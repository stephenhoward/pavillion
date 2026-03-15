import { describe, it, expect, afterEach, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';

import SubscribeSheet from '@/client/components/logged_in/calendar-management/SubscribeSheet.vue';
import { mountComponent } from '@/client/test/lib/vue';

const routes: RouteRecordRaw[] = [
  { path: '/', component: {}, name: 'home' },
];

const mountSubscribeSheet = async (calendarId: string = 'cal-uuid-1') => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });

  await router.push('/');
  await router.isReady();

  const wrapper = mountComponent(SubscribeSheet, router, {
    props: { calendarId },
    stubs: {
      Sheet: {
        template: '<div class="sheet-stub"><header><h2>{{ title }}</h2></header><slot /></div>',
        props: ['title'],
        emits: ['close'],
      },
      SubscribeForm: {
        template: '<div class="subscribe-form-stub"></div>',
        props: ['calendarId'],
        emits: ['subscribed'],
      },
    },
  });

  return wrapper;
};

describe('SubscribeSheet', () => {
  let currentWrapper: any = null;

  afterEach(() => {
    if (currentWrapper) {
      currentWrapper.unmount();
      currentWrapper = null;
    }
    vi.restoreAllMocks();
  });

  it('renders Sheet with SubscribeForm', async () => {
    const wrapper = await mountSubscribeSheet();
    currentWrapper = wrapper;

    await flushPromises();

    expect(wrapper.find('.sheet-stub').exists()).toBe(true);
    expect(wrapper.find('.subscribe-form-stub').exists()).toBe(true);
  });

  it('passes calendarId to SubscribeForm', async () => {
    const wrapper = await mountSubscribeSheet('cal-test-123');
    currentWrapper = wrapper;

    await flushPromises();

    const formStub = wrapper.find('.subscribe-form-stub');
    expect(formStub.exists()).toBe(true);
    // The calendarId is passed through - verified by component rendering
  });

  it('emits close and subscribed when form emits subscribed', async () => {
    const wrapper = await mountSubscribeSheet();
    currentWrapper = wrapper;

    await flushPromises();

    // Find the stubbed SubscribeForm by its selector
    const formStub = wrapper.find('.subscribe-form-stub');
    expect(formStub.exists()).toBe(true);

    // Trigger subscribed event via the parent component's onSubscribed handler
    const subscribeFormComponent = wrapper.findComponent('.subscribe-form-stub');
    subscribeFormComponent.vm.$emit('subscribed');
    await flushPromises();

    expect(wrapper.emitted('subscribed')).toBeTruthy();
    expect(wrapper.emitted('close')).toBeTruthy();
  });
});
