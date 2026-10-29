import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { Pinia } from 'pinia';
import type { Router, RouteRecordRaw } from 'vue-router';

import { mountComponent } from '@/client/test/lib/vue';
import { useFundingStore } from '@/client/stores/fundingStore';
import { useCalendarStore } from '@/client/stores/calendarStore';
import Logout from '@/client/components/logged_out/logout.vue';

const CALENDAR_ID = 'cal-1';

const routes: RouteRecordRaw[] = [
  { path: '/', component: { template: '<div />' }, name: 'app' },
  { path: '/auth/logout', component: Logout, name: 'logout' },
];

/**
 * Mount the logout view on an active Pinia, after seeding the funding cache
 * with the previous session's answers.
 */
async function mountLogout(pinia: Pinia, authn = { logout: vi.fn() }) {
  const router: Router = createRouter({ history: createMemoryHistory(), routes });
  await router.push('/auth/logout');
  await router.isReady();

  return mountComponent(Logout, router, {
    pinia,
    provide: { authn },
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

  it('signs out before resetting the stores', async () => {
    // A reset re-runs state initializers that read storage (the calendar
    // store reads the persisted current calendar), so storage must already
    // be clear of the previous session when the stores are reset.
    const calendarStore = useCalendarStore();
    const reset = vi.spyOn(calendarStore, '$reset');
    const authn = { logout: vi.fn() };

    const wrapper = await mountLogout(pinia, authn);

    expect(authn.logout).toHaveBeenCalledOnce();
    expect(reset).toHaveBeenCalledOnce();
    expect(authn.logout.mock.invocationCallOrder[0]).toBeLessThan(reset.mock.invocationCallOrder[0]);
    wrapper.unmount();
  });
});
