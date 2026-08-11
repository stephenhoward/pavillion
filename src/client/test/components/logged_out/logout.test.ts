import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { Pinia } from 'pinia';
import type { Router, RouteRecordRaw } from 'vue-router';

import { mountComponent } from '@/client/test/lib/vue';
import { useFundingStore } from '@/client/stores/fundingStore';
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
      status: 'funded',
      currentPeriodEnd: '2026-09-01T00:00:00.000Z',
      accessExpiresAt: null,
      features: { widget_embedding: true },
    });

    const wrapper = await mountLogout(pinia);

    expect(fundingStore.statusFor(CALENDAR_ID)).toBeNull();
    expect(fundingStore.featureAccess(CALENDAR_ID, 'widget_embedding')).toBeNull();
    wrapper.unmount();
  });

  it('calls $reset on the funding store rather than clearing it some other way', async () => {
    const fundingStore = useFundingStore();
    const reset = vi.spyOn(fundingStore, '$reset');

    const wrapper = await mountLogout(pinia);

    expect(reset).toHaveBeenCalled();
    wrapper.unmount();
  });
});
