import { ref, computed } from 'vue';
import { CalendarEvent } from '@/common/model/events';

export function useBulkSelection() {
  const selectedEvents = ref<string[]>([]);

  const selectedCount = computed(() => selectedEvents.value.length);
  const hasSelection = computed(() => selectedCount.value > 0);

  /**
   * Toggle selection of a single event
   */
  const toggleEventSelection = (event: CalendarEvent) => {
    const eventId = event.id;
    const index = selectedEvents.value.indexOf(eventId);

    if (index >= 0) {
      selectedEvents.value.splice(index, 1);
    }
    else {
      selectedEvents.value.push(eventId);
    }
  };

  /**
   * Check if an event is selected
   */
  const isEventSelected = (event: CalendarEvent) => {
    return selectedEvents.value.includes(event.id);
  };

  /**
   * Select all events from the provided list
   */
  const selectAll = (events: CalendarEvent[]) => {
    selectedEvents.value = events.map(event => event.id);
  };

  /**
   * Deselect all events
   */
  const deselectAll = () => {
    selectedEvents.value = [];
  };

  /**
   * Get the state of the select all checkbox (for indeterminate state)
   */
  const selectAllState = (events: CalendarEvent[]) => {
    const totalEvents = events.length;
    const selectedCount = selectedEvents.value.filter(id =>
      events.some(event => event.id === id),
    ).length;

    if (selectedCount === 0) {
      return { checked: false, indeterminate: false };
    }
    else if (selectedCount === totalEvents) {
      return { checked: true, indeterminate: false };
    }
    else {
      return { checked: false, indeterminate: true };
    }
  };

  /**
   * Get selected event objects for bulk operations
   */
  const getSelectedEventObjects = (events: CalendarEvent[]) => {
    return events.filter(event => selectedEvents.value.includes(event.id));
  };

  /**
   * Toggle select all - if all are selected, deselect all; otherwise select all
   */
  const toggleSelectAll = (events: CalendarEvent[]) => {
    const state = selectAllState(events);
    if (state.checked) {
      deselectAll();
    }
    else {
      selectAll(events);
    }
  };

  return {
    selectedEvents: selectedEvents,
    selectedCount,
    hasSelection,
    toggleEventSelection,
    isEventSelected,
    selectAll,
    deselectAll,
    selectAllState,
    getSelectedEventObjects,
    toggleSelectAll,
  };
}
