import { describe, it, expect, beforeEach } from 'vitest';
import { EventEntity } from '../entity/event';
import { CalendarEvent } from '@/common/model/events';

describe('EventEntity Schema - AP Identifier Support', () => {
  let apIdentifier: string;
  let uuidIdentifier: string;

  beforeEach(() => {
    apIdentifier = 'https://example.com/o/testcalendar';
    uuidIdentifier = '123e4567-e89b-12d3-a456-426614174000';
  });

  it('should create EventEntity with STRING calendar_id (AP URL format)', async () => {
    const event = new CalendarEvent(apIdentifier, 'https://example.com/events/test-event-1', null);
    const eventEntity = EventEntity.fromModel(event);

    expect(eventEntity.calendar_id).toBe(apIdentifier);
    expect(typeof eventEntity.calendar_id).toBe('string');
    expect(eventEntity.calendar_id).toMatch(/^https:\/\//);
  });

  it('should create EventEntity with UUID calendar_id (backward compatibility during transition)', async () => {
    const event = new CalendarEvent(uuidIdentifier, 'https://example.com/events/test-event-2', null);
    const eventEntity = EventEntity.fromModel(event);

    expect(eventEntity.calendar_id).toBe(uuidIdentifier);
    expect(typeof eventEntity.calendar_id).toBe('string');
    expect(eventEntity.calendar_id).toMatch(/^[0-9a-f-]+$/);
  });

  it('should allow saving EventEntity with AP identifier calendar_id', async () => {
    const event = new CalendarEvent(apIdentifier, 'https://example.com/events/test-event-3', null);
    const eventEntity = EventEntity.fromModel(event);

    // Build the entity (this validates schema compatibility)
    const built = EventEntity.build({
      id: event.id,
      calendar_id: apIdentifier,
      event_source_url: event.eventSourceUrl,
    });

    expect(built.calendar_id).toBe(apIdentifier);
    expect(built.id).toBe(event.id);
  });

  it('should support toModel conversion with AP identifier calendar_id', () => {
    const eventEntity = EventEntity.build({
      id: 'https://example.com/events/test-event-4',
      calendar_id: apIdentifier,
      event_source_url: '/testcalendar/test-event-4',
    });

    const model = eventEntity.toModel();

    expect(model.calendarId).toBe(apIdentifier);
    expect(model.id).toBe('https://example.com/events/test-event-4');
  });
});
