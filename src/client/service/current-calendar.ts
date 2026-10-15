import type { CalendarInfo } from '@/common/model/calendar_info';

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
