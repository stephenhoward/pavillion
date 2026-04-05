import { describe, it, expect } from 'vitest';
import config from 'config';
import { CalendarEvent } from '@/common/model/events';
import { resolveSourceCalendars, parseAttributedToUri, type RepostContext } from '../../helper/source_calendar';

const TEST_DOMAIN: string = config.get('domain');

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

    expect(ctx.event.isRepost).toBe(false);
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

    expect(ctx.event.isRepost).toBe(true);
    expect(ctx.event.sourceCalendar).not.toBeNull();
    expect(ctx.event.sourceCalendar!.urlName).toBe('original-cal');
    expect(ctx.event.sourceCalendar!.host).toBe(TEST_DOMAIN);
    expect(ctx.event.sourceCalendar!.url).toBe('/view/original-cal');
  });

  it('should mark as repost but leave sourceCalendar null when urlName is unavailable', async () => {
    const ctx = buildContext({
      eventId: 'evt-2b',
      displayCalendarId: 'cal-B',
      eventCalendarId: 'cal-A',
      // no sourceCalendarUrlName — calendar entity wasn't eager-loaded
    });

    await resolveSourceCalendars([ctx], new Map());

    expect(ctx.event.isRepost).toBe(true);
    expect(ctx.event.sourceCalendar).toBeNull();
  });

  it('should resolve remote reposts via pre-resolved actor URI map', async () => {
    const ctx = buildContext({
      eventId: 'evt-3',
      displayCalendarId: 'cal-B',
      eventCalendarId: null,
    });

    const remoteActorUriMap = new Map<string, string>([
      ['evt-3', 'https://remote.example.com/calendars/remote-cal'],
    ]);

    await resolveSourceCalendars([ctx], remoteActorUriMap);

    expect(ctx.event.isRepost).toBe(true);
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

    expect(ctx.event.isRepost).toBe(true);
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

    const remoteActorUriMap = new Map<string, string>([
      ['evt-7', 'https://other.example.org/calendars/other-cal'],
    ]);

    await resolveSourceCalendars([nonRepost, localRepost, remoteRepost], remoteActorUriMap);

    expect(nonRepost.event.isRepost).toBe(false);
    expect(nonRepost.event.sourceCalendar).toBeNull();

    expect(localRepost.event.isRepost).toBe(true);
    expect(localRepost.event.sourceCalendar!.urlName).toBe('source-cal');

    expect(remoteRepost.event.isRepost).toBe(true);
    expect(remoteRepost.event.sourceCalendar!.urlName).toBe('other-cal');
    expect(remoteRepost.event.sourceCalendar!.host).toBe('other.example.org');
  });
});

describe('parseAttributedToUri', () => {
  it('should parse standard attributed_to URI', () => {
    const result = parseAttributedToUri('https://remote.example.com/calendars/remote-cal');

    expect(result).not.toBeNull();
    expect(result!.urlName).toBe('remote-cal');
    expect(result!.host).toBe('remote.example.com');
    expect(result!.url).toBe('https://remote.example.com/view/remote-cal');
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
