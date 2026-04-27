import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import config from 'config';

import {
  DnsVerifier,
  VERIFICATION_VALIDITY_DAYS,
  VERIFICATION_GRACE_DAYS,
  isVerificationCurrentlyValid,
  isWithinGracePeriod,
} from '@/server/calendar/service/import/dns-verifier';
import {
  ImportSourceDnsVerificationError,
  IMPORT_DNS_NOT_FOUND,
  IMPORT_DNS_MISMATCH,
  IMPORT_DNS_RESOLVER_DISAGREEMENT,
  IMPORT_DNS_RESOLVER_UNAVAILABLE,
  IMPORT_DNS_PSL_VIOLATION,
} from '@/common/exceptions/import';
import { formatVerificationRecord } from '@/server/calendar/service/import/hmac';

/**
 * DoH JSON response shape per RFC 8484 (Cloudflare/Google format):
 * { Status: 0, Answer: [{ name, type, TTL, data }, ...] }
 */
function buildDohResponse(txtRecords: string[], status = 0): { status: number; body: string } {
  return {
    status: 200,
    body: JSON.stringify({
      Status: status,
      Answer: txtRecords.map((txt) => ({
        name: '_pavillion-challenge.example.org',
        type: 16,
        TTL: 300,
        // DoH JSON encodes TXT values wrapped in double-quotes
        data: `"${txt}"`,
      })),
    }),
  };
}

function mockFetchResponse(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

describe('DnsVerifier', () => {
  const sandbox = sinon.createSandbox();

  const SOURCE_ID = '11111111-1111-1111-1111-111111111111';
  const CALENDAR_ID = '22222222-2222-2222-2222-222222222222';
  const SOURCE_URL = 'https://example.org/calendar.ics';

  let fetchStub: sinon.SinonStub;
  let verifier: DnsVerifier;

  /**
   * Replaces the list returned by `config.get('calendar.import.dohResolvers')`
   * for the duration of a test. Other config keys fall through to the real
   * config so unrelated lookups still succeed.
   */
  function stubResolvers(resolvers: string[]): void {
    const original = config.get.bind(config);
    sandbox.replace(config, 'get', ((key: string) => {
      if (key === 'calendar.import.dohResolvers') {
        return resolvers;
      }
      return original(key);
    }) as typeof config.get);
  }

  beforeEach(() => {
    fetchStub = sandbox.stub();
    verifier = new DnsVerifier({ fetchImpl: fetchStub });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('successful verification', () => {
    it('verifies when both resolvers see the matching TXT record', async () => {
      const record = formatVerificationRecord(SOURCE_ID, CALENDAR_ID);
      const resp = buildDohResponse([record]);
      fetchStub.resolves(mockFetchResponse(resp.status, resp.body));

      const result = await verifier.verify({
        sourceId: SOURCE_ID,
        calendarId: CALENDAR_ID,
        sourceUrl: SOURCE_URL,
      });

      expect(result.verified).toBe(true);
      expect(result.verifiedAt).toBeInstanceOf(Date);
      expect(result.expiresAt).toBeInstanceOf(Date);
      // 90 days in ms
      const deltaMs = result.expiresAt.getTime() - result.verifiedAt.getTime();
      expect(deltaMs).toBe(VERIFICATION_VALIDITY_DAYS * 24 * 60 * 60 * 1000);
    });

    it('verifies when matching TXT record is among 5 records at the name', async () => {
      const record = formatVerificationRecord(SOURCE_ID, CALENDAR_ID);
      const records = [
        'v=spf1 include:_spf.example.org ~all',
        'google-site-verification=abcd1234',
        record,
        'apple-domain-verification=ZZZZ',
        'pavillion-verify=v1:some-other-host:other-token',
      ];
      const resp = buildDohResponse(records);
      fetchStub.resolves(mockFetchResponse(resp.status, resp.body));

      const result = await verifier.verify({
        sourceId: SOURCE_ID,
        calendarId: CALENDAR_ID,
        sourceUrl: SOURCE_URL,
      });

      expect(result.verified).toBe(true);
    });
  });

  describe('resolver disagreement', () => {
    it('throws IMPORT_DNS_RESOLVER_DISAGREEMENT when one resolver sees it and other does not', async () => {
      const record = formatVerificationRecord(SOURCE_ID, CALENDAR_ID);
      const good = buildDohResponse([record]);
      const bad = buildDohResponse(['unrelated-record']);

      fetchStub.onCall(0).resolves(mockFetchResponse(good.status, good.body));
      fetchStub.onCall(1).resolves(mockFetchResponse(bad.status, bad.body));

      const promise = verifier.verify({
        sourceId: SOURCE_ID,
        calendarId: CALENDAR_ID,
        sourceUrl: SOURCE_URL,
      });

      await expect(promise).rejects.toBeInstanceOf(ImportSourceDnsVerificationError);
      await expect(promise).rejects.toHaveProperty('reason', IMPORT_DNS_RESOLVER_DISAGREEMENT);
      await expect(promise).rejects.toHaveProperty('message', IMPORT_DNS_RESOLVER_DISAGREEMENT);
    });
  });

  describe('not found', () => {
    it('throws IMPORT_DNS_NOT_FOUND when neither resolver has the record', async () => {
      const resp = buildDohResponse([]);
      fetchStub.resolves(mockFetchResponse(resp.status, resp.body));

      const promise = verifier.verify({
        sourceId: SOURCE_ID,
        calendarId: CALENDAR_ID,
        sourceUrl: SOURCE_URL,
      });

      await expect(promise).rejects.toBeInstanceOf(ImportSourceDnsVerificationError);
      await expect(promise).rejects.toHaveProperty('reason', IMPORT_DNS_NOT_FOUND);
      await expect(promise).rejects.toHaveProperty('message', IMPORT_DNS_NOT_FOUND);
    });

    it('throws IMPORT_DNS_NOT_FOUND when DoH returns NXDOMAIN (Status=3)', async () => {
      // NXDOMAIN with no Answer array — the typical "name does not exist" shape.
      const resp = buildDohResponse([], 3);
      fetchStub.resolves(mockFetchResponse(resp.status, resp.body));

      const promise = verifier.verify({
        sourceId: SOURCE_ID,
        calendarId: CALENDAR_ID,
        sourceUrl: SOURCE_URL,
      });

      await expect(promise).rejects.toBeInstanceOf(ImportSourceDnsVerificationError);
      await expect(promise).rejects.toHaveProperty('reason', IMPORT_DNS_NOT_FOUND);
    });

    it('throws IMPORT_DNS_MISMATCH when records exist but none match', async () => {
      const resp = buildDohResponse([
        'v=spf1 include:_spf.example.org ~all',
        'pavillion-verify=v1:some-other-host:other-token',
      ]);
      fetchStub.resolves(mockFetchResponse(resp.status, resp.body));

      const promise = verifier.verify({
        sourceId: SOURCE_ID,
        calendarId: CALENDAR_ID,
        sourceUrl: SOURCE_URL,
      });

      await expect(promise).rejects.toBeInstanceOf(ImportSourceDnsVerificationError);
      await expect(promise).rejects.toHaveProperty('reason', IMPORT_DNS_MISMATCH);
    });
  });

  describe('resolver unavailable (fail closed)', () => {
    it('throws IMPORT_DNS_RESOLVER_UNAVAILABLE on network error from any resolver', async () => {
      fetchStub.rejects(new Error('ECONNREFUSED'));

      const promise = verifier.verify({
        sourceId: SOURCE_ID,
        calendarId: CALENDAR_ID,
        sourceUrl: SOURCE_URL,
      });

      await expect(promise).rejects.toBeInstanceOf(ImportSourceDnsVerificationError);
      await expect(promise).rejects.toHaveProperty('reason', IMPORT_DNS_RESOLVER_UNAVAILABLE);
      // Sanitized surface: internal error text must not leak through
      await expect(promise).rejects.toSatisfy(
        (e: unknown) => !(e as Error).message.includes('ECONNREFUSED'),
      );
    });

    it('throws IMPORT_DNS_RESOLVER_UNAVAILABLE on non-200 response', async () => {
      fetchStub.resolves(mockFetchResponse(500, 'Internal Server Error'));

      const promise = verifier.verify({
        sourceId: SOURCE_ID,
        calendarId: CALENDAR_ID,
        sourceUrl: SOURCE_URL,
      });

      await expect(promise).rejects.toBeInstanceOf(ImportSourceDnsVerificationError);
      await expect(promise).rejects.toHaveProperty('reason', IMPORT_DNS_RESOLVER_UNAVAILABLE);
    });

    it('throws IMPORT_DNS_RESOLVER_UNAVAILABLE on malformed JSON', async () => {
      fetchStub.resolves(mockFetchResponse(200, 'not-json{{{'));

      const promise = verifier.verify({
        sourceId: SOURCE_ID,
        calendarId: CALENDAR_ID,
        sourceUrl: SOURCE_URL,
      });

      await expect(promise).rejects.toBeInstanceOf(ImportSourceDnsVerificationError);
      await expect(promise).rejects.toHaveProperty('reason', IMPORT_DNS_RESOLVER_UNAVAILABLE);
    });

    it('throws IMPORT_DNS_RESOLVER_UNAVAILABLE on DoH SERVFAIL (Status=2)', async () => {
      // SERVFAIL is an "the resolver could not answer" signal — treat as unavailable.
      const resp = buildDohResponse([], 2);
      fetchStub.resolves(mockFetchResponse(resp.status, resp.body));

      const promise = verifier.verify({
        sourceId: SOURCE_ID,
        calendarId: CALENDAR_ID,
        sourceUrl: SOURCE_URL,
      });

      await expect(promise).rejects.toBeInstanceOf(ImportSourceDnsVerificationError);
      await expect(promise).rejects.toHaveProperty('reason', IMPORT_DNS_RESOLVER_UNAVAILABLE);
    });

    it('fails closed when only one resolver errors (other succeeds)', async () => {
      const record = formatVerificationRecord(SOURCE_ID, CALENDAR_ID);
      const good = buildDohResponse([record]);

      fetchStub.onCall(0).resolves(mockFetchResponse(good.status, good.body));
      fetchStub.onCall(1).rejects(new Error('timeout'));

      const promise = verifier.verify({
        sourceId: SOURCE_ID,
        calendarId: CALENDAR_ID,
        sourceUrl: SOURCE_URL,
      });

      await expect(promise).rejects.toBeInstanceOf(ImportSourceDnsVerificationError);
      await expect(promise).rejects.toHaveProperty('reason', IMPORT_DNS_RESOLVER_UNAVAILABLE);
    });
  });

  describe('resolver URL validation (SSRF defense)', () => {
    it('rejects an http:// resolver URL without attempting to fetch', async () => {
      stubResolvers(['http://1.1.1.1/dns-query', 'https://8.8.8.8/dns-query']);

      const freshVerifier = new DnsVerifier({ fetchImpl: fetchStub });
      const promise = freshVerifier.verify({
        sourceId: SOURCE_ID,
        calendarId: CALENDAR_ID,
        sourceUrl: SOURCE_URL,
      });

      await expect(promise).rejects.toBeInstanceOf(ImportSourceDnsVerificationError);
      await expect(promise).rejects.toHaveProperty('reason', IMPORT_DNS_RESOLVER_UNAVAILABLE);
      expect(fetchStub.called).toBe(false);
    });

    it('rejects a resolver URL whose hostname is a private IP (169.254.169.254 cloud metadata)', async () => {
      stubResolvers(['https://169.254.169.254/dns-query', 'https://8.8.8.8/dns-query']);

      const freshVerifier = new DnsVerifier({ fetchImpl: fetchStub });
      const promise = freshVerifier.verify({
        sourceId: SOURCE_ID,
        calendarId: CALENDAR_ID,
        sourceUrl: SOURCE_URL,
      });

      await expect(promise).rejects.toBeInstanceOf(ImportSourceDnsVerificationError);
      await expect(promise).rejects.toHaveProperty('reason', IMPORT_DNS_RESOLVER_UNAVAILABLE);
      expect(fetchStub.called).toBe(false);
    });

    it('rejects a resolver URL whose hostname is a loopback address', async () => {
      stubResolvers(['https://127.0.0.1/dns-query', 'https://8.8.8.8/dns-query']);

      const freshVerifier = new DnsVerifier({ fetchImpl: fetchStub });
      const promise = freshVerifier.verify({
        sourceId: SOURCE_ID,
        calendarId: CALENDAR_ID,
        sourceUrl: SOURCE_URL,
      });

      await expect(promise).rejects.toBeInstanceOf(ImportSourceDnsVerificationError);
      await expect(promise).rejects.toHaveProperty('reason', IMPORT_DNS_RESOLVER_UNAVAILABLE);
      expect(fetchStub.called).toBe(false);
    });

    it('accepts the default Cloudflare (1.1.1.1) and Google (8.8.8.8) DoH resolvers', async () => {
      // No config stub — use the real defaults from config/default.yaml.
      const resolvers = config.get<string[]>('calendar.import.dohResolvers');
      expect(resolvers).toEqual([
        'https://1.1.1.1/dns-query',
        'https://8.8.8.8/dns-query',
      ]);

      const record = formatVerificationRecord(SOURCE_ID, CALENDAR_ID);
      const resp = buildDohResponse([record]);
      fetchStub.resolves(mockFetchResponse(resp.status, resp.body));

      const result = await verifier.verify({
        sourceId: SOURCE_ID,
        calendarId: CALENDAR_ID,
        sourceUrl: SOURCE_URL,
      });

      expect(result.verified).toBe(true);
      // Validation did not block the fetch path — both defaults were accepted.
      expect(fetchStub.callCount).toBeGreaterThanOrEqual(2);
    });

    describe('ALLOW_LOCALHOST_ICS_IMPORT gate (pv-1qcp.13)', () => {
      // The test runner already sets NODE_ENV=test; save/restore both vars
      // to isolate closed-default / production-safe / open states.
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

      it('rejects http://127.0.0.1 resolvers when gate is closed (env var unset)', async () => {
        delete process.env.ALLOW_LOCALHOST_ICS_IMPORT;
        process.env.NODE_ENV = 'test';
        stubResolvers(['http://127.0.0.1:3002/dns-query', 'http://127.0.0.1:3003/dns-query']);

        const freshVerifier = new DnsVerifier({ fetchImpl: fetchStub });
        const promise = freshVerifier.verify({
          sourceId: SOURCE_ID,
          calendarId: CALENDAR_ID,
          sourceUrl: SOURCE_URL,
        });

        await expect(promise).rejects.toBeInstanceOf(ImportSourceDnsVerificationError);
        await expect(promise).rejects.toHaveProperty('reason', IMPORT_DNS_RESOLVER_UNAVAILABLE);
        expect(fetchStub.called).toBe(false);
      });

      it('keeps gate closed when NODE_ENV=production even with ALLOW_LOCALHOST_ICS_IMPORT=true', async () => {
        process.env.NODE_ENV = 'production';
        process.env.ALLOW_LOCALHOST_ICS_IMPORT = 'true';
        stubResolvers(['http://127.0.0.1:3002/dns-query', 'http://127.0.0.1:3003/dns-query']);

        const freshVerifier = new DnsVerifier({ fetchImpl: fetchStub });
        const promise = freshVerifier.verify({
          sourceId: SOURCE_ID,
          calendarId: CALENDAR_ID,
          sourceUrl: SOURCE_URL,
        });

        await expect(promise).rejects.toBeInstanceOf(ImportSourceDnsVerificationError);
        await expect(promise).rejects.toHaveProperty('reason', IMPORT_DNS_RESOLVER_UNAVAILABLE);
        expect(fetchStub.called).toBe(false);
      });

      it('accepts http://127.0.0.1 DoH resolvers when gate is open (NODE_ENV=test + flag=true)', async () => {
        process.env.NODE_ENV = 'test';
        process.env.ALLOW_LOCALHOST_ICS_IMPORT = 'true';
        stubResolvers(['http://127.0.0.1:3002/dns-query', 'http://127.0.0.1:3003/dns-query']);

        const record = formatVerificationRecord(SOURCE_ID, CALENDAR_ID);
        const resp = buildDohResponse([record]);
        fetchStub.resolves(mockFetchResponse(resp.status, resp.body));

        const freshVerifier = new DnsVerifier({ fetchImpl: fetchStub });
        const result = await freshVerifier.verify({
          sourceId: SOURCE_ID,
          calendarId: CALENDAR_ID,
          sourceUrl: SOURCE_URL,
        });

        expect(result.verified).toBe(true);
        // The validator did not block the fetch — both http://127.0.0.1
        // resolvers passed through and the fetch stub was called per-resolver.
        expect(fetchStub.callCount).toBeGreaterThanOrEqual(2);
      });

      it('accepts http://127.0.0.1 DoH resolvers when NODE_ENV=e2e + flag=true', async () => {
        process.env.NODE_ENV = 'e2e';
        process.env.ALLOW_LOCALHOST_ICS_IMPORT = 'true';
        stubResolvers(['http://127.0.0.1:3002/dns-query', 'http://127.0.0.1:3003/dns-query']);

        const record = formatVerificationRecord(SOURCE_ID, CALENDAR_ID);
        const resp = buildDohResponse([record]);
        fetchStub.resolves(mockFetchResponse(resp.status, resp.body));

        const freshVerifier = new DnsVerifier({ fetchImpl: fetchStub });
        const result = await freshVerifier.verify({
          sourceId: SOURCE_ID,
          calendarId: CALENDAR_ID,
          sourceUrl: SOURCE_URL,
        });

        expect(result.verified).toBe(true);
      });
    });
  });

  describe('PSL violation', () => {
    const pslCases: [string, boolean][] = [
      // [hostname derived from source URL, expectVerifyToSucceedPastPslCheck]
      ['https://co.uk/cal.ics', false],          // hostname = co.uk (public suffix itself) → reject
      ['https://com/cal.ics', false],            // hostname = com → reject (invalid anyway)
      ['https://example.co.uk/cal.ics', true],  // proper registrable domain → accept past PSL
      ['https://example.com/cal.ics', true],    // proper registrable domain → accept past PSL
      ['https://events.example.com/cal.ics', true], // subdomain → accept
    ];

    for (const [url, shouldPassPsl] of pslCases) {
      it(`${shouldPassPsl ? 'accepts' : 'rejects'} hostname from ${url}`, async () => {
        if (!shouldPassPsl) {
          // Should throw PSL violation WITHOUT calling fetch
          const promise = verifier.verify({
            sourceId: SOURCE_ID,
            calendarId: CALENDAR_ID,
            sourceUrl: url,
          });
          await expect(promise).rejects.toBeInstanceOf(ImportSourceDnsVerificationError);
          await expect(promise).rejects.toHaveProperty('reason', IMPORT_DNS_PSL_VIOLATION);
          expect(fetchStub.called).toBe(false);
        }
        else {
          // For accept cases, stub a successful response to confirm it passes PSL
          const record = formatVerificationRecord(SOURCE_ID, CALENDAR_ID);
          const resp = buildDohResponse([record]);
          fetchStub.resolves(mockFetchResponse(resp.status, resp.body));

          // Note: the formatVerificationRecord is keyed by sourceId+calendarId, not host
          const result = await verifier.verify({
            sourceId: SOURCE_ID,
            calendarId: CALENDAR_ID,
            sourceUrl: url,
          });
          expect(result.verified).toBe(true);
        }
      });
    }
  });

  describe('sanitized error surface', () => {
    it('never echoes raw resolver response in error messages', async () => {
      const secretLeak = 'SECRET_RAW_RESOLVER_DATA_xyz123';
      fetchStub.rejects(new Error(secretLeak));

      const promise = verifier.verify({
        sourceId: SOURCE_ID,
        calendarId: CALENDAR_ID,
        sourceUrl: SOURCE_URL,
      });

      await expect(promise).rejects.toBeInstanceOf(ImportSourceDnsVerificationError);
      const sanitized = new Set([
        IMPORT_DNS_NOT_FOUND,
        IMPORT_DNS_MISMATCH,
        IMPORT_DNS_RESOLVER_DISAGREEMENT,
        IMPORT_DNS_RESOLVER_UNAVAILABLE,
        IMPORT_DNS_PSL_VIOLATION,
      ]);
      await expect(promise).rejects.toSatisfy((e: unknown) => {
        const msg = (e as Error).message;
        return sanitized.has(msg) && !msg.includes(secretLeak);
      });
    });

    it('queries the expected DoH endpoints configured in calendar.import.dohResolvers', async () => {
      const record = formatVerificationRecord(SOURCE_ID, CALENDAR_ID);
      const resp = buildDohResponse([record]);
      fetchStub.resolves(mockFetchResponse(resp.status, resp.body));

      await verifier.verify({
        sourceId: SOURCE_ID,
        calendarId: CALENDAR_ID,
        sourceUrl: SOURCE_URL,
      });

      const resolvers = config.get<string[]>('calendar.import.dohResolvers');
      expect(fetchStub.callCount).toBeGreaterThanOrEqual(resolvers.length);

      const urls = fetchStub.getCalls().map((c) => String(c.args[0]));
      for (const resolver of resolvers) {
        expect(urls.some((u) => u.startsWith(resolver))).toBe(true);
      }
    });

    it('queries for the _pavillion-challenge.{hostname} record name and TXT type', async () => {
      const record = formatVerificationRecord(SOURCE_ID, CALENDAR_ID);
      const resp = buildDohResponse([record]);
      fetchStub.resolves(mockFetchResponse(resp.status, resp.body));

      await verifier.verify({
        sourceId: SOURCE_ID,
        calendarId: CALENDAR_ID,
        sourceUrl: SOURCE_URL,
      });

      for (const call of fetchStub.getCalls()) {
        const url = String(call.args[0]);
        // name param should be _pavillion-challenge.example.org
        expect(url).toMatch(/name=_pavillion-challenge\.example\.org/);
        expect(url).toMatch(/type=TXT/i);
      }
    });
  });
});

describe('verification lifecycle windows', () => {
  it('treats record as valid when now is before expiresAt', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const verifiedAt = new Date('2025-12-01T00:00:00Z');
    const expiresAt = new Date(verifiedAt.getTime() + VERIFICATION_VALIDITY_DAYS * 24 * 60 * 60 * 1000);
    expect(isVerificationCurrentlyValid(expiresAt, now)).toBe(true);
  });

  it('treats record as invalid once past expiresAt', () => {
    const now = new Date('2026-04-10T00:00:00Z');
    const verifiedAt = new Date('2025-12-01T00:00:00Z');
    const expiresAt = new Date(verifiedAt.getTime() + VERIFICATION_VALIDITY_DAYS * 24 * 60 * 60 * 1000);
    // verifiedAt + 90d = 2026-03-01, now is 2026-04-10 → expired
    expect(isVerificationCurrentlyValid(expiresAt, now)).toBe(false);
  });

  it('is within grace period at expiresAt + 13 days', () => {
    const expiresAt = new Date('2026-03-01T00:00:00Z');
    const withinGrace = new Date('2026-03-14T00:00:00Z'); // 13 days after
    expect(isWithinGracePeriod(expiresAt, withinGrace)).toBe(true);
  });

  it('is outside grace period at expiresAt + 15 days', () => {
    const expiresAt = new Date('2026-03-01T00:00:00Z');
    const afterGrace = new Date('2026-03-16T00:00:00Z'); // 15 days after
    expect(isWithinGracePeriod(expiresAt, afterGrace)).toBe(false);
  });

  it('grace period ends exactly at expiresAt + 14 days', () => {
    const expiresAt = new Date('2026-03-01T00:00:00Z');
    const atBoundary = new Date(expiresAt.getTime() + VERIFICATION_GRACE_DAYS * 24 * 60 * 60 * 1000);
    // Inclusive end is a matter of convention; we define grace as strictly less than boundary
    expect(isWithinGracePeriod(expiresAt, atBoundary)).toBe(false);
  });

  it('exposes 90-day and 14-day constants', () => {
    expect(VERIFICATION_VALIDITY_DAYS).toBe(90);
    expect(VERIFICATION_GRACE_DAYS).toBe(14);
  });
});
