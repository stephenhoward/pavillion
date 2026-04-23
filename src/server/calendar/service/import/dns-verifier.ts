import config from 'config';
import { fetch as undiciFetch } from 'undici';
import { getPublicSuffix, parse as parseTld } from 'tldts';

import {
  ImportSourceDnsVerificationError,
  IMPORT_DNS_NOT_FOUND,
  IMPORT_DNS_MISMATCH,
  IMPORT_DNS_RESOLVER_DISAGREEMENT,
  IMPORT_DNS_RESOLVER_UNAVAILABLE,
  IMPORT_DNS_PSL_VIOLATION,
} from '@/common/exceptions/import';
import { formatVerificationRecord } from '@/server/calendar/service/import/hmac';
import { createLogger } from '@/server/common/helper/logger';
import { validateUrlNotPrivate } from '@/server/common/helper/ip-validation';

/**
 * DNS TXT ownership verification for ICS import sources.
 *
 * Verification contract:
 * - Record name: `_pavillion-challenge.{hostname}` derived from source URL
 * - Expected value: `pavillion-verify=v1:{instance-host}:{hmac-token}` (see hmac.ts)
 * - Query TXT via DoH from two configurable resolvers
 *   (config `calendar.import.dohResolvers`, defaults 1.1.1.1 + 8.8.8.8)
 * - Both resolvers must independently see a matching record
 *   (among possibly many TXT records at the name) for success
 * - Fail closed on any resolver unavailability (network, non-200, malformed JSON)
 * - PSL alignment via tldts: hostname must be strictly below its public suffix
 *
 * Privacy:
 * - User-visible messages are drawn exclusively from the fixed sanitized set
 *   declared in `src/common/exceptions/import.ts`. Raw resolver responses,
 *   URLs, and hostnames go only to the debug log.
 *
 * @see security-playbook — configuration, public-api
 * @see privacy-playbook — error-responses, logging
 */

const logger = createLogger('calendar.import.dns-verifier');

/** Validity window for a successful DNS verification. */
export const VERIFICATION_VALIDITY_DAYS = 90;

/** Post-expiry grace window before sync is blocked. */
export const VERIFICATION_GRACE_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface DnsVerifyInput {
  sourceId: string;
  calendarId: string;
  sourceUrl: string;
}

export interface DnsVerifyResult {
  verified: true;
  verifiedAt: Date;
  expiresAt: Date;
}

/**
 * Minimal fetch signature used by the verifier. Accepting this as a
 * constructor dependency keeps the production path on `undici.fetch`
 * while allowing tests to inject a stub without stubbing ES Modules.
 */
export type DohFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

interface DohAnswer {
  name: string;
  type: number;
  TTL?: number;
  data: string;
}

interface DohJsonResponse {
  Status: number;
  Answer?: DohAnswer[];
}

/**
 * Returns true iff a previously-recorded verification is still inside its
 * 90-day validity window.
 */
export function isVerificationCurrentlyValid(
  expiresAt: Date,
  now: Date = new Date(),
): boolean {
  return now.getTime() < expiresAt.getTime();
}

/**
 * Returns true iff now is inside the post-expiry grace window
 * [expiresAt, expiresAt + 14d). Callers typically still allow read-only
 * access during grace but block new syncs after it ends.
 */
export function isWithinGracePeriod(
  expiresAt: Date,
  now: Date = new Date(),
): boolean {
  const graceEnd = expiresAt.getTime() + VERIFICATION_GRACE_DAYS * MS_PER_DAY;
  const n = now.getTime();
  return n >= expiresAt.getTime() && n < graceEnd;
}

/**
 * Extracts the effective hostname from a source URL. Returns null if the
 * URL is unparseable or has no hostname.
 */
function hostnameFromUrl(sourceUrl: string): string | null {
  try {
    const u = new URL(sourceUrl);
    return u.hostname.toLowerCase() || null;
  }
  catch {
    return null;
  }
}

/**
 * PSL check: reject hostnames that are at or above the public suffix.
 * For example, `co.uk` (a public suffix itself) must be rejected, while
 * `example.co.uk` and `events.example.com` are accepted.
 */
function passesPslCheck(hostname: string): boolean {
  // getPublicSuffix returns the public suffix portion, or null if the host
  // is itself not under any known suffix (e.g. bare `com`).
  const parsed = parseTld(hostname);
  if (!parsed || !parsed.hostname) {
    return false;
  }
  // A valid registrable domain must exist (i.e. there is something below
  // the public suffix). `domain` is null when the hostname equals or sits
  // above the suffix.
  if (!parsed.domain) {
    return false;
  }
  // Belt-and-suspenders: ensure hostname != public suffix itself.
  const suffix = getPublicSuffix(hostname);
  if (suffix && suffix === hostname) {
    return false;
  }
  return true;
}

/**
 * DNS-over-HTTPS TXT verifier.
 */
export class DnsVerifier {
  private readonly fetchImpl: DohFetch;
  private validatedResolvers: Promise<string[]> | null = null;

  constructor(fetchImpl?: DohFetch) {
    this.fetchImpl = fetchImpl ?? (undiciFetch as unknown as DohFetch);
  }

  /**
   * Attempts to verify the ownership record for an import source.
   *
   * Throws {@link ImportSourceDnsVerificationError} with one of the fixed
   * sanitized reason codes on failure. On success, returns the window for
   * persisting on the ImportSourceEntity.
   */
  async verify(input: DnsVerifyInput): Promise<DnsVerifyResult> {
    const { sourceId, calendarId, sourceUrl } = input;

    const hostname = hostnameFromUrl(sourceUrl);
    if (!hostname) {
      logger.debug({ sourceId, calendarId }, 'unparseable source URL');
      throw new ImportSourceDnsVerificationError(IMPORT_DNS_PSL_VIOLATION);
    }

    if (!passesPslCheck(hostname)) {
      logger.debug(
        { sourceId, calendarId, hostname },
        'hostname failed PSL alignment; challenge record would fall at/above public suffix',
      );
      throw new ImportSourceDnsVerificationError(IMPORT_DNS_PSL_VIOLATION);
    }

    const recordName = `_pavillion-challenge.${hostname}`;
    const expectedValue = formatVerificationRecord(sourceId, calendarId);
    const resolvers = await this.getResolvers();

    // Query each resolver; each resolver is a pass/fail independently.
    // Fail CLOSED: any resolver unavailability → IMPORT_DNS_RESOLVER_UNAVAILABLE.
    const results: Array<{ resolver: string; matched: boolean; hadRecords: boolean }> = [];

    for (const resolver of resolvers) {
      let records: string[];
      try {
        records = await this.queryTxt(resolver, recordName);
      }
      catch (err) {
        logger.debug(
          { sourceId, calendarId, resolver, recordName, err },
          'DoH query failed; failing closed',
        );
        throw new ImportSourceDnsVerificationError(IMPORT_DNS_RESOLVER_UNAVAILABLE);
      }

      const matched = records.some((r) => r === expectedValue);
      results.push({ resolver, matched, hadRecords: records.length > 0 });
    }

    const allMatched = results.every((r) => r.matched);
    if (allMatched) {
      const verifiedAt = new Date();
      const expiresAt = new Date(verifiedAt.getTime() + VERIFICATION_VALIDITY_DAYS * MS_PER_DAY);
      logger.debug(
        { sourceId, calendarId, recordName, expiresAt },
        'DNS verification succeeded',
      );
      return { verified: true, verifiedAt, expiresAt };
    }

    const anyMatched = results.some((r) => r.matched);
    if (anyMatched) {
      // Some resolvers see it, others do not → disagreement.
      logger.debug(
        { sourceId, calendarId, recordName, results },
        'resolver disagreement on verification record',
      );
      throw new ImportSourceDnsVerificationError(IMPORT_DNS_RESOLVER_DISAGREEMENT);
    }

    const anyHadRecords = results.some((r) => r.hadRecords);
    if (anyHadRecords) {
      logger.debug(
        { sourceId, calendarId, recordName },
        'TXT records present but none match expected verification value',
      );
      throw new ImportSourceDnsVerificationError(IMPORT_DNS_MISMATCH);
    }

    logger.debug(
      { sourceId, calendarId, recordName },
      'no TXT records at challenge name',
    );
    throw new ImportSourceDnsVerificationError(IMPORT_DNS_NOT_FOUND);
  }

  private async getResolvers(): Promise<string[]> {
    if (!this.validatedResolvers) {
      this.validatedResolvers = this.loadAndValidateResolvers();
    }
    try {
      return await this.validatedResolvers;
    }
    catch (err) {
      // Reset memo so the next verify() retries validation rather than being
      // permanently poisoned by a transient issue (e.g. DNS blip during the
      // resolver-hostname lookup). The error itself is already sanitized.
      this.validatedResolvers = null;
      throw err;
    }
  }

  /**
   * Loads the configured DoH resolver URLs and validates each against SSRF
   * protections: https scheme only, and hostnames must not resolve to private,
   * loopback, link-local, or otherwise-unroutable ranges (defense against a
   * compromised or misconfigured config pointing at e.g. 169.254.169.254
   * cloud metadata or internal services).
   *
   * Fails CLOSED: any invalid resolver surfaces as IMPORT_DNS_RESOLVER_UNAVAILABLE,
   * honoring the sanitized error surface (no URLs or hostnames leak to callers).
   */
  private async loadAndValidateResolvers(): Promise<string[]> {
    const resolvers = config.get<string[]>('calendar.import.dohResolvers');
    if (!Array.isArray(resolvers) || resolvers.length < 2) {
      // Configuration bug: dual-resolver is a hard requirement. Surface as
      // resolver-unavailable (fail closed) rather than a different code so
      // the sanitized error surface is honored.
      logger.error(
        { resolverCount: Array.isArray(resolvers) ? resolvers.length : 'invalid' },
        'calendar.import.dohResolvers must contain at least two resolvers',
      );
      throw new ImportSourceDnsVerificationError(IMPORT_DNS_RESOLVER_UNAVAILABLE);
    }

    for (const resolverUrl of resolvers) {
      try {
        await validateUrlNotPrivate(resolverUrl);
      }
      catch (err) {
        logger.warn(
          { resolverUrl, err: (err as Error).message },
          'calendar.import.dohResolvers contains an unsafe URL; rejecting (SSRF defense)',
        );
        throw new ImportSourceDnsVerificationError(IMPORT_DNS_RESOLVER_UNAVAILABLE);
      }
    }

    return resolvers;
  }

  /**
   * Queries a DoH resolver for TXT records at the given name. Returns the
   * list of record values (quotes stripped). Throws on any transport or
   * decoding failure — the caller translates that to IMPORT_DNS_RESOLVER_UNAVAILABLE.
   */
  private async queryTxt(resolverUrl: string, name: string): Promise<string[]> {
    const url = `${resolverUrl}?name=${encodeURIComponent(name)}&type=TXT`;
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/dns-json' },
    });

    if (!response.ok) {
      throw new Error(`DoH non-OK status: ${response.status}`);
    }

    const bodyText = await response.text();
    let parsed: DohJsonResponse;
    try {
      parsed = JSON.parse(bodyText) as DohJsonResponse;
    }
    catch (err) {
      throw new Error(`DoH JSON parse failure: ${(err as Error).message}`);
    }

    // Status 0 = NOERROR per RFC 1035. Status 3 = NXDOMAIN; we treat that as
    // "no records" rather than an unavailable resolver.
    if (parsed.Status !== 0 && parsed.Status !== 3) {
      throw new Error(`DoH non-NOERROR status: ${parsed.Status}`);
    }

    if (!Array.isArray(parsed.Answer)) {
      return [];
    }

    return parsed.Answer
      .filter((a) => a.type === 16) // TXT
      .map((a) => stripTxtQuotes(a.data));
  }
}

/**
 * DoH JSON encodes TXT values wrapped in double-quotes (e.g. "foo").
 * When a single TXT record spans multiple strings, DoH can return them
 * concatenated like `"part1" "part2"` — we join them into the raw value.
 */
function stripTxtQuotes(data: string): string {
  // Match all quoted segments and concatenate their contents
  const matches = data.match(/"([^"]*)"/g);
  if (!matches) {
    return data.trim();
  }
  return matches.map((m) => m.slice(1, -1)).join('');
}
