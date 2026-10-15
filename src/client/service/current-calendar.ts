import type { NavigationGuard, RouteLocationRaw } from 'vue-router';
import type { CalendarInfo } from '@/common/model/calendar_info';
import { useCalendarStore } from '@/client/stores/calendarStore';

/**
 * localStorage key holding the current calendar's ID as a bare string.
 * Nothing else is stored: cross-account safety comes from
 * `resolveCurrentCalendar`, which discards any ID not in the signed-in
 * account's list. Client-app only; the site and widget never read it.
 */
export const CURRENT_CALENDAR_STORAGE_KEY = 'current_calendar_id';

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

function defaultStorage(): Storage | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  }
  catch {
    return undefined;
  }
}

/** Reads the persisted ID; blank, missing or unreadable all yield null. */
export function readPersistedCalendarId(storage: Storage | undefined = defaultStorage()): string | null {
  try {
    const raw = storage?.getItem(CURRENT_CALENDAR_STORAGE_KEY);
    if (typeof raw !== 'string') {
      return null;
    }
    const trimmed = raw.trim();
    return trimmed === '' ? null : trimmed;
  }
  catch {
    return null;
  }
}

/** Writes the ID, or removes the entry on null. Never throws. */
export function writePersistedCalendarId(id: string | null, storage: Storage | undefined = defaultStorage()): void {
  try {
    if (!storage) {
      return;
    }
    if (id) {
      storage.setItem(CURRENT_CALENDAR_STORAGE_KEY, id);
    }
    else {
      storage.removeItem(CURRENT_CALENDAR_STORAGE_KEY);
    }
  }
  catch {
    // Storage may be unavailable (private mode, blocked site data).
  }
}

/** Loads the account's calendars into the store (once) and returns them. */
export type CalendarLoader = () => Promise<CalendarInfo[]>;

/**
 * Guard for a bare route (`/calendar`, `/feed`, `/settings`): resolve the
 * current calendar and redirect to `routeName` with its url name. When no
 * calendar resolves, go to `fallback`, or render in place when `fallback`
 * is `true`. The redirect also persists the resolved ID, so a stale entry
 * is overwritten rather than kept.
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
 * anonymous hit never fires an authenticated request.
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
    const infos = await load();
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
