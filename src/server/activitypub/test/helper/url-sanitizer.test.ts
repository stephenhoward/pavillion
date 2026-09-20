import { describe, it, expect } from 'vitest';
import {
  MAX_EXTERNAL_URL_LENGTH,
  MAX_URL_CANDIDATES,
  sanitizeExternalUrlHref,
  sanitizePeerPageUrl,
} from '@/server/activitypub/helper/url-sanitizer';
// Cross-domain import, in a test only: this file owns the equivalence test
// between the rule of record (`sanitizePeerPageUrl`) and its restatement on
// the calendar domain's render path. Production code may not reach across the
// DEC-003 boundary, which is exactly why the two checks can drift.
import { MAX_PAGE_URL_LENGTH, parseAttributedToUri } from '@/server/calendar/helper/source_calendar';

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

    /**
     * `url` is a list of representations of one page, not a collection, so the
     * candidate count is capped: a hostile peer may not force an unbounded run
     * of `new URL` parses during an authenticated, user-initiated follow.
     */
    it(`examines only the first ${MAX_URL_CANDIDATES} candidates`, () => {
      const filler = Array(MAX_URL_CANDIDATES - 1).fill('javascript:alert(1)');

      expect(sanitizePeerPageUrl([...filler, 'https://remote.example.com/last'], ACTOR_URI))
        .toBe('https://remote.example.com/last');
      expect(sanitizePeerPageUrl([...filler, 'javascript:alert(1)', 'https://remote.example.com/past-the-cap'], ACTOR_URI))
        .toBeNull();
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

    it("pins the scheme to the actor URI's, refusing an http page from an https actor", () => {
      expect(sanitizePeerPageUrl('http://remote.example.com/remote-cal', ACTOR_URI)).toBeNull();
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

  /**
   * The "NEVER throws" contract covers inspecting the candidates, not only
   * parsing them: a candidate whose `href` is a throwing accessor and an
   * array-like whose `length` is both threw before the loop body was guarded.
   * Unreachable through today's only caller — `JSON.parse` output has no
   * accessors — but the next caller reads the contract, not the caller list.
   */
  it('never throws for arbitrary input', () => {
    const throwingHref = {
      get href(): string {
        throw new Error('boom');
      },
    };
    const throwingLength = new Proxy([], {
      get(target, property, receiver) {
        if (property === 'length') throw new Error('boom');
        return Reflect.get(target, property, receiver);
      },
    });
    const nasty: unknown[] = [
      Symbol('x'),
      () => 'x',
      new Map(),
      NaN,
      [[['nested']]],
      throwingHref,
      [throwingHref],
      throwingLength,
    ];
    for (const value of nasty) {
      expect(() => sanitizePeerPageUrl(value, ACTOR_URI)).not.toThrow();
      expect(sanitizePeerPageUrl(value, ACTOR_URI)).toBeNull();
    }

    // A throwing candidate is skipped, not fatal: a usable sibling still wins.
    expect(sanitizePeerPageUrl([throwingHref, 'https://remote.example.com/x'], ACTOR_URI))
      .toBe('https://remote.example.com/x');
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
  /** `https://remote.example.com/` — 27 characters, none of them re-encoded. */
  const HOST_PREFIX = 'https://remote.example.com/';

  /**
   * A `[declared, normalized]` pair whose **normalized** form is exactly
   * `length` characters. `<` percent-encodes to `%3C` — three characters for
   * one — so an angle-bracket run plus a plain-character run hits any length
   * exactly while keeping the declared value comfortably under the pre-parse
   * cap, which is what forces the *post*-parse cap to be the rule under test.
   */
  const pairNormalizingTo = (length: number): [declared: string, normalized: string] => {
    const angles = Math.floor((length - HOST_PREFIX.length) / 3);
    const plain = length - HOST_PREFIX.length - angles * 3;
    return [
      HOST_PREFIX + '<'.repeat(angles) + 'a'.repeat(plain),
      HOST_PREFIX + '%3C'.repeat(angles) + 'a'.repeat(plain),
    ];
  };

  const [atCapDeclared, atCapNormalized] = pairNormalizingTo(MAX_EXTERNAL_URL_LENGTH);
  const [overCapDeclared] = pairNormalizingTo(MAX_EXTERNAL_URL_LENGTH + 1);

  /**
   * The two length constants are deliberate duplicates — DEC-003 forbids the
   * calendar domain importing the ActivityPub helper — and fixtures alone
   * detected drift in one direction only: every `accepted` row was short
   * enough that *lowering* the render cap, or widening it by a little, changed
   * nothing. Assert the numbers directly, and keep the boundary rows below to
   * pin the behaviour at the cap rather than only the number.
   */
  it('caps both sides at the same length', () => {
    expect(MAX_PAGE_URL_LENGTH).toBe(MAX_EXTERNAL_URL_LENGTH);
  });

  it('places the boundary fixtures exactly where the rows below assume', () => {
    expect(atCapDeclared.length).toBeLessThan(MAX_EXTERNAL_URL_LENGTH);
    expect(new URL(atCapDeclared).toString()).toBe(atCapNormalized);
    expect(atCapNormalized).toHaveLength(MAX_EXTERNAL_URL_LENGTH);

    expect(overCapDeclared.length).toBeLessThan(MAX_EXTERNAL_URL_LENGTH);
    expect(new URL(overCapDeclared).toString()).toHaveLength(MAX_EXTERNAL_URL_LENGTH + 1);
  });

  /** Values both sides must refuse. */
  const rejected: Array<[string, string]> = [
    ['a different host', 'https://phish.example/remote-cal'],
    ['a subdomain of the actor host', 'https://evil.remote.example.com/x'],
    ['a lookalike suffix host', 'https://remote.example.com.evil.test/x'],
    ['a trailing-dot host', 'https://remote.example.com./x'],
    ['a different port', 'https://remote.example.com:8443/x'],
    ['an http downgrade of the https actor', 'http://remote.example.com/remote-cal'],
    ['a javascript: URL', 'javascript:alert(document.domain)'],
    ['a data: URL', 'data:text/html;base64,PHNjcmlwdD4='],
    ['a scheme-relative URL', '//evil.example/x'],
    ['an unparseable value', 'not-a-url'],
    ['an empty value', ''],
    ['userinfo credentials', 'https://admin:[email protected]/secret'],
    ['a bare userinfo username', 'https://[email protected]/x'],
    ['a value that normalizes past the length cap', 'https://remote.example.com/x' + '<'.repeat(700)],
    ['a pre-parse over-length value', 'https://remote.example.com/' + 'a'.repeat(2048)],
    ['a value one character past the cap once normalized', overCapDeclared],
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
    // Lowering either cap by a single character turns this row red; nothing
    // else in the table is long enough to notice.
    [
      'a value landing exactly on the length cap once normalized',
      atCapDeclared,
      atCapNormalized,
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

  /**
   * The table above holds the actor URI constant, so it was structurally blind
   * to the one axis the two sides were genuinely unequal on: population pinned
   * against the trimmed actor URI while the render side parsed the raw
   * `attributed_to`. `trim()` strips NBSP, BOM and the Unicode space
   * separators that the WHATWG parser does not, so a whitespace-prefixed actor
   * URI made population accept the declared URL while the render side threw
   * internally and returned null — dropping the whole attribution pill, not
   * just the declared link. Both sides trim now, so vary the actor URI too.
   */
  describe('with a whitespace-prefixed actor URI', () => {
    const declared = 'https://remote.example.com/remote-cal';

    it.each([
      ['a non-breaking space', ' '],
      ['a BOM', '﻿'],
      ['a figure space', ' '],
    ])('both accept an on-host declaration against one prefixed by %s', (_label, prefix) => {
      const actorUri = `${prefix}${ACTOR_URI}`;

      expect(sanitizePeerPageUrl(declared, actorUri)).toBe(declared);

      const rendered = parseAttributedToUri(actorUri, declared);
      expect(rendered).not.toBeNull();
      expect(rendered!.url).toBe(declared);
      // The label the link carries is derived from the same parse.
      expect(rendered!.host).toBe('remote.example.com');
      expect(rendered!.urlName).toBe('remote-cal');
    });

    it.each([
      ['a non-breaking space', ' '],
      ['a BOM', '﻿'],
    ])('both still refuse an off-host declaration against one prefixed by %s', (_label, prefix) => {
      const actorUri = `${prefix}${ACTOR_URI}`;

      expect(sanitizePeerPageUrl('https://phish.example/x', actorUri)).toBeNull();
      expect(parseAttributedToUri(actorUri, 'https://phish.example/x')!.url).toBe(RENDER_FALLBACK_URL);
    });
  });
});
