import { describe, it, expect, afterEach, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';

import Sheet from '@/client/components/common/Sheet.vue';
import { mountComponent } from '@/client/test/lib/vue';

const routes: RouteRecordRaw[] = [
  { path: '/', component: {}, name: 'home' },
];

const mountSheet = async (props: { title: string } = { title: 'Test Title' }) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });

  await router.push('/');
  await router.isReady();

  const wrapper = mountComponent(Sheet, router, {
    props,
  });

  return wrapper;
};

describe('Sheet', () => {
  let currentWrapper: any = null;

  afterEach(() => {
    if (currentWrapper) {
      currentWrapper.unmount();
      currentWrapper = null;
    }
    vi.restoreAllMocks();
    document.body.classList.remove('modal-open');
  });

  it('renders with title', async () => {
    const wrapper = await mountSheet({ title: 'My Sheet Title' });
    currentWrapper = wrapper;

    await flushPromises();

    expect(wrapper.find('.sheet-header h2').text()).toBe('My Sheet Title');
  });

  it('opens dialog on mount', async () => {
    const wrapper = await mountSheet();
    currentWrapper = wrapper;

    await flushPromises();

    const dialog = wrapper.find('dialog');
    expect(dialog.exists()).toBe(true);
  });

  it('emits close when close button is clicked', async () => {
    const wrapper = await mountSheet();
    currentWrapper = wrapper;

    await flushPromises();

    const closeButton = wrapper.find('.sheet-header button');
    await closeButton.trigger('click');

    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('emits close on escape key', async () => {
    const wrapper = await mountSheet();
    currentWrapper = wrapper;

    await flushPromises();

    const dialog = wrapper.find('dialog');
    await dialog.trigger('keydown.esc');

    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('renders slot content', async () => {
    const router: Router = createRouter({
      history: createMemoryHistory(),
      routes,
    });

    await router.push('/');
    await router.isReady();

    const wrapper = mountComponent(Sheet, router, {
      props: { title: 'Test' },
    });
    currentWrapper = wrapper;

    await flushPromises();

    expect(wrapper.find('.sheet-body').exists()).toBe(true);
  });

  it('has correct aria attributes', async () => {
    const wrapper = await mountSheet({ title: 'Accessible Sheet' });
    currentWrapper = wrapper;

    await flushPromises();

    const dialog = wrapper.find('dialog');
    expect(dialog.attributes('aria-modal')).toBe('true');
    expect(dialog.attributes('aria-labelledby')).toBeDefined();

    const titleId = dialog.attributes('aria-labelledby');
    const h2 = wrapper.find(`#${titleId}`);
    expect(h2.exists()).toBe(true);
    expect(h2.text()).toBe('Accessible Sheet');
  });
});
