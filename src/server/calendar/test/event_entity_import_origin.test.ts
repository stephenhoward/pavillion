import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { EventEntity } from '@/server/calendar/entity/event';
import { CalendarEvent } from '@/common/model/events';

/**
 * ICS-import origin column tests for EventEntity.
 *
 * Verifies that:
 * 1. Origin columns can be set/built on the entity.
 * 2. Round-trip (fromModel → toModel) preserves every origin field.
 * 3. Origin metadata is NEVER included in `CalendarEvent.toObject()` output
 *    (privacy: provenance must not leak into public API or AP output).
 *
 * @see bead pv-1qcp.1.2
 * @see migration 0028_add_event_import_origin_columns.ts
 */
describe('EventEntity - ICS import origin columns', () => {
  const calendarId = '123e4567-e89b-12d3-a456-426614174000';
  const eventId = '987e6543-e21b-45d3-b789-426614174999';
  const importSourceId = uuidv4();

  it('persists origin columns through fromModel()', () => {
    const sourceLastModified = new Date('2026-04-22T10:00:00Z');
    const sourceLastSeenAt = new Date('2026-04-22T12:00:00Z');
    const event = new CalendarEvent(eventId, calendarId, '/cal/event-1');
    event.importSourceId = importSourceId;
    event.externalUid = 'upstream-uid-xyz@example.com';
    event.externalRecurrenceId = '20260422T100000Z';
    event.sourceLastModified = sourceLastModified;
    event.sourceLastSeenAt = sourceLastSeenAt;
    event.locallyEdited = false;
    event.xProps = { 'X-FOO': 'bar' };

    const entity = EventEntity.fromModel(event);

    expect(entity.import_source_id).toBe(importSourceId);
    expect(entity.external_uid).toBe('upstream-uid-xyz@example.com');
    expect(entity.external_recurrence_id).toBe('20260422T100000Z');
    expect(entity.source_last_modified).toEqual(sourceLastModified);
    expect(entity.source_last_seen_at).toEqual(sourceLastSeenAt);
    expect(entity.locally_edited).toBe(false);
    expect(entity.x_props).toEqual({ 'X-FOO': 'bar' });
  });

  it('populates origin columns on toModel()', () => {
    const sourceLastModified = new Date('2026-04-22T10:00:00Z');
    const entity = EventEntity.build({
      id: eventId,
      calendar_id: calendarId,
      event_source_url: '/cal/event-1',
      import_source_id: importSourceId,
      external_uid: 'upstream-uid@example.com',
      external_recurrence_id: null,
      source_last_modified: sourceLastModified,
      source_last_seen_at: null,
      locally_edited: true,
      x_props: { 'X-BAR': 'baz' },
    });

    const model = entity.toModel();

    expect(model.importSourceId).toBe(importSourceId);
    expect(model.externalUid).toBe('upstream-uid@example.com');
    expect(model.externalRecurrenceId).toBeNull();
    expect(model.sourceLastModified).toEqual(sourceLastModified);
    expect(model.sourceLastSeenAt).toBeNull();
    expect(model.locallyEdited).toBe(true);
    expect(model.xProps).toEqual({ 'X-BAR': 'baz' });
  });

  it('defaults origin columns safely when an event has no import origin', () => {
    const entity = EventEntity.build({
      id: eventId,
      calendar_id: calendarId,
      event_source_url: '/cal/event-1',
    });

    const model = entity.toModel();

    expect(model.importSourceId).toBeNull();
    expect(model.externalUid).toBeNull();
    expect(model.externalRecurrenceId).toBeNull();
    expect(model.sourceLastModified).toBeNull();
    expect(model.sourceLastSeenAt).toBeNull();
    expect(model.locallyEdited).toBe(false);
    expect(model.xProps).toBeNull();
  });

  it('round-trips every origin field through fromModel → toModel', () => {
    const sourceLastModified = new Date('2026-04-22T10:00:00Z');
    const sourceLastSeenAt = new Date('2026-04-22T12:00:00Z');
    const original = new CalendarEvent(eventId, calendarId, '/cal/event-1');
    original.importSourceId = importSourceId;
    original.externalUid = 'upstream-uid@example.com';
    original.externalRecurrenceId = '20260422T100000Z';
    original.sourceLastModified = sourceLastModified;
    original.sourceLastSeenAt = sourceLastSeenAt;
    original.locallyEdited = true;
    original.xProps = { 'X-CUSTOM': 'value' };

    const entity = EventEntity.fromModel(original);
    const roundTrip = entity.toModel();

    expect(roundTrip.importSourceId).toBe(original.importSourceId);
    expect(roundTrip.externalUid).toBe(original.externalUid);
    expect(roundTrip.externalRecurrenceId).toBe(original.externalRecurrenceId);
    expect(roundTrip.sourceLastModified).toEqual(original.sourceLastModified);
    expect(roundTrip.sourceLastSeenAt).toEqual(original.sourceLastSeenAt);
    expect(roundTrip.locallyEdited).toBe(original.locallyEdited);
    expect(roundTrip.xProps).toEqual(original.xProps);
  });

  describe('privacy: origin metadata never leaks into public toObject()', () => {
    it('omits every origin field from CalendarEvent.toObject()', () => {
      const event = new CalendarEvent(eventId, calendarId, '/cal/event-1');
      event.importSourceId = importSourceId;
      event.externalUid = 'upstream-uid@example.com';
      event.externalRecurrenceId = '20260422T100000Z';
      event.sourceLastModified = new Date('2026-04-22T10:00:00Z');
      event.sourceLastSeenAt = new Date('2026-04-22T12:00:00Z');
      event.locallyEdited = true;
      event.xProps = { 'X-SECRET': 'do-not-leak' };

      const obj = event.toObject();

      expect(obj).not.toHaveProperty('importSourceId');
      expect(obj).not.toHaveProperty('externalUid');
      expect(obj).not.toHaveProperty('externalRecurrenceId');
      expect(obj).not.toHaveProperty('sourceLastModified');
      expect(obj).not.toHaveProperty('sourceLastSeenAt');
      expect(obj).not.toHaveProperty('locallyEdited');
      expect(obj).not.toHaveProperty('xProps');
      // Also guard against accidental snake_case leakage.
      expect(obj).not.toHaveProperty('import_source_id');
      expect(obj).not.toHaveProperty('external_uid');
      expect(obj).not.toHaveProperty('x_props');
    });

    it('origin fields are also absent after round-trip through fromObject/toObject', () => {
      const event = new CalendarEvent(eventId, calendarId, '/cal/event-1');
      event.importSourceId = importSourceId;
      event.externalUid = 'upstream@example.com';
      event.locallyEdited = true;

      const obj = event.toObject();
      const rehydrated = CalendarEvent.fromObject(obj);

      // fromObject does not read origin fields (they were not serialized);
      // the rehydrated model must default to a blank origin state.
      expect(rehydrated.importSourceId).toBeNull();
      expect(rehydrated.externalUid).toBeNull();
      expect(rehydrated.locallyEdited).toBe(false);
    });
  });
});
