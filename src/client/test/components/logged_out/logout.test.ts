import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { Pinia } from 'pinia';
import type { Router, RouteRecordRaw } from 'vue-router';

import { mountComponent } from '@/client/test/lib/vue';
import { useFundingStore } from '@/client/stores/fundingStore';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { useFeedStore } from '@/client/stores/feedStore';
import { useEventStore } from '@/client/stores/eventStore';
import { useCategoryStore } from '@/client/stores/categoryStore';
import { useSeriesStore } from '@/client/stores/seriesStore';
import { useInvitationStore } from '@/client/stores/invitationStore';
import { useApplicationStore } from '@/client/stores/applicationStore';
import { useCalendarAdminStore } from '@/client/stores/calendarAdminStore';
import { useLocationStore } from '@/client/stores/locationStore';
import { useModerationStore } from '@/client/stores/moderation-store';
import { useNotificationStore } from '@/client/stores/notificationStore';
import Logout from '@/client/components/logged_out/logout.vue';

const CALENDAR_ID = 'cal-1';

// Every store that holds data belonging to the signed-in account. Each must be
// reset on logout so a shared browser cannot carry one account's data into the
// next session. Add new user-specific stores here and to logout.vue together.
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

const routes: RouteRecordRaw[] = [
  { path: '/', component: { template: '<div />' }, name: 'app' },
  { path: '/auth/logout', component: Logout, name: 'logout' },
];

/**
 * Mount the logout view on an active Pinia, after seeding the funding cache
 * with the previous session's answers.
 */
async function mountLogout(pinia: Pinia) {
  const router: Router = createRouter({ history: createMemoryHistory(), routes });
  await router.push('/auth/logout');
  await router.isReady();

  return mountComponent(Logout, router, {
    pinia,
    provide: { authn: { logout: vi.fn() } },
  });
}

describe('Logout Component (client logged_out)', () => {
  let pinia: Pinia;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clears the funding cache so the previous session cannot answer for the next', async () => {
    // The funding cache is per-account: it says whether *this* operator's
    // calendars may use a gated feature. On a shared browser, surviving a
    // logout means answering the next account's questions with the previous
    // account's entitlements.
    const fundingStore = useFundingStore();
    fundingStore.setSummary(CALENDAR_ID, {
      status: 'covered',
      features: { widget_embedding: true },
    });

    const wrapper = await mountLogout(pinia);

    expect(fundingStore.statusFor(CALENDAR_ID)).toBeNull();
    expect(fundingStore.featureAccess(CALENDAR_ID, 'widget_embedding')).toBeNull();
    wrapper.unmount();
  });

  it.each(userSpecificStores)('calls $reset on the %s store', async (_name, useStore) => {
    const store = useStore();
    const reset = vi.spyOn(store, '$reset');

    const wrapper = await mountLogout(pinia);

    expect(reset).toHaveBeenCalledOnce();
    wrapper.unmount();
  });
});
