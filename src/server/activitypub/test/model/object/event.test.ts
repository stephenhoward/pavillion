import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent, CalendarEventContent, CalendarEventSchedule } from '@/common/model/events';
import { EventCategory } from '@/common/model/event_category';
import { EventSeries } from '@/common/model/event_series';
import { EventSeriesContent } from '@/common/model/event_series_content';
import { EventLocation } from '@/common/model/location';
import { EventObject } from '@/server/activitypub/model/object/event';

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
        'https://pavillion.dev/api/public/v1/calendar/mycal/categories/cat-uuid-1',
        'https://pavillion.dev/api/public/v1/calendar/mycal/categories/cat-uuid-2',
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

      expect(obj.categories[0]).toMatch(/^https:\/\/pavillion\.dev\//);
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

      expect(obj.series).toBe('https://pavillion.dev/calendars/mycal/series/series-uuid-1234');
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

      expect(obj.series).toMatch(/^https:\/\/pavillion\.dev\//);
    });

  });

  describe('toActivityPubObject()', () => {

    it('should serialize a basic event with standard AS properties', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');
      event.addContent(new CalendarEventContent('en', 'Test Event', 'A test description'));
      const startDt = DateTime.fromISO('2026-04-15T09:00:00.000Z');
      const endDt = DateTime.fromISO('2026-04-15T12:00:00.000Z');
      event.schedules = [new CalendarEventSchedule('s1', startDt, endDt)];
      event.location = new EventLocation('loc-id', 'City Park');

      const obj = new EventObject(calendar, event);
      const result = obj.toActivityPubObject();

      expect(result.type).toBe('Event');
      expect(result.id).toMatch(/^https:\/\/pavillion\.dev\/calendars\/mycal\/events\/event-uuid$/);
      expect(result.attributedTo).toBe('https://pavillion.dev/calendars/mycal');
      expect(result.name).toBe('Test Event');
      expect(result.summary).toBe('A test description');
      expect(result.startTime).toBe(startDt.toISO());
      expect(result.endTime).toBe(endDt.toISO());
      expect(result.to).toContain('https://www.w3.org/ns/activitystreams#Public');
      expect(result.cc).toContain('https://pavillion.dev/calendars/mycal/followers');
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

    it('should fall back to date field when no schedules exist', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'calendar-uuid');
      event.date = '2026-04-15';
      event.addContent(new CalendarEventContent('en', 'No Schedule Event', ''));

      const obj = new EventObject(calendar, event);
      const result = obj.toActivityPubObject();

      expect(result.startTime).toBe('2026-04-15T00:00:00.000Z');
      expect(result).not.toHaveProperty('endTime');
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
      expect(reconstituted.schedules[0].startDate?.toISO()).toBe(startDt.toISO());
      expect(reconstituted.schedules[0].endDate?.toISO()).toBe(endDt.toISO());
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

  });

});
