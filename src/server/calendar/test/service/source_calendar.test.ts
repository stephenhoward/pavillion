import { describe, it, expect } from 'vitest';
import config from 'config';
import { CalendarEvent } from '@/common/model/events';
import { resolveSourceCalendars, parseAttributedToUri, type RepostContext } from '../../helper/source_calendar';
import type { EventSourceActor } from '@/server/activitypub/interface';

const TEST_DOMAIN: string = config.get('domain');

const REMOTE_ACTOR_URI = 'https://remote.example.com/calendars/remote-cal';

/**
 * Builds the map `resolveSourceCalendars` receives from the AP interface.
 * `pageUrl` null models a peer whose actor document declared no usable `url`.
 */
function actorMap(entries: Array<[string, string, string | null]>): Map<string, EventSourceActor> {
  return new Map(entries.map(([eventId, actorUri, pageUrl]) => [eventId, { actorUri, pageUrl }]));
}

function buildContext(overrides: {
  eventId: string;
  displayCalendarId: string;
  eventCalendarId: string | null;
  sourceCalendarUrlName?: string;
}): RepostContext {
  return {
    event: new CalendarEvent(overrides.eventId, overrides.eventCalendarId),
    displayCalendarId: overrides.displayCalendarId,
    eventCalendarId: overrides.eventCalendarId,
    sourceCalendarUrlName: overrides.sourceCalendarUrlName,
  };
}

describe('resolveSourceCalendars', () => {
  it('should not mark non-reposted events', async () => {
    const ctx = buildContext({
      eventId: 'evt-1',
      displayCalendarId: 'cal-A',
      eventCalendarId: 'cal-A',
    });

    await resolveSourceCalendars([ctx], new Map());

    expect(ctx.event.repostStatus).toBe('none');
    expect(ctx.event.sourceCalendar).toBeNull();
  });

  it('should resolve local reposts from eager-loaded calendar data', async () => {
    const ctx = buildContext({
      eventId: 'evt-2',
      displayCalendarId: 'cal-B',
      eventCalendarId: 'cal-A',
      sourceCalendarUrlName: 'original-cal',
    });

    await resolveSourceCalendars([ctx], new Map());

    expect(ctx.event.repostStatus).toBe('manual');
    expect(ctx.event.sourceCalendar).not.toBeNull();
    expect(ctx.event.sourceCalendar!.urlName).toBe('original-cal');
    expect(ctx.event.sourceCalendar!.host).toBe(TEST_DOMAIN);
    expect(ctx.event.sourceCalendar!.url).toBe('/original-cal');
  });

  it('should mark as repost but leave sourceCalendar null when urlName is unavailable', async () => {
    const ctx = buildContext({
      eventId: 'evt-2b',
      displayCalendarId: 'cal-B',
      eventCalendarId: 'cal-A',
      // no sourceCalendarUrlName — calendar entity wasn't eager-loaded
    });

    await resolveSourceCalendars([ctx], new Map());

    expect(ctx.event.repostStatus).toBe('manual');
    expect(ctx.event.sourceCalendar).toBeNull();
  });

  it('should use the page URL the peer declared in its actor document', async () => {
    const ctx = buildContext({
      eventId: 'evt-3',
      displayCalendarId: 'cal-B',
      eventCalendarId: null,
    });

    await resolveSourceCalendars(
      [ctx],
      actorMap([['evt-3', REMOTE_ACTOR_URI, 'https://remote.example.com/remote-cal']]),
    );

    expect(ctx.event.repostStatus).toBe('manual');
    expect(ctx.event.sourceCalendar!.urlName).toBe('remote-cal');
    expect(ctx.event.sourceCalendar!.host).toBe('remote.example.com');
    expect(ctx.event.sourceCalendar!.url).toBe('https://remote.example.com/remote-cal');
  });

  it('should fall back to the /view/ spelling when the peer declared no page URL', async () => {
    const ctx = buildContext({
      eventId: 'evt-3b',
      displayCalendarId: 'cal-B',
      eventCalendarId: null,
    });

    await resolveSourceCalendars([ctx], actorMap([['evt-3b', REMOTE_ACTOR_URI, null]]));

    expect(ctx.event.repostStatus).toBe('manual');
    expect(ctx.event.sourceCalendar!.urlName).toBe('remote-cal');
    expect(ctx.event.sourceCalendar!.host).toBe('remote.example.com');
    expect(ctx.event.sourceCalendar!.url).toBe('https://remote.example.com/view/remote-cal');
  });

  it('should handle remote repost with no entry in actor URI map', async () => {
    const ctx = buildContext({
      eventId: 'evt-4',
      displayCalendarId: 'cal-B',
      eventCalendarId: null,
    });

    await resolveSourceCalendars([ctx], new Map());

    expect(ctx.event.repostStatus).toBe('manual');
    expect(ctx.event.sourceCalendar).toBeNull();
  });

  it('should handle mixed repost and non-repost events in a batch', async () => {
    const nonRepost = buildContext({
      eventId: 'evt-5',
      displayCalendarId: 'cal-A',
      eventCalendarId: 'cal-A',
    });
    const localRepost = buildContext({
      eventId: 'evt-6',
      displayCalendarId: 'cal-A',
      eventCalendarId: 'cal-C',
      sourceCalendarUrlName: 'source-cal',
    });
    const remoteRepost = buildContext({
      eventId: 'evt-7',
      displayCalendarId: 'cal-A',
      eventCalendarId: null,
    });

    await resolveSourceCalendars(
      [nonRepost, localRepost, remoteRepost],
      actorMap([['evt-7', 'https://other.example.org/calendars/other-cal', null]]),
    );

    expect(nonRepost.event.repostStatus).toBe('none');
    expect(nonRepost.event.sourceCalendar).toBeNull();

    expect(localRepost.event.repostStatus).toBe('manual');
    expect(localRepost.event.sourceCalendar!.urlName).toBe('source-cal');

    expect(remoteRepost.event.repostStatus).toBe('manual');
    expect(remoteRepost.event.sourceCalendar!.urlName).toBe('other-cal');
    expect(remoteRepost.event.sourceCalendar!.host).toBe('other.example.org');
  });
});

describe('parseAttributedToUri', () => {
  it('should parse standard attributed_to URI', () => {
    const result = parseAttributedToUri(REMOTE_ACTOR_URI, 'https://remote.example.com/remote-cal');

    expect(result).not.toBeNull();
    expect(result!.urlName).toBe('remote-cal');
    expect(result!.host).toBe('remote.example.com');
    expect(result!.url).toBe('https://remote.example.com/remote-cal');
  });

  /**
   * The peer declares its own page URL, so it need not follow our route shape
   * at all — that is the point of reading it rather than guessing.
   */
  it('should take the declared page URL verbatim, whatever its path shape', () => {
    const result = parseAttributedToUri(
      REMOTE_ACTOR_URI,
      'https://remote.example.com/en/groups/remote-cal?tab=events',
    );

    expect(result!.url).toBe('https://remote.example.com/en/groups/remote-cal?tab=events');
    // The label is still parsed out of the actor URI path.
    expect(result!.urlName).toBe('remote-cal');
    expect(result!.host).toBe('remote.example.com');
  });

  describe('fallback when no usable page URL is declared', () => {
    /**
     * The fallback is deliberately the retired `/view/` spelling, not the root
     * shape DEC-018 gave our own pages: `/view/{urlName}` resolves on a
     * pre-DEC-018 peer directly and on an upgraded peer via its own 301, while
     * `/{urlName}` resolves only on an upgraded peer.
     */
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['empty string', ''],
    ])('falls back to the /view/ spelling for %s', (_label, declared) => {
      const result = parseAttributedToUri(REMOTE_ACTOR_URI, declared);

      expect(result!.url).toBe('https://remote.example.com/view/remote-cal');
    });

    it('falls back when the argument is omitted entirely', () => {
      expect(parseAttributedToUri(REMOTE_ACTOR_URI)!.url)
        .toBe('https://remote.example.com/view/remote-cal');
    });
  });

  /**
   * `sourceCalendar.url` is rendered as an anchor href on anonymous public
   * pages, labelled with the peer's handle, so a page URL that is not on the
   * peer's own host must never reach the page. The rule of record is
   * `sanitizePeerPageUrl` in the ActivityPub domain, which applies it before
   * the value is cached; this restates it at the render boundary.
   *
   * The two must agree on every axis, not only host and scheme.
   * `src/server/activitypub/test/helper/url-sanitizer.test.ts` holds the
   * table-driven equivalence test that fails when either side drifts — add a
   * hostile value there, not only here.
   */
  describe('rejects a page URL the peer may not declare', () => {
    it.each([
      ['a different host', 'https://phish.example/remote-cal'],
      ['a subdomain of the actor host', 'https://evil.remote.example.com/x'],
      ['a lookalike suffix host', 'https://remote.example.com.evil.test/x'],
      ['a different port', 'https://remote.example.com:8443/x'],
      ['an http downgrade of the https actor', 'http://remote.example.com/remote-cal'],
      ['a javascript: URL', 'javascript:alert(document.domain)'],
      ['a data: URL', 'data:text/html;base64,PHNjcmlwdD4='],
      ['an unparseable value', 'not-a-url'],
      ['userinfo credentials on the actor host', 'https://admin:[email protected]/secret'],
      ['a bare userinfo username on the actor host', 'https://[email protected]/x'],
    ])('falls back rather than emitting %s', (_label, hostile) => {
      const result = parseAttributedToUri(REMOTE_ACTOR_URI, hostile);

      expect(result!.url).toBe('https://remote.example.com/view/remote-cal');
    });
  });

  /**
   * Normalization is the axis the render check silently dropped: it returned
   * the stored bytes rather than the parse, so whitespace, quotes and control
   * characters reached the href verbatim even though the population side had
   * percent-encoded them. Harmless while the only writer is the follow path and
   * the only reader is a Vue attribute binding; not harmless the first time the
   * value reaches a server-rendered context or a second ingest path writes the
   * column.
   */
  describe('normalizes the declared page URL rather than echoing it', () => {
    it.each([
      ['surrounding whitespace', '  https://remote.example.com/x  ', 'https://remote.example.com/x'],
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
      ['a newline inside the scheme', 'ht\ntps://remote.example.com/x', 'https://remote.example.com/x'],
    ])('normalizes %s', (_label, declared, expected) => {
      expect(parseAttributedToUri(REMOTE_ACTOR_URI, declared)!.url).toBe(expected);
    });

    it('falls back when the declared URL normalizes past the length cap', () => {
      const declared = 'https://remote.example.com/x' + '<'.repeat(700);

      expect(declared.length).toBeLessThan(2048);
      expect(parseAttributedToUri(REMOTE_ACTOR_URI, declared)!.url)
        .toBe('https://remote.example.com/view/remote-cal');
    });
  });

  it('should handle trailing slash', () => {
    const result = parseAttributedToUri('https://remote.example.com/calendars/remote-cal/');

    expect(result!.urlName).toBe('remote-cal');
  });

  it('should return null for malformed URI', () => {
    expect(parseAttributedToUri('not-a-valid-url')).toBeNull();
  });

  it('should return null for URI without /calendars/ path', () => {
    expect(parseAttributedToUri('https://remote.example.com/actors/some-actor')).toBeNull();
  });

  it('should return null when /calendars/ has no following segment', () => {
    expect(parseAttributedToUri('https://host.example.com/calendars/')).toBeNull();
  });

  it('should reject javascript: scheme URIs', () => {
    expect(parseAttributedToUri('javascript://evil.example.com/calendars/x')).toBeNull();
  });

  it('should reject data: scheme URIs', () => {
    expect(parseAttributedToUri('data://evil.example.com/calendars/x')).toBeNull();
  });

  it('should reject ftp: scheme URIs', () => {
    expect(parseAttributedToUri('ftp://evil.example.com/calendars/x')).toBeNull();
  });
});
