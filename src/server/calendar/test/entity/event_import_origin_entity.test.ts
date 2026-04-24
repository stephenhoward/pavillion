import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { CalendarEvent } from '@/common/model/events';
import { EventEntity } from '@/server/calendar/entity/event';
import { EventImportOriginEntity } from '@/server/calendar/entity/event_import_origin';
import { ImportSourceEntity } from '@/server/calendar/entity/import_source';

/**
 * Entity-level tests for the EventImportOriginEntity sibling table.
 *
 * Covers:
 * 1. Column shape (required columns declared, types populated via build()).
 * 2. Default value for `locally_edited` = false.
 * 3. @BelongsTo associations target EventEntity and ImportSourceEntity
 *    via `event_id` and `import_source_id` respectively.
 * 4. Structural privacy invariant: an origin row carries the 7 provenance
 *    fields; the corresponding CalendarEvent (round-tripped through
 *    fromObject/toObject) never surfaces them.
 *
 * There is deliberately no toModel/fromModel on this entity — the table is
 * service-consumed only and never serialized over the wire. The pv-picz.2
 * testing-auditor flagged that any "privacy" assertion using an ad-hoc
 * property set on a bare object literal was tautological; the real-entity
 * CalendarEvent round-trip below is the assertion that has teeth.
 *
 * @see bead pv-picz.1 (entity introduction)
 * @see bead pv-picz.2 (EventEntity + CalendarEvent origin-column removal)
 * @see migration 0028_create_event_import_origin.ts
 */
describe('EventImportOriginEntity', () => {
  describe('column shape', () => {
    it('exposes every origin-provenance column on build()', () => {
      const id = uuidv4();
      const eventId = uuidv4();
      const importSourceId = uuidv4();
      const sourceLastModified = new Date('2026-04-22T10:00:00Z');
      const sourceLastSeenAt = new Date('2026-04-22T12:00:00Z');

      const entity = EventImportOriginEntity.build({
        id,
        event_id: eventId,
        import_source_id: importSourceId,
        external_uid: 'upstream-uid@example.com',
        external_recurrence_id: '20260422T100000Z',
        source_last_modified: sourceLastModified,
        source_last_seen_at: sourceLastSeenAt,
        locally_edited: true,
        x_props: { 'X-FOO': 'bar' },
      });

      expect(entity.id).toBe(id);
      expect(entity.event_id).toBe(eventId);
      expect(entity.import_source_id).toBe(importSourceId);
      expect(entity.external_uid).toBe('upstream-uid@example.com');
      expect(entity.external_recurrence_id).toBe('20260422T100000Z');
      expect(entity.source_last_modified).toEqual(sourceLastModified);
      expect(entity.source_last_seen_at).toEqual(sourceLastSeenAt);
      expect(entity.locally_edited).toBe(true);
      expect(entity.x_props).toEqual({ 'X-FOO': 'bar' });
    });

    it('accepts nullable origin columns (recurrence, modified, seen, x_props)', () => {
      const entity = EventImportOriginEntity.build({
        id: uuidv4(),
        event_id: uuidv4(),
        import_source_id: uuidv4(),
        external_uid: 'upstream-uid@example.com',
        external_recurrence_id: null,
        source_last_modified: null,
        source_last_seen_at: null,
        x_props: null,
      });

      expect(entity.external_recurrence_id).toBeNull();
      expect(entity.source_last_modified).toBeNull();
      expect(entity.source_last_seen_at).toBeNull();
      expect(entity.x_props).toBeNull();
    });
  });

  describe('default values', () => {
    it('defaults locally_edited to false when omitted on build()', () => {
      const entity = EventImportOriginEntity.build({
        id: uuidv4(),
        event_id: uuidv4(),
        import_source_id: uuidv4(),
        external_uid: 'upstream-uid@example.com',
      });

      expect(entity.locally_edited).toBe(false);
    });
  });

  describe('associations', () => {
    it('declares a @BelongsTo association to EventEntity on event_id', () => {
      const associations = (EventImportOriginEntity as unknown as { associations: Record<string, any> }).associations;
      const eventAssoc = associations.event;
      expect(eventAssoc).toBeDefined();
      expect(eventAssoc.associationType).toBe('BelongsTo');
      expect(eventAssoc.target).toBe(EventEntity);
      expect(eventAssoc.foreignKey).toBe('event_id');
    });

    it('declares a @BelongsTo association to ImportSourceEntity on import_source_id', () => {
      const associations = (EventImportOriginEntity as unknown as { associations: Record<string, any> }).associations;
      const sourceAssoc = associations.importSource;
      expect(sourceAssoc).toBeDefined();
      expect(sourceAssoc.associationType).toBe('BelongsTo');
      expect(sourceAssoc.target).toBe(ImportSourceEntity);
      expect(sourceAssoc.foreignKey).toBe('import_source_id');
    });
  });

  describe('privacy invariant: origin provenance never surfaces on the event model', () => {
    it('origin-row construction does not attach provenance fields to CalendarEvent.toObject()', () => {
      // Build a real origin row for a specific event id.
      const eventId = uuidv4();
      const origin = EventImportOriginEntity.build({
        id: uuidv4(),
        event_id: eventId,
        import_source_id: uuidv4(),
        external_uid: 'upstream@example.com',
        external_recurrence_id: '20260422T100000Z',
        source_last_modified: new Date('2026-04-22T10:00:00Z'),
        source_last_seen_at: new Date('2026-04-22T12:00:00Z'),
        locally_edited: true,
        x_props: { 'X-SECRET': 'do-not-leak' },
      });
      void origin; // row exists; no mutation of the event is attempted.

      // Construct the matching CalendarEvent via fromObject — the same path
      // the API layer uses when serializing to the wire. The 7 origin
      // provenance fields must never appear on the object.
      const event = CalendarEvent.fromObject({
        id: eventId,
        calendarId: uuidv4(),
        eventSourceUrl: '/cal/event-1',
      });
      const obj = event.toObject();

      expect(obj).not.toHaveProperty('importSourceId');
      expect(obj).not.toHaveProperty('externalUid');
      expect(obj).not.toHaveProperty('externalRecurrenceId');
      expect(obj).not.toHaveProperty('sourceLastModified');
      expect(obj).not.toHaveProperty('sourceLastSeenAt');
      expect(obj).not.toHaveProperty('locallyEdited');
      expect(obj).not.toHaveProperty('xProps');
      // Snake-case guard.
      expect(obj).not.toHaveProperty('import_source_id');
      expect(obj).not.toHaveProperty('external_uid');
      expect(obj).not.toHaveProperty('x_props');
    });
  });
});
