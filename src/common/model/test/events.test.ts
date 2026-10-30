import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DateTime, Settings } from 'luxon';

import { CalendarEvent, CalendarEventContent, CalendarEventSchedule, EventFrequency } from '@/common/model/events';
import { EventLocationSpace } from '@/common/model/location';

/**
 * Unit tests for CalendarEvent model serialization.
 *
 * Covers toObject / fromObject round-trip for the space / spaceId wire contract.
 */
describe('CalendarEvent model', () => {

  describe('toObject', () => {
    it('emits spaceId alongside space when a Space is set', () => {
      const event = new CalendarEvent('evt-1', 'cal-1');
      const space = new EventLocationSpace('space-uuid-1', 'place-uuid-1');
      event.space = space;

      const obj = event.toObject();

      expect(obj.space).toBeDefined();
      expect(obj.space.id).toBe('space-uuid-1');
      expect(obj.spaceId).toBe('space-uuid-1');
    });

    it('emits spaceId: null and space: null when no Space is set', () => {
      const event = new CalendarEvent('evt-2', 'cal-1');
      event.space = null;

      const obj = event.toObject();

      expect(obj.space).toBeNull();
      expect(obj.spaceId).toBeNull();
    });

    it('emits locationId alongside location when a locationId is set', () => {
      const event = new CalendarEvent('evt-3', 'cal-1');
      event.locationId = 'loc-uuid-1';

      const obj = event.toObject();

      expect(obj.locationId).toBe('loc-uuid-1');
    });
  });

  describe('fromObject', () => {
    it('populates space from the space object on the wire', () => {
      const raw = {
        id: 'evt-1',
        calendarId: 'cal-1',
        space: {
          id: 'space-uuid-1',
          placeId: 'place-uuid-1',
          content: {},
        },
        spaceId: 'space-uuid-1',
      };

      const event = CalendarEvent.fromObject(raw);

      expect(event.space).toBeDefined();
      expect(event.space?.id).toBe('space-uuid-1');
      expect(event.space?.placeId).toBe('place-uuid-1');
    });

    it('round-trips a CalendarEvent with Space through toObject then fromObject', () => {
      const event = new CalendarEvent('evt-round', 'cal-1');
      const space = new EventLocationSpace('space-uuid-2', 'place-uuid-2');
      event.space = space;
      event.locationId = 'place-uuid-2';

      const obj = event.toObject();
      const restored = CalendarEvent.fromObject(obj);

      expect(restored.space?.id).toBe('space-uuid-2');
      expect(restored.space?.placeId).toBe('place-uuid-2');
      expect(restored.locationId).toBe('place-uuid-2');
    });

    it('round-trips a CalendarEvent without Space (whole venue)', () => {
      const event = new CalendarEvent('evt-whole', 'cal-1');
      event.space = null;
      event.locationId = 'place-uuid-3';

      const obj = event.toObject();
      const restored = CalendarEvent.fromObject(obj);

      expect(restored.space).toBeNull();
      expect(restored.locationId).toBe('place-uuid-3');
    });

    it('round-trips a CalendarEvent with no Place at all', () => {
      const event = new CalendarEvent('evt-noplace', 'cal-1');
      event.space = null;
      event.locationId = null;

      const obj = event.toObject();
      const restored = CalendarEvent.fromObject(obj);

      expect(restored.space).toBeNull();
      expect(restored.locationId).toBeNull();
    });
  });

  describe('dropped-language tombstones', () => {
    it('serializes a dropped language as null so the server deletes it', () => {
      const event = new CalendarEvent('evt-1', 'cal-1');
      event.addContent(new CalendarEventContent('en', 'Concert'));
      event.addContent(new CalendarEventContent('fr', 'Concert FR'));

      event.dropContent('fr');

      const obj = event.toObject();
      expect(obj.content).toHaveProperty('fr', null);
      expect(obj.content.en.name).toBe('Concert');
    });

    it('emits no tombstone for an event that has not been saved yet', () => {
      const event = new CalendarEvent('', 'cal-1');
      event.addContent(new CalendarEventContent('en', 'Concert'));
      event.addContent(new CalendarEventContent('fr', 'Concert FR'));

      event.dropContent('fr');

      expect(event.toObject().content).not.toHaveProperty('fr');
    });

    it('clears the tombstone when the language is added back', () => {
      const event = new CalendarEvent('evt-1', 'cal-1');
      event.addContent(new CalendarEventContent('fr', 'Concert FR'));
      event.dropContent('fr');

      event.content('fr').name = 'Concert encore';

      expect(event.toObject().content.fr.name).toBe('Concert encore');
    });

    it('round-trips a tombstone to an event without that language', () => {
      const event = new CalendarEvent('evt-1', 'cal-1');
      event.addContent(new CalendarEventContent('en', 'Concert'));
      event.addContent(new CalendarEventContent('fr', 'Concert FR'));
      event.dropContent('fr');

      const restored = CalendarEvent.fromObject(event.toObject());

      expect(restored.getLanguages()).toEqual(['en']);
    });
  });
});

/**
 * Unit tests for CalendarEventSchedule's zone on the wire.
 *
 * The process zone is pinned to America/New_York so a schedule zone of
 * America/Los_Angeles can only survive by being carried, never by matching
 * the machine running the tests.
 */
describe('CalendarEventSchedule zone', () => {
  const PROCESS_ZONE = 'America/New_York';
  let savedDefaultZone: typeof Settings.defaultZone;

  beforeEach(() => {
    savedDefaultZone = Settings.defaultZone;
    Settings.defaultZone = PROCESS_ZONE;
  });

  afterEach(() => {
    Settings.defaultZone = savedDefaultZone;
  });

  const laSchedule = (): CalendarEventSchedule => {
    const start = DateTime.fromISO('2026-10-27T10:15', { zone: 'America/Los_Angeles' });
    const schedule = new CalendarEventSchedule('sched-1', start, start.plus({ weeks: 8 }));
    schedule.eventEndTime = start.plus({ hours: 2 });
    schedule.frequency = EventFrequency.WEEKLY;
    schedule.interval = 1;
    return schedule;
  };

  it('toObject emits the start date zone as timezone', () => {
    expect(laSchedule().toObject().timezone).toBe('America/Los_Angeles');
  });

  it('toObject emits timezone: null when there is no start date', () => {
    expect(new CalendarEventSchedule('sched-empty').toObject().timezone).toBeNull();
  });

  it('round-trips America/Los_Angeles on start, end and eventEndTime with instants unchanged', () => {
    const original = laSchedule();

    const restored = CalendarEventSchedule.fromObject(original.toObject());

    expect(restored.startDate?.zoneName).toBe('America/Los_Angeles');
    expect(restored.endDate?.zoneName).toBe('America/Los_Angeles');
    expect(restored.eventEndTime?.zoneName).toBe('America/Los_Angeles');
    expect(restored.startDate?.toMillis()).toBe(original.startDate?.toMillis());
    expect(restored.endDate?.toMillis()).toBe(original.endDate?.toMillis());
    expect(restored.eventEndTime?.toMillis()).toBe(original.eventEndTime?.toMillis());
    expect(restored.startDate?.toFormat('HH:mm')).toBe('10:15');
  });

  it('applies the zone to UTC instants on the wire', () => {
    const restored = CalendarEventSchedule.fromObject({
      start: '2026-10-27T17:15:00.000Z',
      timezone: 'America/Los_Angeles',
    });

    expect(restored.startDate?.zoneName).toBe('America/Los_Angeles');
    expect(restored.startDate?.toFormat('HH:mm')).toBe('10:15');
  });

  it('parses a schedule with no timezone key exactly as before: process zone, same instant', () => {
    const wire = laSchedule().toObject();
    delete wire.timezone;

    const restored = CalendarEventSchedule.fromObject(wire);

    expect(restored.startDate?.zoneName).toBe(PROCESS_ZONE);
    expect(restored.endDate?.zoneName).toBe(PROCESS_ZONE);
    expect(restored.eventEndTime?.zoneName).toBe(PROCESS_ZONE);
    expect(restored.startDate?.toMillis()).toBe(laSchedule().startDate?.toMillis());
  });

  it.each([
    ['an unknown zone name', 'Not/AZone'],
    ['a fixed UTC offset', '+05:00'],
    ['a negative fixed offset', '-08:00'],
    ['a fixed offset written with a Unicode minus', '−08:00'],
    ['an empty string', ''],
    ['a non-string', 42],
    ['null', null],
  ])('falls back to the process zone without throwing for %s', (_label, timezone) => {
    const wire = { ...laSchedule().toObject(), timezone };

    const restored = CalendarEventSchedule.fromObject(wire);

    expect(restored.startDate?.isValid).toBe(true);
    expect(restored.startDate?.zoneName).toBe(PROCESS_ZONE);
    expect(restored.eventEndTime?.zoneName).toBe(PROCESS_ZONE);
    expect(restored.startDate?.toMillis()).toBe(laSchedule().startDate?.toMillis());
  });

  it.each([
    ['a case variant', 'america/los_angeles'],
    ['an upper-case variant', 'AMERICA/LOS_ANGELES'],
    ['a link alias', 'US/Pacific'],
  ])('canonicalizes %s to America/Los_Angeles', (_label, timezone) => {
    expect(CalendarEventSchedule.parseZone(timezone)).toBe('America/Los_Angeles');

    const restored = CalendarEventSchedule.fromObject({ ...laSchedule().toObject(), timezone });

    expect(restored.startDate?.zoneName).toBe('America/Los_Angeles');
    expect(restored.startDate?.toMillis()).toBe(laSchedule().startDate?.toMillis());
  });
});
