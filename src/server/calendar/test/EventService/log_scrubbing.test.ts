import { describe, it, expect } from 'vitest';

import { scrubExternalUrlForLog } from '@/server/calendar/service/events';

/**
 * Tests for scrubExternalUrlForLog — the privacy-preserving log helper that
 * strips query strings and fragments from external URLs before they reach
 * structured log output.
 *
 * External URLs can carry OAuth tokens, session IDs, or other PII-adjacent
 * material in their query string or fragment. Per the privacy-playbook /
 * privacy/logging standard, such values must never be logged verbatim.
 */
describe('scrubExternalUrlForLog', () => {
  it('returns null for null input', () => {
    expect(scrubExternalUrlForLog(null)).toBe(null);
  });

  it('returns null for undefined input', () => {
    expect(scrubExternalUrlForLog(undefined)).toBe(null);
  });

  it('preserves origin and pathname when no query or fragment is present', () => {
    expect(scrubExternalUrlForLog('https://example.com/path')).toBe('https://example.com/path');
  });

  it('strips the query string entirely (may contain tokens/PII)', () => {
    const scrubbed = scrubExternalUrlForLog('https://example.com/path?token=secret&session=abcd1234');
    expect(scrubbed).toBe('https://example.com/path');
    expect(scrubbed).not.toContain('token');
    expect(scrubbed).not.toContain('secret');
    expect(scrubbed).not.toContain('session');
    expect(scrubbed).not.toContain('?');
  });

  it('strips the fragment entirely', () => {
    const scrubbed = scrubExternalUrlForLog('https://example.com/path#user=alice');
    expect(scrubbed).toBe('https://example.com/path');
    expect(scrubbed).not.toContain('#');
    expect(scrubbed).not.toContain('alice');
  });

  it('strips both query string and fragment when both are present', () => {
    const scrubbed = scrubExternalUrlForLog('https://example.com/events/123?token=xyz#anchor');
    expect(scrubbed).toBe('https://example.com/events/123');
  });

  it('returns null for unparseable URL (never emits raw malformed value)', () => {
    expect(scrubExternalUrlForLog('not a url')).toBe(null);
    expect(scrubExternalUrlForLog('://broken')).toBe(null);
  });

  it('preserves non-default ports in the origin', () => {
    expect(scrubExternalUrlForLog('https://example.com:8443/path?x=1')).toBe('https://example.com:8443/path');
  });

  it('preserves http scheme', () => {
    expect(scrubExternalUrlForLog('http://example.com/path?x=1')).toBe('http://example.com/path');
  });

  it('does not emit the raw full URL when a query string is present', () => {
    const raw = 'https://example.com/path?token=supersecretvalue';
    const scrubbed = scrubExternalUrlForLog(raw);
    expect(scrubbed).not.toBe(raw);
    expect(scrubbed).not.toContain('supersecretvalue');
  });
});
