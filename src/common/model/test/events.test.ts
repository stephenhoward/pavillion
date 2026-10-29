import { describe, it, expect } from 'vitest';

import { CalendarEvent, CalendarEventContent } from '@/common/model/events';
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
