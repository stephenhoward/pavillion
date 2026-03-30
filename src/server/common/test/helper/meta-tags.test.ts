import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import { DateTime } from 'luxon';

import { parseEventPageParams, buildEventMetaTags, PublicInterfaceHolder } from '@/server/common/helper/meta-tags';
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
    it('should extract params from /view/calendar/events/eventId', () => {
      const result = parseEventPageParams('/view/my-calendar/events/event-123');
      expect(result).toEqual({
        calendarUrlName: 'my-calendar',
        eventId: 'event-123',
      });
    });

    it('should extract params from /view/calendar/events/eventId/instanceId', () => {
      const result = parseEventPageParams('/view/my-calendar/events/event-123/instance-456');
      expect(result).toEqual({
        calendarUrlName: 'my-calendar',
        eventId: 'event-123',
        instanceId: 'instance-456',
      });
    });

    it('should extract params from /en/view/calendar/events/eventId (locale-prefixed)', () => {
      const result = parseEventPageParams('/en/view/my-calendar/events/event-123');
      expect(result).toEqual({
        calendarUrlName: 'my-calendar',
        eventId: 'event-123',
      });
    });

    it('should extract params from /es/view/calendar/events/eventId/instanceId (locale-prefixed instance)', () => {
      const result = parseEventPageParams('/es/view/my-calendar/events/event-123/instance-456');
      expect(result).toEqual({
        calendarUrlName: 'my-calendar',
        eventId: 'event-123',
        instanceId: 'instance-456',
      });
    });

    it('should return null for /view/calendar (calendar page)', () => {
      expect(parseEventPageParams('/view/my-calendar')).toBeNull();
    });

    it('should return null for /view/calendar/series/seriesName (series page)', () => {
      expect(parseEventPageParams('/view/my-calendar/series/weekly-meetup')).toBeNull();
    });

    it('should return null for / (root)', () => {
      expect(parseEventPageParams('/')).toBeNull();
    });

    it('should return null for /api/public/v1/events/id (API path)', () => {
      expect(parseEventPageParams('/api/public/v1/events/event-123')).toBeNull();
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
      expect(result!.url).toBe('https://example.com/view/my-calendar/events/event-uuid-1');
      expect(result!.type).toBe('article');
      expect(result!.siteName).toBe('My Calendar');
    });

    it('should return correct MetaTagData for an event instance (uses instance endpoint)', async () => {
      const iface = createMockInterface();
      const calendar = createMockCalendar();
      const event = createMockEvent({ mediaId: 'media-uuid-2' });
      const instance = new CalendarEventInstance(
        'instance-uuid-1',
        event,
        DateTime.fromISO('2026-04-01T10:00:00'),
        DateTime.fromISO('2026-04-01T12:00:00'),
      );

      (iface.current!.getCalendarByName as sinon.SinonStub).resolves(calendar);
      (iface.current!.getEventInstanceById as sinon.SinonStub).resolves(instance);

      const params = { calendarUrlName: 'my-calendar', eventId: 'event-uuid-1', instanceId: 'instance-uuid-1' };
      const result = await buildEventMetaTags(iface, params, 'en', baseUrl);

      expect(result).not.toBeNull();
      expect(result!.title).toBe('Test Event');
      expect(result!.url).toBe('https://example.com/view/my-calendar/events/event-uuid-1/instance-uuid-1');
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
  });
});
