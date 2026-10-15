import { defineStore } from 'pinia';
import { Calendar } from '@/common/model/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';
import { readPersistedCalendarId, writePersistedCalendarId } from '@/client/service/current-calendar';

export const useCalendarStore = defineStore('calendars', {
  state: () => {
    return {
      /** Every calendar the account owns or edits, with the relationship. */
      calendarInfos: [] as CalendarInfo[],
      loaded: false,
      /**
       * The current calendar. The URL is the source of truth (a router guard
       * sets this from `:calendar`); the value persists so a bare route can
       * resolve on reload. Null until a route or the resolver sets it.
       */
      selectedCalendarId: readPersistedCalendarId(),
    };
  },
  getters: {
    calendars: (state): Calendar[] => state.calendarInfos.map((info: CalendarInfo) => info.calendar),
    ownedCalendars: (state): CalendarInfo[] => state.calendarInfos.filter((info: CalendarInfo) => info.isOwner),
    editedCalendars: (state): CalendarInfo[] => state.calendarInfos.filter((info: CalendarInfo) => info.isEditor),
    hasCalendars: (state) => state.calendarInfos.length > 0,
    hasMultipleCalendars: (state) => state.calendarInfos.length > 1,
    getCalendarById: (state) => (id: string): Calendar | null => {
      return state.calendarInfos.find((info: CalendarInfo) => info.calendar.id === id)?.calendar ?? null;
    },
    getCalendarByUrlName: (state) => (urlName: string): Calendar | null => {
      return state.calendarInfos.find((info: CalendarInfo) => info.calendar.urlName === urlName)?.calendar ?? null;
    },
    getCalendarInfoByUrlName: (state) => (urlName: string): CalendarInfo | null => {
      return state.calendarInfos.find((info: CalendarInfo) => info.calendar.urlName === urlName) ?? null;
    },
    selectedCalendar: (state): Calendar | null => {
      if (!state.selectedCalendarId) {
        return null;
      }
      return state.calendarInfos.find((info: CalendarInfo) => info.calendar.id === state.selectedCalendarId)?.calendar ?? null;
    },
  },
  actions: {
    /** Replace every calendar and mark the store loaded. */
    setCalendarInfos(infos: CalendarInfo[]) {
      this.calendarInfos = infos;
      this.loaded = true;
    },

    /** Adds a calendar the account just created, so it is owned. */
    addCalendar(calendar: Calendar) {
      const exists = this.calendarInfos.some((info: CalendarInfo) => info.calendar.id === calendar.id);
      if (!exists) {
        this.calendarInfos.push(new CalendarInfo(calendar, 'owner'));
      }
    },

    /** Replace the calendar inside its info, keeping the relationship; add as owned if absent. */
    updateCalendar(calendar: Calendar) {
      const index = this.calendarInfos.findIndex((info: CalendarInfo) => info.calendar.id === calendar.id);
      if (index >= 0) {
        this.calendarInfos[index] = new CalendarInfo(calendar, this.calendarInfos[index].userRelationship);
      }
      else {
        this.addCalendar(calendar);
      }
    },

    removeCalendar(calendar: Calendar) {
      const index = this.calendarInfos.findIndex((info: CalendarInfo) => info.calendar.id === calendar.id);
      if (index >= 0) {
        this.calendarInfos.splice(index, 1);
      }
    },

    /** Set and persist the current calendar. */
    setSelectedCalendar(calendarId: string | null) {
      this.selectedCalendarId = calendarId;
      writePersistedCalendarId(calendarId);
    },

    /** Forget the current calendar in memory and in storage. */
    clearSelectedCalendar() {
      this.selectedCalendarId = null;
      writePersistedCalendarId(null);
    },
  },
});
