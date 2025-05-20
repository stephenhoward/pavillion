import { defineStore } from 'pinia';
import { CalendarEvent } from '@/common/model/events';

export const useEventStore = defineStore('events', {
  state: () => {
    return {
      events: [] as CalendarEvent[],
    };
  },
  actions: {
    /**
     * Adds a new calendar event to the store.
     *
     * @param {CalendarEvent} event - The event to add to the store
     */
    addEvent(event: CalendarEvent) {
      this.events.push(event);
    },

    /**
     * Updates an existing event in the store or adds it if not found.
     *
     * @param {CalendarEvent} event - The event to update or add
     */
    updateEvent(event: CalendarEvent) {
      const index = this.events.findIndex((e: CalendarEvent) => e.id === event.id );
      if ( index >= 0 ) {
        this.events[index] = event;
      }
      else {
        this.addEvent(event);
      }
    },
    /**
     * Set events in the store
     * @param events - The events to set in the store
     */
    setEvents(events: CalendarEvent[]) {
      this.events = events;
    },
  },
});
