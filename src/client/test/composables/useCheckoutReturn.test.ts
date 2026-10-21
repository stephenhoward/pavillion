import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router } from 'vue-router';

import FundingService from '@/client/service/funding';
import { useCheckoutReturn, verifyCheckoutSession } from '@/client/composables/useCheckoutReturn';
import type { CheckoutOutcome } from '@/client/composables/useCheckoutReturn';

const GENERAL_PATH = '/settings/calendar/town-hall/general';

/**
 * Mount a bare host for the composable at `url`, recording every outcome it
 * reports. The router is returned so tests can read the URL it left behind,
 * with spies on the navigations the composable may make.
 */
async function mountAt(url: string) {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/settings/calendar/:calendar/general', component: { render: () => null } }],
  });
  await router.push(url);
  await router.isReady();
  const replace = vi.spyOn(router, 'replace');
  const push = vi.spyOn(router, 'push');

  const outcomes: CheckoutOutcome[] = [];
  const Host = defineComponent({
    setup() {
      useCheckoutReturn((outcome) => {
        outcomes.push(outcome);
      });
      return () => h('div');
    },
  });

  const wrapper = mount(Host, { global: { plugins: [router] } });
  await flushPromises();

  return { wrapper, router, outcomes, replace, push };
}

describe('useCheckoutReturn', () => {
  let statusSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    statusSpy = vi.spyOn(FundingService.prototype, 'getCheckoutSessionStatus');
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('confirms a returned session once and strips session_id from the URL', async () => {
    statusSpy.mockResolvedValue({ status: 'complete' });

    const { wrapper, router, outcomes } = await mountAt(`${GENERAL_PATH}?session_id=cs_test_a1B2c3&keep=1`);

    expect(statusSpy).toHaveBeenCalledTimes(1);
    expect(statusSpy).toHaveBeenCalledWith('cs_test_a1B2c3');
    expect(outcomes).toEqual(['success']);
    expect(router.currentRoute.value.path).toBe(GENERAL_PATH);
    expect(router.currentRoute.value.query).toEqual({ keep: '1' });
    wrapper.unmount();
  });

  it('replaces the history entry rather than adding one', async () => {
    statusSpy.mockResolvedValue({ status: 'complete' });

    const { wrapper, replace, push } = await mountAt(`${GENERAL_PATH}?session_id=cs_live_xyz`);

    expect(replace).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it.each([
    ['the unsubstituted template', '{CHECKOUT_SESSION_ID}'],
    ['the percent-encoded template', '%7BCHECKOUT_SESSION_ID%7D'],
    ['garbage', 'not-a-session'],
    ['an id with the wrong prefix', 'pi_test_123'],
    ['an empty value', ''],
  ])('strips %s without asking the server', async (_label, value) => {
    const { wrapper, router, outcomes } = await mountAt(`${GENERAL_PATH}?session_id=${value}`);

    expect(statusSpy).not.toHaveBeenCalled();
    expect(outcomes).toEqual([]);
    expect(router.currentRoute.value.query).toEqual({});
    wrapper.unmount();
  });

  it('does nothing when the URL carries no session_id', async () => {
    const { wrapper, router, outcomes, replace } = await mountAt(`${GENERAL_PATH}?keep=1`);

    expect(statusSpy).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(outcomes).toEqual([]);
    expect(router.currentRoute.value.query).toEqual({ keep: '1' });
    wrapper.unmount();
  });

  it('reports an error when the server says the session expired', async () => {
    statusSpy.mockResolvedValue({ status: 'expired' });

    const { wrapper, outcomes } = await mountAt(`${GENERAL_PATH}?session_id=cs_test_expired`);

    expect(outcomes).toEqual(['error']);
    wrapper.unmount();
  });

  it('reports nothing while the session is still open', async () => {
    statusSpy.mockResolvedValue({ status: 'open' });

    const { wrapper, router, outcomes } = await mountAt(`${GENERAL_PATH}?session_id=cs_test_open`);

    expect(outcomes).toEqual([]);
    expect(router.currentRoute.value.query).toEqual({});
    wrapper.unmount();
  });
});

describe('verifyCheckoutSession', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['complete', 'success'],
    ['expired', 'error'],
    ['open', null],
  ] as const)('maps a %s session to %s', async (status, expected) => {
    const service = new FundingService();
    vi.spyOn(service, 'getCheckoutSessionStatus').mockResolvedValue({ status } as any);

    expect(await verifyCheckoutSession(service, 'cs_test_1')).toBe(expected);
  });

  it('reports an error when the status lookup fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const service = new FundingService();
    vi.spyOn(service, 'getCheckoutSessionStatus').mockRejectedValue(new Error('network'));

    expect(await verifyCheckoutSession(service, 'cs_test_1')).toBe('error');
  });
});
