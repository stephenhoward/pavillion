import { describe, test, expect } from 'vitest';
import { CalendarEvent, URL_PROMPT_VALUES, UrlPrompt } from '@/common/model/events';
import { InvalidExternalUrlError } from '@/common/exceptions/calendar';

describe('CalendarEvent Model - externalUrl and urlPrompt', () => {
  test('externalUrl defaults to null', () => {
    const event = new CalendarEvent('event-123', 'cal-456');
    expect(event.externalUrl).toBeNull();
  });

  test('urlPrompt defaults to null', () => {
    const event = new CalendarEvent('event-123', 'cal-456');
    expect(event.urlPrompt).toBeNull();
  });

  test('URL_PROMPT_VALUES contains the four supported prompts', () => {
    expect(URL_PROMPT_VALUES).toEqual(['tickets', 'rsvp', 'more_info', 'register']);
  });

  test('toObject emits externalUrl and urlPrompt when set', () => {
    const event = new CalendarEvent('event-123', 'cal-456');
    event.externalUrl = 'https://example.com/tickets';
    event.urlPrompt = 'tickets';

    const obj = event.toObject();

    expect(obj.externalUrl).toBe('https://example.com/tickets');
    expect(obj.urlPrompt).toBe('tickets');
  });

  test('toObject emits null fields when not set', () => {
    const event = new CalendarEvent('event-123', 'cal-456');

    const obj = event.toObject();

    expect(obj.externalUrl).toBeNull();
    expect(obj.urlPrompt).toBeNull();
  });

  test('fromObject reads externalUrl and urlPrompt', () => {
    const obj = {
      id: 'event-123',
      calendarId: 'cal-456',
      externalUrl: 'https://example.com/rsvp',
      urlPrompt: 'rsvp',
      date: '2024-06-15',
      content: {},
      schedules: [],
    };

    const event = CalendarEvent.fromObject(obj);

    expect(event.externalUrl).toBe('https://example.com/rsvp');
    expect(event.urlPrompt).toBe('rsvp');
  });

  test('fromObject defaults externalUrl and urlPrompt to null when absent', () => {
    const obj = {
      id: 'event-123',
      calendarId: 'cal-456',
      date: '2024-06-15',
      content: {},
      schedules: [],
    };

    const event = CalendarEvent.fromObject(obj);

    expect(event.externalUrl).toBeNull();
    expect(event.urlPrompt).toBeNull();
  });

  test('fromObject handles explicit null values', () => {
    const obj = {
      id: 'event-123',
      calendarId: 'cal-456',
      externalUrl: null,
      urlPrompt: null,
      date: '2024-06-15',
      content: {},
      schedules: [],
    };

    const event = CalendarEvent.fromObject(obj);

    expect(event.externalUrl).toBeNull();
    expect(event.urlPrompt).toBeNull();
  });

  test('fromObject sanitizes invalid urlPrompt to null', () => {
    const obj = {
      id: 'event-123',
      calendarId: 'cal-456',
      externalUrl: 'https://example.com',
      urlPrompt: 'not_a_real_prompt',
      date: '2024-06-15',
      content: {},
      schedules: [],
    };

    const event = CalendarEvent.fromObject(obj);

    expect(event.externalUrl).toBe('https://example.com');
    expect(event.urlPrompt).toBeNull();
  });

  test('fromObject sanitizes non-string urlPrompt to null', () => {
    const obj = {
      id: 'event-123',
      calendarId: 'cal-456',
      urlPrompt: 42,
      date: '2024-06-15',
      content: {},
      schedules: [],
    };

    const event = CalendarEvent.fromObject(obj);

    expect(event.urlPrompt).toBeNull();
  });

  test.each(URL_PROMPT_VALUES)('round-trip preserves urlPrompt=%s', (prompt: UrlPrompt) => {
    const original = new CalendarEvent('event-123', 'cal-456');
    original.externalUrl = 'https://example.com/link';
    original.urlPrompt = prompt;

    const roundTrip = CalendarEvent.fromObject(original.toObject());

    expect(roundTrip.externalUrl).toBe('https://example.com/link');
    expect(roundTrip.urlPrompt).toBe(prompt);
  });

  test('round-trip preserves null externalUrl and urlPrompt', () => {
    const original = new CalendarEvent('event-123', 'cal-456');

    const roundTrip = CalendarEvent.fromObject(original.toObject());

    expect(roundTrip.externalUrl).toBeNull();
    expect(roundTrip.urlPrompt).toBeNull();
  });
});

describe('InvalidExternalUrlError', () => {
  test('has default message', () => {
    const err = new InvalidExternalUrlError();
    expect(err.message).toBe('invalid external url');
    expect(err.name).toBe('InvalidExternalUrlError');
  });

  test('accepts custom message', () => {
    const err = new InvalidExternalUrlError('custom message');
    expect(err.message).toBe('custom message');
  });

  test('is an instance of Error and InvalidExternalUrlError', () => {
    const err = new InvalidExternalUrlError();
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(InvalidExternalUrlError);
  });
});
