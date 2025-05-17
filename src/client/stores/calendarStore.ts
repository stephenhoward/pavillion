import { defineStore } from 'pinia';
import { Calendar } from '@/common/model/calendar';

export const useCalendarStore = defineStore('calendars', {
  state: () => {
    return {
      calendars: [] as Calendar[],
      loaded: false,
    };
  },
  getters: {
    /**
     * Check if the user has any calendars
     */
    hasCalendars: (state) => state.calendars.length > 0,

    /**
     * Get calendar by ID
     */
    getCalendarById: (state) => (id: string) => {
      return state.calendars.find((calendar: Calendar) => calendar.id === id) || null;
    },

    /**
     * Get calendar by URL name
     */
    getCalendarByUrlName: (state) => (urlName: string) => {
      return state.calendars.find((calendar: Calendar) => calendar.urlName === urlName) || null;
    },
  },
  actions: {
    /**
     * Set calendars in the store and mark as loaded
     * @param {Calendar[]} calendars - The calendars to set in the store
     */
    setCalendars(calendars: Calendar[]) {
      this.calendars = calendars;
      this.loaded = true;
    },

    /**
     * Adds a new calendar to the store.
     * @param {Calendar} calendar - The calendar to add to the store
     */
    addCalendar(calendar: Calendar) {
      const exists = this.calendars.some((c: Calendar) => c.id === calendar.id);
      if (!exists) {
        this.calendars.push(calendar);
      }
    },

    /**
     * Updates an existing calendar in the store or adds it if not found.
     * @param {Calendar} calendar - The calendar to update or add
     */
    updateCalendar(calendar: Calendar) {
      const index = this.calendars.findIndex((c: Calendar) => c.id === calendar.id);
      if (index >= 0) {
        this.calendars[index] = calendar;
      }
      else {
        this.addCalendar(calendar);
      }
    },

    /**
     * Removes a calendar from the store.
     * @param {Calendar} calendar - The calendar to remove
     */
    removeCalendar(calendar: Calendar) {
      const index = this.calendars.findIndex((c: Calendar) => c.id === calendar.id);
      if (index >= 0) {
        this.calendars.splice(index, 1);
      }
    },
  },
});
