import { describe, it, expect } from 'vitest';

import { validateApActorUri } from '@/server/notifications/service/ap-actor-uri';

describe('validateApActorUri', () => {
  // ---------------------------------------------------------------------------
  // Accepted inputs
  // ---------------------------------------------------------------------------

  describe('valid URIs', () => {
    it('accepts a plain https URI and returns the lowercased hostname', () => {
      const result = validateApActorUri('https://example.org/users/alice');
      expect(result).toEqual({ kind: 'valid', host: 'example.org' });
    });

    it('lowercases mixed-case hostnames', () => {
      const result = validateApActorUri('https://EXAMPLE.org/users/alice');
      expect(result).toEqual({ kind: 'valid', host: 'example.org' });
    });

    it('accepts https URIs with port numbers (hostname only is returned)', () => {
      const result = validateApActorUri('https://example.org:8443/users/alice');
      expect(result).toEqual({ kind: 'valid', host: 'example.org' });
    });

    it('NFKC-normalizes fullwidth ASCII hostnames to defeat homograph variants', () => {
      // Fullwidth "example.com" — each char is the U+FFxx fullwidth form
      const fullwidth = 'https://ｅｘａｍｐｌｅ.com/users/alice';
      const result = validateApActorUri(fullwidth);
      expect(result).toEqual({ kind: 'valid', host: 'example.com' });
    });

    it('accepts internationalized domain names (punycode form)', () => {
      const result = validateApActorUri('https://xn--bcher-kva.example/users/alice');
      expect(result).toEqual({ kind: 'valid', host: 'xn--bcher-kva.example' });
    });
  });

  // ---------------------------------------------------------------------------
  // Rejected inputs
  // ---------------------------------------------------------------------------

  describe('invalid URIs', () => {
    it('rejects malformed strings that fail URL parsing', () => {
      expect(validateApActorUri('not a url')).toEqual({ kind: 'invalid' });
    });

    it('rejects empty string', () => {
      expect(validateApActorUri('')).toEqual({ kind: 'invalid' });
    });

    it('rejects http scheme (HTTPS-only)', () => {
      expect(validateApActorUri('http://example.org/users/alice')).toEqual({ kind: 'invalid' });
    });

    it('rejects non-http(s) schemes (file)', () => {
      expect(validateApActorUri('file:///etc/passwd')).toEqual({ kind: 'invalid' });
    });

    it('rejects javascript: scheme', () => {
      expect(validateApActorUri('javascript:alert(1)')).toEqual({ kind: 'invalid' });
    });

    it('rejects URIs containing a userinfo component (username only)', () => {
      expect(validateApActorUri('https://user@example.org/users/alice')).toEqual({ kind: 'invalid' });
    });

    it('rejects URIs containing a userinfo component (username + password)', () => {
      expect(validateApActorUri('https://user:pass@example.org/users/alice')).toEqual({ kind: 'invalid' });
    });

    it('rejects IPv4 literal hostnames', () => {
      expect(validateApActorUri('https://192.168.1.1/users/alice')).toEqual({ kind: 'invalid' });
    });

    it('rejects IPv4 literals on non-private ranges', () => {
      expect(validateApActorUri('https://8.8.8.8/users/alice')).toEqual({ kind: 'invalid' });
    });

    it('rejects IPv6 literal hostnames', () => {
      expect(validateApActorUri('https://[2001:db8::1]/users/alice')).toEqual({ kind: 'invalid' });
    });

    it('rejects IPv6 loopback literal', () => {
      expect(validateApActorUri('https://[::1]/users/alice')).toEqual({ kind: 'invalid' });
    });

    it('rejects IPv4 loopback literal', () => {
      expect(validateApActorUri('https://127.0.0.1/users/alice')).toEqual({ kind: 'invalid' });
    });

    // -----------------------------------------------------------------------
    // RFC 1123 DNS allowlist (Rule 6)
    //
    // Node's WHATWG URL parser tolerates `{`, `}`, `,`, spaces and other
    // characters DNS does not. Without the allowlist, a URI such as
    // `https://evil.com}attacker.bad.org/` flows through with a host of
    // `evil.com}attacker.bad.org`, and the stored attribution token
    // `i18n:flag_actor_remote{host:evil.com}attacker.bad.org}` becomes
    // spoofable on the client (no XSS — Vue/i18next auto-escape — but the
    // recipient sees attacker-controlled display text).
    // -----------------------------------------------------------------------

    it('rejects hostnames containing `}` (closing brace would break i18n token grammar)', () => {
      expect(validateApActorUri('https://evil.com}bad.org/')).toEqual({ kind: 'invalid' });
    });

    it('rejects hostnames containing `{` (opening brace would break i18n token grammar)', () => {
      expect(validateApActorUri('https://a{b.com/')).toEqual({ kind: 'invalid' });
    });

    it('rejects hostnames containing a comma', () => {
      expect(validateApActorUri('https://x,y.com/')).toEqual({ kind: 'invalid' });
    });

    it('rejects URIs whose hostname would contain a space (WHATWG URL parse failure)', () => {
      // Spaces are not legal in URIs; WHATWG URL rejects this at parse
      // time (Rule 1). Documented here so the trust boundary is covered
      // even though Rule 6 is not the gate that fires.
      expect(validateApActorUri('https://has space.com/')).toEqual({ kind: 'invalid' });
    });

    it('rejects hostnames with a leading hyphen in a label', () => {
      expect(validateApActorUri('https://-bad.example/')).toEqual({ kind: 'invalid' });
    });

    it('rejects hostnames with a trailing hyphen in a label', () => {
      expect(validateApActorUri('https://bad-.example/')).toEqual({ kind: 'invalid' });
    });

    it('rejects hostnames with an empty label (consecutive dots)', () => {
      // WHATWG URL may itself reject some of these; the assertion is that
      // however the parser tolerates them, the allowlist rejects them.
      expect(validateApActorUri('https://a..b.example/')).toEqual({ kind: 'invalid' });
    });
  });
});
