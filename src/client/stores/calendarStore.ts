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
      /** The account `calendarInfos` was loaded for, so an account switch can be detected. */
      accountId: null as string | null,
      /**
       * The current calendar. The URL is the source of truth (a router guard
       * sets this from `:calendar`); the value persists so a bare route can
       * resolve on reload. Null until a route or the resolver sets it.
       */
      selectedCalendarId: readPersistedCalendarId(),
    };
  },
  getters: {
    /** Bare calendars in API order, without the relationship. */
    calendars: (state): Calendar[] => state.calendarInfos.map((info: CalendarInfo) => info.calendar),
    /** Calendars the account owns. */
    ownedCalendars: (state): CalendarInfo[] => state.calendarInfos.filter((info: CalendarInfo) => info.isOwner),
    /** Calendars the account edits but does not own. */
    editedCalendars: (state): CalendarInfo[] => state.calendarInfos.filter((info: CalendarInfo) => info.isEditor),
    /** Check if the user has any calendars. */
    hasCalendars: (state) => state.calendarInfos.length > 0,
    /** Check if the user has multiple calendars. */
    hasMultipleCalendars: (state) => state.calendarInfos.length > 1,
    /** Get a calendar by ID, or null if the account has none with that ID. */
    getCalendarById: (state) => (id: string): Calendar | null => {
      return state.calendarInfos.find((info: CalendarInfo) => info.calendar.id === id)?.calendar ?? null;
    },
    /** Get a calendar by URL name, or null if not found. */
    getCalendarByUrlName: (state) => (urlName: string): Calendar | null => {
      return state.calendarInfos.find((info: CalendarInfo) => info.calendar.urlName === urlName)?.calendar ?? null;
    },
    /** Get a calendar with its relationship by URL name, or null if not found. */
    getCalendarInfoByUrlName: (state) => (urlName: string): CalendarInfo | null => {
      return state.calendarInfos.find((info: CalendarInfo) => info.calendar.urlName === urlName) ?? null;
    },
    /** The current calendar, or null when none is selected or it is not in the store. */
    selectedCalendar: (state): Calendar | null => {
      if (!state.selectedCalendarId) {
        return null;
      }
      return state.calendarInfos.find((info: CalendarInfo) => info.calendar.id === state.selectedCalendarId)?.calendar ?? null;
    },
  },
  actions: {
    /** Replace every calendar and mark the store loaded for `accountId`. */
    setCalendarInfos(infos: CalendarInfo[], accountId: string | null = null) {
      this.calendarInfos = infos;
      this.loaded = true;
      this.accountId = accountId;
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

    /** Removes a calendar from the store. */
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

    /** Drop the cached list, its account and the current calendar, so the next load starts clean. */
    resetCalendars() {
      this.calendarInfos = [];
      this.loaded = false;
      this.accountId = null;
      this.clearSelectedCalendar();
    },
  },
});
