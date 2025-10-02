import { expect, describe, it } from 'vitest';
import { CalendarEvent, CalendarEventSchedule } from '@/common/model/events';
import { EventLocation } from '@/common/model/location';
import { Media } from '@/common/model/media';
import { EventCategory } from '@/common/model/event_category';
import { DateTime } from 'luxon';
import { useEventDuplication } from '@/client/composables/useEventDuplication';

describe('useEventDuplication', () => {
  const { stripEventForDuplication } = useEventDuplication();

  it('strips event ID for duplication', () => {
    const sourceEvent = new CalendarEvent('calendarId', 'originalEventId');
    sourceEvent.content('en').name = 'Original Event';

    const duplicatedEvent = stripEventForDuplication(sourceEvent);

    expect(duplicatedEvent.id).toBe('');
    expect(duplicatedEvent.content('en').name).toBe('Original Event');
  });

  it('strips schedule IDs', () => {
    const sourceEvent = new CalendarEvent('calendarId', 'eventId');
    const schedule = new CalendarEventSchedule('scheduleId', DateTime.now(), DateTime.now().plus({ hours: 2 }));
    sourceEvent.schedules = [schedule];

    const duplicatedEvent = stripEventForDuplication(sourceEvent);

    expect(duplicatedEvent.schedules).toHaveLength(1);
    expect(duplicatedEvent.schedules[0].id).toBe('');
    expect(duplicatedEvent.schedules[0].startDate).toEqual(schedule.startDate);
  });

  it('preserves media references', () => {
    const sourceEvent = new CalendarEvent('calendarId', 'eventId');
    sourceEvent.media = new Media('mediaId', 'image.jpg', 'image/jpeg', 1024);
    sourceEvent.mediaId = 'mediaId';

    const duplicatedEvent = stripEventForDuplication(sourceEvent);

    expect(duplicatedEvent.media).toEqual(sourceEvent.media);
    expect(duplicatedEvent.mediaId).toBe('mediaId');
  });

  it('clears event source URL', () => {
    const sourceEvent = new CalendarEvent('calendarId', 'eventId', 'testDate', 'http://example.com/event');

    const duplicatedEvent = stripEventForDuplication(sourceEvent);

    expect(duplicatedEvent.eventSourceUrl).toBe('');
  });

  it('preserves categories', () => {
    const sourceEvent = new CalendarEvent('calendarId', 'eventId');
    sourceEvent.categories = [new EventCategory('categoryId', 'calendarId')];

    const duplicatedEvent = stripEventForDuplication(sourceEvent);

    expect(duplicatedEvent.categories).toHaveLength(1);
    expect(duplicatedEvent.categories[0]).toEqual(sourceEvent.categories[0]);
  });

  it('preserves event content and location', () => {
    const sourceEvent = new CalendarEvent('calendarId', 'eventId');
    sourceEvent.content('en').name = 'Test Event';
    sourceEvent.content('en').description = 'Test Description';
    sourceEvent.location = new EventLocation('locationId', 'Test Location');
    sourceEvent.location.address = '123 Test St';

    const duplicatedEvent = stripEventForDuplication(sourceEvent);

    expect(duplicatedEvent.content('en').name).toBe('Test Event');
    expect(duplicatedEvent.content('en').description).toBe('Test Description');
    expect(duplicatedEvent.location?.name).toBe('Test Location');
    expect(duplicatedEvent.location?.address).toBe('123 Test St');
  });

  it('preserves calendar ID', () => {
    const sourceEvent = new CalendarEvent('originalCalendarId', 'eventId');

    const duplicatedEvent = stripEventForDuplication(sourceEvent);

    expect(duplicatedEvent.calendarId).toBe('originalCalendarId');
  });

  it('does not modify original event', () => {
    const sourceEvent = new CalendarEvent('calendarId', 'originalEventId');
    sourceEvent.content('en').name = 'Original Event';
    sourceEvent.mediaId = 'mediaId';

    stripEventForDuplication(sourceEvent);

    // Original event should be unchanged
    expect(sourceEvent.id).toBe('originalEventId');
    expect(sourceEvent.mediaId).toBe('mediaId');
    expect(sourceEvent.content('en').name).toBe('Original Event');
  });
});
