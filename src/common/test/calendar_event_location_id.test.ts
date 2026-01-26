import { describe, test, expect } from 'vitest';
import { CalendarEvent } from '@/common/model/events';
import { EventLocation } from '@/common/model/location';

describe('CalendarEvent Model - locationId Property', () => {
  test('creates event with locationId', () => {
    const event = new CalendarEvent('event-123', 'cal-456');
    event.locationId = 'https://pavillion.dev/places/loc-789';

    expect(event.locationId).toBe('https://pavillion.dev/places/loc-789');
  });

  test('locationId defaults to null', () => {
    const event = new CalendarEvent('event-123', 'cal-456');

    expect(event.locationId).toBeNull();
  });

  test('toObject includes locationId when set', () => {
    const event = new CalendarEvent('event-123', 'cal-456');
    event.locationId = 'https://pavillion.dev/places/loc-789';

    const obj = event.toObject();

    expect(obj.locationId).toBe('https://pavillion.dev/places/loc-789');
  });

  test('toObject includes null locationId when not set', () => {
    const event = new CalendarEvent('event-123', 'cal-456');

    const obj = event.toObject();

    expect(obj.locationId).toBeNull();
  });

  test('fromObject correctly deserializes locationId', () => {
    const obj = {
      id: 'event-123',
      calendarId: 'cal-456',
      locationId: 'https://pavillion.dev/places/loc-789',
      date: '2024-06-15',
      content: {},
      schedules: [],
    };

    const event = CalendarEvent.fromObject(obj);

    expect(event.locationId).toBe('https://pavillion.dev/places/loc-789');
  });

  test('fromObject handles null locationId', () => {
    const obj = {
      id: 'event-123',
      calendarId: 'cal-456',
      locationId: null,
      date: '2024-06-15',
      content: {},
      schedules: [],
    };

    const event = CalendarEvent.fromObject(obj);

    expect(event.locationId).toBeNull();
  });

  test('fromObject handles missing locationId', () => {
    const obj = {
      id: 'event-123',
      calendarId: 'cal-456',
      date: '2024-06-15',
      content: {},
      schedules: [],
    };

    const event = CalendarEvent.fromObject(obj);

    expect(event.locationId).toBeNull();
  });

  test('round-trip conversion preserves locationId', () => {
    const original = new CalendarEvent('event-123', 'cal-456');
    original.locationId = 'https://pavillion.dev/places/loc-999';

    const obj = original.toObject();
    const roundTrip = CalendarEvent.fromObject(obj);

    expect(roundTrip.locationId).toBe(original.locationId);
  });

  test('event can have both location and locationId during transition period', () => {
    const event = new CalendarEvent('event-123', 'cal-456');
    event.locationId = 'https://pavillion.dev/places/loc-789';
    event.location = new EventLocation(
      'https://pavillion.dev/places/loc-789',
      'Washington Park',
      '4033 SW Canyon Rd',
    );

    expect(event.locationId).toBe('https://pavillion.dev/places/loc-789');
    expect(event.location).toBeInstanceOf(EventLocation);
    expect(event.location?.id).toBe('https://pavillion.dev/places/loc-789');
  });

  test('toObject serializes both location and locationId when both present', () => {
    const event = new CalendarEvent('event-123', 'cal-456');
    event.locationId = 'https://pavillion.dev/places/loc-789';
    event.location = new EventLocation(
      'https://pavillion.dev/places/loc-789',
      'Washington Park',
      '4033 SW Canyon Rd',
    );

    const obj = event.toObject();

    expect(obj.locationId).toBe('https://pavillion.dev/places/loc-789');
    expect(obj.location).toBeDefined();
    expect(obj.location.id).toBe('https://pavillion.dev/places/loc-789');
  });
});
