import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useBulkSelection } from '@/client/composables/useBulkSelection';
import { CalendarEvent } from '@/common/model/events';

describe('useBulkSelection', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('basic selection functionality', () => {
    it('should initialize with empty selection', () => {
      const { selectedEvents, selectedCount, hasSelection } = useBulkSelection();

      expect(selectedEvents.value).toEqual([]);
      expect(selectedCount.value).toBe(0);
      expect(hasSelection.value).toBe(false);
    });

    it('should select and deselect individual events', () => {
      const { selectedEvents, selectedCount, hasSelection, toggleEventSelection } = useBulkSelection();
      const event = new CalendarEvent('calendar-1', 'event-1');

      toggleEventSelection(event);
      expect(selectedEvents.value).toContain('event-1');
      expect(selectedCount.value).toBe(1);
      expect(hasSelection.value).toBe(true);

      toggleEventSelection(event);
      expect(selectedEvents.value).toEqual([]);
      expect(selectedCount.value).toBe(0);
      expect(hasSelection.value).toBe(false);
    });

    it('should check if event is selected', () => {
      const { isEventSelected, toggleEventSelection } = useBulkSelection();
      const event = new CalendarEvent('calendar-1', 'event-1');

      expect(isEventSelected(event)).toBe(false);

      toggleEventSelection(event);
      expect(isEventSelected(event)).toBe(true);
    });
  });

  describe('select all functionality', () => {
    it('should select all events from provided list', () => {
      const { selectedEvents, selectedCount, selectAll } = useBulkSelection();
      const events = [
        new CalendarEvent('calendar-1', 'event-1'),
        new CalendarEvent('calendar-1', 'event-2'),
        new CalendarEvent('calendar-1', 'event-3'),
      ];

      selectAll(events);

      expect(selectedEvents.value).toHaveLength(3);
      expect(selectedCount.value).toBe(3);
      expect(selectedEvents.value).toContain('event-1');
      expect(selectedEvents.value).toContain('event-2');
      expect(selectedEvents.value).toContain('event-3');
    });

    it('should deselect all events', () => {
      const { selectedEvents, selectedCount, selectAll, deselectAll } = useBulkSelection();
      const events = [
        new CalendarEvent('calendar-1', 'event-1'),
        new CalendarEvent('calendar-1', 'event-2'),
      ];

      selectAll(events);
      expect(selectedCount.value).toBe(2);

      deselectAll();
      expect(selectedEvents.value).toEqual([]);
      expect(selectedCount.value).toBe(0);
    });
  });

  describe('indeterminate state for select all checkbox', () => {
    it('should detect indeterminate state when some events are selected', () => {
      const { selectAllState, toggleEventSelection } = useBulkSelection();
      const events = [
        new CalendarEvent('calendar-1', 'event-1'),
        new CalendarEvent('calendar-1', 'event-2'),
        new CalendarEvent('calendar-1', 'event-3'),
      ];

      // Initially unchecked
      expect(selectAllState(events)).toEqual({ checked: false, indeterminate: false });

      // Select one event - should be indeterminate
      toggleEventSelection(events[0]);
      expect(selectAllState(events)).toEqual({ checked: false, indeterminate: true });

      // Select all events - should be checked
      toggleEventSelection(events[1]);
      toggleEventSelection(events[2]);
      expect(selectAllState(events)).toEqual({ checked: true, indeterminate: false });
    });
  });

  describe('bulk operations on selected events', () => {
    it('should provide selected event objects for bulk operations', () => {
      const { getSelectedEventObjects, toggleEventSelection } = useBulkSelection();
      const events = [
        new CalendarEvent('calendar-1', 'event-1'),
        new CalendarEvent('calendar-1', 'event-2'),
        new CalendarEvent('calendar-1', 'event-3'),
      ];

      toggleEventSelection(events[0]);
      toggleEventSelection(events[2]);

      const selectedEventObjects = getSelectedEventObjects(events);
      expect(selectedEventObjects).toHaveLength(2);
      expect(selectedEventObjects[0].id).toBe('event-1');
      expect(selectedEventObjects[1].id).toBe('event-3');
    });
  });
});
