import { describe, it, expect, afterEach, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';

import EventCancelConfirmModal from '@/client/components/logged_in/calendar/EventCancelConfirmModal.vue';
import { mountComponent } from '@/client/test/lib/vue';

const routes: RouteRecordRaw[] = [
  { path: '/', component: {}, name: 'home' },
];

const SheetStub = {
  template: '<div class="sheet-stub"><header><h2>{{ title }}</h2></header><slot /></div>',
  props: ['title'],
  emits: ['close'],
};

const mountModal = async (props: Record<string, any> = {}) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });

  await router.push('/');
  await router.isReady();

  return mountComponent(EventCancelConfirmModal, router, {
    stubs: { Sheet: SheetStub },
    props,
  });
};

describe('EventCancelConfirmModal', () => {
  let currentWrapper: any = null;

  afterEach(() => {
    if (currentWrapper) {
      currentWrapper.unmount();
      currentWrapper = null;
    }
    vi.restoreAllMocks();
  });

  describe('rendering', () => {
    it('renders the Sheet with the confirm_title as its heading', async () => {
      const wrapper = await mountModal();
      currentWrapper = wrapper;
      await flushPromises();

      expect(wrapper.find('.sheet-stub').exists()).toBe(true);
      expect(wrapper.find('h2').text()).toBe('Cancel this instance?');
    });

    it('renders the confirm_message body copy', async () => {
      const wrapper = await mountModal();
      currentWrapper = wrapper;
      await flushPromises();

      expect(wrapper.text()).toContain(
        'This will mark the selected occurrence as cancelled. You can restore it later.',
      );
    });

    it('renders the hide-from-public checkbox unchecked by default', async () => {
      const wrapper = await mountModal();
      currentWrapper = wrapper;
      await flushPromises();

      const checkbox = wrapper.find('input[type="checkbox"]');
      expect(checkbox.exists()).toBe(true);
      expect((checkbox.element as HTMLInputElement).checked).toBe(false);
    });

    it('renders the hide toggle label and description copy', async () => {
      const wrapper = await mountModal();
      currentWrapper = wrapper;
      await flushPromises();

      expect(wrapper.text()).toContain('Hide from public');
      expect(wrapper.text()).toContain(
        'When enabled, this cancelled instance will not be shown on public calendars or federated out.',
      );
    });
  });

  describe('checkbox toggling', () => {
    it('updates hideFromPublic state when the checkbox is toggled', async () => {
      const wrapper = await mountModal();
      currentWrapper = wrapper;
      await flushPromises();

      const checkbox = wrapper.find('input[type="checkbox"]');
      await checkbox.setValue(true);

      expect((checkbox.element as HTMLInputElement).checked).toBe(true);
    });
  });

  describe('submit', () => {
    it('emits confirm with hideFromPublic=false when submit is clicked unchecked', async () => {
      const wrapper = await mountModal();
      currentWrapper = wrapper;
      await flushPromises();

      const submitButton = wrapper.find('[data-testid="confirm-submit"]');
      expect(submitButton.exists()).toBe(true);
      await submitButton.trigger('click');

      expect(wrapper.emitted('confirm')).toBeTruthy();
      expect(wrapper.emitted('confirm')?.[0]).toEqual([{ hideFromPublic: false }]);
    });

    it('emits confirm with hideFromPublic=true when submit is clicked after toggling checkbox', async () => {
      const wrapper = await mountModal();
      currentWrapper = wrapper;
      await flushPromises();

      const checkbox = wrapper.find('input[type="checkbox"]');
      await checkbox.setValue(true);

      const submitButton = wrapper.find('[data-testid="confirm-submit"]');
      await submitButton.trigger('click');

      expect(wrapper.emitted('confirm')).toBeTruthy();
      expect(wrapper.emitted('confirm')?.[0]).toEqual([{ hideFromPublic: true }]);
    });
  });

  describe('allowHide=false', () => {
    it('hides the hide-from-public toggle when allowHide is false', async () => {
      const wrapper = await mountModal({ allowHide: false });
      currentWrapper = wrapper;
      await flushPromises();

      expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
      expect(wrapper.text()).not.toContain('Hide from public');
    });

    it('emits confirm with hideFromPublic=false when allowHide is false', async () => {
      const wrapper = await mountModal({ allowHide: false });
      currentWrapper = wrapper;
      await flushPromises();

      const submitButton = wrapper.find('[data-testid="confirm-submit"]');
      await submitButton.trigger('click');

      expect(wrapper.emitted('confirm')).toBeTruthy();
      expect(wrapper.emitted('confirm')?.[0]).toEqual([{ hideFromPublic: false }]);
    });

    it('shows the hide-from-public toggle by default (allowHide defaults to true)', async () => {
      const wrapper = await mountModal();
      currentWrapper = wrapper;
      await flushPromises();

      expect(wrapper.find('input[type="checkbox"]').exists()).toBe(true);
    });
  });

  describe('cancel / close', () => {
    it('emits close when the cancel button is clicked', async () => {
      const wrapper = await mountModal();
      currentWrapper = wrapper;
      await flushPromises();

      const cancelButton = wrapper.find('[data-testid="confirm-cancel"]');
      expect(cancelButton.exists()).toBe(true);
      await cancelButton.trigger('click');

      expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('emits close when the Sheet emits close (e.g. escape key)', async () => {
      const wrapper = await mountModal();
      currentWrapper = wrapper;
      await flushPromises();

      const sheet = wrapper.findComponent(SheetStub);
      sheet.vm.$emit('close');
      await flushPromises();

      expect(wrapper.emitted('close')).toBeTruthy();
    });
  });
});
