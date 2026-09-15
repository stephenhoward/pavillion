import { describe, it, expect } from 'vitest';
import {
  MAX_EXTERNAL_URL_LENGTH,
  sanitizeExternalUrlHref,
  sanitizePeerPageUrl,
} from '@/server/activitypub/helper/url-sanitizer';
// Cross-domain import, in a test only: this file owns the equivalence test
// between the rule of record (`sanitizePeerPageUrl`) and its restatement on
// the calendar domain's render path. Production code may not reach across the
// DEC-003 boundary, which is exactly why the two checks can drift.
import { parseAttributedToUri } from '@/server/calendar/helper/source_calendar';

const ACTOR_URI = 'https://remote.example.com/calendars/remote-cal';

/** What `parseAttributedToUri` emits when no declared page URL survives. */
const RENDER_FALLBACK_URL = 'https://remote.example.com/view/remote-cal';

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

  /**
   * The cap has to bound what is *returned*, not what arrived: WHATWG
   * normalization percent-encodes, so an input comfortably under the limit can
   * normalize to roughly three times its length. Every column these values are
   * stored in is a `varchar(2048)`, and on postgres an over-length write is a
   * hard `22001` — thrown mid-follow, before the follow row and the outbox add,
   * which would let a peer make itself unfollowable. sqlite (the dev, test and
   * e2e configs) tolerates the over-length write silently, so no test in the
   * suite can catch this class of bug through the database. It has to be
   * asserted on the sanitizer.
   */
  it('rejects an input under the cap whose normalized form exceeds it', () => {
    const input = 'https://remote.example.com/' + '<'.repeat(700);

    expect(input.length).toBeLessThanOrEqual(MAX_EXTERNAL_URL_LENGTH);
    expect(new URL(input).toString().length).toBeGreaterThan(MAX_EXTERNAL_URL_LENGTH);
    expect(sanitizeExternalUrlHref(input)).toBeNull();
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

    /**
     * `String.prototype.trim()` strips characters the WHATWG parser does not
     * (NBSP, BOM, the Unicode space separators), so validating the trimmed
     * actor URI and then parsing the raw one makes the two disagree and turns
     * the documented "never throws" contract into a `TypeError`. Unreachable
     * through today's only caller — `validateUrlNotPrivate` parses first — but
     * the next caller would not know that.
     */
    it.each([
      ['a non-breaking space', ' '],
      ['a BOM', '﻿'],
      ['a figure space', ' '],
    ])('pins against the trimmed actor URI rather than throwing for one prefixed by %s', (_label, prefix) => {
      const actorUri = `${prefix}https://remote.example.com/calendars/remote-cal`;

      expect(() => sanitizePeerPageUrl('https://remote.example.com/remote-cal', actorUri)).not.toThrow();
      expect(sanitizePeerPageUrl('https://remote.example.com/remote-cal', actorUri))
        .toBe('https://remote.example.com/remote-cal');
      // The pin still holds — the host came from the parse, not from the prefix.
      expect(sanitizePeerPageUrl('https://phish.example/x', actorUri)).toBeNull();
    });
  });

  /**
   * `URL.host` ignores userinfo, so credentials sail through the host pin. The
   * rendered link's visible authority then disagrees with the handle we label
   * it with, some browsers auto-submit the credentials as Basic auth, and
   * `https://[email protected]/` reads as an email address to anyone
   * hovering it.
   */
  describe('userinfo credentials', () => {
    it.each([
      ['a username and password', 'https://admin:[email protected]/secret'],
      ['a bare username', 'https://[email protected]/x'],
      ['an empty password', 'https://admin:@remote.example.com/x'],
    ])('rejects %s on the actor host', (_label, hostile) => {
      expect(sanitizePeerPageUrl(hostile, ACTOR_URI)).toBeNull();
    });

    it('rejects credentials declared inside a Link object', () => {
      const raw = { type: 'Link', href: 'https://admin:[email protected]/x' };
      expect(sanitizePeerPageUrl(raw, ACTOR_URI)).toBeNull();
    });
  });

  /**
   * Values that are rejected today by the host pin, the scheme allowlist or
   * the length cap rather than by a rule of their own. Asserted so a future
   * change to the pinning strategy cannot quietly reintroduce a bypass.
   */
  describe('named rejections that no single rule is named for', () => {
    it('rejects a trailing-dot host, which is not the actor host', () => {
      expect(sanitizePeerPageUrl('https://remote.example.com./x', ACTOR_URI)).toBeNull();
    });

    it('rejects a scheme-relative URL', () => {
      expect(sanitizePeerPageUrl('//evil.example/x', ACTOR_URI)).toBeNull();
    });

    it('rejects a declared URL whose normalized form exceeds the length cap', () => {
      const hostile = 'https://remote.example.com/' + '<'.repeat(700);

      expect(hostile.length).toBeLessThanOrEqual(MAX_EXTERNAL_URL_LENGTH);
      expect(sanitizePeerPageUrl(hostile, ACTOR_URI)).toBeNull();
    });

    it('percent-encodes embedded control characters rather than emitting them', () => {
      // Not a rejection: the parser normalizes these away. Asserted because the
      // render-path restatement must do the same rather than pass them through.
      expect(sanitizePeerPageUrl('https://remote.example.com/xy', ACTOR_URI))
        .toBe('https://remote.example.com/x%01y');
      expect(sanitizePeerPageUrl('https://remote.example.com/x"onmouseover=alert(1)', ACTOR_URI))
        .toBe('https://remote.example.com/x%22onmouseover=alert(1)');
    });

    it('takes the valid first element of an array and never looks at a hostile second', () => {
      const raw = ['https://remote.example.com/first', 'https://phish.example/second'];

      expect(sanitizePeerPageUrl(raw, ACTOR_URI)).toBe('https://remote.example.com/first');
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

/**
 * THIS TEST EXISTS TO KEEP TWO CHECKS IN STEP.
 *
 * A peer-declared page URL is checked twice: `sanitizePeerPageUrl` gates it
 * before it is cached on `calendar_actor.page_url` (the rule of record), and
 * `pinnedPageUrl` inside the calendar domain's `parseAttributedToUri` gates it
 * again at the render boundary, where it becomes an anchor href on an anonymous
 * public page. The render side cannot call the rule of record — DEC-003 forbids
 * the import — so it is a restatement, and a restatement drifts. It already
 * had: it agreed on scheme and host while accepting values the population side
 * rejected or rewrote, differing on normalization, userinfo and length.
 *
 * Edit either side and this table is what catches the divergence. Both doc
 * comments point here.
 */
describe('population and render checks agree on every axis', () => {
  /** Values both sides must refuse. */
  const rejected: Array<[string, string]> = [
    ['a different host', 'https://phish.example/remote-cal'],
    ['a subdomain of the actor host', 'https://evil.remote.example.com/x'],
    ['a lookalike suffix host', 'https://remote.example.com.evil.test/x'],
    ['a trailing-dot host', 'https://remote.example.com./x'],
    ['a different port', 'https://remote.example.com:8443/x'],
    ['a javascript: URL', 'javascript:alert(document.domain)'],
    ['a data: URL', 'data:text/html;base64,PHNjcmlwdD4='],
    ['a scheme-relative URL', '//evil.example/x'],
    ['an unparseable value', 'not-a-url'],
    ['an empty value', ''],
    ['userinfo credentials', 'https://admin:[email protected]/secret'],
    ['a bare userinfo username', 'https://[email protected]/x'],
    ['a value that normalizes past the length cap', 'https://remote.example.com/x' + '<'.repeat(700)],
    ['a pre-parse over-length value', 'https://remote.example.com/' + 'a'.repeat(2048)],
  ];

  /** Values both sides must accept, normalized identically. */
  const accepted: Array<[string, string, string]> = [
    [
      'a plain on-host URL',
      'https://remote.example.com/remote-cal',
      'https://remote.example.com/remote-cal',
    ],
    [
      'an upper-case host',
      'https://REMOTE.EXAMPLE.COM/remote-cal',
      'https://remote.example.com/remote-cal',
    ],
    [
      'surrounding whitespace',
      '  https://remote.example.com/x  ',
      'https://remote.example.com/x',
    ],
    [
      'an embedded quote',
      'https://remote.example.com/x"onmouseover=alert(1)',
      'https://remote.example.com/x%22onmouseover=alert(1)',
    ],
    [
      'an embedded control character',
      'https://remote.example.com/xy',
      'https://remote.example.com/x%01y',
    ],
    [
      'a newline inside the scheme',
      'ht\ntps://remote.example.com/x',
      'https://remote.example.com/x',
    ],
    [
      'a path shape that is not ours',
      'https://remote.example.com/en/groups/remote-cal?tab=events',
      'https://remote.example.com/en/groups/remote-cal?tab=events',
    ],
  ];

  it.each(rejected)('both reject %s', (_label, hostile) => {
    expect(sanitizePeerPageUrl(hostile, ACTOR_URI)).toBeNull();
    // The render side has no null to return — refusing means falling back.
    expect(parseAttributedToUri(ACTOR_URI, hostile)!.url).toBe(RENDER_FALLBACK_URL);
  });

  it.each(accepted)('both accept %s and normalize it identically', (_label, declared, expected) => {
    expect(sanitizePeerPageUrl(declared, ACTOR_URI)).toBe(expected);
    expect(parseAttributedToUri(ACTOR_URI, declared)!.url).toBe(expected);
  });
});
