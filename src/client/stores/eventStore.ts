import { defineStore } from 'pinia';
import { CalendarEvent } from '@/common/model/events';
import CalendarEventInstance from '@/common/model/event_instance';

export const useEventStore = defineStore('events', {
  state: () => {
    return {
      events: {} as Record<string, CalendarEvent[]>,
      // Materialized event occurrences keyed by event id. Populated on demand
      // by components that need to operate on individual instances (e.g. the
      // per-event cancellation panel). The in-place update actions allow the
      // UI to reflect cancel/restore mutations without a full refetch.
      instances: {} as Record<string, CalendarEventInstance[]>,
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

    /**
     * Replace the cached list of instances for a given event id.
     *
     * @param eventId - The event whose instance cache should be replaced
     * @param instances - The instances to cache under that event id
     */
    setInstancesForEvent(eventId: string, instances: CalendarEventInstance[]) {
      this.instances[eventId] = instances;
    },

    /**
     * Update a single cached instance in place by id. Silent no-op when the
     * event has no cached instances or when the instance id is not present.
     *
     * Used by cancel/restore flows to reflect the server's updated instance
     * state without refetching the full list.
     *
     * @param eventId - The event whose instance cache holds the target
     * @param instance - The updated instance to write back into the cache
     */
    updateInstance(eventId: string, instance: CalendarEventInstance) {
      const cached = this.instances[eventId];
      if (!cached) {
        return;
      }
      const index = cached.findIndex((i: CalendarEventInstance) => i.id === instance.id);
      if (index >= 0) {
        cached[index] = instance;
      }
    },

    /**
     * Remove a cached instance by id. Silent no-op when the event has no
     * cached instances. Used by cancel flows with hideFromPublic=true where
     * the server returns no instance because it no longer materializes.
     *
     * @param eventId - The event whose instance cache holds the target
     * @param instanceId - The id of the instance to drop from the cache
     */
    removeInstance(eventId: string, instanceId: string) {
      const cached = this.instances[eventId];
      if (!cached) {
        return;
      }
      this.instances[eventId] = cached.filter(
        (i: CalendarEventInstance) => i.id !== instanceId,
      );
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

    /**
     * Get cached instances for a specific event.
     *
     * @param state - The store state
     * @returns Function that returns instances for an event id or empty array
     */
    instancesForEvent: (state) => (eventId: string) => {
      return state.instances[eventId] || [];
    },
  },
});
