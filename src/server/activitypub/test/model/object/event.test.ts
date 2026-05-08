import { describe, it, expect, beforeEach, vi } from 'vitest';
import config from 'config';
import { DateTime } from 'luxon';

// Hoisted logger mock so we can assert on warn calls. The real logger is
// silent in test mode anyway, so this swap does not affect other tests.
const { mockWarn } = vi.hoisted(() => ({
  mockWarn: vi.fn(),
}));

vi.mock('@/server/common/helper/logger', () => ({
  default: { child: () => ({ warn: mockWarn, error: vi.fn(), info: vi.fn(), debug: vi.fn() }) },
  createLogger: () => ({ warn: mockWarn, error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

import { Calendar } from '@/common/model/calendar';
import { CalendarEvent, CalendarEventContent, CalendarEventSchedule, UrlPrompt } from '@/common/model/events';
import { EventCategory } from '@/common/model/event_category';
import { EventSeries } from '@/common/model/event_series';
import { EventSeriesContent } from '@/common/model/event_series_content';
import { EventLocation, EventLocationContent, EventLocationSpace, EventLocationSpaceContent } from '@/common/model/location';
import { Media } from '@/common/model/media';
import { EventObject } from '@/server/activitypub/model/object/event';

const domain = config.get<string>('domain');

describe('EventObject', () => {

  describe('categories serialization', () => {

    it('should emit an empty categories array when event has no categories', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');

      const obj = new EventObject(calendar, event);

      expect(obj.categories).toEqual([]);
    });

    it('should populate categories with well-formed URIs when event has categories', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');

      const cat1 = new EventCategory('cat-uuid-1', 'calendar-uuid');
      const cat2 = new EventCategory('cat-uuid-2', 'calendar-uuid');
      event.categories = [cat1, cat2];

      const obj = new EventObject(calendar, event);

      expect(obj.categories).toEqual([
        `https://${domain}/api/public/v1/calendar/mycal/categories/cat-uuid-1`,
        `https://${domain}/api/public/v1/calendar/mycal/categories/cat-uuid-2`,
      ]);
    });

    it('should use the calendar urlName and category id in the URI', () => {
      const calendar = new Calendar('cal-id', 'testcalendar');
      const event = new CalendarEvent('event-id', 'cal-id');

      const cat = new EventCategory('specific-cat-id', 'cal-id');
      event.categories = [cat];

      const obj = new EventObject(calendar, event);

      expect(obj.categories).toHaveLength(1);
      expect(obj.categories[0]).toContain('/calendar/testcalendar/');
      expect(obj.categories[0]).toContain('/specific-cat-id');
    });

    it('should use the configured domain in category URIs', () => {
      const calendar = new Calendar('cal-id', 'mycal');
      const event = new CalendarEvent('event-id', 'cal-id');

      const cat = new EventCategory('cat-id', 'cal-id');
      event.categories = [cat];

      const obj = new EventObject(calendar, event);

      expect(obj.categories[0]).toMatch(new RegExp(`^https://${domain.replace(/\./g, '\\.')}/`));
    });

  });

  describe('series serialization', () => {

    it('should have series as null when event has no series', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');

      const obj = new EventObject(calendar, event);

      expect(obj.series).toBeNull();
    });

    it('should set series to the AP series Object ID URL when event has a series', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');
      const series = new EventSeries('series-uuid-1234', 'calendar-uuid', 'myseries');
      const content = new EventSeriesContent('en', 'My Series', 'A description');
      series.addContent(content);
      event.series = series;

      const obj = new EventObject(calendar, event);

      expect(obj.series).toBe(`https://${domain}/calendars/mycal/series/series-uuid-1234`);
    });

    it('should use the calendar urlName and series UUID in the series URL', () => {
      const calendar = new Calendar('cal-id', 'testcalendar');
      const event = new CalendarEvent('event-id', 'cal-id');
      const series = new EventSeries('specific-series-uuid', 'cal-id', 'myseries');
      series.addContent(new EventSeriesContent('en', 'Series', ''));
      event.series = series;

      const obj = new EventObject(calendar, event);

      expect(obj.series).toContain('/calendars/testcalendar/series/');
      expect(obj.series).toContain('specific-series-uuid');
    });

    it('should use the configured domain in the series URL', () => {
      const calendar = new Calendar('cal-id', 'mycal');
      const event = new CalendarEvent('event-id', 'cal-id');
      const series = new EventSeries('series-id', 'cal-id', 'myseries');
      series.addContent(new EventSeriesContent('en', 'Series', ''));
      event.series = series;

      const obj = new EventObject(calendar, event);

      expect(obj.series).toMatch(new RegExp(`^https://${domain.replace(/\./g, '\\.')}/`));
    });

  });

  describe('toActivityPubObject()', () => {

    it('should serialize a basic event with standard AS properties', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');
      event.addContent(new CalendarEventContent('en', 'Test Event', 'A test description'));
      const startDt = DateTime.fromISO('2026-04-15T09:00:00.000Z');
      const endDt = DateTime.fromISO('2026-04-15T12:00:00.000Z');
      const schedule = new CalendarEventSchedule('s1', startDt, endDt);
      schedule.eventEndTime = endDt;
      event.schedules = [schedule];
      event.location = new EventLocation('loc-id', 'City Park');

      const obj = new EventObject(calendar, event);
      const result = obj.toActivityPubObject();

      expect(result.type).toBe('Event');
      expect(result.id).toMatch(new RegExp(`^https://${domain.replace(/\./g, '\\.')}/calendars/mycal/events/event-uuid$`));
      expect(result.attributedTo).toBe(`https://${domain}/calendars/mycal`);
      expect(result.name).toBe('Test Event');
      expect(result.summary).toBe('A test description');
      expect(result.startTime).toBe(startDt.toISO());
      expect(result.endTime).toBe(endDt.toISO());
      expect(result.to).toContain('https://www.w3.org/ns/activitystreams#Public');
      expect(result.cc).toContain(`https://${domain}/calendars/mycal/followers`);
      expect(result.location).toBeDefined();
      expect(result.location.type).toBe('Place');
      expect(result.location.name).toBe('City Park');
      expect(result['pavillion:content']).toBeDefined();
      expect(result['pavillion:categories']).toBeDefined();
      expect(result['pavillion:series']).toBeDefined();
      expect(result['pavillion:schedules']).toBeDefined();
    });

    it('should include nameMap and summaryMap for multilingual events', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');
      event.addContent(new CalendarEventContent('en', 'English Name', 'English Desc'));
      event.addContent(new CalendarEventContent('es', 'Spanish Name', 'Spanish Desc'));

      const obj = new EventObject(calendar, event);
      const result = obj.toActivityPubObject();

      expect(result.name).toBe('English Name');
      expect(result.nameMap).toEqual({ en: 'English Name', es: 'Spanish Name' });
      expect(result.summaryMap).toEqual({ en: 'English Desc', es: 'Spanish Desc' });

      // Single-language events should NOT have nameMap/summaryMap
      const singleEvent = new CalendarEvent('event-2', 'calendar-uuid');
      singleEvent.addContent(new CalendarEventContent('en', 'Only English', 'Only Desc'));
      const singleObj = new EventObject(calendar, singleEvent);
      const singleResult = singleObj.toActivityPubObject();

      expect(singleResult).not.toHaveProperty('nameMap');
      expect(singleResult).not.toHaveProperty('summaryMap');
    });

    it('should synthesize endTime as startTime + 1 hour when no schedules exist', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');
      event.date = '2026-04-15';
      event.addContent(new CalendarEventContent('en', 'No Schedule Event', ''));

      const obj = new EventObject(calendar, event);
      const result = obj.toActivityPubObject();

      expect(result.startTime).toBe('2026-04-15T00:00:00.000Z');
      expect(result).toHaveProperty('endTime');
      const startMs = DateTime.fromISO(result.startTime).toMillis();
      const endMs = DateTime.fromISO(result.endTime).toMillis();
      expect(endMs - startMs).toBe(3600000); // 1 hour in milliseconds
    });

    it('should synthesize endTime as startTime + 1 hour when schedule has no endDate', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');
      const startDt = DateTime.fromISO('2026-04-15T09:00:00.000Z');
      event.schedules = [new CalendarEventSchedule('s1', startDt)];
      event.addContent(new CalendarEventContent('en', 'No End Date Event', ''));

      const obj = new EventObject(calendar, event);
      const result = obj.toActivityPubObject();

      expect(result).toHaveProperty('endTime');
      const startMs = DateTime.fromISO(result.startTime).toMillis();
      const endMs = DateTime.fromISO(result.endTime).toMillis();
      expect(endMs - startMs).toBe(3600000);
    });

    it('should use eventEndTime for AP endTime when eventEndTime is set', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');
      const startDt = DateTime.fromISO('2026-04-15T09:00:00.000Z');
      const endDt = DateTime.fromISO('2026-04-15T12:00:00.000Z');
      const eventEndTimeDt = DateTime.fromISO('2026-04-15T11:00:00.000Z');
      const schedule = new CalendarEventSchedule('s1', startDt, endDt);
      schedule.eventEndTime = eventEndTimeDt;
      event.schedules = [schedule];
      event.addContent(new CalendarEventContent('en', 'Event With End Time', ''));

      const obj = new EventObject(calendar, event);
      const result = obj.toActivityPubObject();

      expect(result.endTime).toBe(eventEndTimeDt.toISO());
    });

    it('should use eventEndTime for AP endTime when eventEndTime is set and endDate is null (recurring events)', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');
      const startDt = DateTime.fromISO('2026-04-15T09:00:00.000Z');
      const eventEndTimeDt = DateTime.fromISO('2026-04-15T11:00:00.000Z');
      const schedule = new CalendarEventSchedule('s1', startDt);
      schedule.eventEndTime = eventEndTimeDt;
      // endDate is null (typical for recurring events where endDate tracks recurrence end)
      schedule.endDate = null;
      event.schedules = [schedule];
      event.addContent(new CalendarEventContent('en', 'Recurring Event With End Time', ''));

      const obj = new EventObject(calendar, event);
      const result = obj.toActivityPubObject();

      expect(result.endTime).toBe(eventEndTimeDt.toISO());
    });


    it('should synthesize endTime when only endDate is set (endDate is not used for AP endTime)', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');
      const startDt = DateTime.fromISO('2026-04-15T09:00:00.000Z');
      const endDt = DateTime.fromISO('2026-04-15T12:00:00.000Z');
      const schedule = new CalendarEventSchedule('s1', startDt, endDt);
      event.schedules = [schedule];
      event.addContent(new CalendarEventContent('en', 'Event With End Date Only', ''));

      const obj = new EventObject(calendar, event);
      const result = obj.toActivityPubObject();

      // endDate is for recurrence only — AP endTime should be synthesized as startTime + 1 hour
      // Use fromISO with setZone to match the production code's zone-preserving behavior
      const expectedSynthesized = DateTime.fromISO(startDt.toISO()!, { setZone: true }).plus({ hours: 1 }).toISO();
      expect(result.endTime).toBe(expectedSynthesized);
    });

    it('should always include endTime in output', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');
      event.addContent(new CalendarEventContent('en', 'Minimal Event', ''));

      const obj = new EventObject(calendar, event);
      const result = obj.toActivityPubObject();

      expect(result).toHaveProperty('endTime');
    });

    it('should omit location when event has no location', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');
      event.addContent(new CalendarEventContent('en', 'No Location', ''));

      const obj = new EventObject(calendar, event);
      const result = obj.toActivityPubObject();

      expect(result).not.toHaveProperty('location');
    });

    it('should use "Untitled Event" when content is empty', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');

      const obj = new EventObject(calendar, event);
      const result = obj.toActivityPubObject();

      expect(result.name).toBe('Untitled Event');
    });

    it('should include pavillion:* extensions and exclude internal properties', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');
      event.addContent(new CalendarEventContent('en', 'Test', 'Desc'));
      const startDt = DateTime.fromISO('2026-04-15T09:00:00.000Z');
      event.schedules = [new CalendarEventSchedule('s1', startDt)];

      const cat = new EventCategory('cat-1', 'calendar-uuid');
      event.categories = [cat];

      const series = new EventSeries('series-1', 'calendar-uuid', 'myseries');
      series.addContent(new EventSeriesContent('en', 'Series', ''));
      event.series = series;

      const obj = new EventObject(calendar, event);
      const result = obj.toActivityPubObject();

      expect(result['pavillion:content']).toEqual(event.toObject().content);
      expect(result['pavillion:categories']).toBeInstanceOf(Array);
      expect(result['pavillion:categories'].length).toBe(1);
      expect(result['pavillion:series']).toMatch(/^https:\/\//);
      expect(result['pavillion:schedules']).toBeInstanceOf(Array);
      expect(result['pavillion:schedules'].length).toBe(1);

      // Internal properties should NOT leak into AP output
      expect(result).not.toHaveProperty('date');
      expect(result).not.toHaveProperty('parentEvent');
      expect(result).not.toHaveProperty('childEvents');
    });

    it('should emit content as HTML-wrapped primary description', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');
      event.addContent(new CalendarEventContent('en', 'Test Event', 'A test description'));

      const obj = new EventObject(calendar, event);
      const result = obj.toActivityPubObject();

      expect(result.content).toBe('<p>A test description</p>');
    });

    it('should emit contentMap with HTML-wrapped descriptions for multilingual events', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');
      event.addContent(new CalendarEventContent('en', 'English Name', 'English Desc'));
      event.addContent(new CalendarEventContent('es', 'Spanish Name', 'Spanish Desc'));

      const obj = new EventObject(calendar, event);
      const result = obj.toActivityPubObject();

      expect(result.contentMap).toEqual({
        en: '<p>English Desc</p>',
        es: '<p>Spanish Desc</p>',
      });
    });

    it('should not emit content or contentMap when description is empty', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');
      event.addContent(new CalendarEventContent('en', 'Title Only', ''));

      const obj = new EventObject(calendar, event);
      const result = obj.toActivityPubObject();

      expect(result).not.toHaveProperty('content');
      expect(result).not.toHaveProperty('contentMap');
    });

    it('should not emit contentMap for single-language events', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');
      event.addContent(new CalendarEventContent('en', 'Test', 'A description'));

      const obj = new EventObject(calendar, event);
      const result = obj.toActivityPubObject();

      expect(result.content).toBe('<p>A description</p>');
      expect(result).not.toHaveProperty('contentMap');
    });

    it('should not affect existing EventObject instance properties (regression guard)', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');
      event.addContent(new CalendarEventContent('en', 'Test', 'Desc'));
      event.date = '2026-04-15';

      const cat = new EventCategory('cat-1', 'calendar-uuid');
      event.categories = [cat];

      const obj = new EventObject(calendar, event);

      // Instance properties should still use old shape (unprefixed)
      expect(obj.content).toHaveProperty('en');
      expect(obj.date).toBeDefined();
      expect(obj.categories).toBeInstanceOf(Array);
      expect(typeof obj.categories[0]).toBe('string');

      // Calling toActivityPubObject should not alter instance
      obj.toActivityPubObject();
      expect(obj.content).toHaveProperty('en');
      expect(obj.date).toBeDefined();
    });

    it('should include image when event has its own media', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');
      event.addContent(new CalendarEventContent('en', 'Event With Image', ''));
      event.media = new Media('media-uuid', 'calendar-uuid', 'abc123', 'photo.jpg', 'image/jpeg', 1024, 'approved');

      const obj = new EventObject(calendar, event);
      const result = obj.toActivityPubObject();

      expect(result.image).toEqual({
        type: 'Image',
        url: `https://${domain}/api/v1/media/media-uuid`,
        mediaType: 'image/jpeg',
      });
    });

    it('should fall back to calendar defaultEventImage when event has no media', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      calendar.defaultEventImage = new Media('default-img-uuid', 'calendar-uuid', 'def456', 'default.png', 'image/png', 2048, 'approved');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');
      event.addContent(new CalendarEventContent('en', 'Event Without Image', ''));

      const obj = new EventObject(calendar, event);
      const result = obj.toActivityPubObject();

      expect(result.image).toEqual({
        type: 'Image',
        url: `https://${domain}/api/v1/media/default-img-uuid`,
        mediaType: 'image/png',
      });
    });

    it('should omit image when neither event media nor calendar default exists', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');
      event.addContent(new CalendarEventContent('en', 'No Image Event', ''));

      const obj = new EventObject(calendar, event);
      const result = obj.toActivityPubObject();

      expect(result).not.toHaveProperty('image');
    });

    it('should prefer event media over calendar default image', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      calendar.defaultEventImage = new Media('default-img-uuid', 'calendar-uuid', 'def456', 'default.png', 'image/png', 2048, 'approved');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');
      event.addContent(new CalendarEventContent('en', 'Event With Own Image', ''));
      event.media = new Media('event-img-uuid', 'calendar-uuid', 'ghi789', 'event.jpg', 'image/jpeg', 3072, 'approved');

      const obj = new EventObject(calendar, event);
      const result = obj.toActivityPubObject();

      expect(result.image).toEqual({
        type: 'Image',
        url: `https://${domain}/api/v1/media/event-img-uuid`,
        mediaType: 'image/jpeg',
      });
    });

    describe('externalUrl + urlPrompt serialization', () => {

      it('should emit attachment Link and pavillion:urlPrompt when both fields are set', () => {
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'Event', ''));
        event.externalUrl = 'https://example.com/tickets';
        event.urlPrompt = 'tickets';

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        expect(result.attachment).toEqual([
          {
            type: 'Link',
            href: 'https://example.com/tickets',
            name: 'Tickets',
            rel: 'external',
          },
        ]);
        expect(result['pavillion:urlPrompt']).toBe('tickets');
      });

      it('should emit correct translated label for rsvp prompt', () => {
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'Event', ''));
        event.externalUrl = 'https://example.com/rsvp';
        event.urlPrompt = 'rsvp';

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        expect(result.attachment[0].name).toBe('RSVP');
        expect(result.attachment[0].rel).toBe('external');
        expect(result['pavillion:urlPrompt']).toBe('rsvp');
      });

      it('should emit correct translated label for more_info prompt', () => {
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'Event', ''));
        event.externalUrl = 'https://example.com/info';
        event.urlPrompt = 'more_info';

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        expect(result.attachment[0].name).toBe('More Information');
        expect(result['pavillion:urlPrompt']).toBe('more_info');
      });

      it('should emit correct translated label for register prompt', () => {
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'Event', ''));
        event.externalUrl = 'https://example.com/register';
        event.urlPrompt = 'register';

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        expect(result.attachment[0].name).toBe('Register');
        expect(result['pavillion:urlPrompt']).toBe('register');
      });

      it('should not emit attachment or pavillion:urlPrompt when both fields are null', () => {
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'Event', ''));

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        expect(result).not.toHaveProperty('attachment');
        expect(result).not.toHaveProperty('pavillion:urlPrompt');
      });

      it('should not emit attachment or pavillion:urlPrompt when only externalUrl is set', () => {
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'Event', ''));
        event.externalUrl = 'https://example.com/tickets';
        event.urlPrompt = null;

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        expect(result).not.toHaveProperty('attachment');
        expect(result).not.toHaveProperty('pavillion:urlPrompt');
      });

      it('should not emit attachment or pavillion:urlPrompt when only urlPrompt is set', () => {
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'Event', ''));
        event.externalUrl = null;
        event.urlPrompt = 'tickets';

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        expect(result).not.toHaveProperty('attachment');
        expect(result).not.toHaveProperty('pavillion:urlPrompt');
      });

      it('should not use or overload the AS top-level url field', () => {
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'Event', ''));
        event.externalUrl = 'https://example.com/tickets';
        event.urlPrompt = 'tickets';

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        // AS top-level `url` is reserved for Mobilizon's canonical event page.
        expect(result).not.toHaveProperty('url');
      });

    });

    describe('pavillion:place serialization', () => {

      it('should emit pavillion:place when event.location is set', () => {
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'Event', ''));
        const location = new EventLocation(
          'place-uuid-123',
          'Convention Center',
          '100 Main St',
          'Springfield',
          'OR',
          '97477',
          'US',
        );
        location.addContent(new EventLocationContent('en', 'Accessible parking'));
        location.addContent(new EventLocationContent('fr', 'Stationnement accessible'));
        event.location = location;

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        expect(result['pavillion:place']).toEqual({
          id: `https://${domain}/calendars/mycal/places/place-uuid-123`,
          address: '100 Main St',
          city: 'Springfield',
          state: 'OR',
          postalCode: '97477',
          country: 'US',
          content: {
            en: { name: 'Convention Center', accessibilityInfo: 'Accessible parking' },
            fr: { name: 'Convention Center', accessibilityInfo: 'Stationnement accessible' },
          },
        });
      });

      it('should omit pavillion:place when event has no location', () => {
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'Event', ''));

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        expect(result).not.toHaveProperty('pavillion:place');
      });

      it('should mint id URL from configured domain, calendar urlName, and location.id', () => {
        const calendar = new Calendar('calendar-uuid', 'testcalendar');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'Event', ''));
        event.location = new EventLocation('specific-place-id', 'Some Venue');

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        // Domain MUST come from config, not request host (host-header spoofing risk)
        expect(result['pavillion:place'].id).toBe(
          `https://${domain}/calendars/testcalendar/places/specific-place-id`,
        );
      });

      it('should emit pavillion:place with empty content when location has no per-language content', () => {
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'Event', ''));
        // Location with no addContent() calls — _content is empty
        event.location = new EventLocation(
          'place-empty',
          'Bare Venue',
          '50 Side St',
          'Portland',
          'OR',
          '97200',
          'US',
        );

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        expect(result['pavillion:place']).toEqual({
          id: `https://${domain}/calendars/mycal/places/place-empty`,
          address: '50 Side St',
          city: 'Portland',
          state: 'OR',
          postalCode: '97200',
          country: 'US',
          content: {},
        });
      });

      it('should emit pavillion:place with flat top-level address fields (not nested)', () => {
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'Event', ''));
        event.location = new EventLocation(
          'place-flat',
          'Venue',
          '1 First St',
          'Eugene',
          'OR',
          '97401',
          'US',
        );

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        const place = result['pavillion:place'];
        // Address fields are flat keys at the top level of pavillion:place,
        // NOT nested in a PostalAddress sub-object (that's the AS location shape).
        expect(place.address).toBe('1 First St');
        expect(place.city).toBe('Eugene');
        expect(place.state).toBe('OR');
        expect(place.postalCode).toBe('97401');
        expect(place.country).toBe('US');
        expect(place).not.toHaveProperty('PostalAddress');
        // The address field is a string, not a sub-object
        expect(typeof place.address).toBe('string');
      });

      it('should mirror event.location.name into every content entry name field (single-string source)', () => {
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'Event', ''));
        const location = new EventLocation('place-multi', 'Shared Venue Name');
        location.addContent(new EventLocationContent('en', 'EN access'));
        location.addContent(new EventLocationContent('fr', 'FR access'));
        location.addContent(new EventLocationContent('es', 'ES access'));
        event.location = location;

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        const content = result['pavillion:place'].content;
        // Today, EventLocation.name is single-string. Wire shape carries
        // per-language name slots so when names later become translatable, the
        // wire format does not need to change.
        expect(content.en.name).toBe('Shared Venue Name');
        expect(content.fr.name).toBe('Shared Venue Name');
        expect(content.es.name).toBe('Shared Venue Name');
        expect(content.en.accessibilityInfo).toBe('EN access');
        expect(content.fr.accessibilityInfo).toBe('FR access');
        expect(content.es.accessibilityInfo).toBe('ES access');
      });

      it('should emit address fields as empty strings when location has no address data', () => {
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'Event', ''));
        // Location with only id and name — no address fields
        event.location = new EventLocation('place-noaddr', 'Name Only');

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        const place = result['pavillion:place'];
        expect(place.id).toBe(`https://${domain}/calendars/mycal/places/place-noaddr`);
        expect(place.address).toBe('');
        expect(place.city).toBe('');
        expect(place.state).toBe('');
        expect(place.postalCode).toBe('');
        expect(place.country).toBe('');
      });

    });

    describe('pavillion:space serialization', () => {

      it('should emit pavillion:space when event.location AND event.space are set', () => {
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'Event', ''));
        event.location = new EventLocation('place-uuid-1', 'Convention Center');
        const space = new EventLocationSpace('space-uuid-1', 'place-uuid-1');
        space.addContent(new EventLocationSpaceContent('en', 'Pacific Room', 'Hearing loop, 3rd floor'));
        space.addContent(new EventLocationSpaceContent('fr', 'Salle Pacifique', 'Boucle auditive, 3e étage'));
        event.space = space;

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        expect(result['pavillion:space']).toEqual({
          id: `https://${domain}/calendars/mycal/places/place-uuid-1/spaces/space-uuid-1`,
          content: {
            en: { name: 'Pacific Room', accessibilityInfo: 'Hearing loop, 3rd floor' },
            fr: { name: 'Salle Pacifique', accessibilityInfo: 'Boucle auditive, 3e étage' },
          },
        });
      });

      it('should omit pavillion:space when event has no space', () => {
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'Event', ''));
        event.location = new EventLocation('place-uuid-1', 'Convention Center');
        // No event.space

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        expect(result).not.toHaveProperty('pavillion:space');
        // pavillion:place should still be present
        expect(result['pavillion:place']).toBeDefined();
      });

      it('should omit pavillion:space when event has space but no location (defensive)', () => {
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'Event', ''));
        // Pathological state: a Space without its Place is meaningless on the
        // wire. The outbound emitter must defensively skip it.
        const space = new EventLocationSpace('space-uuid-1', 'place-uuid-1');
        space.addContent(new EventLocationSpaceContent('en', 'Pacific Room', 'Hearing loop'));
        event.space = space;
        // No event.location

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        expect(result).not.toHaveProperty('pavillion:space');
        expect(result).not.toHaveProperty('pavillion:place');
      });

      it('should mint id URL whose parent path matches the parent pavillion:place.id segment (round-trip)', () => {
        const calendar = new Calendar('calendar-uuid', 'testcalendar');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'Event', ''));
        event.location = new EventLocation('specific-place-id', 'Some Venue');
        const space = new EventLocationSpace('specific-space-id', 'specific-place-id');
        space.addContent(new EventLocationSpaceContent('en', 'Room', ''));
        event.space = space;

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        // The space id MUST contain the parent place id segment so the inbound
        // parent-path prefix check (`${placeId}/spaces/`) passes round-trip.
        const placeId = result['pavillion:place'].id;
        const spaceId = result['pavillion:space'].id;
        expect(spaceId).toBe(`${placeId}/spaces/specific-space-id`);
        expect(spaceId.startsWith(`${placeId}/spaces/`)).toBe(true);
      });

      it('should mint id URL from configured domain (NOT request host — host-header spoofing risk)', () => {
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'Event', ''));
        event.location = new EventLocation('place-1', 'Venue');
        const space = new EventLocationSpace('space-1', 'place-1');
        space.addContent(new EventLocationSpaceContent('en', 'Room', ''));
        event.space = space;

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        // Domain MUST come from config, not request host
        expect(result['pavillion:space'].id).toBe(
          `https://${domain}/calendars/mycal/places/place-1/spaces/space-1`,
        );
      });

      it('should emit per-language content map keyed by every language present in space._content', () => {
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'Event', ''));
        event.location = new EventLocation('place-1', 'Venue');
        const space = new EventLocationSpace('space-1', 'place-1');
        space.addContent(new EventLocationSpaceContent('en', 'EN Name', 'EN access'));
        space.addContent(new EventLocationSpaceContent('fr', 'FR Name', 'FR access'));
        space.addContent(new EventLocationSpaceContent('es', 'ES Name', 'ES access'));
        event.space = space;

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        const content = result['pavillion:space'].content;
        // Unlike Place (single-string name), Space names are translatable today
        // so each entry carries its own name string.
        expect(content.en).toEqual({ name: 'EN Name', accessibilityInfo: 'EN access' });
        expect(content.fr).toEqual({ name: 'FR Name', accessibilityInfo: 'FR access' });
        expect(content.es).toEqual({ name: 'ES Name', accessibilityInfo: 'ES access' });
      });

      it('should emit pavillion:space with empty content map when space has no per-language content', () => {
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'Event', ''));
        event.location = new EventLocation('place-1', 'Venue');
        // Space with no addContent() calls — _content is empty
        event.space = new EventLocationSpace('space-empty', 'place-1');

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        expect(result['pavillion:space']).toEqual({
          id: `https://${domain}/calendars/mycal/places/place-1/spaces/space-empty`,
          content: {},
        });
      });

    });

    describe('flat as:Place.name concatenation with Space', () => {

      it('should concatenate flat as:Place.name as "Place — Space" in the primary language when Space present', () => {
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'My Event', ''));
        event.location = new EventLocation('place-uuid-1', 'Convention Center');
        const space = new EventLocationSpace('space-uuid-1', 'place-uuid-1');
        space.addContent(new EventLocationSpaceContent('en', 'Pacific Room', 'Hearing loop'));
        event.space = space;

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        // Flat fallback for non-Pavillion peers (Mobilizon, Mastodon, Gancio)
        // gets the concatenated label since they cannot consume pavillion:space.
        expect(result.location.type).toBe('Place');
        expect(result.location.name).toBe('Convention Center — Pacific Room');
      });

      it('should keep Place.name alone when no Space is present', () => {
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'My Event', ''));
        event.location = new EventLocation('place-uuid-1', 'Convention Center');
        // No event.space — whole-venue event

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        expect(result.location.name).toBe('Convention Center');
        expect(result.location.name).not.toContain('—');
      });

      it('should pick the Space name in the same primary language used for event content', () => {
        // Event has only French content, so the primary language should be 'fr'.
        // The flat as:Place.name concatenation must use the FR space name to
        // stay internally consistent with the rest of the flat surface (name,
        // summary, content all come from the same primary-language pick).
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('fr', 'Évènement', 'Description'));
        event.location = new EventLocation('place-uuid-1', 'Centre des Congrès');
        const space = new EventLocationSpace('space-uuid-1', 'place-uuid-1');
        space.addContent(new EventLocationSpaceContent('en', 'Pacific Room', ''));
        space.addContent(new EventLocationSpaceContent('fr', 'Salle Pacifique', ''));
        event.space = space;

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        // Primary language is 'fr' (event has no en content), so the Space
        // name should be the FR translation, not the EN one.
        expect(result.name).toBe('Évènement');
        expect(result.location.name).toBe('Centre des Congrès — Salle Pacifique');
      });

      it('should fall back to the first available Space name when primary-language entry has no name', () => {
        // Event content is English, but the Space has no English name (only FR).
        // The concatenation must still produce a usable label for non-Pavillion
        // peers by falling back to the first Space content with a non-empty name.
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'My Event', ''));
        event.location = new EventLocation('place-uuid-1', 'Convention Center');
        const space = new EventLocationSpace('space-uuid-1', 'place-uuid-1');
        space.addContent(new EventLocationSpaceContent('fr', 'Salle Pacifique', ''));
        event.space = space;

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        expect(result.location.name).toBe('Convention Center — Salle Pacifique');
      });

      it('should keep Place.name alone when Space has no per-language content (defensive)', () => {
        // Pathological state: Space exists but has no content map. Concatenation
        // would produce a trailing em-dash, so we suppress it and emit Place
        // alone on the flat surface. The structured pavillion:space extension
        // is unaffected.
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'My Event', ''));
        event.location = new EventLocation('place-uuid-1', 'Convention Center');
        // Space with no addContent() calls — every _content[lang]?.name is undefined
        event.space = new EventLocationSpace('space-empty', 'place-uuid-1');

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        expect(result.location.name).toBe('Convention Center');
      });

    });

  });

  describe('fromActivityPubObject()', () => {

    it('should normalize standard AS input into eventParams shape', () => {
      const apObject = {
        name: 'Test',
        startTime: '2026-04-15T09:00:00-05:00',
        endTime: '2026-04-15T12:00:00-05:00',
        summary: 'A description',
      };

      const result = EventObject.fromActivityPubObject(apObject);

      expect(result.content.en.name).toBe('Test');
      expect(result.content.en.description).toBe('A description');
      expect(result.date).toBe('2026-04-15');
      expect(result.schedules[0].start).toBe('2026-04-15T09:00:00-05:00');
      expect(result.schedules[0].end).toBe('2026-04-15T12:00:00-05:00');
    });

    it('should normalize multilingual AS input with nameMap and summaryMap', () => {
      const apObject = {
        nameMap: { en: 'English', es: 'Spanish' },
        summaryMap: { en: 'Eng desc', es: 'Esp desc' },
      };

      const result = EventObject.fromActivityPubObject(apObject);

      expect(result.content.en.name).toBe('English');
      expect(result.content.es.name).toBe('Spanish');
      expect(result.content.en.description).toBe('Eng desc');
      expect(result.content.es.description).toBe('Esp desc');
    });

    it('should pass through new Pavillion format with pavillion:* prefixes', () => {
      const apObject = {
        'pavillion:content': { en: { name: 'Test', description: 'Desc' } },
        'pavillion:categories': ['uri1'],
        'pavillion:series': 'series-uri',
        'pavillion:schedules': [{ id: 's1', start: '2026-04-15T09:00:00Z', end: '2026-04-15T12:00:00Z' }],
      };

      const result = EventObject.fromActivityPubObject(apObject);

      expect(result.content).toEqual({ en: { name: 'Test', description: 'Desc' } });
      expect(result.categories).toEqual(['uri1']);
      expect(result.series).toBe('series-uri');
      expect(result.schedules).toEqual([{ id: 's1', start: '2026-04-15T09:00:00Z', end: '2026-04-15T12:00:00Z' }]);
    });

    it('should pass through old Pavillion format (backward compat)', () => {
      const apObject = {
        content: { en: { name: 'Old', description: 'Format' } },
        categories: ['cat-uri'],
        schedules: [{ id: 's1' }],
      };

      const result = EventObject.fromActivityPubObject(apObject);

      expect(result.content).toEqual({ en: { name: 'Old', description: 'Format' } });
      expect(result.categories).toEqual(['cat-uri']);
      expect(result.schedules).toEqual([{ id: 's1' }]);
    });

    it('should give pavillion:content precedence over AS name/summary', () => {
      const apObject = {
        name: 'AS Name',
        'pavillion:content': { en: { name: 'Pavillion Name', description: 'Pav Desc' } },
      };

      const result = EventObject.fromActivityPubObject(apObject);

      expect(result.content.en.name).toBe('Pavillion Name');
    });

    it('should normalize AP Place location with PostalAddress', () => {
      const apObject = {
        location: {
          type: 'Place',
          name: 'Park',
          address: {
            type: 'PostalAddress',
            streetAddress: '123 Main St',
            addressLocality: 'Springfield',
            addressRegion: 'IL',
            postalCode: '62701',
            addressCountry: 'US',
          },
        },
      };

      const result = EventObject.fromActivityPubObject(apObject);

      expect(result.location.name).toBe('Park');
      expect(result.location.address).toBe('123 Main St');
      expect(result.location.city).toBe('Springfield');
      expect(result.location.state).toBe('IL');
      expect(result.location.postalCode).toBe('62701');
      expect(result.location.country).toBe('US');

      // String location should be wrapped
      const stringResult = EventObject.fromActivityPubObject({ location: 'Some Place' });
      expect(stringResult.location.name).toBe('Some Place');
    });

    it('should sanitize HTML in pavillion:content name and description fields', () => {
      const apObject = {
        'pavillion:content': {
          en: { name: '<script>alert("xss")</script>Event', description: '<img src=x onerror=alert(1)>Desc' },
          es: { name: '<b>Evento</b>', description: 'Normal' },
        },
      };

      const result = EventObject.fromActivityPubObject(apObject);
      expect(result.content.en.name).toBe('alert("xss")Event');
      expect(result.content.en.description).toBe('Desc');
      expect(result.content.es.name).toBe('Evento');
      expect(result.content.es.description).toBe('Normal');
    });

    it('should sanitize HTML in old Pavillion format content', () => {
      const apObject = {
        content: {
          en: { name: '<script>xss</script>Title', description: 'Clean' },
        },
      };

      const result = EventObject.fromActivityPubObject(apObject);
      expect(result.content.en.name).toBe('xssTitle');
    });

    it('should sanitize HTML in location name and address fields', () => {
      const apObject = {
        location: {
          type: 'Place',
          name: '<script>alert(1)</script>Park',
          address: {
            type: 'PostalAddress',
            streetAddress: '<b>123</b> Main St',
            addressLocality: '<em>Springfield</em>',
          },
        },
      };

      const result = EventObject.fromActivityPubObject(apObject);
      expect(result.location.name).toBe('alert(1)Park');
      expect(result.location.address).toBe('123 Main St');
      expect(result.location.city).toBe('Springfield');
    });

    it('should handle Mobilizon hybrid location arrays with Place and VirtualLocation', () => {
      const apObject = {
        location: [
          {
            type: 'Place',
            name: 'Conference Center',
            address: {
              type: 'PostalAddress',
              streetAddress: '456 Oak Ave',
              addressLocality: 'Portland',
            },
          },
          {
            type: 'VirtualLocation',
            url: 'https://meet.example.com/room-123',
          },
        ],
      };

      const result = EventObject.fromActivityPubObject(apObject);

      expect(result.location.name).toBe('Conference Center');
      expect(result.location.address).toBe('456 Oak Ave');
      expect(result.location.city).toBe('Portland');
      expect(result.location.virtualUrl).toBe('https://meet.example.com/room-123');
    });

    it('should handle location array with only VirtualLocation', () => {
      const apObject = {
        location: [
          {
            type: 'VirtualLocation',
            name: 'Online Meeting',
            url: 'https://zoom.example.com/meeting',
          },
        ],
      };

      const result = EventObject.fromActivityPubObject(apObject);

      expect(result.location.name).toBe('Online Meeting');
      expect(result.location.virtualUrl).toBe('https://zoom.example.com/meeting');
    });

    it('should handle location array with Place only (no VirtualLocation)', () => {
      const apObject = {
        location: [
          {
            type: 'Place',
            name: 'City Hall',
          },
        ],
      };

      const result = EventObject.fromActivityPubObject(apObject);

      expect(result.location.name).toBe('City Hall');
      expect(result.location.virtualUrl).toBeUndefined();
    });

    it('should round-trip through toActivityPubObject and fromActivityPubObject', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');
      event.addContent(new CalendarEventContent('en', 'Round Trip', 'Test description'));
      event.date = '2026-04-15';
      const startDt = DateTime.fromISO('2026-04-15T09:00:00.000Z');
      const endDt = DateTime.fromISO('2026-04-15T12:00:00.000Z');
      event.schedules = [new CalendarEventSchedule('s1', startDt, endDt)];
      event.location = new EventLocation('loc-id', 'City Park', '123 Main', 'Springfield', 'IL', '62701', 'US');

      const obj = new EventObject(calendar, event);
      const apOutput = obj.toActivityPubObject();
      const normalized = EventObject.fromActivityPubObject(apOutput);
      const reconstituted = CalendarEvent.fromObject(normalized);

      // Content should match
      expect(reconstituted._content.en.name).toBe('Round Trip');
      expect(reconstituted._content.en.description).toBe('Test description');

      // Date should match
      expect(reconstituted.date).toBe('2026-04-15');

      // Schedule start/end times should match
      expect(reconstituted.schedules.length).toBeGreaterThan(0);
      expect(reconstituted.schedules[0].startDate?.toMillis()).toBe(startDt.toMillis());
      expect(reconstituted.schedules[0].endDate?.toMillis()).toBe(endDt.toMillis());
    });

    it('should round-trip hideFromPublic on pavillion:schedules entries', () => {
      // Outbound: a local event has a cancellation-only exclusion schedule
      // (isExclusion + hideFromPublic=false) alongside a normal schedule.
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');
      event.addContent(new CalendarEventContent('en', 'Series Event', ''));
      event.date = '2026-04-15';

      const normalStart = DateTime.fromISO('2026-04-15T09:00:00.000Z');
      const cancelledStart = DateTime.fromISO('2026-04-22T09:00:00.000Z');

      const normal = new CalendarEventSchedule('s-normal', normalStart);
      normal.isExclusion = false;
      normal.hideFromPublic = true;

      const cancelled = new CalendarEventSchedule('s-cancel', cancelledStart);
      cancelled.isExclusion = true;
      cancelled.hideFromPublic = false;

      event.schedules = [normal, cancelled];

      const apOutput = new EventObject(calendar, event).toActivityPubObject();

      // Outbound: hideFromPublic is present on every pavillion:schedules entry
      expect(apOutput['pavillion:schedules']).toBeInstanceOf(Array);
      expect(apOutput['pavillion:schedules']).toHaveLength(2);
      expect(apOutput['pavillion:schedules'][0]).toMatchObject({
        id: 's-normal',
        isException: false,
        hideFromPublic: true,
      });
      expect(apOutput['pavillion:schedules'][1]).toMatchObject({
        id: 's-cancel',
        isException: true,
        hideFromPublic: false,
      });

      // Inbound (origin actor, no gating applied by omitting actorUri):
      // hideFromPublic is preserved on both schedules through the reconstitute.
      const normalized = EventObject.fromActivityPubObject(apOutput);
      const reconstituted = CalendarEvent.fromObject(normalized);

      const rebuiltNormal = reconstituted.schedules.find(s => s.id === 's-normal');
      const rebuiltCancel = reconstituted.schedules.find(s => s.id === 's-cancel');
      expect(rebuiltNormal?.hideFromPublic).toBe(true);
      expect(rebuiltCancel?.isExclusion).toBe(true);
      expect(rebuiltCancel?.hideFromPublic).toBe(false);
    });

    it('should round-trip with synthesized endTime when no endDate exists', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');
      event.addContent(new CalendarEventContent('en', 'No End', 'Test'));
      event.date = '2026-04-15';
      const startDt = DateTime.fromISO('2026-04-15T09:00:00.000Z');
      event.schedules = [new CalendarEventSchedule('s1', startDt)];

      const obj = new EventObject(calendar, event);
      const apOutput = obj.toActivityPubObject();

      // The AP output should have a synthesized endTime
      expect(apOutput).toHaveProperty('endTime');

      const normalized = EventObject.fromActivityPubObject(apOutput);
      const reconstituted = CalendarEvent.fromObject(normalized);

      // pavillion:schedules preserves the original schedule (no endDate),
      // so the reconstituted event should NOT have an endDate despite the synthesized endTime
      expect(reconstituted.schedules[0].startDate?.toMillis()).toBe(startDt.toMillis());
      expect(reconstituted.schedules[0].endDate).toBeNull();
    });

    it('should map standard AS endTime into schedule end when no pavillion:schedules present', () => {
      // Simulates what a non-Pavillion AS consumer would receive
      const apObject = {
        name: 'External Event',
        startTime: '2026-04-15T09:00:00.000Z',
        endTime: '2026-04-15T10:00:00.000Z',
        summary: 'From external source',
      };

      const result = EventObject.fromActivityPubObject(apObject);

      expect(result.schedules[0].start).toBe('2026-04-15T09:00:00.000Z');
      expect(result.schedules[0].end).toBe('2026-04-15T10:00:00.000Z');
    });

    it('should use string content (HTML) as description fallback when summary is absent', () => {
      const apObject = {
        type: 'Event',
        id: 'https://gancio.example/events/123',
        name: 'Gancio Event',
        content: '<p>A <strong>great</strong> event description</p>',
        startTime: '2026-05-01T10:00:00Z',
      };

      const result = EventObject.fromActivityPubObject(apObject);
      expect(result.content.en.name).toBe('Gancio Event');
      expect(result.content.en.description).toBe('A great event description');
    });

    it('should prefer summary over string content when both are present', () => {
      const apObject = {
        type: 'Event',
        id: 'https://example.com/events/1',
        name: 'Test Event',
        summary: 'Short summary',
        content: '<p>Longer HTML description</p>',
        startTime: '2026-05-01T10:00:00Z',
      };

      const result = EventObject.fromActivityPubObject(apObject);
      expect(result.content.en.description).toBe('Short summary');
    });

    it('should use contentMap as description fallback when summaryMap is absent', () => {
      const apObject = {
        type: 'Event',
        id: 'https://mobilizon.example/events/456',
        nameMap: { en: 'English Title', fr: 'Titre Français' },
        contentMap: { en: '<p>English description</p>', fr: '<p>Description française</p>' },
        startTime: '2026-05-01T10:00:00Z',
      };

      const result = EventObject.fromActivityPubObject(apObject);
      expect(result.content.en.name).toBe('English Title');
      expect(result.content.en.description).toBe('English description');
      expect(result.content.fr.name).toBe('Titre Français');
      expect(result.content.fr.description).toBe('Description française');
    });

    it('should prefer summaryMap over contentMap when both are present', () => {
      const apObject = {
        type: 'Event',
        id: 'https://example.com/events/2',
        nameMap: { en: 'Title' },
        summaryMap: { en: 'Summary text' },
        contentMap: { en: '<p>HTML content</p>' },
        startTime: '2026-05-01T10:00:00Z',
      };

      const result = EventObject.fromActivityPubObject(apObject);
      expect(result.content.en.description).toBe('Summary text');
    });

    it('should handle content with HTML entities', () => {
      const apObject = {
        type: 'Event',
        id: 'https://example.com/events/3',
        name: 'Entity Event',
        content: '<p>Rock &amp; Roll &quot;Night&quot;</p>',
        startTime: '2026-05-01T10:00:00Z',
      };

      const result = EventObject.fromActivityPubObject(apObject);
      expect(result.content.en.description).toBe('Rock & Roll "Night"');
    });

    it('should sanitize script tags from name field', () => {
      const apObject = {
        name: '<script>alert("xss")</script>My Event',
        startTime: '2026-05-01T10:00:00Z',
      };

      const result = EventObject.fromActivityPubObject(apObject);
      expect(result.content.en.name).toBe('alert("xss")My Event');
      expect(result.content.en.name).not.toContain('<script>');
    });

    it('should sanitize HTML from nameMap values', () => {
      const apObject = {
        nameMap: { en: '<b>Bold</b> Title', es: '<img src=x onerror=alert(1)>Evento' },
        summaryMap: { en: 'Desc', es: 'Desc' },
        startTime: '2026-05-01T10:00:00Z',
      };

      const result = EventObject.fromActivityPubObject(apObject);
      expect(result.content.en.name).toBe('Bold Title');
      expect(result.content.es.name).toBe('Evento');
    });

    it('should sanitize HTML from summary field', () => {
      const apObject = {
        name: 'Test',
        summary: '<script>steal(cookies)</script>A safe description',
        startTime: '2026-05-01T10:00:00Z',
      };

      const result = EventObject.fromActivityPubObject(apObject);
      expect(result.content.en.description).toBe('steal(cookies)A safe description');
      expect(result.content.en.description).not.toContain('<script>');
    });

    it('should sanitize HTML from summaryMap values', () => {
      const apObject = {
        nameMap: { en: 'Title' },
        summaryMap: { en: '<div onmouseover="alert(1)">Hoverable</div>', fr: '<a href="javascript:void(0)">Lien</a>' },
        startTime: '2026-05-01T10:00:00Z',
      };

      const result = EventObject.fromActivityPubObject(apObject);
      expect(result.content.en.description).toBe('Hoverable');
      expect(result.content.fr.description).toBe('Lien');
    });

    it('should decode HTML entities in name and summary fields', () => {
      const apObject = {
        name: 'Rock &amp; Roll &quot;Night&quot;',
        summary: 'Fun &amp; Games ahead',
        startTime: '2026-05-01T10:00:00Z',
      };

      const result = EventObject.fromActivityPubObject(apObject);
      expect(result.content.en.name).toBe('Rock & Roll "Night"');
      expect(result.content.en.description).toBe('Fun & Games ahead');
    });

    it('should include contentMap languages in allLanguages set', () => {
      const apObject = {
        type: 'Event',
        id: 'https://example.com/events/4',
        nameMap: { en: 'English Only Name' },
        contentMap: { en: '<p>English</p>', de: '<p>Deutsch</p>' },
        startTime: '2026-05-01T10:00:00Z',
      };

      const result = EventObject.fromActivityPubObject(apObject);
      expect(result.content.de).toBeDefined();
      expect(result.content.de.description).toBe('Deutsch');
    });

    describe('externalUrl + urlPrompt parsing', () => {

      it('should parse attachment Link with rel:external and pavillion:urlPrompt', () => {
        const apObject = {
          name: 'Test',
          startTime: '2026-04-15T09:00:00Z',
          attachment: [
            { type: 'Link', href: 'https://example.com/tickets', rel: 'external', name: 'Tickets' },
          ],
          'pavillion:urlPrompt': 'tickets' as UrlPrompt,
        };

        const result = EventObject.fromActivityPubObject(apObject);

        expect(result.externalUrl).toBe('https://example.com/tickets');
        expect(result.urlPrompt).toBe('tickets');
      });

      it('should null externalUrl when href is javascript: scheme', () => {
        const apObject = {
          name: 'Test',
          attachment: [
            { type: 'Link', href: 'javascript:alert(1)', rel: 'external' },
          ],
          'pavillion:urlPrompt': 'tickets',
        };

        const result = EventObject.fromActivityPubObject(apObject);

        expect(result.externalUrl).toBeNull();
        expect(result.urlPrompt).toBeNull();
      });

      it('should null externalUrl when href is data: URI', () => {
        const apObject = {
          name: 'Test',
          attachment: [
            { type: 'Link', href: 'data:text/html,<script>alert(1)</script>', rel: 'external' },
          ],
          'pavillion:urlPrompt': 'tickets',
        };

        const result = EventObject.fromActivityPubObject(apObject);

        expect(result.externalUrl).toBeNull();
        expect(result.urlPrompt).toBeNull();
      });

      it('should null externalUrl when href is ftp: scheme', () => {
        const apObject = {
          name: 'Test',
          attachment: [
            { type: 'Link', href: 'ftp://example.com/file', rel: 'external' },
          ],
          'pavillion:urlPrompt': 'tickets',
        };

        const result = EventObject.fromActivityPubObject(apObject);

        expect(result.externalUrl).toBeNull();
        expect(result.urlPrompt).toBeNull();
      });

      it('should null both fields when pavillion:urlPrompt is not in the whitelist', () => {
        const apObject = {
          name: 'Test',
          attachment: [
            { type: 'Link', href: 'https://example.com/tickets', rel: 'external' },
          ],
          'pavillion:urlPrompt': 'buy_now_pay_later', // not a valid enum
        };

        const result = EventObject.fromActivityPubObject(apObject);

        expect(result.externalUrl).toBeNull();
        expect(result.urlPrompt).toBeNull();
      });

      it('should null both fields when pavillion:urlPrompt is missing but href is valid', () => {
        const apObject = {
          name: 'Test',
          attachment: [
            { type: 'Link', href: 'https://example.com/tickets', rel: 'external' },
          ],
        };

        const result = EventObject.fromActivityPubObject(apObject);

        expect(result.externalUrl).toBeNull();
        expect(result.urlPrompt).toBeNull();
      });

      it('should null both fields when pavillion:urlPrompt is set but href is missing', () => {
        const apObject = {
          name: 'Test',
          'pavillion:urlPrompt': 'tickets',
        };

        const result = EventObject.fromActivityPubObject(apObject);

        expect(result.externalUrl).toBeNull();
        expect(result.urlPrompt).toBeNull();
      });

      it('should ignore attachment entries without rel:external', () => {
        const apObject = {
          name: 'Test',
          attachment: [
            { type: 'Link', href: 'https://example.com/canonical', rel: 'canonical' },
            { type: 'Link', href: 'https://example.com/alt', rel: 'alternate' },
          ],
          'pavillion:urlPrompt': 'tickets',
        };

        const result = EventObject.fromActivityPubObject(apObject);

        expect(result.externalUrl).toBeNull();
        expect(result.urlPrompt).toBeNull();
      });

      it('should null externalUrl when href is empty string', () => {
        const apObject = {
          name: 'Test',
          attachment: [
            { type: 'Link', href: '', rel: 'external' },
          ],
          'pavillion:urlPrompt': 'tickets',
        };

        const result = EventObject.fromActivityPubObject(apObject);

        expect(result.externalUrl).toBeNull();
        expect(result.urlPrompt).toBeNull();
      });

      it('should null externalUrl when href is whitespace only', () => {
        const apObject = {
          name: 'Test',
          attachment: [
            { type: 'Link', href: '   ', rel: 'external' },
          ],
          'pavillion:urlPrompt': 'tickets',
        };

        const result = EventObject.fromActivityPubObject(apObject);

        expect(result.externalUrl).toBeNull();
        expect(result.urlPrompt).toBeNull();
      });

      it('should null externalUrl when href exceeds 2048 characters', () => {
        const longHref = 'https://example.com/' + 'a'.repeat(2050);
        const apObject = {
          name: 'Test',
          attachment: [
            { type: 'Link', href: longHref, rel: 'external' },
          ],
          'pavillion:urlPrompt': 'tickets',
        };

        const result = EventObject.fromActivityPubObject(apObject);

        expect(result.externalUrl).toBeNull();
        expect(result.urlPrompt).toBeNull();
      });

      it('should null externalUrl when href is protocol-relative', () => {
        const apObject = {
          name: 'Test',
          attachment: [
            { type: 'Link', href: '//example.com/tickets', rel: 'external' },
          ],
          'pavillion:urlPrompt': 'tickets',
        };

        const result = EventObject.fromActivityPubObject(apObject);

        expect(result.externalUrl).toBeNull();
        expect(result.urlPrompt).toBeNull();
      });

      it('should null externalUrl when href is not a string', () => {
        const apObject = {
          name: 'Test',
          attachment: [
            { type: 'Link', href: 12345, rel: 'external' },
          ],
          'pavillion:urlPrompt': 'tickets',
        };

        const result = EventObject.fromActivityPubObject(apObject);

        expect(result.externalUrl).toBeNull();
        expect(result.urlPrompt).toBeNull();
      });

      it('should handle non-array attachment gracefully', () => {
        const apObject = {
          name: 'Test',
          attachment: { type: 'Link', href: 'https://example.com', rel: 'external' },
          'pavillion:urlPrompt': 'tickets',
        };

        const result = EventObject.fromActivityPubObject(apObject);

        expect(result.externalUrl).toBeNull();
        expect(result.urlPrompt).toBeNull();
      });

      it('should accept all four valid urlPrompt values (rsvp, more_info, register)', () => {
        const rsvpResult = EventObject.fromActivityPubObject({
          name: 'Test',
          attachment: [{ type: 'Link', href: 'https://example.com/rsvp', rel: 'external' }],
          'pavillion:urlPrompt': 'rsvp',
        });
        expect(rsvpResult.externalUrl).toBe('https://example.com/rsvp');
        expect(rsvpResult.urlPrompt).toBe('rsvp');

        const infoResult = EventObject.fromActivityPubObject({
          name: 'Test',
          attachment: [{ type: 'Link', href: 'https://example.com/info', rel: 'external' }],
          'pavillion:urlPrompt': 'more_info',
        });
        expect(infoResult.externalUrl).toBe('https://example.com/info');
        expect(infoResult.urlPrompt).toBe('more_info');

        const registerResult = EventObject.fromActivityPubObject({
          name: 'Test',
          attachment: [{ type: 'Link', href: 'https://example.com/register', rel: 'external' }],
          'pavillion:urlPrompt': 'register',
        });
        expect(registerResult.externalUrl).toBe('https://example.com/register');
        expect(registerResult.urlPrompt).toBe('register');
      });

      it('should round-trip externalUrl and urlPrompt through toActivityPubObject and fromActivityPubObject', () => {
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'Round Trip', 'desc'));
        event.date = '2026-04-15';
        event.schedules = [new CalendarEventSchedule('s1', DateTime.fromISO('2026-04-15T09:00:00Z'))];
        event.externalUrl = 'https://example.com/tickets';
        event.urlPrompt = 'tickets';

        const obj = new EventObject(calendar, event);
        const apOutput = obj.toActivityPubObject();
        const normalized = EventObject.fromActivityPubObject(apOutput);

        expect(normalized.externalUrl).toBe('https://example.com/tickets');
        expect(normalized.urlPrompt).toBe('tickets');
      });

      it('should not set externalUrl or urlPrompt when neither attachment nor pavillion:urlPrompt present', () => {
        const apObject = {
          name: 'Test',
          startTime: '2026-04-15T09:00:00Z',
        };

        const result = EventObject.fromActivityPubObject(apObject);

        expect(result.externalUrl).toBeNull();
        expect(result.urlPrompt).toBeNull();
      });

    });

    describe('pavillion:place / pavillion:space consumption (Option B)', () => {

      beforeEach(() => {
        mockWarn.mockClear();
      });

      it('should consume pavillion:place with priority over flat location (Place + content)', () => {
        const apObject = {
          location: {
            type: 'Place',
            // Flat AS Place name MUST be ignored when extension is present
            name: 'Flat Fallback Name',
            address: { type: 'PostalAddress', streetAddress: '999 Old Address' },
          },
          'pavillion:place': {
            id: 'https://origin.example/calendars/owner/places/place-uuid-1',
            address: '100 Main St',
            city: 'Springfield',
            state: 'OR',
            postalCode: '97477',
            country: 'US',
            content: {
              en: { name: 'Convention Center', accessibilityInfo: 'Accessible parking' },
              fr: { name: 'Centre Convention', accessibilityInfo: 'Stationnement accessible' },
            },
          },
        };

        const result = EventObject.fromActivityPubObject(apObject);

        // Address fields come from the extension's flat keys
        expect(result.location.address).toBe('100 Main St');
        expect(result.location.city).toBe('Springfield');
        expect(result.location.state).toBe('OR');
        expect(result.location.postalCode).toBe('97477');
        expect(result.location.country).toBe('US');
        // name comes from first available content[lang].name, NOT the flat fallback
        expect(result.location.name).toBe('Convention Center');
        expect(result.location.name).not.toBe('Flat Fallback Name');
        // originUri set from extension id
        expect(result.location.originUri).toBe('https://origin.example/calendars/owner/places/place-uuid-1');
        // content carries per-language accessibilityInfo
        expect(result.location.content.en.accessibilityInfo).toBe('Accessible parking');
        expect(result.location.content.fr.accessibilityInfo).toBe('Stationnement accessible');
      });

      it('should fall back to flat _normalizeLocation when no pavillion:place extension present', () => {
        const apObject = {
          location: {
            type: 'Place',
            name: 'City Park',
            address: {
              type: 'PostalAddress',
              streetAddress: '123 Main St',
              addressLocality: 'Springfield',
            },
          },
        };

        const result = EventObject.fromActivityPubObject(apObject);

        // The existing _normalizeLocation flat-path output is preserved
        expect(result.location.name).toBe('City Park');
        expect(result.location.address).toBe('123 Main St');
        expect(result.location.city).toBe('Springfield');
        // No originUri or content from flat path
        expect(result.location.originUri).toBeUndefined();
        expect(result.location.content).toBeUndefined();
        // No space when no extension
        expect(result.space).toBeUndefined();
      });

      it('should consume pavillion:space when its id parent path matches pavillion:place.id', () => {
        const placeId = 'https://origin.example/calendars/owner/places/place-uuid-1';
        const spaceId = `${placeId}/spaces/space-uuid-1`;
        const apObject = {
          'pavillion:place': {
            id: placeId,
            content: {
              en: { name: 'Convention Center', accessibilityInfo: '' },
            },
          },
          'pavillion:space': {
            id: spaceId,
            content: {
              en: { name: 'Pacific Room', accessibilityInfo: 'Hearing loop, 3rd floor' },
              fr: { name: 'Salle Pacifique', accessibilityInfo: 'Boucle auditive, 3e étage' },
            },
          },
        };

        const result = EventObject.fromActivityPubObject(apObject);

        expect(result.space).toBeDefined();
        expect(result.space.originUri).toBe(spaceId);
        expect(result.space.content.en.name).toBe('Pacific Room');
        expect(result.space.content.en.accessibilityInfo).toBe('Hearing loop, 3rd floor');
        expect(result.space.content.fr.name).toBe('Salle Pacifique');
        expect(result.space.content.fr.accessibilityInfo).toBe('Boucle auditive, 3e étage');
      });

      it('should sanitize HTML from BOTH name and accessibilityInfo on Place per language', () => {
        const apObject = {
          'pavillion:place': {
            id: 'https://origin.example/calendars/owner/places/place-uuid-1',
            content: {
              en: {
                name: '<script>alert(1)</script>Convention Center',
                accessibilityInfo: '<img src=x onerror=alert(1)>Accessible parking',
              },
              fr: {
                name: '<b>Centre</b> Convention',
                accessibilityInfo: '<em>Stationnement</em> accessible',
              },
            },
          },
        };

        const result = EventObject.fromActivityPubObject(apObject);

        expect(result.location.content.en.accessibilityInfo).toBe('Accessible parking');
        expect(result.location.content.fr.accessibilityInfo).toBe('Stationnement accessible');
        // The single-string EventLocation.name comes from first available content.name (sanitized)
        expect(result.location.name).toBe('alert(1)Convention Center');
        expect(result.location.name).not.toContain('<script>');
      });

      it('should sanitize HTML from BOTH name and accessibilityInfo on Space per language', () => {
        const placeId = 'https://origin.example/calendars/owner/places/place-uuid-1';
        const spaceId = `${placeId}/spaces/space-uuid-1`;
        const apObject = {
          'pavillion:place': {
            id: placeId,
            content: {
              en: { name: 'Convention Center', accessibilityInfo: '' },
            },
          },
          'pavillion:space': {
            id: spaceId,
            content: {
              en: {
                name: '<script>alert("xss")</script>Pacific Room',
                accessibilityInfo: '<img src=x onerror=alert(1)>Hearing loop',
              },
              fr: {
                name: '<b>Salle</b> Pacifique',
                accessibilityInfo: '<em>Boucle</em> auditive',
              },
            },
          },
        };

        const result = EventObject.fromActivityPubObject(apObject);

        expect(result.space.content.en.name).toBe('alert("xss")Pacific Room');
        expect(result.space.content.en.name).not.toContain('<script>');
        expect(result.space.content.en.accessibilityInfo).toBe('Hearing loop');
        expect(result.space.content.fr.name).toBe('Salle Pacifique');
        expect(result.space.content.fr.accessibilityInfo).toBe('Boucle auditive');
      });

      it('should drop pavillion:space and emit structured warning when parent path does not match pavillion:place.id', () => {
        mockWarn.mockClear();
        const placeId = 'https://origin.example/calendars/owner/places/place-uuid-1';
        const spaceId = 'https://origin.example/calendars/other-owner/places/different-place/spaces/space-uuid-1';
        const apObject = {
          id: 'https://origin.example/calendars/owner/events/evt-1',
          attributedTo: 'https://origin.example/calendars/owner',
          'pavillion:place': {
            id: placeId,
            content: { en: { name: 'Convention Center', accessibilityInfo: '' } },
          },
          'pavillion:space': {
            id: spaceId,
            content: { en: { name: 'Pacific Room', accessibilityInfo: '' } },
          },
        };

        const result = EventObject.fromActivityPubObject(apObject);

        // Place still ingests
        expect(result.location).toBeDefined();
        expect(result.location.originUri).toBe(placeId);
        // Space dropped
        expect(result.space).toBeUndefined();

        // Structured warning logged with structural identifiers only
        expect(mockWarn).toHaveBeenCalledOnce();
        const [payload] = mockWarn.mock.calls[0];
        expect(payload).toMatchObject({
          activityId: 'https://origin.example/calendars/owner/events/evt-1',
          senderDomain: 'origin.example',
          placeId: placeId,
          spaceId: spaceId,
        });
        // Content fields MUST NOT be logged
        expect(payload).not.toHaveProperty('content');
        expect(payload).not.toHaveProperty('name');
        expect(payload).not.toHaveProperty('accessibilityInfo');
        expect(JSON.stringify(payload)).not.toContain('Convention Center');
        expect(JSON.stringify(payload)).not.toContain('Pacific Room');
      });

      it('should drop pavillion:space silently and fall through to _normalizeLocation when pavillion:place is absent', () => {
        const apObject = {
          location: {
            type: 'Place',
            name: 'City Park',
            address: {
              type: 'PostalAddress',
              streetAddress: '123 Main St',
            },
          },
          'pavillion:space': {
            id: 'https://origin.example/calendars/owner/places/place-uuid-1/spaces/space-uuid-1',
            content: { en: { name: 'Pacific Room', accessibilityInfo: '' } },
          },
        };

        const result = EventObject.fromActivityPubObject(apObject);

        // Space orphan dropped
        expect(result.space).toBeUndefined();
        // Flat _normalizeLocation path runs
        expect(result.location.name).toBe('City Park');
        expect(result.location.address).toBe('123 Main St');
      });

      it('should run existing _normalizeLocation unchanged when neither extension is present (Mobilizon/Mastodon/Gancio regression guard)', () => {
        const apObject = {
          location: [
            {
              type: 'Place',
              name: 'Conference Center',
              address: {
                type: 'PostalAddress',
                streetAddress: '456 Oak Ave',
                addressLocality: 'Portland',
              },
            },
            {
              type: 'VirtualLocation',
              url: 'https://meet.example.com/room-123',
            },
          ],
        };

        const result = EventObject.fromActivityPubObject(apObject);

        expect(result.location.name).toBe('Conference Center');
        expect(result.location.address).toBe('456 Oak Ave');
        expect(result.location.city).toBe('Portland');
        expect(result.location.virtualUrl).toBe('https://meet.example.com/room-123');
        expect(result.space).toBeUndefined();
      });

      it('should pick first available content[lang].name when populating EventLocation.name (no preferred-language hint)', () => {
        const apObject = {
          'pavillion:place': {
            id: 'https://origin.example/calendars/owner/places/place-uuid-1',
            content: {
              fr: { name: 'Centre Français', accessibilityInfo: '' },
              en: { name: 'English Center', accessibilityInfo: '' },
            },
          },
        };

        const result = EventObject.fromActivityPubObject(apObject);

        // First available content entry's name is used; either is acceptable per spec.
        expect(['Centre Français', 'English Center']).toContain(result.location.name);
      });

      it('should drop mismatched-parent Space without crashing when activityId or attributedTo are missing', () => {
        const apObject = {
          'pavillion:place': {
            id: 'https://origin.example/calendars/owner/places/place-uuid-1',
            content: { en: { name: 'Place', accessibilityInfo: '' } },
          },
          'pavillion:space': {
            id: 'https://origin.example/calendars/other/places/different/spaces/space-1',
            content: { en: { name: 'Space', accessibilityInfo: '' } },
          },
        };

        const result = EventObject.fromActivityPubObject(apObject);
        expect(result.location).toBeDefined();
        expect(result.space).toBeUndefined();
      });

      it('should NOT stamp originUri when pavillion:place.id is oversized (>2048 chars)', () => {
        // Build an id that is unambiguously over the 2048-char limit. The
        // origin host is fine; only the path is bloated. Place content still
        // ingests so the row is locally usable, but the origin_uri dedup key
        // is withheld because the wire id failed validation.
        const oversizedPath = 'a'.repeat(2100);
        const apObject = {
          'pavillion:place': {
            id: `https://origin.example/${oversizedPath}`,
            content: { en: { name: 'Convention Center', accessibilityInfo: '' } },
          },
        };

        const result = EventObject.fromActivityPubObject(apObject);

        expect(result.location).toBeDefined();
        expect(result.location.name).toBe('Convention Center');
        expect(result.location.originUri).toBeUndefined();
      });

      it('should NOT stamp originUri when pavillion:place.id has a non-http(s) scheme', () => {
        const apObject = {
          'pavillion:place': {
            id: 'javascript:alert(1)',
            content: { en: { name: 'Convention Center', accessibilityInfo: '' } },
          },
        };

        const result = EventObject.fromActivityPubObject(apObject);

        expect(result.location).toBeDefined();
        expect(result.location.originUri).toBeUndefined();
      });

      it('should NOT stamp originUri when pavillion:place.id has a data: scheme', () => {
        const apObject = {
          'pavillion:place': {
            id: 'data:text/html,<script>alert(1)</script>',
            content: { en: { name: 'Convention Center', accessibilityInfo: '' } },
          },
        };

        const result = EventObject.fromActivityPubObject(apObject);

        expect(result.location).toBeDefined();
        expect(result.location.originUri).toBeUndefined();
      });

      it('should NOT stamp originUri when pavillion:place.id fails to parse as a URL', () => {
        const apObject = {
          'pavillion:place': {
            id: 'not a url at all !!!',
            content: { en: { name: 'Convention Center', accessibilityInfo: '' } },
          },
        };

        const result = EventObject.fromActivityPubObject(apObject);

        expect(result.location).toBeDefined();
        expect(result.location.originUri).toBeUndefined();
      });

      it('should NOT stamp originUri when actorUri host does not match pavillion:place.id host', () => {
        mockWarn.mockClear();
        const apObject = {
          'pavillion:place': {
            // Claims origin.example...
            id: 'https://origin.example/calendars/owner/places/place-uuid-1',
            content: { en: { name: 'Convention Center', accessibilityInfo: '' } },
          },
        };

        // ...but the sender is impostor.example
        const result = EventObject.fromActivityPubObject(apObject, {
          actorUri: 'https://impostor.example/calendars/attacker',
        });

        expect(result.location).toBeDefined();
        // Place content still ingests
        expect(result.location.name).toBe('Convention Center');
        // But the origin_uri stamp is withheld so dedup-by-origin won't fire
        expect(result.location.originUri).toBeUndefined();
        // Structured warning emitted with structural identifiers only
        expect(mockWarn).toHaveBeenCalled();
        const payload = mockWarn.mock.calls[mockWarn.mock.calls.length - 1][0];
        expect(payload).toMatchObject({
          senderDomain: 'impostor.example',
          claimedHost: 'origin.example',
        });
        // Content fields MUST NOT be logged
        expect(JSON.stringify(payload)).not.toContain('Convention Center');
      });

      it('should stamp originUri when actorUri host matches pavillion:place.id host', () => {
        const apObject = {
          'pavillion:place': {
            id: 'https://origin.example/calendars/owner/places/place-uuid-1',
            content: { en: { name: 'Convention Center', accessibilityInfo: '' } },
          },
        };

        const result = EventObject.fromActivityPubObject(apObject, {
          actorUri: 'https://origin.example/calendars/owner',
        });

        expect(result.location.originUri).toBe('https://origin.example/calendars/owner/places/place-uuid-1');
      });

      it('should NOT stamp space originUri when space id has a non-http(s) scheme even if parent path matches', () => {
        // The parent-path prefix check passes (space id starts with place.id +
        // '/spaces/') because the place.id is itself a javascript: URL — but
        // _validatePavillionId rejects both, so neither gets an originUri.
        const placeId = 'javascript:alert(1)';
        const spaceId = `${placeId}/spaces/space-1`;
        const apObject = {
          'pavillion:place': {
            id: placeId,
            content: { en: { name: 'Place', accessibilityInfo: '' } },
          },
          'pavillion:space': {
            id: spaceId,
            content: { en: { name: 'Pacific Room', accessibilityInfo: '' } },
          },
        };

        const result = EventObject.fromActivityPubObject(apObject);

        expect(result.space).toBeDefined();
        expect(result.space.originUri).toBeUndefined();
        // Space content still ingests despite missing origin_uri
        expect(result.space.content.en.name).toBe('Pacific Room');
      });

    });

    describe('origin-actor gating of hideFromPublic', () => {

      // Shared fixture: a remote event that carries two schedules, one marked
      // as a cancellation override (isException + hideFromPublic=false).
      function makeApObjectWithCancellation(): Record<string, any> {
        return {
          type: 'Event',
          id: 'https://origin.example/calendars/owner/events/evt-1',
          attributedTo: 'https://origin.example/calendars/owner',
          name: 'Origin Event',
          startTime: '2026-04-15T09:00:00Z',
          'pavillion:schedules': [
            { id: 's-normal', start: '2026-04-15T09:00:00Z', isException: false, hideFromPublic: true },
            { id: 's-cancel', start: '2026-04-22T09:00:00Z', isException: true, hideFromPublic: false },
          ],
        };
      }

      it('preserves hideFromPublic when the actor shares the event origin domain', () => {
        const apObject = makeApObjectWithCancellation();

        const result = EventObject.fromActivityPubObject(apObject, {
          actorUri: 'https://origin.example/calendars/owner',
        });

        expect(result.schedules).toHaveLength(2);
        expect(result.schedules[0].hideFromPublic).toBe(true);
        expect(result.schedules[1].hideFromPublic).toBe(false);
      });

      it('preserves hideFromPublic when no actorUri is supplied (legacy caller)', () => {
        const apObject = makeApObjectWithCancellation();

        const result = EventObject.fromActivityPubObject(apObject);

        expect(result.schedules).toHaveLength(2);
        expect(result.schedules[0].hideFromPublic).toBe(true);
        expect(result.schedules[1].hideFromPublic).toBe(false);
      });

      it('strips hideFromPublic from every schedule when actor domain differs from event origin', () => {
        const apObject = makeApObjectWithCancellation();

        const result = EventObject.fromActivityPubObject(apObject, {
          actorUri: 'https://other.example/users/editor',
        });

        expect(result.schedules).toHaveLength(2);
        expect(result.schedules[0]).not.toHaveProperty('hideFromPublic');
        expect(result.schedules[1]).not.toHaveProperty('hideFromPublic');
        // Other fields on the schedule remain intact — only hideFromPublic is stripped
        expect(result.schedules[1].isException).toBe(true);
        expect(result.schedules[1].id).toBe('s-cancel');
      });

      it('strips hideFromPublic when actorUri is present but malformed', () => {
        const apObject = makeApObjectWithCancellation();

        const result = EventObject.fromActivityPubObject(apObject, {
          actorUri: 'not-a-valid-uri',
        });

        // A malformed actor URI cannot be proven to share origin, so the safer
        // posture is to treat it as non-origin and strip the privileged field.
        expect(result.schedules[0]).not.toHaveProperty('hideFromPublic');
        expect(result.schedules[1]).not.toHaveProperty('hideFromPublic');
      });

      it('falls back to attributedTo for origin when event id is missing', () => {
        const apObject: Record<string, any> = {
          type: 'Event',
          attributedTo: 'https://origin.example/calendars/owner',
          name: 'No-ID Event',
          startTime: '2026-04-15T09:00:00Z',
          'pavillion:schedules': [
            { id: 's1', start: '2026-04-15T09:00:00Z', isException: true, hideFromPublic: false },
          ],
        };

        const result = EventObject.fromActivityPubObject(apObject, {
          actorUri: 'https://origin.example/users/someone',
        });

        expect(result.schedules[0].hideFromPublic).toBe(false);
      });

      it('does not alter schedules when the payload has no pavillion:schedules or hideFromPublic field', () => {
        const apObject = {
          type: 'Event',
          id: 'https://origin.example/calendars/owner/events/evt-2',
          attributedTo: 'https://origin.example/calendars/owner',
          name: 'Plain AS Event',
          startTime: '2026-04-15T09:00:00Z',
          endTime: '2026-04-15T10:00:00Z',
        };

        const result = EventObject.fromActivityPubObject(apObject, {
          actorUri: 'https://other.example/users/editor',
        });

        // Synthesized from startTime/endTime; no hideFromPublic was ever present
        expect(result.schedules).toHaveLength(1);
        expect(result.schedules[0]).not.toHaveProperty('hideFromPublic');
      });

    });

  });

  describe('published field', () => {

    describe('toActivityPubObject()', () => {

      it('should emit published when event.createdAt is set', () => {
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'Test Event', ''));
        event.createdAt = new Date('2026-03-01T10:00:00.000Z');

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        expect(result.published).toBe('2026-03-01T10:00:00.000Z');
      });

      it('should omit published when event.createdAt is null', () => {
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'Test Event', ''));
        event.createdAt = null;

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        expect(result).not.toHaveProperty('published');
      });

      it('should be distinct from the envelope published (object vs activity timestamp)', () => {
        // The EventObject's published = when the object was originally created.
        // The Activity envelope's published = when the activity was sent.
        // These are separate concerns and must not be confused.
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'Test Event', ''));
        event.createdAt = new Date('2025-01-15T08:00:00.000Z');

        const obj = new EventObject(calendar, event);
        const result = obj.toActivityPubObject();

        // published exists and reflects the object creation time, not "now"
        expect(result.published).toBe('2025-01-15T08:00:00.000Z');
      });

    });

    describe('fromActivityPubObject()', () => {

      it('should map published to createdAt in the result', () => {
        const apObject = {
          name: 'Remote Event',
          startTime: '2026-04-15T09:00:00Z',
          published: '2026-03-01T10:00:00.000Z',
        };

        const result = EventObject.fromActivityPubObject(apObject);

        expect(result.createdAt).toBeInstanceOf(Date);
        expect((result.createdAt as Date).toISOString()).toBe('2026-03-01T10:00:00.000Z');
      });

      it('should not set createdAt when published is absent', () => {
        const apObject = {
          name: 'Event Without Published',
          startTime: '2026-04-15T09:00:00Z',
        };

        const result = EventObject.fromActivityPubObject(apObject);

        expect(result).not.toHaveProperty('createdAt');
      });

      it('should not set createdAt when published is an invalid date string', () => {
        const apObject = {
          name: 'Event With Bad Published',
          startTime: '2026-04-15T09:00:00Z',
          published: 'not-a-date',
        };

        const result = EventObject.fromActivityPubObject(apObject);

        expect(result).not.toHaveProperty('createdAt');
      });

      it('should survive round-trip: toActivityPubObject → fromActivityPubObject preserves published', () => {
        const calendar = new Calendar('calendar-uuid', 'mycal');
        const event = new CalendarEvent('event-uuid', 'calendar-uuid');
        event.addContent(new CalendarEventContent('en', 'Round-trip Event', ''));
        event.createdAt = new Date('2026-02-15T12:00:00.000Z');
        const startDt = DateTime.fromISO('2026-04-15T09:00:00.000Z');
        event.schedules = [new CalendarEventSchedule('s1', startDt)];

        const obj = new EventObject(calendar, event);
        const apRepresentation = obj.toActivityPubObject();

        // Simulate receiving this AP representation
        const parsed = EventObject.fromActivityPubObject(apRepresentation);

        expect(parsed.createdAt).toBeInstanceOf(Date);
        expect((parsed.createdAt as Date).toISOString()).toBe('2026-02-15T12:00:00.000Z');
      });

    });

  });

});
