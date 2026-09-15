import { describe, it, expect } from 'vitest';
import { sanitizeExternalUrlHref, sanitizePeerPageUrl } from '@/server/activitypub/helper/url-sanitizer';

const ACTOR_URI = 'https://remote.example.com/calendars/remote-cal';

describe('sanitizeExternalUrlHref', () => {
  it('accepts an http(s) URL', () => {
    expect(sanitizeExternalUrlHref('https://remote.example.com/x')).toBe('https://remote.example.com/x');
  });

  it('rejects a non-http(s) scheme', () => {
    expect(sanitizeExternalUrlHref('javascript:alert(1)')).toBeNull();
  });

  it('rejects a non-string, an empty value and an over-length value', () => {
    expect(sanitizeExternalUrlHref(undefined)).toBeNull();
    expect(sanitizeExternalUrlHref('   ')).toBeNull();
    expect(sanitizeExternalUrlHref('https://remote.example.com/' + 'a'.repeat(2048))).toBeNull();
  });
});

describe('sanitizePeerPageUrl', () => {
  describe('AS2 url shape normalization', () => {
    it('accepts a bare string', () => {
      expect(sanitizePeerPageUrl('https://remote.example.com/remote-cal', ACTOR_URI))
        .toBe('https://remote.example.com/remote-cal');
    });

    it('accepts a Link object and reads its href', () => {
      const raw = { type: 'Link', href: 'https://remote.example.com/remote-cal' };
      expect(sanitizePeerPageUrl(raw, ACTOR_URI)).toBe('https://remote.example.com/remote-cal');
    });

    it('accepts an array of strings and takes the first survivor', () => {
      const raw = [
        'https://remote.example.com/first',
        'https://remote.example.com/second',
      ];
      expect(sanitizePeerPageUrl(raw, ACTOR_URI)).toBe('https://remote.example.com/first');
    });

    it('accepts an array of Link objects and takes the first survivor', () => {
      const raw = [
        { type: 'Link', href: 'https://remote.example.com/first' },
        { type: 'Link', href: 'https://remote.example.com/second' },
      ];
      expect(sanitizePeerPageUrl(raw, ACTOR_URI)).toBe('https://remote.example.com/first');
    });

    it('skips entries that fail sanitization and takes the first that survives', () => {
      const raw = [
        'javascript:alert(1)',
        { type: 'Link', href: 'https://phish.example/x' },
        'https://remote.example.com/survivor',
      ];
      expect(sanitizePeerPageUrl(raw, ACTOR_URI)).toBe('https://remote.example.com/survivor');
    });

    it('returns null for shapes it does not recognize', () => {
      expect(sanitizePeerPageUrl(undefined, ACTOR_URI)).toBeNull();
      expect(sanitizePeerPageUrl(null, ACTOR_URI)).toBeNull();
      expect(sanitizePeerPageUrl(42, ACTOR_URI)).toBeNull();
      expect(sanitizePeerPageUrl({}, ACTOR_URI)).toBeNull();
      expect(sanitizePeerPageUrl({ type: 'Link', href: 99 }, ACTOR_URI)).toBeNull();
      expect(sanitizePeerPageUrl([], ACTOR_URI)).toBeNull();
    });
  });

  describe('scheme allowlist', () => {
    it.each([
      'javascript:alert(document.domain)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'ftp://remote.example.com/remote-cal',
      'file:///etc/passwd',
    ])('rejects %s', (hostile) => {
      expect(sanitizePeerPageUrl(hostile, ACTOR_URI)).toBeNull();
    });

    it('rejects a hostile scheme declared inside a Link object', () => {
      expect(sanitizePeerPageUrl({ type: 'Link', href: 'javascript:alert(1)' }, ACTOR_URI)).toBeNull();
    });
  });

  describe('host pinning to the actor URI', () => {
    it('rejects a URL on a different host', () => {
      expect(sanitizePeerPageUrl('https://phish.example/remote-cal', ACTOR_URI)).toBeNull();
    });

    it('rejects an off-host URL declared inside a Link object', () => {
      expect(sanitizePeerPageUrl({ type: 'Link', href: 'https://phish.example/x' }, ACTOR_URI)).toBeNull();
    });

    it('rejects an off-host URL declared inside an array, emitting no attacker host', () => {
      const raw = ['https://phish.example/a', { type: 'Link', href: 'https://evil.example/b' }];
      expect(sanitizePeerPageUrl(raw, ACTOR_URI)).toBeNull();
    });

    it('rejects a subdomain of the actor host', () => {
      expect(sanitizePeerPageUrl('https://evil.remote.example.com/x', ACTOR_URI)).toBeNull();
    });

    it('rejects a host that merely embeds the actor host', () => {
      expect(sanitizePeerPageUrl('https://remote.example.com.evil.test/x', ACTOR_URI)).toBeNull();
    });

    it('rejects a host differing only by port', () => {
      expect(sanitizePeerPageUrl('https://remote.example.com:8443/x', ACTOR_URI)).toBeNull();
    });

    it('matches the host case-insensitively', () => {
      expect(sanitizePeerPageUrl('https://REMOTE.EXAMPLE.COM/remote-cal', ACTOR_URI))
        .toBe('https://remote.example.com/remote-cal');
    });

    it('allows a scheme that differs from the actor URI as long as the host matches', () => {
      expect(sanitizePeerPageUrl('http://remote.example.com/remote-cal', ACTOR_URI))
        .toBe('http://remote.example.com/remote-cal');
    });

    it('returns null when the actor URI itself is unusable', () => {
      const candidate = 'https://remote.example.com/remote-cal';
      expect(sanitizePeerPageUrl(candidate, 'not-a-url')).toBeNull();
      expect(sanitizePeerPageUrl(candidate, '')).toBeNull();
    });
  });

  it('never throws for arbitrary input', () => {
    const nasty: unknown[] = [Symbol('x'), () => 'x', new Map(), NaN, [[['nested']]]];
    for (const value of nasty) {
      expect(() => sanitizePeerPageUrl(value, ACTOR_URI)).not.toThrow();
      expect(sanitizePeerPageUrl(value, ACTOR_URI)).toBeNull();
    }
  });
});
