import type { NavigationGuard, RouteLocationRaw } from 'vue-router';
import type { CalendarInfo } from '@/common/model/calendar_info';
import { useCalendarStore } from '@/client/stores/calendarStore';

/*
 * Current-calendar resolution and the router guards that keep the calendar
 * store's selection equal to the `:calendar` in the URL. Persistence of the
 * selection lives in `current-calendar-storage.ts`, which imports nothing, so
 * the store and the auth service can use it without a cycle.
 *
 * `/event` (`event_new`) is the one store-scoped route: `newEvent()` sets the
 * selection, then navigates; the editor reads `calendarStore.selectedCalendar`.
 */

/**
 * Pure resolution of the current calendar. Order: the persisted ID if it is
 * in the account's list (owned or edited), else the first owned calendar in
 * API order, else the first edited, else null.
 */
export function resolveCurrentCalendar(
  persistedId: string | null,
  infos: CalendarInfo[],
): CalendarInfo | null {
  if (persistedId) {
    const hit = infos.find((info) => info.calendar.id === persistedId);
    if (hit) {
      return hit;
    }
  }
  return infos.find((info) => info.isOwner) ?? infos.find((info) => info.isEditor) ?? null;
}

/** Loads the account's calendars into the store (once) and returns them. */
export type CalendarLoader = () => Promise<CalendarInfo[]>;

/**
 * Guard for a bare route (`/calendar`, `/feed`, `/settings`): resolve the
 * current calendar and redirect to `routeName` with its url name. When no
 * calendar resolves, go to `fallback`, or render in place when `fallback`
 * is `true`. The guard persists the resolved ID itself, so a stale entry is
 * overwritten even where no sync guard runs; in the app the sync guard also
 * persists it on the redirected navigation. A failed load rejects, aborting
 * the navigation: there is nowhere sound to send the user.
 */
export function createCurrentCalendarRedirect(
  routeName: string,
  fallback: RouteLocationRaw | true,
  load: CalendarLoader,
): NavigationGuard {
  return async () => {
    const infos = await load();
    const store = useCalendarStore();
    const target = resolveCurrentCalendar(store.selectedCalendarId, infos);
    if (!target) {
      return fallback;
    }
    if (store.selectedCalendarId !== target.calendar.id) {
      store.setSelectedCalendar(target.calendar.id);
    }
    return { name: routeName, params: { calendar: target.calendar.urlName } };
  };
}

/**
 * Global guard: the URL is the source of truth for the current calendar.
 * Any route carrying a string `:calendar` param that names one of the
 * account's calendars sets the store's selection. Unknown names (not
 * owned or edited) change nothing. Skipped when logged out so an
 * anonymous hit never fires an authenticated request. Best-effort: a
 * failed load leaves the selection unchanged and lets the navigation
 * proceed, so the page itself can report the error.
 */
export function createCurrentCalendarSync(
  isLoggedIn: () => boolean,
  load: CalendarLoader,
): NavigationGuard {
  return async (to) => {
    const name = to.params.calendar;
    if (typeof name !== 'string' || !isLoggedIn()) {
      return true;
    }
    let infos: CalendarInfo[];
    try {
      infos = await load();
    }
    catch {
      return true;
    }
    const hit = infos.find((info) => info.calendar.urlName === name);
    if (hit) {
      const store = useCalendarStore();
      if (store.selectedCalendarId !== hit.calendar.id) {
        store.setSelectedCalendar(hit.calendar.id);
      }
    }
    return true;
  };
}
