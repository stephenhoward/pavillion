import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { Agent } from 'undici';

import {
  Fetcher,
  MAX_REDIRECTS,
  MAX_BODY_BYTES,
  USER_AGENT,
  ICS_FETCH_POLICY,
  IMAGE_FETCH_CONTENT_TYPES,
  createImageFetchPolicy,
  type RequestFn,
  type RequestResponse,
  type AgentFactory,
  type DnsLookupFn,
  type IpValidatorFn,
} from '@/server/calendar/service/import/fetcher';
import type { UploadConstraints } from '@/server/media/interface';
import type { UrlValidatorFn } from '@/server/calendar/service/import/types';
import {
  ImportSourceFetchError,
  ImportSourceSsrfBlockedError,
  IMPORT_FETCH_ERROR,
  IMPORT_SSRF_BLOCKED,
} from '@/common/exceptions/import';

/**
 * Build a fake RequestResponse whose body yields the given chunks in order.
 */
function makeResponse(
  statusCode: number,
  headers: Record<string, string | string[] | undefined>,
  bodyChunks: Uint8Array[] = [],
): RequestResponse {
  return {
    statusCode,
    headers,
    body: (async function* () {
      for (const chunk of bodyChunks) {
        yield chunk;
      }
    })(),
  };
}

/** Response whose body throws mid-iteration to simulate a mid-stream disconnect. */
function makeDisconnectingResponse(
  statusCode: number,
  headers: Record<string, string | string[] | undefined>,
  prefix: Uint8Array,
): RequestResponse {
  return {
    statusCode,
    headers,
    body: (async function* () {
      yield prefix;
      throw new Error('socket hang up');
    })(),
  };
}

/** Response whose body yields chunks totalling more than `limit` bytes. */
function makeHugeResponse(
  statusCode: number,
  headers: Record<string, string | string[] | undefined>,
  totalBytes: number,
): RequestResponse {
  const CHUNK_SIZE = 64 * 1024;
  return {
    statusCode,
    headers,
    body: (async function* () {
      let emitted = 0;
      while (emitted < totalBytes) {
        const size = Math.min(CHUNK_SIZE, totalBytes - emitted);
        yield new Uint8Array(size);
        emitted += size;
      }
    })(),
  };
}

const VCAL_OK = Buffer.from('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n', 'utf8');

describe('Fetcher', () => {
  const sandbox = sinon.createSandbox();

  let dnsLookup: sinon.SinonStub & DnsLookupFn;
  let validateUrl: sinon.SinonStub & UrlValidatorFn;
  let isPrivateIp: sinon.SinonStub & IpValidatorFn;
  let createAgent: sinon.SinonStub & AgentFactory;
  let request: sinon.SinonStub & RequestFn;

  function buildFetcher(): Fetcher {
    return new Fetcher({
      dnsLookup,
      validateUrl,
      isPrivateIp,
      createAgent,
      request,
    });
  }

  beforeEach(() => {
    dnsLookup = sandbox.stub<[string], Promise<string[]>>() as sinon.SinonStub & DnsLookupFn;
    (dnsLookup as sinon.SinonStub).resolves(['203.0.113.10']);

    validateUrl = sandbox.stub<[string], Promise<boolean>>() as sinon.SinonStub & UrlValidatorFn;
    (validateUrl as sinon.SinonStub).resolves(true);

    isPrivateIp = sandbox.stub<[string], boolean>().returns(false) as sinon.SinonStub & IpValidatorFn;

    createAgent = sandbox.stub<[string], Agent>() as sinon.SinonStub & AgentFactory;
    // The returned object doesn't need to be a real Agent — the fetcher only
    // passes it through to `request`, and tests stub `request`.
    (createAgent as sinon.SinonStub).callsFake((ip: string) => {
      return { __pinnedIp: ip, close: () => Promise.resolve() } as unknown as Agent;
    });

    request = sandbox.stub<[string, unknown], Promise<RequestResponse>>() as sinon.SinonStub & RequestFn;
  });

  afterEach(() => {
    sandbox.restore();
  });

  // -------------------------------------------------------------------------
  // Pinned-IP Agent contract
  // -------------------------------------------------------------------------

  describe('pinned-IP Agent', () => {
    it('constructs an Agent pinned to the DNS-resolved IP for the request', async () => {
      (dnsLookup as sinon.SinonStub).resolves(['198.51.100.77']);
      (request as sinon.SinonStub).resolves(makeResponse(200, { 'content-type': 'text/calendar' }, [VCAL_OK]));

      const result = await buildFetcher().fetch({ url: 'https://example.org/cal.ics' });

      expect(result.outcome).toBe('ok');
      expect((dnsLookup as sinon.SinonStub).callCount).toBe(1);
      expect((createAgent as sinon.SinonStub).callCount).toBe(1);
      expect((createAgent as sinon.SinonStub).firstCall.args[0]).toBe('198.51.100.77');

      // Assert the Agent constructed with the pinned IP was passed to request.
      const reqCall = (request as sinon.SinonStub).firstCall;
      const dispatcher = reqCall.args[1].dispatcher as unknown as { __pinnedIp: string };
      expect(dispatcher.__pinnedIp).toBe('198.51.100.77');
    });

    it('rejects when DNS returns zero addresses', async () => {
      (dnsLookup as sinon.SinonStub).resolves([]);

      try {
        await buildFetcher().fetch({ url: 'https://example.org/cal.ics' });
        expect.fail('Expected ImportSourceFetchError');
      }
      catch (err) {
        expect(err).toBeInstanceOf(ImportSourceFetchError);
        expect((err as ImportSourceFetchError).message).toBe(IMPORT_FETCH_ERROR);
      }
      expect((createAgent as sinon.SinonStub).called).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // DNS rebinding defense
  // -------------------------------------------------------------------------

  describe('DNS rebinding defense', () => {
    it('blocks when any resolved IP is private — simulated rebinder', async () => {
      // DNS returns one public and one private IP. isPrivateIp returns true
      // for the private one — this must abort the fetch entirely.
      (dnsLookup as sinon.SinonStub).resolves(['203.0.113.5', '10.0.0.1']);
      (isPrivateIp as sinon.SinonStub).callsFake((ip: string) => ip.startsWith('10.'));

      try {
        await buildFetcher().fetch({ url: 'https://rebinder.example/cal.ics' });
        expect.fail('Expected ImportSourceSsrfBlockedError');
      }
      catch (err) {
        expect(err).toBeInstanceOf(ImportSourceSsrfBlockedError);
        expect((err as ImportSourceSsrfBlockedError).message).toBe(IMPORT_SSRF_BLOCKED);
      }
      // Agent must NEVER be created once a private IP is observed.
      expect((createAgent as sinon.SinonStub).called).toBe(false);
      expect((request as sinon.SinonStub).called).toBe(false);
    });

    it('blocks on a redirect target that resolves to a private IP', async () => {
      // First hop: public. Second hop: private.
      (dnsLookup as sinon.SinonStub).onCall(0).resolves(['203.0.113.10']);
      (dnsLookup as sinon.SinonStub).onCall(1).resolves(['192.168.1.1']);
      (isPrivateIp as sinon.SinonStub).callsFake((ip: string) =>
        ip.startsWith('192.168.') || ip.startsWith('10.'));

      (request as sinon.SinonStub).onCall(0).resolves(
        makeResponse(302, { location: 'https://internal.example/secret' }, []),
      );

      try {
        await buildFetcher().fetch({ url: 'https://public.example/cal.ics' });
        expect.fail('Expected ImportSourceSsrfBlockedError');
      }
      catch (err) {
        expect(err).toBeInstanceOf(ImportSourceSsrfBlockedError);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Redirect chain
  // -------------------------------------------------------------------------

  describe('redirect chain', () => {
    it('follows up to 5 redirects successfully; Agent count equals hop count', async () => {
      // NOTE: Agent count == hop count is an SSRF isolation invariant. Each
      // hop MUST create a new pinned Agent; relaxing this defeats the
      // rebinding defense. Do not change this assertion lightly.
      (dnsLookup as sinon.SinonStub).resolves(['203.0.113.10']);

      // 4 redirects then a 200 with body — 5 total hops.
      (request as sinon.SinonStub).onCall(0).resolves(
        makeResponse(301, { location: 'https://a.example/1' }, []),
      );
      (request as sinon.SinonStub).onCall(1).resolves(
        makeResponse(302, { location: 'https://a.example/2' }, []),
      );
      (request as sinon.SinonStub).onCall(2).resolves(
        makeResponse(303, { location: 'https://a.example/3' }, []),
      );
      (request as sinon.SinonStub).onCall(3).resolves(
        makeResponse(307, { location: 'https://a.example/4' }, []),
      );
      (request as sinon.SinonStub).onCall(4).resolves(
        makeResponse(200, { 'content-type': 'text/calendar' }, [VCAL_OK]),
      );

      const result = await buildFetcher().fetch({ url: 'https://a.example/0' });

      expect(result.outcome).toBe('ok');
      expect((request as sinon.SinonStub).callCount).toBe(5);
      expect((createAgent as sinon.SinonStub).callCount).toBe(5);
    });

    it('rejects a 6th redirect (hop limit is 5)', async () => {
      (dnsLookup as sinon.SinonStub).resolves(['203.0.113.10']);
      // 5 redirects — the 6th hop would violate the limit.
      for (let i = 0; i < MAX_REDIRECTS + 1; i++) {
        (request as sinon.SinonStub).onCall(i).resolves(
          makeResponse(302, { location: `https://a.example/${i + 1}` }, []),
        );
      }

      try {
        await buildFetcher().fetch({ url: 'https://a.example/0' });
        expect.fail('Expected ImportSourceFetchError');
      }
      catch (err) {
        expect(err).toBeInstanceOf(ImportSourceFetchError);
      }
      // After the 5th redirect the fetcher rejects before creating a 6th Agent.
      expect((createAgent as sinon.SinonStub).callCount).toBe(MAX_REDIRECTS);
    });

    it('strips Authorization + Cookie on cross-origin redirect', async () => {
      (dnsLookup as sinon.SinonStub).resolves(['203.0.113.10']);

      (request as sinon.SinonStub).onCall(0).resolves(
        makeResponse(302, { location: 'https://other.example/cal.ics' }, []),
      );
      (request as sinon.SinonStub).onCall(1).resolves(
        makeResponse(200, { 'content-type': 'text/calendar' }, [VCAL_OK]),
      );

      await buildFetcher().fetch({ url: 'https://first.example/cal.ics' });

      // SSRF isolation invariant (see 5-hop test for full rationale).
      expect((createAgent as sinon.SinonStub).callCount).toBe(2);

      // Both hops must have no Authorization or Cookie header present.
      for (const call of (request as sinon.SinonStub).getCalls()) {
        const headers = call.args[1].headers as Record<string, string>;
        expect(headers.authorization).toBeUndefined();
        expect(headers.cookie).toBeUndefined();
        expect(headers.Authorization).toBeUndefined();
        expect(headers.Cookie).toBeUndefined();
      }
    });

    it('rejects a redirect without a Location header', async () => {
      (request as sinon.SinonStub).onCall(0).resolves(
        makeResponse(302, {}, []),
      );

      try {
        await buildFetcher().fetch({ url: 'https://a.example/0' });
        expect.fail('Expected ImportSourceFetchError');
      }
      catch (err) {
        expect(err).toBeInstanceOf(ImportSourceFetchError);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Body limits & integrity
  // -------------------------------------------------------------------------

  describe('body limits', () => {
    it('rejects when Content-Length lies and actual body exceeds 10 MiB', async () => {
      // Server declares 100 bytes but streams 12 MiB. The fetcher must not
      // trust the header and must abort at the 10 MiB stream boundary.
      (request as sinon.SinonStub).resolves(
        makeHugeResponse(
          200,
          { 'content-type': 'text/calendar', 'content-length': '100' },
          12 * 1024 * 1024,
        ),
      );

      try {
        await buildFetcher().fetch({ url: 'https://a.example/cal.ics' });
        expect.fail('Expected ImportSourceFetchError');
      }
      catch (err) {
        expect(err).toBeInstanceOf(ImportSourceFetchError);
        const details = (err as ImportSourceFetchError).details as { reason?: string; observed?: number };
        expect(details?.reason).toBe('body_too_large');
        // Prove the stream was cut short — we did not buffer the full 12 MiB.
        expect(details.observed).toBeLessThan(11 * 1024 * 1024);
      }
    });

    it('accepts a body exactly at the limit', async () => {
      // Body of size MAX_BODY_BYTES exactly, starting with BEGIN:VCALENDAR.
      const prefix = Buffer.from('BEGIN:VCALENDAR\r\n', 'utf8');
      const padding = Buffer.alloc(MAX_BODY_BYTES - prefix.length, 0x20);
      const body = Buffer.concat([prefix, padding]);
      (request as sinon.SinonStub).resolves(
        makeResponse(200, { 'content-type': 'text/calendar' }, [body]),
      );

      const result = await buildFetcher().fetch({ url: 'https://a.example/cal.ics' });
      expect(result.outcome).toBe('ok');
    });

    it('throws ImportSourceFetchError on mid-stream disconnect', async () => {
      (request as sinon.SinonStub).resolves(
        makeDisconnectingResponse(
          200,
          { 'content-type': 'text/calendar' },
          Buffer.from('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n', 'utf8'),
        ),
      );

      try {
        await buildFetcher().fetch({ url: 'https://a.example/cal.ics' });
        expect.fail('Expected ImportSourceFetchError');
      }
      catch (err) {
        expect(err).toBeInstanceOf(ImportSourceFetchError);
        const details = (err as ImportSourceFetchError).details as { reason?: string };
        expect(details?.reason).toBe('stream_error');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Content-Type allowlist / signature sniff
  // -------------------------------------------------------------------------

  describe('content type and signature', () => {
    it('rejects text/html outright', async () => {
      (request as sinon.SinonStub).resolves(
        makeResponse(200, { 'content-type': 'text/html; charset=utf-8' }, [Buffer.from('<html/>')]),
      );

      try {
        await buildFetcher().fetch({ url: 'https://a.example/cal.ics' });
        expect.fail('Expected ImportSourceFetchError');
      }
      catch (err) {
        expect(err).toBeInstanceOf(ImportSourceFetchError);
        const details = (err as ImportSourceFetchError).details as { reason?: string; contentType?: string };
        expect(details?.reason).toBe('rejected_content_type');
        expect(details?.contentType).toBe('text/html');
      }
    });

    it('rejects other disallowed content types', async () => {
      (request as sinon.SinonStub).resolves(
        makeResponse(200, { 'content-type': 'application/json' }, [Buffer.from('{}')]),
      );

      try {
        await buildFetcher().fetch({ url: 'https://a.example/cal.ics' });
        expect.fail('Expected ImportSourceFetchError');
      }
      catch (err) {
        expect(err).toBeInstanceOf(ImportSourceFetchError);
        const details = (err as ImportSourceFetchError).details as { reason?: string };
        expect(details?.reason).toBe('disallowed_content_type');
      }
    });

    it('rejects when body does not begin with BEGIN:VCALENDAR', async () => {
      (request as sinon.SinonStub).resolves(
        makeResponse(
          200,
          { 'content-type': 'text/calendar' },
          [Buffer.from('Not a calendar at all, sorry\r\n', 'utf8')],
        ),
      );

      try {
        await buildFetcher().fetch({ url: 'https://a.example/cal.ics' });
        expect.fail('Expected ImportSourceFetchError');
      }
      catch (err) {
        // Classified as FetchError (not ParseError) because the fetcher owns signature validation; ParseError is reserved for downstream ICS parsing failures.
        expect(err).toBeInstanceOf(ImportSourceFetchError);
        const details = (err as ImportSourceFetchError).details as { reason?: string };
        expect(details?.reason).toBe('missing_vcalendar_signature');
      }
    });

    it('accepts content-type variants in the allowlist', async () => {
      for (const ct of ['text/calendar', 'text/x-calendar', 'application/calendar']) {
        (request as sinon.SinonStub).reset();
        (request as sinon.SinonStub).resolves(
          makeResponse(200, { 'content-type': ct }, [VCAL_OK]),
        );
        const r = await buildFetcher().fetch({ url: 'https://a.example/cal.ics' });
        expect(r.outcome).toBe('ok');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Conditional GET / 304
  // -------------------------------------------------------------------------

  describe('conditional GET', () => {
    it('sends If-None-Match when an ETag is provided', async () => {
      (request as sinon.SinonStub).resolves(
        makeResponse(200, { 'content-type': 'text/calendar', etag: '"abc123"' }, [VCAL_OK]),
      );

      await buildFetcher().fetch({ url: 'https://a.example/cal.ics', etag: '"abc123"' });

      const headers = (request as sinon.SinonStub).firstCall.args[1].headers as Record<string, string>;
      expect(headers['if-none-match']).toBe('"abc123"');
    });

    it('returns not_modified on 304 without reading a body', async () => {
      (request as sinon.SinonStub).resolves(
        makeResponse(304, { etag: '"abc123"' }, []),
      );

      const result = await buildFetcher().fetch({ url: 'https://a.example/cal.ics', etag: '"abc123"' });
      expect(result.outcome).toBe('not_modified');
      if (result.outcome === 'not_modified') {
        expect(result.httpStatus).toBe(304);
        expect(result.etag).toBe('"abc123"');
      }
    });
  });

  // -------------------------------------------------------------------------
  // User-Agent / headers
  // -------------------------------------------------------------------------

  describe('User-Agent', () => {
    it('sets the exact spec User-Agent header (no instance hostname)', async () => {
      (request as sinon.SinonStub).resolves(
        makeResponse(200, { 'content-type': 'text/calendar' }, [VCAL_OK]),
      );

      await buildFetcher().fetch({ url: 'https://a.example/cal.ics' });

      const headers = (request as sinon.SinonStub).firstCall.args[1].headers as Record<string, string>;
      expect(headers['user-agent']).toBe(USER_AGENT);
      expect(USER_AGENT).toMatch(/^Pavillion\/[^ ]+ ICS-Fetcher \(\+https:\/\/pavillion\.app\)$/);
      // Ensure no instance hostname leaked in
      expect(headers['user-agent']).not.toContain('example');
      expect(headers['user-agent']).not.toMatch(/a\.example|first\.example|other\.example/);
    });
  });

  // -------------------------------------------------------------------------
  // SSRF URL literal guard
  // -------------------------------------------------------------------------

  describe('URL-level SSRF guard', () => {
    it('propagates SSRF block from validateUrl (private IP literal, bad scheme, etc.)', async () => {
      (validateUrl as sinon.SinonStub).rejects(new Error('URL must use HTTPS, got: http:'));

      try {
        await buildFetcher().fetch({ url: 'http://evil.example/cal.ics' });
        expect.fail('Expected error');
      }
      catch (err) {
        // Unexpected errors are wrapped as ImportSourceFetchError — that's fine
        // here: the URL layer guard itself is already tested in ip-validation.
        expect(err).toBeInstanceOf(ImportSourceFetchError);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Content hash
  // -------------------------------------------------------------------------

  describe('content hash', () => {
    it('returns a sha256 hex hash of the raw body when ETag absent', async () => {
      (request as sinon.SinonStub).resolves(
        makeResponse(200, { 'content-type': 'text/calendar' }, [VCAL_OK]),
      );

      const result = await buildFetcher().fetch({ url: 'https://a.example/cal.ics' });
      expect(result.outcome).toBe('ok');
      if (result.outcome === 'ok') {
        expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
        expect(result.etag).toBeUndefined();
      }
    });
  });

  // -------------------------------------------------------------------------
  // ALLOW_LOCALHOST_ICS_IMPORT gate (pv-1qcp.13)
  // -------------------------------------------------------------------------

  describe('ALLOW_LOCALHOST_ICS_IMPORT gate', () => {
    // NODE_ENV=test is already set by the test runner. Save/restore both
    // vars to isolate closed-default / production-safe / open states.
    const originalEnv = process.env.NODE_ENV;
    const originalFlag = process.env.ALLOW_LOCALHOST_ICS_IMPORT;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
      if (originalFlag === undefined) {
        delete process.env.ALLOW_LOCALHOST_ICS_IMPORT;
      }
      else {
        process.env.ALLOW_LOCALHOST_ICS_IMPORT = originalFlag;
      }
    });

    it('rejects a DNS-resolved private IP when gate is closed (env var unset)', async () => {
      delete process.env.ALLOW_LOCALHOST_ICS_IMPORT;
      process.env.NODE_ENV = 'test';

      (dnsLookup as sinon.SinonStub).resolves(['127.0.0.1']);
      (isPrivateIp as sinon.SinonStub).callsFake((ip: string) => ip === '127.0.0.1');

      await expect(
        buildFetcher().fetch({ url: 'https://localhost.test/cal.ics' }),
      ).rejects.toBeInstanceOf(ImportSourceSsrfBlockedError);

      expect((createAgent as sinon.SinonStub).called).toBe(false);
      expect((request as sinon.SinonStub).called).toBe(false);
    });

    it('keeps gate closed when NODE_ENV=production even with ALLOW_LOCALHOST_ICS_IMPORT=true', async () => {
      process.env.NODE_ENV = 'production';
      process.env.ALLOW_LOCALHOST_ICS_IMPORT = 'true';

      (dnsLookup as sinon.SinonStub).resolves(['127.0.0.1']);
      (isPrivateIp as sinon.SinonStub).callsFake((ip: string) => ip === '127.0.0.1');

      await expect(
        buildFetcher().fetch({ url: 'https://localhost.test/cal.ics' }),
      ).rejects.toBeInstanceOf(ImportSourceSsrfBlockedError);

      expect((createAgent as sinon.SinonStub).called).toBe(false);
    });

    it('allows a DNS-resolved 127.0.0.1 through when gate is open (NODE_ENV=test + flag=true)', async () => {
      process.env.NODE_ENV = 'test';
      process.env.ALLOW_LOCALHOST_ICS_IMPORT = 'true';

      (dnsLookup as sinon.SinonStub).resolves(['127.0.0.1']);
      (isPrivateIp as sinon.SinonStub).callsFake((ip: string) => ip === '127.0.0.1');
      (request as sinon.SinonStub).resolves(
        makeResponse(200, { 'content-type': 'text/calendar' }, [VCAL_OK]),
      );

      const result = await buildFetcher().fetch({ url: 'https://localhost.test/cal.ics' });
      expect(result.outcome).toBe('ok');

      // Pinned-IP Agent was still built for the localhost address — the
      // hardened pinning contract is preserved.
      expect((createAgent as sinon.SinonStub).callCount).toBe(1);
      expect((createAgent as sinon.SinonStub).firstCall.args[0]).toBe('127.0.0.1');
    });

    it('allows DNS-resolved 127.0.0.1 when NODE_ENV=e2e + flag=true', async () => {
      process.env.NODE_ENV = 'e2e';
      process.env.ALLOW_LOCALHOST_ICS_IMPORT = 'true';

      (dnsLookup as sinon.SinonStub).resolves(['127.0.0.1']);
      (isPrivateIp as sinon.SinonStub).callsFake((ip: string) => ip === '127.0.0.1');
      (request as sinon.SinonStub).resolves(
        makeResponse(200, { 'content-type': 'text/calendar' }, [VCAL_OK]),
      );

      const result = await buildFetcher().fetch({ url: 'https://localhost.test/cal.ics' });
      expect(result.outcome).toBe('ok');
    });
  });

  // -------------------------------------------------------------------------
  // Per-call fetch policy
  // -------------------------------------------------------------------------

  describe('fetch policy', () => {
    const constraints: UploadConstraints = {
      allowedTypes: ['image/png', 'image/jpeg', 'image/heic', 'image/webp'],
      maxFileSize: 1024,
      extensionByMimeType: {},
    };
    const imagePolicy = createImageFetchPolicy(constraints);
    const IMG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

    async function reasonOf(promise: Promise<unknown>): Promise<string | undefined> {
      try {
        await promise;
      }
      catch (err) {
        expect(err).toBeInstanceOf(ImportSourceFetchError);
        return ((err as ImportSourceFetchError).details as { reason?: string }).reason;
      }
      expect.fail('Expected ImportSourceFetchError');
    }

    it('reports the normalised content type on an ICS fetch', async () => {
      (request as sinon.SinonStub).resolves(
        makeResponse(200, { 'content-type': 'Text/Calendar; charset=utf-8' }, [VCAL_OK]),
      );
      const r = await buildFetcher().fetch({ url: 'https://a.example/cal.ics' });
      expect(r.outcome === 'ok' && r.contentType).toBe('text/calendar');
    });

    it('exposes ICS_FETCH_POLICY with the ICS cap and allowlist', () => {
      expect(ICS_FETCH_POLICY.maxBodyBytes).toBe(MAX_BODY_BYTES);
      expect(ICS_FETCH_POLICY.allowedContentTypes.has('text/calendar')).toBe(true);
      expect(ICS_FETCH_POLICY.signatureCheck).not.toBeNull();
    });

    it.each(['image/png', 'image/jpeg', 'image/heic'])('accepts %s under the image policy', async (ct) => {
      (request as sinon.SinonStub).resolves(makeResponse(200, { 'content-type': ct }, [IMG]));
      const r = await buildFetcher().fetch({ url: 'https://a.example/i' }, imagePolicy);
      expect(r.outcome).toBe('ok');
      expect(r.outcome === 'ok' && r.contentType).toBe(ct);
    });

    it('accepts Image/JPEG; charset=binary and reports image/jpeg', async () => {
      (request as sinon.SinonStub).resolves(
        makeResponse(200, { 'content-type': 'Image/JPEG; charset=binary' }, [IMG]),
      );
      const r = await buildFetcher().fetch({ url: 'https://a.example/i' }, imagePolicy);
      expect(r.outcome === 'ok' && r.contentType).toBe('image/jpeg');
    });

    it('rejects text/html under the image policy as rejected_content_type', async () => {
      (request as sinon.SinonStub).resolves(makeResponse(200, { 'content-type': 'text/html' }, [IMG]));
      expect(await reasonOf(buildFetcher().fetch({ url: 'https://a.example/i' }, imagePolicy)))
        .toBe('rejected_content_type');
    });

    it.each(['text/calendar', 'image/webp'])('rejects %s under the image policy', async (ct) => {
      (request as sinon.SinonStub).resolves(makeResponse(200, { 'content-type': ct }, [IMG]));
      expect(await reasonOf(buildFetcher().fetch({ url: 'https://a.example/i' }, imagePolicy)))
        .toBe('disallowed_content_type');
    });

    it('rejects a missing Content-Type under the image policy but not under ICS', async () => {
      (request as sinon.SinonStub).resolves(makeResponse(200, {}, [IMG]));
      expect(await reasonOf(buildFetcher().fetch({ url: 'https://a.example/i' }, imagePolicy)))
        .toBe('disallowed_content_type');

      (request as sinon.SinonStub).resolves(makeResponse(200, {}, [VCAL_OK]));
      const r = await buildFetcher().fetch({ url: 'https://a.example/cal.ics' });
      expect(r.outcome).toBe('ok');
    });

    it('enforces the policy byte cap', async () => {
      (request as sinon.SinonStub).resolves(
        makeHugeResponse(200, { 'content-type': 'image/png' }, 1025),
      );
      expect(await reasonOf(buildFetcher().fetch({ url: 'https://a.example/i' }, imagePolicy)))
        .toBe('body_too_large');
    });

    it('does not sniff for BEGIN:VCALENDAR under the image policy', async () => {
      (request as sinon.SinonStub).resolves(makeResponse(200, { 'content-type': 'image/png' }, [IMG]));
      const r = await buildFetcher().fetch({ url: 'https://a.example/i' }, imagePolicy);
      expect(r.outcome).toBe('ok');
    });

    it('sends exactly user-agent and accept under the image policy', async () => {
      (request as sinon.SinonStub).resolves(makeResponse(200, { 'content-type': 'image/png' }, [IMG]));
      await buildFetcher().fetch({ url: 'https://a.example/i' }, imagePolicy);
      const headers = (request as sinon.SinonStub).firstCall.args[1].headers as Record<string, string>;
      expect(Object.keys(headers).sort()).toEqual(['accept', 'user-agent']);
      expect(headers['accept']).toBe(imagePolicy.accept);
      expect(headers['accept']).toContain('image/png');
    });

    it('still sends the ICS accept header with no policy', async () => {
      (request as sinon.SinonStub).resolves(makeResponse(200, { 'content-type': 'text/calendar' }, [VCAL_OK]));
      await buildFetcher().fetch({ url: 'https://a.example/cal.ics' });
      const headers = (request as sinon.SinonStub).firstCall.args[1].headers as Record<string, string>;
      expect(headers['accept']).toBe(ICS_FETCH_POLICY.accept);
      expect(headers['accept']).toContain('text/calendar');
    });

    it('rejects a private-IP resolution under the image policy with the same error class as ICS', async () => {
      (isPrivateIp as sinon.SinonStub).returns(true);
      const errorOf = async (policy?: typeof imagePolicy) => {
        try {
          await buildFetcher().fetch({ url: 'https://a.example/x' }, policy);
        }
        catch (err) {
          return err;
        }
      };
      const icsErr = await errorOf();
      const imgErr = await errorOf(imagePolicy);
      expect(icsErr).toBeInstanceOf(ImportSourceSsrfBlockedError);
      expect(imgErr).toBeInstanceOf(ImportSourceSsrfBlockedError);
      expect((request as sinon.SinonStub).called).toBe(false);
    });

    describe('createImageFetchPolicy', () => {
      it('intersects the fixed constant with the media allowlist, never widening it', () => {
        const p = createImageFetchPolicy({
          ...constraints,
          allowedTypes: ['image/png', 'image/jpeg', 'image/heic', 'image/svg+xml', 'image/webp'],
        });
        expect([...p.allowedContentTypes].sort()).toEqual(['image/heic', 'image/jpeg', 'image/png']);
        expect([...IMAGE_FETCH_CONTENT_TYPES].sort()).toEqual(['image/heic', 'image/jpeg', 'image/png']);
      });

      it('narrows when media allows fewer types, but keeps accept at the fixed list', () => {
        const p = createImageFetchPolicy({ ...constraints, allowedTypes: ['image/png'] });
        expect([...p.allowedContentTypes]).toEqual(['image/png']);
        expect(p.accept).toContain('image/jpeg');
      });

      it('takes the cap from the constraints and has no signature check', () => {
        expect(imagePolicy.maxBodyBytes).toBe(1024);
        expect(imagePolicy.signatureCheck).toBeNull();
      });
    });
  });
});
