import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import { DateTime } from 'luxon';

import { parseEventPageParams, buildEventMetaTags, PublicInterfaceHolder } from '@/server/common/helper/meta-tags';
import { CALENDAR_URL_NAME_RE } from '@/common/validation/calendarUrlName';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import { CalendarEvent, CalendarEventContent } from '@/common/model/events';
import CalendarEventInstance from '@/common/model/event_instance';
import { Media } from '@/common/model/media';

/**
 * Creates a mock Calendar with content and optional defaultEventImage.
 */
function createMockCalendar(opts: { name?: string; defaultImageId?: string } = {}): Calendar {
  const calendar = new Calendar('cal-uuid-1', 'my-calendar');
  const content = new CalendarContent('en', opts.name ?? 'My Calendar', 'A test calendar');
  calendar.addContent(content);

  if (opts.defaultImageId) {
    const media = new Media(opts.defaultImageId, 'cal-uuid-1', '', 'image.jpg', 'image/jpeg', 0);
    calendar.defaultEventImage = media;
  }

  return calendar;
}

/**
 * Creates a mock CalendarEvent with content and optional media.
 */
function createMockEvent(opts: {
  id?: string;
  name?: string;
  description?: string;
  mediaId?: string;
  locale?: string;
} = {}): CalendarEvent {
  const event = new CalendarEvent(opts.id ?? 'event-uuid-1', 'cal-uuid-1');
  const locale = opts.locale ?? 'en';
  const content = new CalendarEventContent(
    locale,
    opts.name ?? 'Test Event',
    opts.description ?? 'A great event',
  );
  event.addContent(content);

  if (opts.mediaId) {
    event.media = new Media(opts.mediaId, 'cal-uuid-1', '', 'image.jpg', 'image/jpeg', 0);
  }

  return event;
}

describe('MetaTags Helper', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
    vi.restoreAllMocks();
  });

  describe('parseEventPageParams', () => {
    // Event ids address a uuid column, so the parser requires the 8-4-4-4-12
    // shape. EVENT_ID is v4 (what this instance mints); PEER_EVENT_ID carries a
    // version-1 nibble, standing in for an id minted by a federated peer.
    const EVENT_ID = '3f1c0a2e-6b4d-4e8a-9c17-2d5f8b0a1e33';
    const PEER_EVENT_ID = '3f1c0a2e-6b4d-1e8a-8c17-2d5f8b0a1e33';

    it('should extract params from /calendar/events/eventId', () => {
      const result = parseEventPageParams(`/my-calendar/events/${EVENT_ID}`);
      expect(result).toEqual({
        calendarUrlName: 'my-calendar',
        eventId: EVENT_ID,
      });
    });

    it('parses a path with a timestamp slug as instanceStartTime', () => {
      const result = parseEventPageParams(`/my-calendar/events/${EVENT_ID}/20260508-1800`);
      expect(result).toEqual({
        calendarUrlName: 'my-calendar',
        eventId: EVENT_ID,
        instanceStartTime: '20260508-1800',
      });
    });

    it('should extract params from /en/calendar/events/eventId (locale-prefixed)', () => {
      const result = parseEventPageParams(`/en/my-calendar/events/${EVENT_ID}`);
      expect(result).toEqual({
        calendarUrlName: 'my-calendar',
        eventId: EVENT_ID,
      });
    });

    it('parses a locale-prefixed path with a timestamp slug', () => {
      const result = parseEventPageParams(`/fr/my-calendar/events/${EVENT_ID}/20260508-1800`);
      expect(result).toEqual({
        calendarUrlName: 'my-calendar',
        eventId: EVENT_ID,
        instanceStartTime: '20260508-1800',
      });
    });

    it('treats a two-letter non-locale first segment as a calendar name', () => {
      // 'nz' is not a supported language code, so it must be read as a calendar
      // name rather than stripped as a locale prefix -- which is why the locale
      // strip validates the code instead of matching a bare two-letter shape.
      const result = parseEventPageParams(`/nz/events/${EVENT_ID}`);
      expect(result).toEqual({
        calendarUrlName: 'nz',
        eventId: EVENT_ID,
      });
    });

    it('accepts a single trailing slash', () => {
      // The router matches `/cal/events/:id/` and the site SPA renders the event
      // page for it, so the parser must resolve meta tags for it too.
      expect(parseEventPageParams(`/my-calendar/events/${EVENT_ID}/`)).toEqual({
        calendarUrlName: 'my-calendar',
        eventId: EVENT_ID,
      });
      expect(parseEventPageParams(`/my-calendar/events/${EVENT_ID}/20260508-1800/`)).toEqual({
        calendarUrlName: 'my-calendar',
        eventId: EVENT_ID,
        instanceStartTime: '20260508-1800',
      });
    });

    it('accepts a uuid that is not version 4', () => {
      // looksLikeUuid, not isValidUuidV4: the check guards a uuid column, and an
      // event id minted by a federated peer need not carry v4 bits.
      expect(parseEventPageParams(`/my-calendar/events/${PEER_EVENT_ID}`)).toEqual({
        calendarUrlName: 'my-calendar',
        eventId: PEER_EVENT_ID,
      });
    });

    it('returns null when the event id is not uuid-shaped', () => {
      // Without this the id reaches Postgres as `where: { id: ... }` against a
      // uuid column, raising once per request on an unrate-limited route.
      expect(parseEventPageParams('/my-calendar/events/zzzz')).toBeNull();
      expect(parseEventPageParams('/my-calendar/events/event-123')).toBeNull();
      expect(parseEventPageParams(`/my-calendar/events/${EVENT_ID}x`)).toBeNull();
      expect(parseEventPageParams('/my-calendar/events/3f1c0a2e6b4d4e8a9c172d5f8b0a1e33')).toBeNull();
    });

    it('returns null for paths whose instance segment is not a valid slug', () => {
      expect(parseEventPageParams(`/my-calendar/events/${EVENT_ID}/not-a-slug`)).toBeNull();
      // Per DEC-006, UUID instance slugs are no longer valid.
      expect(parseEventPageParams(`/my-calendar/events/${EVENT_ID}/00000000-0000-0000-0000-000000000000`)).toBeNull();
    });

    it('rejects over-long calendarUrlName segments', () => {
      const huge = 'a'.repeat(200);
      expect(parseEventPageParams(`/${huge}/events/${EVENT_ID}`)).toBeNull();
    });

    it('rejects over-long eventId segments', () => {
      const huge = 'a'.repeat(100);
      expect(parseEventPageParams(`/my-calendar/events/${huge}`)).toBeNull();
    });

    it('should return null for /calendar (calendar page)', () => {
      expect(parseEventPageParams('/my-calendar')).toBeNull();
    });

    it('should return null for /calendar/series/seriesName (series page)', () => {
      expect(parseEventPageParams('/my-calendar/series/weekly-meetup')).toBeNull();
    });

    it('should return null for / (root)', () => {
      expect(parseEventPageParams('/')).toBeNull();
    });

    it('should return null for /api/public/v1/events/id (API path)', () => {
      expect(parseEventPageParams(`/api/public/v1/events/${EVENT_ID}`)).toBeNull();
    });

    it('returns null when the first segment is a reserved route segment', () => {
      // These are structurally identical to a root event page; only the
      // reservation check keeps them from resolving as one.
      expect(parseEventPageParams(`/api/events/${EVENT_ID}`)).toBeNull();
      expect(parseEventPageParams(`/admin/events/${EVENT_ID}`)).toBeNull();
      expect(parseEventPageParams(`/discover/events/${EVENT_ID}`)).toBeNull();
      expect(parseEventPageParams(`/view/events/${EVENT_ID}`)).toBeNull();
      expect(parseEventPageParams(`/auth/events/${EVENT_ID}/20260508-1800`)).toBeNull();
    });

    it('folds case when testing the first segment for reservation', () => {
      // Asserts the parser delegates case handling to isReservedRouteSegment
      // rather than relying on the regex's own /i flag.
      expect(parseEventPageParams(`/API/events/${EVENT_ID}`)).toBeNull();
      expect(parseEventPageParams(`/Admin/events/${EVENT_ID}`)).toBeNull();
    });

    it('rejects a reserved first segment behind a locale prefix', () => {
      // The locale is stripped before the reservation check, so the segment
      // tested is the calendar slot -- not the locale, which is itself reserved.
      expect(parseEventPageParams(`/fr/admin/events/${EVENT_ID}`)).toBeNull();
    });

    it('strips at most one locale prefix', () => {
      // Only one prefix is removed, so a doubled prefix leaves `es` in the
      // calendar slot and the path stops matching. This is what makes the
      // caller's obligation to pass a raw req.path (never a pre-stripped path)
      // load-bearing: a second strip elsewhere would resolve this as
      // my-calendar's event page.
      expect(parseEventPageParams(`/fr/es/my-calendar/events/${EVENT_ID}`)).toBeNull();
    });

    it('does not decode percent-encoding before the reservation check', () => {
      // Express matches routes on the raw pathname, so the check sees the
      // encoded spelling and does not fire. The parse succeeds with the literal
      // segment; what makes that safe lives one layer up, in the
      // getCalendarByName test below.
      expect(parseEventPageParams(`/%61dmin/events/${EVENT_ID}`)).toEqual({
        calendarUrlName: '%61dmin',
        eventId: EVENT_ID,
      });
    });

    it('returns null for the retired /view/ shape', () => {
      // DEC-018 retires /view/ as an address; the server 301s it, so meta-tag
      // resolution must never treat it as a live event page.
      expect(parseEventPageParams(`/view/my-calendar/events/${EVENT_ID}`)).toBeNull();
      expect(parseEventPageParams(`/view/my-calendar/events/${EVENT_ID}/20260508-1800`)).toBeNull();
      expect(parseEventPageParams(`/fr/view/my-calendar/events/${EVENT_ID}`)).toBeNull();
    });
  });

  describe('buildEventMetaTags', () => {
    const baseUrl = 'https://example.com';

    function createMockInterface() {
      return {
        current: {
          getCalendarByName: sandbox.stub(),
          getEventById: sandbox.stub(),
          getEventInstanceById: sandbox.stub(),
          findOrMaterializeInstanceWithDetails: sandbox.stub(),
        },
      } as unknown as PublicInterfaceHolder;
    }

    it('should return correct MetaTagData with title, description, image, url for an event', async () => {
      const iface = createMockInterface();
      const calendar = createMockCalendar();
      const event = createMockEvent({ mediaId: 'media-uuid-1' });

      (iface.current!.getCalendarByName as sinon.SinonStub).resolves(calendar);
      (iface.current!.getEventById as sinon.SinonStub).resolves(event);

      const params = { calendarUrlName: 'my-calendar', eventId: 'event-uuid-1' };
      const result = await buildEventMetaTags(iface, params, 'en', baseUrl);

      expect(result).not.toBeNull();
      expect(result!.title).toBe('Test Event');
      expect(result!.description).toBe('A great event');
      expect(result!.image).toBe('https://example.com/api/v1/media/media-uuid-1');
      expect(result!.url).toBe('https://example.com/my-calendar/events/event-uuid-1');
      expect(result!.type).toBe('article');
      expect(result!.siteName).toBe('My Calendar');
    });

    it('constructs the instance canonical URL from the timestamp slug', async () => {
      const iface = createMockInterface();
      const calendar = createMockCalendar();
      const event = createMockEvent({ mediaId: 'media-uuid-2' });
      const instance = new CalendarEventInstance(
        'instance-uuid-1',
        event,
        DateTime.fromISO('2026-05-08T18:00:00', { zone: 'utc' }),
        DateTime.fromISO('2026-05-08T20:00:00', { zone: 'utc' }),
      );

      (iface.current!.getCalendarByName as sinon.SinonStub).resolves(calendar);
      (iface.current!.findOrMaterializeInstanceWithDetails as sinon.SinonStub).resolves(instance);

      const params = {
        calendarUrlName: 'my-calendar',
        eventId: 'event-uuid-1',
        instanceStartTime: '20260508-1800',
      };
      const result = await buildEventMetaTags(iface, params, 'en', baseUrl);

      expect(result).not.toBeNull();
      expect(result!.title).toBe('Test Event');
      expect(result!.url).toBe('https://example.com/my-calendar/events/event-uuid-1/20260508-1800');

      // Verify the interface lookup was performed via findOrMaterializeInstanceWithDetails
      // with a DateTime derived from the slug.
      const call = (iface.current!.findOrMaterializeInstanceWithDetails as sinon.SinonStub).getCall(0);
      expect(call.args[0]).toBe('event-uuid-1');
      const passedDt = call.args[1] as DateTime;
      expect(passedDt.toUTC().toISO()).toBe('2026-05-08T18:00:00.000Z');
    });

    it('constructs the non-instance canonical URL when no slug is present', async () => {
      const iface = createMockInterface();
      const calendar = createMockCalendar();
      const event = createMockEvent();

      (iface.current!.getCalendarByName as sinon.SinonStub).resolves(calendar);
      (iface.current!.getEventById as sinon.SinonStub).resolves(event);

      const params = { calendarUrlName: 'my-calendar', eventId: 'event-uuid-1' };
      const result = await buildEventMetaTags(iface, params, 'en', baseUrl);

      expect(result).not.toBeNull();
      expect(result!.url).toBe('https://example.com/my-calendar/events/event-uuid-1');
    });

    it('returns null when instanceStartTime slug fails to parse', async () => {
      const iface = createMockInterface();
      const calendar = createMockCalendar();

      (iface.current!.getCalendarByName as sinon.SinonStub).resolves(calendar);

      // Slug that structurally matches the regex but is semantically invalid
      // (e.g. month 99). parseInstanceSlug returns null in this case.
      const params = {
        calendarUrlName: 'my-calendar',
        eventId: 'event-uuid-1',
        instanceStartTime: '20269913-9999',
      };
      const result = await buildEventMetaTags(iface, params, 'en', baseUrl);

      expect(result).toBeNull();
    });

    it('returns null when the materialized instance is not found', async () => {
      const iface = createMockInterface();
      const calendar = createMockCalendar();

      (iface.current!.getCalendarByName as sinon.SinonStub).resolves(calendar);
      (iface.current!.findOrMaterializeInstanceWithDetails as sinon.SinonStub).resolves(null);

      const params = {
        calendarUrlName: 'my-calendar',
        eventId: 'event-uuid-1',
        instanceStartTime: '20260508-1800',
      };
      const result = await buildEventMetaTags(iface, params, 'en', baseUrl);

      expect(result).toBeNull();
    });

    it('should decode HTML entities before stripping tags', async () => {
      const iface = createMockInterface();
      const calendar = createMockCalendar();
      const event = createMockEvent({
        description: '&lt;b&gt;Bold text&lt;/b&gt; &amp; more',
      });

      (iface.current!.getCalendarByName as sinon.SinonStub).resolves(calendar);
      (iface.current!.getEventById as sinon.SinonStub).resolves(event);

      const params = { calendarUrlName: 'my-calendar', eventId: 'event-uuid-1' };
      const result = await buildEventMetaTags(iface, params, 'en', baseUrl);

      expect(result).not.toBeNull();
      expect(result!.description).toBe('Bold text & more');
    });

    it('should strip HTML tags from description', async () => {
      const iface = createMockInterface();
      const calendar = createMockCalendar();
      const event = createMockEvent({
        description: '<p>Hello <strong>world</strong></p><br/><em>italic</em>',
      });

      (iface.current!.getCalendarByName as sinon.SinonStub).resolves(calendar);
      (iface.current!.getEventById as sinon.SinonStub).resolves(event);

      const params = { calendarUrlName: 'my-calendar', eventId: 'event-uuid-1' };
      const result = await buildEventMetaTags(iface, params, 'en', baseUrl);

      expect(result).not.toBeNull();
      expect(result!.description).toBe('Hello worlditalic');
    });

    it('should truncate long descriptions at 200 chars with ellipsis', async () => {
      const iface = createMockInterface();
      const calendar = createMockCalendar();
      const longDescription = 'A'.repeat(250);
      const event = createMockEvent({ description: longDescription });

      (iface.current!.getCalendarByName as sinon.SinonStub).resolves(calendar);
      (iface.current!.getEventById as sinon.SinonStub).resolves(event);

      const params = { calendarUrlName: 'my-calendar', eventId: 'event-uuid-1' };
      const result = await buildEventMetaTags(iface, params, 'en', baseUrl);

      expect(result).not.toBeNull();
      expect(result!.description).toBe('A'.repeat(200) + '...');
      expect(result!.description.length).toBe(203);
    });

    it('should use calendar defaultEventImage as fallback when event has no media', async () => {
      const iface = createMockInterface();
      const calendar = createMockCalendar({ defaultImageId: 'default-img-uuid' });
      const event = createMockEvent(); // no media

      (iface.current!.getCalendarByName as sinon.SinonStub).resolves(calendar);
      (iface.current!.getEventById as sinon.SinonStub).resolves(event);

      const params = { calendarUrlName: 'my-calendar', eventId: 'event-uuid-1' };
      const result = await buildEventMetaTags(iface, params, 'en', baseUrl);

      expect(result).not.toBeNull();
      expect(result!.image).toBe('https://example.com/api/v1/media/default-img-uuid');
    });

    it('should fall back to first available language when requested locale has no content', async () => {
      const iface = createMockInterface();
      const calendar = createMockCalendar();
      // Event only has Spanish content
      const event = createMockEvent({ locale: 'es', name: 'Evento de Prueba', description: 'Un gran evento' });

      (iface.current!.getCalendarByName as sinon.SinonStub).resolves(calendar);
      (iface.current!.getEventById as sinon.SinonStub).resolves(event);

      const params = { calendarUrlName: 'my-calendar', eventId: 'event-uuid-1' };
      // Request English, but event only has Spanish
      const result = await buildEventMetaTags(iface, params, 'en', baseUrl);

      expect(result).not.toBeNull();
      expect(result!.title).toBe('Evento de Prueba');
      expect(result!.description).toBe('Un gran evento');
    });

    // The render-boundary twin of content-languages.test.ts's "does not count a
    // language carrying only alt text". resolveContentLocale picks a row and
    // the caller reads the title and description off it, so a row carrying
    // only alt text must not be selected -- a peer that federates
    // `pavillion:content.fr = { imageAlt: ... }` would otherwise blank the
    // page title and description for French crawlers and link previews.
    it('does not resolve to a language whose row carries only alt text', async () => {
      const iface = createMockInterface();
      const calendar = createMockCalendar();
      const event = createMockEvent();
      event.addContent(new CalendarEventContent('fr', '', '', '', 'Une salle comble'));

      (iface.current!.getCalendarByName as sinon.SinonStub).resolves(calendar);
      (iface.current!.getEventById as sinon.SinonStub).resolves(event);

      const params = { calendarUrlName: 'my-calendar', eventId: 'event-uuid-1' };
      const result = await buildEventMetaTags(iface, params, 'fr', baseUrl);

      expect(result).not.toBeNull();
      expect(result!.title).toBe('Test Event');
      expect(result!.description).toBe('A great event');
    });

    // The twin of the test above on the OTHER resolution path. The requested
    // locale check is not the only way a row gets selected: when no row exists
    // for the requested (or default) locale, the final fallback picks from
    // `getLanguages()`, which lists every stored row including alt-only ones.
    // An unchecked `available[0]` there blanks og:title and og:description for
    // crawlers and link unfurlers exactly as a requested-locale hit would.
    it('does not fall back to a language whose row carries only alt text', async () => {
      const iface = createMockInterface();
      const calendar = createMockCalendar();
      const event = new CalendarEvent('event-uuid-1', 'cal-uuid-1');
      // Alt-only row added first, so it is `getLanguages()[0]`.
      event.addContent(new CalendarEventContent('fr', '', '', '', 'Une salle comble'));
      event.addContent(new CalendarEventContent('es', 'Evento de Prueba', 'Un gran evento'));

      (iface.current!.getCalendarByName as sinon.SinonStub).resolves(calendar);
      (iface.current!.getEventById as sinon.SinonStub).resolves(event);

      const params = { calendarUrlName: 'my-calendar', eventId: 'event-uuid-1' };
      // English is requested and no English row exists, so resolution reaches
      // the final fallback rather than the requested-locale branch.
      const result = await buildEventMetaTags(iface, params, 'en', baseUrl);

      expect(result).not.toBeNull();
      expect(result!.title).toBe('Evento de Prueba');
      expect(result!.description).toBe('Un gran evento');
    });

    it('does not resolve a calendar site name from an alt-only row', async () => {
      const iface = createMockInterface();
      const calendar = createMockCalendar();
      calendar.addContent(new CalendarContent('fr', '', '', 'Une banniere de lanternes'));
      const event = createMockEvent();

      (iface.current!.getCalendarByName as sinon.SinonStub).resolves(calendar);
      (iface.current!.getEventById as sinon.SinonStub).resolves(event);

      const params = { calendarUrlName: 'my-calendar', eventId: 'event-uuid-1' };
      const result = await buildEventMetaTags(iface, params, 'fr', baseUrl);

      expect(result).not.toBeNull();
      expect(result!.siteName).toBe('My Calendar');
    });

    it('should fall back to default locale for invalid locale strings', async () => {
      const iface = createMockInterface();
      const calendar = createMockCalendar();
      const event = createMockEvent(); // has 'en' content

      (iface.current!.getCalendarByName as sinon.SinonStub).resolves(calendar);
      (iface.current!.getEventById as sinon.SinonStub).resolves(event);

      const params = { calendarUrlName: 'my-calendar', eventId: 'event-uuid-1' };
      // Use invalid locale string; should fall back to 'en' (DEFAULT_LANGUAGE_CODE)
      const result = await buildEventMetaTags(iface, params, 'zzzzzzzz', baseUrl);

      expect(result).not.toBeNull();
      expect(result!.title).toBe('Test Event');
    });

    it('should return null when event fetch throws', async () => {
      const iface = createMockInterface();
      const calendar = createMockCalendar();

      (iface.current!.getCalendarByName as sinon.SinonStub).resolves(calendar);
      (iface.current!.getEventById as sinon.SinonStub).rejects(new Error('Database error'));

      const params = { calendarUrlName: 'my-calendar', eventId: 'event-uuid-1' };
      const result = await buildEventMetaTags(iface, params, 'en', baseUrl);

      expect(result).toBeNull();
    });

    it('should return null on timeout (mock slow promise)', async () => {
      const iface = createMockInterface();

      // Simulate a very slow response that exceeds the 2s timeout
      (iface.current!.getCalendarByName as sinon.SinonStub).returns(
        new Promise((resolve) => {
          setTimeout(() => resolve(createMockCalendar()), 5000);
        }),
      );

      const params = { calendarUrlName: 'my-calendar', eventId: 'event-uuid-1' };
      const result = await buildEventMetaTags(iface, params, 'en', baseUrl);

      expect(result).toBeNull();
    }, 10000);

    it('should return null when calendar not found', async () => {
      const iface = createMockInterface();

      (iface.current!.getCalendarByName as sinon.SinonStub).resolves(null);

      const params = { calendarUrlName: 'nonexistent', eventId: 'event-uuid-1' };
      const result = await buildEventMetaTags(iface, params, 'en', baseUrl);

      expect(result).toBeNull();
    });

    it('yields no meta tags for a percent-encoded calendar name', async () => {
      // The other half of the pin on parseEventPageParams' undecoded segment:
      // the parser hands '%61dmin' through verbatim, and this is where it stops.
      // The stub reproduces the real resolver's gate -- getCalendarByName tests
      // CALENDAR_URL_NAME_RE and returns null before querying -- so loosening
      // that shared regex fails here rather than silently reaching a row.
      const iface = createMockInterface();

      (iface.current!.getCalendarByName as sinon.SinonStub).callsFake(
        async (name: string) => (CALENDAR_URL_NAME_RE.test(name) ? createMockCalendar() : null),
      );
      (iface.current!.getEventById as sinon.SinonStub).resolves(createMockEvent());

      const params = { calendarUrlName: '%61dmin', eventId: 'event-uuid-1' };
      const result = await buildEventMetaTags(iface, params, 'en', baseUrl);

      expect(result).toBeNull();
      expect(CALENDAR_URL_NAME_RE.test('%61dmin')).toBe(false);
      expect((iface.current!.getEventById as sinon.SinonStub).called).toBe(false);
    });
  });
});
