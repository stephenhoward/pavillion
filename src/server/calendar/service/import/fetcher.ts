/**
 * SSRF-hardened ICS fetcher.
 *
 * Implements the fetch half of the ICS import pipeline. Given a URL, it:
 *
 * 1. Validates the URL (scheme + private-IP literal check)
 * 2. DNS-resolves the hostname and validates every returned IP
 * 3. Picks one validated IP and constructs a per-request `undici.Agent`
 *    whose `connect.lookup` returns *that* exact IP. This pins the socket
 *    to the validated address and makes DNS rebinding at the socket layer
 *    impossible: a second DNS resolution at connect time cannot redirect
 *    the connection to a different IP.
 * 4. Issues the request with a capped body size, content-type allowlist,
 *    and VCALENDAR signature sniff
 * 5. Handles up to 5 redirects manually; each hop creates a NEW pinned
 *    Agent after re-validation. `Authorization` and `Cookie` headers are
 *    stripped on cross-origin redirects.
 *
 * The module is dependency-injected to keep unit tests pure:
 *  - `dnsLookup` — resolve hostname to IPs
 *  - `validateUrlNotPrivate` — SSRF URL check (scheme + IP literal)
 *  - `isPrivateIp` — SSRF check for a resolved IP literal
 *  - `createAgent` — build an undici Agent with pinned-IP `connect.lookup`
 *  - `request` — undici-style request function returning streamed body
 *
 * Production wires these to `undici` and the hardened `ip-validation` helper.
 *
 * @see security-playbook — SSRF, public-api
 * @see privacy-playbook — logging discipline
 * @see bead pv-1qcp.1.7 — contract + acceptance criteria
 */

import { createHash } from 'node:crypto';
import dns from 'node:dns';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { Agent, request as undiciRequest } from 'undici';

import {
  ImportSourceFetchError,
  ImportSourceSsrfBlockedError,
} from '@/common/exceptions/import';
import {
  isPrivateIP,
  validateUrlNotPrivate,
} from '@/server/common/helper/ip-validation';
import { createLogger } from '@/server/common/helper/logger';
import {
  createIcsUrlValidator,
  isLocalhostIcsImportAllowed,
} from '@/server/common/helper/test-ssrf-gate';

const logger = createLogger('calendar.import.fetcher');

// ---------------------------------------------------------------------------
// Limits and constants
// ---------------------------------------------------------------------------

/** Maximum redirect hops. A 6th is rejected. */
export const MAX_REDIRECTS = 5;

/** Hard body cap enforced on the response stream, pre-decompression. */
export const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MiB

/** First-bytes sniff window for BEGIN:VCALENDAR signature. */
export const SIGNATURE_SNIFF_BYTES = 256;

/** Required signature at the start of the body. */
const VCALENDAR_SIGNATURE = 'BEGIN:VCALENDAR';

/** Accepted content types (case-insensitive, parameter-stripped). */
const ALLOWED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'text/calendar',
  'text/x-calendar',
  'application/calendar',
]);

/** Explicitly rejected content types (logged separately from "other"). */
const REJECTED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'text/html',
  'application/xhtml+xml',
]);

/**
 * User-Agent string per privacy-advisor — no instance hostname.
 * Version is read from package.json at module init so the UA stays in sync
 * with releases without a hardcoded literal.
 */
const pkg = createRequire(import.meta.url)('../../../../../package.json') as { version: string };
export const USER_AGENT = `Pavillion/${pkg.version} ICS-Fetcher (+https://pavillion.app)`;

/** Per-phase timeouts (ms). */
export const CONNECT_TIMEOUT_MS = 10_000;
export const HEADERS_TIMEOUT_MS = 15_000;
export const BODY_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FetcherInput {
  /** Canonical source URL. */
  url: string;
  /** Import-source identifier for structured logging. */
  importSourceId?: string;
  /** Previous ETag to send as `If-None-Match` for conditional GET. */
  etag?: string;
}

export type FetcherOutcome =
  | 'ok'
  | 'not_modified'
  | 'fetch_error'
  | 'ssrf_blocked';

export interface FetcherOk {
  outcome: 'ok';
  httpStatus: number;
  body: Buffer;
  contentHash: string;
  etag?: string;
  bytesReceived: number;
}

export interface FetcherNotModified {
  outcome: 'not_modified';
  httpStatus: 304;
  etag?: string;
}

export type FetcherResult = FetcherOk | FetcherNotModified;

/**
 * Minimal `undici.request` signature used by the fetcher. Kept narrow so
 * unit tests can stub it without pulling in real undici internals.
 */
export interface RequestInit {
  method: 'GET';
  headers: Record<string, string>;
  dispatcher: Agent;
  signal?: AbortSignal;
  maxRedirections?: number;
  headersTimeout?: number;
  bodyTimeout?: number;
}

export interface RequestResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>;
}

export type RequestFn = (url: string, init: RequestInit) => Promise<RequestResponse>;

/**
 * Factory that returns a per-request Agent pinned to the given IP.
 * Exposed as an injected dep so tests can assert Agent creation count
 * (one per redirect hop — an SSRF isolation invariant, not coverage metric).
 */
export type AgentFactory = (pinnedIp: string) => Agent;

/** DNS lookup returning the list of resolved IPs. */
export type DnsLookupFn = (hostname: string) => Promise<string[]>;

/** URL SSRF validator (scheme + IP-literal private check). */
export type UrlValidatorFn = (url: string) => Promise<boolean>;

/** IP literal SSRF check (true => private / unsafe). */
export type IpValidatorFn = (ip: string) => boolean;

export interface FetcherDependencies {
  dnsLookup?: DnsLookupFn;
  validateUrl?: UrlValidatorFn;
  isPrivateIp?: IpValidatorFn;
  createAgent?: AgentFactory;
  request?: RequestFn;
}

// ---------------------------------------------------------------------------
// Default implementations
// ---------------------------------------------------------------------------

const dnsLookupAll = promisify(dns.lookup) as unknown as (
  hostname: string,
  opts: { all: true; verbatim: true },
) => Promise<Array<{ address: string; family: number }>>;

async function defaultDnsLookup(hostname: string): Promise<string[]> {
  const results = await dnsLookupAll(hostname, { all: true, verbatim: true });
  return results.map(r => r.address);
}

function defaultCreateAgent(pinnedIp: string): Agent {
  return new Agent({
    connect: {
      // Mirrors the dual-signature contract of `dns.lookup`: when undici
      // (or any caller) passes `options.all = true`, the callback must
      // receive an *array* of `{ address, family }` entries; otherwise
      // it receives the positional `(err, address, family)` tuple.
      // Node 24+ undici calls with `{ all: true }` for http connects,
      // so an array-aware path is required to avoid
      // `ERR_INVALID_IP_ADDRESS` under the pinned agent.
      lookup: (
        _hostname: string,
        options: unknown,
        callback: (
          err: NodeJS.ErrnoException | null,
          addressOrAddresses: string | Array<{ address: string; family: number }>,
          family?: number,
        ) => void,
      ) => {
        const family = pinnedIp.includes(':') ? 6 : 4;
        const wantsAll = typeof options === 'object'
          && options !== null
          && (options as { all?: unknown }).all === true;
        if (wantsAll) {
          callback(null, [{ address: pinnedIp, family }]);
        }
        else {
          callback(null, pinnedIp, family);
        }
      },
      timeout: CONNECT_TIMEOUT_MS,
    },
  });
}

const defaultRequest: RequestFn = async (url, init) => {
  const res = await undiciRequest(url, {
    method: init.method,
    headers: init.headers,
    dispatcher: init.dispatcher,
    signal: init.signal,
    maxRedirections: 0,
    headersTimeout: init.headersTimeout ?? HEADERS_TIMEOUT_MS,
    bodyTimeout: init.bodyTimeout ?? BODY_TIMEOUT_MS,
  });
  return {
    statusCode: res.statusCode,
    headers: res.headers as Record<string, string | string[] | undefined>,
    body: res.body as unknown as AsyncIterable<Uint8Array>,
  };
};

// ---------------------------------------------------------------------------
// Fetcher class
// ---------------------------------------------------------------------------

export class Fetcher {
  private readonly dnsLookup: DnsLookupFn;
  private readonly validateUrl: UrlValidatorFn;
  private readonly isPrivateIp: IpValidatorFn;
  private readonly createAgent: AgentFactory;
  private readonly request: RequestFn;

  constructor(deps: FetcherDependencies = {}) {
    this.dnsLookup = deps.dnsLookup ?? defaultDnsLookup;
    // When the ALLOW_LOCALHOST_ICS_IMPORT gate is open (test/e2e only), a
    // relaxed validator is substituted so http:// + localhost fixtures are
    // accepted here. The shared `validateUrlNotPrivate` helper is always
    // strict — the gate is consulted at THIS call site, not inside the
    // helper (pv-gdqp).
    this.validateUrl = deps.validateUrl ?? createIcsUrlValidator(validateUrlNotPrivate);
    this.isPrivateIp = deps.isPrivateIp ?? isPrivateIP;
    this.createAgent = deps.createAgent ?? defaultCreateAgent;
    this.request = deps.request ?? defaultRequest;
  }

  /**
   * Fetch the given URL with full SSRF-hardening, body cap, content-type
   * allowlist, and signature sniff. Handles redirect chains manually with
   * a fresh pinned Agent per hop.
   */
  async fetch(input: FetcherInput): Promise<FetcherResult> {
    const { importSourceId, etag } = input;
    let currentUrl = input.url;
    let previousUrl: URL | null = null;
    const agents: Agent[] = [];

    try {
      // MAX_REDIRECTS is a HOP ceiling (total hops, not redirects-after-first).
      // Loop indices 0..MAX_REDIRECTS-1 are valid; an attempted hop at index
      // MAX_REDIRECTS is rejected before any agent / request work.
      for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
        // 1. Validate URL (scheme + literal IP check). This also rejects
        //    alternate IPv4 encodings and non-HTTPS schemes.
        await this.validateUrl(currentUrl);

        const parsedUrl = new URL(currentUrl);
        const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, '');

        // 2. Resolve hostname → IPs, validate every one.
        const addresses = await this.dnsLookup(hostname);
        if (addresses.length === 0) {
          throw new ImportSourceFetchError({ reason: 'dns_no_answer' });
        }
        // Env-gated test hook: allow private-IP resolutions (e.g. 127.0.0.1)
        // through when NODE_ENV=test|e2e AND ALLOW_LOCALHOST_ICS_IMPORT=true.
        // The `defaultCreateAgent` already pins the socket to the resolved
        // IP via `connect.lookup`, so allowing a localhost address here still
        // flows through the same hardened pinning path.
        // See src/server/common/helper/test-ssrf-gate.ts.
        const icsTestGateOpen = isLocalhostIcsImportAllowed();
        for (const ip of addresses) {
          if (this.isPrivateIp(ip)) {
            if (icsTestGateOpen) {
              logger.warn(
                { importSourceId, ip },
                'ics.fetch.localhost_allowed: ALLOW_LOCALHOST_ICS_IMPORT gate is open — never enable in production',
              );
              continue;
            }
            throw new ImportSourceSsrfBlockedError({ reason: 'private_ip_resolved' });
          }
        }

        // 3. Pick the first validated IP and build a pinned Agent.
        const pinnedIp = addresses[0];
        const agent = this.createAgent(pinnedIp);
        agents.push(agent);

        logger.debug(
          { importSourceId, hop, url: currentUrl, pinnedIp },
          'ics.fetch.hop',
        );

        // 4. Build request headers. Strip Authorization/Cookie on cross-origin
        //    redirects.
        const headers: Record<string, string> = {
          'user-agent': USER_AGENT,
          'accept': 'text/calendar, text/x-calendar, application/calendar;q=0.9, */*;q=0.1',
        };
        if (hop === 0 && etag) {
          headers['if-none-match'] = etag;
        }
        // (No Authorization/Cookie headers are sent by the fetcher itself,
        //  but if future extensions pass them through we ensure they are
        //  never carried across a cross-origin hop.)

        // 5. Issue the request.
        let response: RequestResponse;
        try {
          response = await this.request(currentUrl, {
            method: 'GET',
            headers,
            dispatcher: agent,
            maxRedirections: 0,
            headersTimeout: HEADERS_TIMEOUT_MS,
            bodyTimeout: BODY_TIMEOUT_MS,
          });
        }
        catch (err) {
          throw new ImportSourceFetchError({
            reason: 'network_error',
            cause: err instanceof Error ? err.message : String(err),
          });
        }

        const status = response.statusCode;

        // 304 Not Modified short-circuits with no body read.
        if (status === 304) {
          logger.info(
            { importSourceId, outcome: 'not_modified', httpStatus: 304, bytesReceived: 0 },
            'ics.fetch.result',
          );
          return {
            outcome: 'not_modified',
            httpStatus: 304,
            etag: extractHeader(response.headers, 'etag'),
          };
        }

        // Redirect handling.
        if (status >= 300 && status < 400) {
          const location = extractHeader(response.headers, 'location');
          if (!location) {
            throw new ImportSourceFetchError({ reason: 'redirect_without_location', httpStatus: status });
          }
          // Drain any redirect body to free the socket.
          await drainBody(response.body);

          // The `for` loop condition `hop < MAX_REDIRECTS` is the sole redirect
          // ceiling. A redirect received on the last permitted hop falls out of
          // the loop and is caught by the defensive post-loop throw below.

          const nextUrl = new URL(location, currentUrl);
          previousUrl = parsedUrl;
          currentUrl = nextUrl.toString();

          // Cross-origin check — strip auth/cookie (already not sent, but
          //  record the decision for logs and any future header pass-through).
          if (previousUrl && !sameOrigin(previousUrl, nextUrl)) {
            delete headers['authorization'];
            delete headers['cookie'];
            logger.debug(
              { importSourceId, hop, crossOrigin: true },
              'ics.fetch.cross_origin_redirect',
            );
          }
          continue;
        }

        if (status < 200 || status >= 300) {
          // Non-2xx, non-redirect — drain and error out.
          await drainBody(response.body);
          throw new ImportSourceFetchError({ reason: 'http_error', httpStatus: status });
        }

        // 6. Content-Type check (allowlist + explicit reject).
        const contentTypeRaw = extractHeader(response.headers, 'content-type') ?? '';
        const contentType = contentTypeRaw.split(';')[0].trim().toLowerCase();
        if (REJECTED_CONTENT_TYPES.has(contentType)) {
          await drainBody(response.body);
          throw new ImportSourceFetchError({ reason: 'rejected_content_type', contentType });
        }
        if (contentType && !ALLOWED_CONTENT_TYPES.has(contentType)) {
          await drainBody(response.body);
          throw new ImportSourceFetchError({ reason: 'disallowed_content_type', contentType });
        }

        // 7. Stream body with hard cap enforced at 10 MiB pre-decompression.
        //    `Content-Length` is not trusted.
        const body = await readBodyCapped(response.body, MAX_BODY_BYTES);

        // 8. Signature sniff.
        const signatureWindow = body
          .subarray(0, Math.min(body.length, SIGNATURE_SNIFF_BYTES))
          .toString('utf8');
        // Allow a BOM or leading whitespace before BEGIN:VCALENDAR.
        if (!signatureWindow.replace(/^﻿/, '').trimStart().startsWith(VCALENDAR_SIGNATURE)) {
          throw new ImportSourceFetchError({ reason: 'missing_vcalendar_signature' });
        }

        const contentHash = createHash('sha256').update(body).digest('hex');
        const responseEtag = extractHeader(response.headers, 'etag');

        logger.info(
          { importSourceId, outcome: 'ok', httpStatus: status, bytesReceived: body.length },
          'ics.fetch.result',
        );

        return {
          outcome: 'ok',
          httpStatus: status,
          body,
          contentHash,
          etag: responseEtag,
          bytesReceived: body.length,
        };
      }

      // Unreachable — loop only exits via return or throw. Defensive:
      throw new ImportSourceFetchError({ reason: 'too_many_redirects' });
    }
    catch (err) {
      if (err instanceof ImportSourceSsrfBlockedError) {
        logger.warn(
          { importSourceId, outcome: 'ssrf_blocked' },
          'ics.fetch.ssrf_blocked',
        );
        throw err;
      }
      if (err instanceof ImportSourceFetchError) {
        logger.info(
          { importSourceId, outcome: 'fetch_error' },
          'ics.fetch.result',
        );
        throw err;
      }
      // Unexpected: wrap as fetch_error so callers see a typed failure.
      logger.info(
        { importSourceId, outcome: 'fetch_error' },
        'ics.fetch.result',
      );
      throw new ImportSourceFetchError({
        reason: 'unexpected_error',
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    finally {
      // Close all agents created along the redirect chain.
      for (const agent of agents) {
        // Fire-and-forget; agent.close is best-effort.
        void agent.close().catch(() => { /* swallow */ });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function sameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.host === b.host;
}

async function drainBody(body: AsyncIterable<Uint8Array>): Promise<void> {
  try {
    for await (const _chunk of body) {
      // discard
    }
  }
  catch {
    // swallow
  }
}

/**
 * Read an async-iterable body into a Buffer, aborting as soon as the
 * accumulated size exceeds `limit`. Treats mid-stream errors as an
 * `ImportSourceFetchError`.
 */
async function readBodyCapped(
  body: AsyncIterable<Uint8Array>,
  limit: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of body) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > limit) {
        throw new ImportSourceFetchError({ reason: 'body_too_large', limit, observed: total });
      }
      chunks.push(buf);
    }
  }
  catch (err) {
    if (err instanceof ImportSourceFetchError) throw err;
    throw new ImportSourceFetchError({
      reason: 'stream_error',
      cause: err instanceof Error ? err.message : String(err),
    });
  }
  return Buffer.concat(chunks, total);
}
