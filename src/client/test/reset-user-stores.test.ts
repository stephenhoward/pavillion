import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { resetUserStores } from '@/client/stores/reset-user-stores';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { useFeedStore } from '@/client/stores/feedStore';
import { useEventStore } from '@/client/stores/eventStore';
import { useCategoryStore } from '@/client/stores/categoryStore';
import { useSeriesStore } from '@/client/stores/seriesStore';
import { useInvitationStore } from '@/client/stores/invitationStore';
import { useApplicationStore } from '@/client/stores/applicationStore';
import { useFundingStore } from '@/client/stores/fundingStore';
import { useCalendarAdminStore } from '@/client/stores/calendarAdminStore';
import { useLocationStore } from '@/client/stores/locationStore';
import { useModerationStore } from '@/client/stores/moderation-store';
import { useNotificationStore } from '@/client/stores/notificationStore';
import { Calendar } from '@/common/model/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';
import { CURRENT_CALENDAR_STORAGE_KEY } from '@/client/service/current-calendar-storage';

// Every store that holds data belonging to the signed-in account. Each must be
// reset when the account changes (logout, or another account signing in
// through the session-expired modal) so a shared browser cannot carry one
// account's data into the next session. Add new user-specific stores here and
// to reset-user-stores.ts together.
const userSpecificStores = [
  ['calendar', useCalendarStore],
  ['feed', useFeedStore],
  ['event', useEventStore],
  ['category', useCategoryStore],
  ['series', useSeriesStore],
  ['invitation', useInvitationStore],
  ['application', useApplicationStore],
  ['funding', useFundingStore],
  ['calendarAdmin', useCalendarAdminStore],
  ['location', useLocationStore],
  ['moderation', useModerationStore],
  ['notification', useNotificationStore],
] as const;

describe('resetUserStores', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it.each(userSpecificStores)('calls $reset on the %s store', (_name, useStore) => {
    const store = useStore();
    const reset = vi.spyOn(store, '$reset');

    resetUserStores();

    expect(reset).toHaveBeenCalledOnce();
  });

  it('forgets the previous account\'s calendars and current calendar, in memory and in storage', () => {
    // $reset() alone re-runs the state initializer, which reads the persisted
    // current calendar back in; the persisted key has to go first.
    const calendarStore = useCalendarStore();
    const calendar = new Calendar('cal-a', 'account-a-calendar');
    calendarStore.setCalendarInfos([new CalendarInfo(calendar, 'owner')], 'account-a');
    calendarStore.setSelectedCalendar('cal-a');

    resetUserStores();

    expect(localStorage.getItem(CURRENT_CALENDAR_STORAGE_KEY)).toBeNull();
    expect(calendarStore.selectedCalendarId).toBeNull();
    expect(calendarStore.calendarInfos).toEqual([]);
    expect(calendarStore.loaded).toBe(false);
    expect(calendarStore.accountId).toBeNull();
  });
});
