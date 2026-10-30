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

/**
 * Clear every store holding data that belongs to the signed-in account, so a
 * shared browser cannot carry one account's data into the next session. Call
 * it whenever the account changes: on logout, and when a different account
 * signs in through the session-expired modal.
 *
 * The calendar store is cleared through `resetCalendars()` first because its
 * state initializer reads the persisted current calendar: `$reset()` alone
 * would read the previous account's calendar straight back in.
 */
export function resetUserStores(): void {
  const calendarStore = useCalendarStore();
  calendarStore.resetCalendars();
  calendarStore.$reset();

  useFeedStore().$reset();
  useEventStore().$reset();
  useCategoryStore().$reset();
  useSeriesStore().$reset();
  useInvitationStore().$reset();
  useApplicationStore().$reset();
  useFundingStore().$reset();
  useCalendarAdminStore().$reset();
  useLocationStore().$reset();
  useModerationStore().$reset();
  useNotificationStore().$reset();
}
