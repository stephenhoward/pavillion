import { describe, it, expect } from 'vitest';
import {
  ImportSourceNotFoundError,
  ImportSourceFetchError,
  ImportSourceSsrfBlockedError,
  ImportSourceParseError,
  ImportSourceDnsVerificationError,
  ImportSourceVerifyRateLimitError,
  IMPORT_DNS_NOT_FOUND,
  IMPORT_DNS_MISMATCH,
  IMPORT_DNS_RESOLVER_DISAGREEMENT,
  IMPORT_DNS_RESOLVER_UNAVAILABLE,
  IMPORT_DNS_PSL_VIOLATION,
  IMPORT_FETCH_ERROR,
  IMPORT_SSRF_BLOCKED,
  IMPORT_PARSE_ERROR,
  IMPORT_NOT_FOUND,
  IMPORT_VERIFY_RATE_LIMITED,
} from '@/common/exceptions/import';

/**
 * Simulate HTTP boundary serialization: throw server-side, serialize to JSON,
 * then reconstruct error type on the client side via errorName discrimination.
 */
function serializeError(err: Error): { error: string; errorName: string } {
  return {
    error: err.message,
    errorName: err.name,
  };
}

const errorMap: Record<string, new (...args: never[]) => Error> = {
  ImportSourceNotFoundError: ImportSourceNotFoundError as unknown as new () => Error,
  ImportSourceFetchError: ImportSourceFetchError as unknown as new () => Error,
  ImportSourceSsrfBlockedError: ImportSourceSsrfBlockedError as unknown as new () => Error,
  ImportSourceParseError: ImportSourceParseError as unknown as new () => Error,
  ImportSourceDnsVerificationError: ImportSourceDnsVerificationError as unknown as new () => Error,
  ImportSourceVerifyRateLimitError: ImportSourceVerifyRateLimitError as unknown as new () => Error,
};

describe('ICS import exceptions', () => {

  describe('ImportSourceNotFoundError', () => {
    it('uses a fixed sanitized message and has errorName set', () => {
      const err = new ImportSourceNotFoundError();
      expect(err.name).toBe('ImportSourceNotFoundError');
      expect(err.message).toBe(IMPORT_NOT_FOUND);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ImportSourceNotFoundError);
    });

    it('carries optional debug-only details that are not part of the message', () => {
      const err = new ImportSourceNotFoundError({ importSourceId: 'abc-123' });
      expect(err.message).toBe(IMPORT_NOT_FOUND);
      expect(err.details).toEqual({ importSourceId: 'abc-123' });
    });
  });

  describe('ImportSourceFetchError', () => {
    it('uses fixed sanitized message', () => {
      const err = new ImportSourceFetchError();
      expect(err.name).toBe('ImportSourceFetchError');
      expect(err.message).toBe(IMPORT_FETCH_ERROR);
    });

    it('does not leak URLs or IPs in the message when details are provided', () => {
      const err = new ImportSourceFetchError({ url: 'https://example.com/ics', ip: '198.51.100.1', statusCode: 500 });
      expect(err.message).toBe(IMPORT_FETCH_ERROR);
      expect(err.message).not.toContain('example.com');
      expect(err.message).not.toContain('198.51.100.1');
      expect(err.details).toEqual({ url: 'https://example.com/ics', ip: '198.51.100.1', statusCode: 500 });
    });
  });

  describe('ImportSourceSsrfBlockedError', () => {
    it('uses fixed sanitized message', () => {
      const err = new ImportSourceSsrfBlockedError();
      expect(err.name).toBe('ImportSourceSsrfBlockedError');
      expect(err.message).toBe(IMPORT_SSRF_BLOCKED);
    });

    it('does not expose blocked IP/host in the user-visible message', () => {
      const err = new ImportSourceSsrfBlockedError({ blockedIp: '10.0.0.1', host: 'internal.corp' });
      expect(err.message).toBe(IMPORT_SSRF_BLOCKED);
      expect(err.message).not.toContain('10.0.0.1');
      expect(err.message).not.toContain('internal.corp');
    });
  });

  describe('ImportSourceParseError', () => {
    it('uses fixed sanitized message', () => {
      const err = new ImportSourceParseError();
      expect(err.name).toBe('ImportSourceParseError');
      expect(err.message).toBe(IMPORT_PARSE_ERROR);
    });

    it('keeps raw parser output in details only', () => {
      const err = new ImportSourceParseError({ parserMessage: 'unexpected token at line 42' });
      expect(err.message).toBe(IMPORT_PARSE_ERROR);
      expect(err.details).toEqual({ parserMessage: 'unexpected token at line 42' });
    });
  });

  describe('ImportSourceDnsVerificationError', () => {
    it('accepts each of the fixed DNS reason codes as its message', () => {
      const reasons = [
        IMPORT_DNS_NOT_FOUND,
        IMPORT_DNS_MISMATCH,
        IMPORT_DNS_RESOLVER_DISAGREEMENT,
        IMPORT_DNS_RESOLVER_UNAVAILABLE,
        IMPORT_DNS_PSL_VIOLATION,
      ];
      for (const reason of reasons) {
        const err = new ImportSourceDnsVerificationError(reason);
        expect(err.name).toBe('ImportSourceDnsVerificationError');
        expect(err.message).toBe(reason);
      }
    });

    it('does not leak resolver-raw data or hostnames into the message', () => {
      const err = new ImportSourceDnsVerificationError(IMPORT_DNS_MISMATCH, {
        host: 'import.example.com',
        resolverAnswers: { cloudflare: ['1.2.3.4'], google: ['5.6.7.8'] },
      });
      expect(err.message).toBe(IMPORT_DNS_MISMATCH);
      expect(err.message).not.toContain('example.com');
      expect(err.message).not.toContain('1.2.3.4');
      expect(err.details).toBeDefined();
    });
  });

  describe('ImportSourceVerifyRateLimitError', () => {
    it('uses fixed sanitized message', () => {
      const err = new ImportSourceVerifyRateLimitError();
      expect(err.name).toBe('ImportSourceVerifyRateLimitError');
      expect(err.message).toBe(IMPORT_VERIFY_RATE_LIMITED);
    });
  });

  describe('cross-HTTP round-trip serialization', () => {
    const cases: Array<{ name: string; err: Error }> = [
      { name: 'ImportSourceNotFoundError', err: new ImportSourceNotFoundError() },
      { name: 'ImportSourceFetchError', err: new ImportSourceFetchError() },
      { name: 'ImportSourceSsrfBlockedError', err: new ImportSourceSsrfBlockedError() },
      { name: 'ImportSourceParseError', err: new ImportSourceParseError() },
      { name: 'ImportSourceDnsVerificationError', err: new ImportSourceDnsVerificationError(IMPORT_DNS_NOT_FOUND) },
      { name: 'ImportSourceVerifyRateLimitError', err: new ImportSourceVerifyRateLimitError() },
    ];

    for (const { name, err } of cases) {
      it(`round-trips ${name} via errorName discrimination`, () => {
        // Server side: throw → catch → serialize
        let caught: Error;
        try {
          throw err;
        }
        catch (e) {
          caught = e as Error;
        }
        const payload = serializeError(caught!);
        const wire = JSON.parse(JSON.stringify(payload));

        // Client side: reconstruct by errorName
        expect(wire.errorName).toBe(name);
        const Ctor = errorMap[wire.errorName];
        expect(Ctor).toBeDefined();
        const reconstructed = new Ctor();
        expect(reconstructed.name).toBe(name);
        expect(reconstructed).toBeInstanceOf(Error);
      });
    }

    it('does not serialize the details field onto the wire payload', () => {
      const err = new ImportSourceFetchError({ url: 'https://example.com/ics', ip: '198.51.100.1' });
      const payload = serializeError(err);
      // Only message + name travel over the wire
      expect(payload).toEqual({
        error: IMPORT_FETCH_ERROR,
        errorName: 'ImportSourceFetchError',
      });
      expect(JSON.stringify(payload)).not.toContain('example.com');
      expect(JSON.stringify(payload)).not.toContain('198.51.100.1');
    });
  });
});
