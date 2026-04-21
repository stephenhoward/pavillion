import { defineStore } from 'pinia';
import { CalendarEvent } from '@/common/model/events';

export const useEventStore = defineStore('events', {
  state: () => {
    return {
      events: {} as Record<string, CalendarEvent[]>,
    };
  },
  actions: {
    /**
     * Adds a new calendar event to the store.
     *
     * @param {string} calendarId - The ID of the calendar to which the event belongs
     * @param {CalendarEvent} event - The event to add to the store
     */
    addEvent(calendarId: string, event: CalendarEvent) {
      if (!this.events[calendarId]) {
        this.events[calendarId] = [];
      }
      this.events[calendarId].push(event);
    },

    /**
     * Updates an existing event in the store or adds it if not found.
     *
     * @param {string} calendarId - The ID of the calendar to which the event belongs
     * @param {CalendarEvent} event - The event to update or add
     */
    updateEvent(calendarId: string, event: CalendarEvent) {
      if (!this.events[calendarId]) {
        this.events[calendarId] = [];
      }
      const index = this.events[calendarId].findIndex((e: CalendarEvent) => e.id === event.id );
      if ( index >= 0 ) {
        this.events[calendarId][index] = event;
      }
      else {
        this.addEvent(calendarId, event);
      }
    },
    /**
     * Set events in the store
     * @param calendarId - The ID of the calendar to which the events belong
     * @param events - The events to set in the store
     */
    setEventsForCalendar(calendarId: string, events: CalendarEvent[]) {
      this.events[calendarId] = events;
    },

    /**
     * Remove an event from the store
     * @param calendarId - The ID of the calendar to which the event belongs
     * @param event - The event to remove
     */
    removeEvent(calendarId: string, event: CalendarEvent) {
      if (this.events[calendarId]) {
        this.events[calendarId] = this.events[calendarId].filter(
          (e: CalendarEvent) => e.id !== event.id,
        );
      }
    },
  },
  getters: {
    /**
     * Get events for a specific calendar
     * @param state - The store state
     * @returns Function that returns events for a calendar ID or empty array
     */
    eventsForCalendar: (state) => (calendarId: string) => {
      return state.events[calendarId] || [];
    },
  },
});
