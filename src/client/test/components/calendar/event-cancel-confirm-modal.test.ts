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
      expect(wrapper.find('h2').text()).toBe('Cancel this date?');
    });

    it('renders the confirm_message body copy', async () => {
      const wrapper = await mountModal();
      currentWrapper = wrapper;
      await flushPromises();

      expect(wrapper.text()).toContain(
        'This date will be marked as cancelled. It takes effect right away, even if you leave the editor without saving. You can restore it later.',
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
        'When on, this cancelled date will not appear on public calendars or be shared with other calendars.',
      );
    });
  });

  describe('organizer wording', () => {
    it('names the date in the heading when a date is given', async () => {
      const wrapper = await mountModal({ date: 'Jan 1, 2030, 12:00 PM' });
      currentWrapper = wrapper;
      await flushPromises();

      expect(wrapper.find('h2').text()).toBe('Cancel Jan 1, 2030, 12:00 PM?');
    });

    it('labels the buttons "Keep it" and "Cancel this date"', async () => {
      const wrapper = await mountModal();
      currentWrapper = wrapper;
      await flushPromises();

      expect(wrapper.find('[data-testid="confirm-cancel"]').text()).toBe('Keep it');
      expect(wrapper.find('[data-testid="confirm-submit"]').text()).toBe('Cancel this date');
    });

    it('avoids developer jargon in the visible copy', async () => {
      const wrapper = await mountModal();
      currentWrapper = wrapper;
      await flushPromises();

      expect(wrapper.text()).not.toMatch(/instance|occurrence|federat/i);
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
