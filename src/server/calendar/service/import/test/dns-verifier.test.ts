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

  beforeEach(() => {
    fetchStub = sandbox.stub();
    verifier = new DnsVerifier(fetchStub);
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

      try {
        await verifier.verify({
          sourceId: SOURCE_ID,
          calendarId: CALENDAR_ID,
          sourceUrl: SOURCE_URL,
        });
        throw new Error('Expected to throw');
      }
      catch (err) {
        expect(err).toBeInstanceOf(ImportSourceDnsVerificationError);
        const e = err as ImportSourceDnsVerificationError;
        expect(e.reason).toBe(IMPORT_DNS_RESOLVER_DISAGREEMENT);
        expect(e.message).toBe(IMPORT_DNS_RESOLVER_DISAGREEMENT);
      }
    });
  });

  describe('not found', () => {
    it('throws IMPORT_DNS_NOT_FOUND when neither resolver has the record', async () => {
      const resp = buildDohResponse([]);
      fetchStub.resolves(mockFetchResponse(resp.status, resp.body));

      try {
        await verifier.verify({
          sourceId: SOURCE_ID,
          calendarId: CALENDAR_ID,
          sourceUrl: SOURCE_URL,
        });
        throw new Error('Expected to throw');
      }
      catch (err) {
        expect(err).toBeInstanceOf(ImportSourceDnsVerificationError);
        const e = err as ImportSourceDnsVerificationError;
        expect(e.reason).toBe(IMPORT_DNS_NOT_FOUND);
        expect(e.message).toBe(IMPORT_DNS_NOT_FOUND);
      }
    });

    it('throws IMPORT_DNS_MISMATCH when records exist but none match', async () => {
      const resp = buildDohResponse([
        'v=spf1 include:_spf.example.org ~all',
        'pavillion-verify=v1:some-other-host:other-token',
      ]);
      fetchStub.resolves(mockFetchResponse(resp.status, resp.body));

      try {
        await verifier.verify({
          sourceId: SOURCE_ID,
          calendarId: CALENDAR_ID,
          sourceUrl: SOURCE_URL,
        });
        throw new Error('Expected to throw');
      }
      catch (err) {
        expect(err).toBeInstanceOf(ImportSourceDnsVerificationError);
        const e = err as ImportSourceDnsVerificationError;
        expect(e.reason).toBe(IMPORT_DNS_MISMATCH);
      }
    });
  });

  describe('resolver unavailable (fail closed)', () => {
    it('throws IMPORT_DNS_RESOLVER_UNAVAILABLE on network error from any resolver', async () => {
      fetchStub.rejects(new Error('ECONNREFUSED'));

      try {
        await verifier.verify({
          sourceId: SOURCE_ID,
          calendarId: CALENDAR_ID,
          sourceUrl: SOURCE_URL,
        });
        throw new Error('Expected to throw');
      }
      catch (err) {
        expect(err).toBeInstanceOf(ImportSourceDnsVerificationError);
        const e = err as ImportSourceDnsVerificationError;
        expect(e.reason).toBe(IMPORT_DNS_RESOLVER_UNAVAILABLE);
        expect(e.message).not.toContain('ECONNREFUSED');
      }
    });

    it('throws IMPORT_DNS_RESOLVER_UNAVAILABLE on non-200 response', async () => {
      fetchStub.resolves(mockFetchResponse(500, 'Internal Server Error'));

      try {
        await verifier.verify({
          sourceId: SOURCE_ID,
          calendarId: CALENDAR_ID,
          sourceUrl: SOURCE_URL,
        });
        throw new Error('Expected to throw');
      }
      catch (err) {
        expect(err).toBeInstanceOf(ImportSourceDnsVerificationError);
        const e = err as ImportSourceDnsVerificationError;
        expect(e.reason).toBe(IMPORT_DNS_RESOLVER_UNAVAILABLE);
      }
    });

    it('throws IMPORT_DNS_RESOLVER_UNAVAILABLE on malformed JSON', async () => {
      fetchStub.resolves(mockFetchResponse(200, 'not-json{{{'));

      try {
        await verifier.verify({
          sourceId: SOURCE_ID,
          calendarId: CALENDAR_ID,
          sourceUrl: SOURCE_URL,
        });
        throw new Error('Expected to throw');
      }
      catch (err) {
        expect(err).toBeInstanceOf(ImportSourceDnsVerificationError);
        const e = err as ImportSourceDnsVerificationError;
        expect(e.reason).toBe(IMPORT_DNS_RESOLVER_UNAVAILABLE);
      }
    });

    it('fails closed when only one resolver errors (other succeeds)', async () => {
      const record = formatVerificationRecord(SOURCE_ID, CALENDAR_ID);
      const good = buildDohResponse([record]);

      fetchStub.onCall(0).resolves(mockFetchResponse(good.status, good.body));
      fetchStub.onCall(1).rejects(new Error('timeout'));

      try {
        await verifier.verify({
          sourceId: SOURCE_ID,
          calendarId: CALENDAR_ID,
          sourceUrl: SOURCE_URL,
        });
        throw new Error('Expected to throw');
      }
      catch (err) {
        expect(err).toBeInstanceOf(ImportSourceDnsVerificationError);
        const e = err as ImportSourceDnsVerificationError;
        expect(e.reason).toBe(IMPORT_DNS_RESOLVER_UNAVAILABLE);
      }
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
          try {
            await verifier.verify({
              sourceId: SOURCE_ID,
              calendarId: CALENDAR_ID,
              sourceUrl: url,
            });
            throw new Error('Expected PSL violation');
          }
          catch (err) {
            expect(err).toBeInstanceOf(ImportSourceDnsVerificationError);
            const e = err as ImportSourceDnsVerificationError;
            expect(e.reason).toBe(IMPORT_DNS_PSL_VIOLATION);
            expect(fetchStub.called).toBe(false);
          }
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

      try {
        await verifier.verify({
          sourceId: SOURCE_ID,
          calendarId: CALENDAR_ID,
          sourceUrl: SOURCE_URL,
        });
        throw new Error('Expected to throw');
      }
      catch (err) {
        expect(err).toBeInstanceOf(ImportSourceDnsVerificationError);
        const e = err as ImportSourceDnsVerificationError;
        // Message is exactly the sanitized code, nothing more
        const sanitized = new Set([
          IMPORT_DNS_NOT_FOUND,
          IMPORT_DNS_MISMATCH,
          IMPORT_DNS_RESOLVER_DISAGREEMENT,
          IMPORT_DNS_RESOLVER_UNAVAILABLE,
          IMPORT_DNS_PSL_VIOLATION,
        ]);
        expect(sanitized.has(e.message)).toBe(true);
        expect(e.message).not.toContain(secretLeak);
      }
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
