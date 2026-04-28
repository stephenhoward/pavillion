import { describe, it, expect } from 'vitest';

import {
  RELME_PAGE_URL_MAX_LENGTH,
  normalizeUrl,
  validateRelMePageUrl,
} from '@/client/service/rel_me_url_validation';

describe('normalizeUrl', () => {
  it('returns an empty string when input is empty after trim', () => {
    expect(normalizeUrl('')).toBe('');
    expect(normalizeUrl('   ')).toBe('');
  });

  it('passes inputs that already declare a scheme through unchanged', () => {
    expect(normalizeUrl('https://example.com/path'))
      .toBe('https://example.com/path');
    expect(normalizeUrl('http://example.com'))
      .toBe('http://example.com');
    expect(normalizeUrl('ftp://example.com'))
      .toBe('ftp://example.com');
  });

  it('prepends https:// when scheme is omitted', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com');
    expect(normalizeUrl('  example.com/page  '))
      .toBe('https://example.com/page');
  });
});

describe('validateRelMePageUrl', () => {
  const HOSTNAME = 'example.com';

  it('rejects empty input with page_url_required', () => {
    expect(validateRelMePageUrl('', HOSTNAME))
      .toEqual({ ok: false, key: 'rel_me_challenge.page_url_required' });
    expect(validateRelMePageUrl('   ', HOSTNAME))
      .toEqual({ ok: false, key: 'rel_me_challenge.page_url_required' });
  });

  it('rejects URLs longer than the max length with page_url_too_long', () => {
    const tooLong = `https://${HOSTNAME}/${'a'.repeat(RELME_PAGE_URL_MAX_LENGTH)}`;
    expect(validateRelMePageUrl(tooLong, HOSTNAME))
      .toEqual({ ok: false, key: 'rel_me_challenge.page_url_too_long' });
  });

  it('rejects unparseable URLs with page_url_invalid', () => {
    expect(validateRelMePageUrl('https://', HOSTNAME))
      .toEqual({ ok: false, key: 'rel_me_challenge.page_url_invalid' });
  });

  it('rejects non-https schemes with page_url_invalid_scheme', () => {
    expect(validateRelMePageUrl('http://example.com/page', HOSTNAME))
      .toEqual({ ok: false, key: 'rel_me_challenge.page_url_invalid_scheme' });
    expect(validateRelMePageUrl('ftp://example.com/page', HOSTNAME))
      .toEqual({ ok: false, key: 'rel_me_challenge.page_url_invalid_scheme' });
  });

  it('rejects mismatched hostnames with page_url_hostname_mismatch', () => {
    expect(validateRelMePageUrl('https://other.com/page', HOSTNAME))
      .toEqual({ ok: false, key: 'rel_me_challenge.page_url_hostname_mismatch' });
  });

  it('matches hostnames case-insensitively', () => {
    expect(validateRelMePageUrl('https://EXAMPLE.com/page', HOSTNAME))
      .toEqual({ ok: true, url: 'https://EXAMPLE.com/page' });
    expect(validateRelMePageUrl('https://example.com/page', 'EXAMPLE.COM'))
      .toEqual({ ok: true, url: 'https://example.com/page' });
  });

  it('accepts schemeless input by auto-prepending https://', () => {
    expect(validateRelMePageUrl('example.com/page', HOSTNAME))
      .toEqual({ ok: true, url: 'https://example.com/page' });
  });

  it('returns the normalized URL on success', () => {
    expect(validateRelMePageUrl('  https://example.com/page  ', HOSTNAME))
      .toEqual({ ok: true, url: 'https://example.com/page' });
  });
});
