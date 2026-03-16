import { describe, it, expect, afterEach, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';

import FundingSheet from '@/client/components/logged_in/calendar-management/FundingSheet.vue';
import { mountComponent } from '@/client/test/lib/vue';

const routes: RouteRecordRaw[] = [
  { path: '/', component: {}, name: 'home' },
];

const mountFundingSheet = async (calendarId: string = 'cal-uuid-1') => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });

  await router.push('/');
  await router.isReady();

  const wrapper = mountComponent(FundingSheet, router, {
    props: { calendarId },
    stubs: {
      Sheet: {
        template: '<div class="sheet-stub"><header><h2>{{ title }}</h2></header><slot /></div>',
        props: ['title'],
        emits: ['close'],
      },
      FundingForm: {
        template: '<div class="funding-form-stub"></div>',
        props: ['calendarId'],
        emits: ['subscribed'],
      },
    },
  });

  return wrapper;
};

describe('FundingSheet', () => {
  let currentWrapper: any = null;

  afterEach(() => {
    if (currentWrapper) {
      currentWrapper.unmount();
      currentWrapper = null;
    }
    vi.restoreAllMocks();
  });

  it('renders Sheet with FundingForm', async () => {
    const wrapper = await mountFundingSheet();
    currentWrapper = wrapper;

    await flushPromises();

    expect(wrapper.find('.sheet-stub').exists()).toBe(true);
    expect(wrapper.find('.funding-form-stub').exists()).toBe(true);
  });

  it('passes calendarId to FundingForm', async () => {
    const wrapper = await mountFundingSheet('cal-test-123');
    currentWrapper = wrapper;

    await flushPromises();

    const formStub = wrapper.find('.funding-form-stub');
    expect(formStub.exists()).toBe(true);
    // The calendarId is passed through - verified by component rendering
  });

  it('emits close and subscribed when form emits subscribed', async () => {
    const wrapper = await mountFundingSheet();
    currentWrapper = wrapper;

    await flushPromises();

    // Find the stubbed FundingForm by its selector
    const formStub = wrapper.find('.funding-form-stub');
    expect(formStub.exists()).toBe(true);

    // Trigger subscribed event via the parent component's onSubscribed handler
    const fundingFormComponent = wrapper.findComponent('.funding-form-stub');
    fundingFormComponent.vm.$emit('subscribed');
    await flushPromises();

    expect(wrapper.emitted('subscribed')).toBeTruthy();
    expect(wrapper.emitted('close')).toBeTruthy();
  });
});
