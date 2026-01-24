import { describe, it, expect, beforeEach } from 'vitest';
import { EventEntity } from '../entity/event';
import { CalendarEvent } from '@/common/model/events';

describe('EventEntity Schema - Calendar ID Support', () => {
  let uuidIdentifier: string;
  let eventId: string;

  beforeEach(() => {
    uuidIdentifier = '123e4567-e89b-12d3-a456-426614174000';
    eventId = '987e6543-e21b-45d3-b789-426614174999';
  });

  it('should create EventEntity with UUID calendar_id for local events', async () => {
    const event = new CalendarEvent(eventId, uuidIdentifier, '/testcalendar/event-1');
    const eventEntity = EventEntity.fromModel(event);

    expect(eventEntity.calendar_id).toBe(uuidIdentifier);
    expect(typeof eventEntity.calendar_id).toBe('string');
    expect(eventEntity.calendar_id).toMatch(/^[0-9a-f-]+$/i);
  });

  it('should create EventEntity with null calendar_id for remote events', async () => {
    const event = new CalendarEvent(eventId, null, 'https://remote.example.com/events/123');
    const eventEntity = EventEntity.fromModel(event);

    expect(eventEntity.calendar_id).toBeNull();
  });

  it('should allow building EventEntity with UUID calendar_id', async () => {
    const built = EventEntity.build({
      id: eventId,
      calendar_id: uuidIdentifier,
      event_source_url: '/testcalendar/event-1',
    });

    expect(built.calendar_id).toBe(uuidIdentifier);
    expect(built.id).toBe(eventId);
  });

  it('should allow building EventEntity with null calendar_id (remote event)', async () => {
    const built = EventEntity.build({
      id: eventId,
      calendar_id: null,
      event_source_url: 'https://remote.example.com/events/123',
    });

    expect(built.calendar_id).toBeNull();
    expect(built.id).toBe(eventId);
  });

  it('should convert toModel with UUID calendar_id', () => {
    const eventEntity = EventEntity.build({
      id: eventId,
      calendar_id: uuidIdentifier,
      event_source_url: '/testcalendar/event-1',
    });

    const model = eventEntity.toModel();

    expect(model.calendarId).toBe(uuidIdentifier);
    expect(model.id).toBe(eventId);
    expect(model.isLocal()).toBe(true);
    expect(model.isRemote()).toBe(false);
  });

  it('should convert toModel with null calendar_id (remote event)', () => {
    const eventEntity = EventEntity.build({
      id: eventId,
      calendar_id: null,
      event_source_url: 'https://remote.example.com/events/123',
    });

    const model = eventEntity.toModel();

    expect(model.calendarId).toBeNull();
    expect(model.id).toBe(eventId);
    expect(model.isLocal()).toBe(false);
    expect(model.isRemote()).toBe(true);
  });
});
