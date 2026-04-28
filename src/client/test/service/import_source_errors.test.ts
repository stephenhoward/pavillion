import { describe, it, expect } from 'vitest';

import { importSourceErrorKey } from '@/client/service/import_source_errors';
import {
  ImportSourceDnsVerificationError,
  ImportSourceRelMeVerificationError,
  ImportSourceFetchError,
  ImportSourceSsrfBlockedError,
  ImportSourceParseError,
  ImportSourceVerifyRateLimitError,
  IMPORT_DNS_NOT_FOUND,
  IMPORT_DNS_MISMATCH,
  IMPORT_DNS_RESOLVER_DISAGREEMENT,
  IMPORT_DNS_RESOLVER_UNAVAILABLE,
  IMPORT_DNS_PSL_VIOLATION,
  IMPORT_RELME_PAGE_FETCH_ERROR,
  IMPORT_RELME_PARSE_ERROR,
  IMPORT_RELME_LINK_NOT_FOUND,
  IMPORT_RELME_HOSTNAME_MISMATCH,
  IMPORT_RELME_PSL_VIOLATION,
} from '@/common/exceptions/import';

describe('importSourceErrorKey', () => {
  describe('verify-dns context', () => {
    const dnsCases: [string, string][] = [
      [IMPORT_DNS_NOT_FOUND, 'errors.dns_not_found'],
      [IMPORT_DNS_MISMATCH, 'errors.dns_mismatch'],
      [IMPORT_DNS_RESOLVER_DISAGREEMENT, 'errors.dns_resolver_disagreement'],
      [IMPORT_DNS_RESOLVER_UNAVAILABLE, 'errors.dns_resolver_unavailable'],
      [IMPORT_DNS_PSL_VIOLATION, 'errors.dns_psl_violation'],
    ];

    for (const [reason, expectedKey] of dnsCases) {
      it(`maps ${reason} to ${expectedKey}`, () => {
        const err = new ImportSourceDnsVerificationError(reason);
        expect(importSourceErrorKey(err, 'verify-dns')).toBe(expectedKey);
      });
    }

    it('maps common transport errors to their shared keys', () => {
      expect(importSourceErrorKey(new ImportSourceFetchError(), 'verify-dns'))
        .toBe('errors.fetch_error');
      expect(importSourceErrorKey(new ImportSourceSsrfBlockedError(), 'verify-dns'))
        .toBe('errors.ssrf_blocked');
      expect(importSourceErrorKey(new ImportSourceParseError(), 'verify-dns'))
        .toBe('errors.parse_error');
      expect(importSourceErrorKey(new ImportSourceVerifyRateLimitError(), 'verify-dns'))
        .toBe('errors.rate_limited');
    });

    it('falls back to errors.unknown_verify for unrecognized errors', () => {
      expect(importSourceErrorKey(new Error('boom'), 'verify-dns'))
        .toBe('errors.unknown_verify');
      expect(importSourceErrorKey(null, 'verify-dns'))
        .toBe('errors.unknown_verify');
    });
  });

  describe('verify-rel-me context', () => {
    const relmeCases: [string, string][] = [
      [IMPORT_RELME_PAGE_FETCH_ERROR, 'errors.relme_page_fetch_error'],
      [IMPORT_RELME_PARSE_ERROR, 'errors.relme_parse_error'],
      [IMPORT_RELME_LINK_NOT_FOUND, 'errors.relme_link_not_found'],
      [IMPORT_RELME_HOSTNAME_MISMATCH, 'errors.relme_hostname_mismatch'],
      [IMPORT_RELME_PSL_VIOLATION, 'errors.relme_psl_violation'],
    ];

    for (const [reason, expectedKey] of relmeCases) {
      it(`maps ${reason} to ${expectedKey}`, () => {
        const err = new ImportSourceRelMeVerificationError(reason);
        expect(importSourceErrorKey(err, 'verify-rel-me')).toBe(expectedKey);
      });
    }

    it('maps SSRF blocks during page fetch to errors.ssrf_blocked', () => {
      expect(importSourceErrorKey(new ImportSourceSsrfBlockedError(), 'verify-rel-me'))
        .toBe('errors.ssrf_blocked');
    });

    it('maps rate-limit errors to errors.rate_limited', () => {
      expect(importSourceErrorKey(new ImportSourceVerifyRateLimitError(), 'verify-rel-me'))
        .toBe('errors.rate_limited');
    });

    it('falls back to errors.unknown_verify for unrecognized errors', () => {
      expect(importSourceErrorKey(new Error('boom'), 'verify-rel-me'))
        .toBe('errors.unknown_verify');
    });
  });

  describe('sync context', () => {
    it('maps common transport errors to their shared keys', () => {
      expect(importSourceErrorKey(new ImportSourceFetchError(), 'sync'))
        .toBe('errors.fetch_error');
      expect(importSourceErrorKey(new ImportSourceSsrfBlockedError(), 'sync'))
        .toBe('errors.ssrf_blocked');
      expect(importSourceErrorKey(new ImportSourceParseError(), 'sync'))
        .toBe('errors.parse_error');
      expect(importSourceErrorKey(new ImportSourceVerifyRateLimitError(), 'sync'))
        .toBe('errors.rate_limited');
    });

    it('does NOT unwrap verification errors in the sync context', () => {
      const err = new ImportSourceDnsVerificationError(IMPORT_DNS_NOT_FOUND);
      expect(importSourceErrorKey(err, 'sync'))
        .toBe('errors.unknown_sync');
    });

    it('falls back to errors.unknown_sync for unrecognized errors', () => {
      expect(importSourceErrorKey(new Error('boom'), 'sync'))
        .toBe('errors.unknown_sync');
      expect(importSourceErrorKey(null, 'sync'))
        .toBe('errors.unknown_sync');
    });
  });
});
