import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { mount, flushPromises, VueWrapper } from '@vue/test-utils';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';
import RepostCategoriesModal from '@/client/components/logged_in/repost-categories-modal.vue';

const FEED_TRANSLATIONS: Record<string, string> = {
  'categoryMapping.repostDialogTitle': 'Repost with categories',
  'categoryMapping.repostDialogDescription': 'Some categories from "{{eventTitle}}" are not mapped to local categories. Select the local categories to apply when reposting:',
  'categoryMapping.repostConfirm': 'Repost',
  'categoryMapping.cancel': 'Cancel',
  'categoryMapping.categoriesLabel': 'Local categories',
  'categoryMapping.noLocalCategories': 'No local categories available.',
};

const ALL_CATEGORIES = [
  { id: 'cat-1', name: 'Music' },
  { id: 'cat-2', name: 'Sports' },
  { id: 'cat-3', name: 'Art' },
];

const PRE_SELECTED = [
  { id: 'cat-1', name: 'Music' },
];

const mountModal = (props: Record<string, any> = {}): VueWrapper => {
  return mount(RepostCategoriesModal, {
    global: {
      plugins: [[I18NextVue, { i18next }]],
      stubs: {
        // Stub the Modal wrapper to render slot content directly, bypassing
        // native <dialog> showModal() which is not supported in happy-dom.
        Modal: {
          template: '<div role="dialog" aria-modal="true"><slot /></div>',
          props: ['title'],
          emits: ['close'],
        },
      },
    },
    props: {
      eventTitle: 'Test Event',
      preSelectedCategories: PRE_SELECTED,
      allLocalCategories: ALL_CATEGORIES,
      ...props,
    },
  });
};

describe('RepostCategoriesModal', () => {
  beforeAll(async () => {
    await i18next.init({
      lng: 'en',
      resources: {
        en: {
          feed: FEED_TRANSLATIONS,
        },
      },
    });
  });

  afterEach(() => {
    document.body.classList.remove('modal-open');
  });

  describe('Rendering', () => {
    it('renders a description paragraph', async () => {
      const wrapper = mountModal();
      await flushPromises();

      const description = wrapper.find('p.description');
      expect(description.exists()).toBe(true);
      wrapper.unmount();
    });

    it('renders one checkbox per local category', async () => {
      const wrapper = mountModal();
      await flushPromises();

      const checkboxes = wrapper.findAll('input[type="checkbox"]');
      expect(checkboxes).toHaveLength(ALL_CATEGORIES.length);
      wrapper.unmount();
    });

    it('renders a label for each category showing its name', async () => {
      const wrapper = mountModal();
      await flushPromises();

      const labels = wrapper.findAll('label.category-label');
      const labelTexts = labels.map(l => l.text());
      expect(labelTexts).toContain('Music');
      expect(labelTexts).toContain('Sports');
      expect(labelTexts).toContain('Art');
      wrapper.unmount();
    });

    it('renders a Repost confirm button', async () => {
      const wrapper = mountModal();
      await flushPromises();

      const buttons = wrapper.findAll('button');
      const repostButton = buttons.find(b => b.text() === 'Repost');
      expect(repostButton).toBeTruthy();
      wrapper.unmount();
    });

    it('renders a Cancel button', async () => {
      const wrapper = mountModal();
      await flushPromises();

      const buttons = wrapper.findAll('button');
      const cancelButton = buttons.find(b => b.text() === 'Cancel');
      expect(cancelButton).toBeTruthy();
      wrapper.unmount();
    });

    it('shows a no-categories message when allLocalCategories is empty', async () => {
      const wrapper = mountModal({ allLocalCategories: [] });
      await flushPromises();

      expect(wrapper.find('ul.category-list').exists()).toBe(false);
      const msg = wrapper.find('p.no-categories');
      expect(msg.exists()).toBe(true);
      wrapper.unmount();
    });
  });

  describe('Pre-selected categories', () => {
    it('pre-checks categories that are in preSelectedCategories', async () => {
      const wrapper = mountModal();
      await flushPromises();

      const checkboxes = wrapper.findAll('input[type="checkbox"]');
      // cat-1 (Music) is pre-selected
      const musicCheckbox = checkboxes.find(
        cb => (cb.element as HTMLInputElement).value === 'cat-1',
      );
      expect(musicCheckbox).toBeTruthy();
      expect((musicCheckbox!.element as HTMLInputElement).checked).toBe(true);
      wrapper.unmount();
    });

    it('does not pre-check categories that are not in preSelectedCategories', async () => {
      const wrapper = mountModal();
      await flushPromises();

      const checkboxes = wrapper.findAll('input[type="checkbox"]');
      const sportsCheckbox = checkboxes.find(
        cb => (cb.element as HTMLInputElement).value === 'cat-2',
      );
      expect(sportsCheckbox).toBeTruthy();
      expect((sportsCheckbox!.element as HTMLInputElement).checked).toBe(false);
      wrapper.unmount();
    });

    it('starts with empty selection when preSelectedCategories is empty', async () => {
      const wrapper = mountModal({ preSelectedCategories: [] });
      await flushPromises();

      const checkboxes = wrapper.findAll('input[type="checkbox"]');
      for (const cb of checkboxes) {
        expect((cb.element as HTMLInputElement).checked).toBe(false);
      }
      wrapper.unmount();
    });
  });

  describe('Toggling categories', () => {
    it('checking an unchecked category adds it to the selection', async () => {
      const wrapper = mountModal();
      await flushPromises();

      // Sports (cat-2) is not pre-selected
      const checkboxes = wrapper.findAll('input[type="checkbox"]');
      const sportsCheckbox = checkboxes.find(
        cb => (cb.element as HTMLInputElement).value === 'cat-2',
      );
      expect(sportsCheckbox).toBeTruthy();
      await sportsCheckbox!.trigger('change');

      const vm = wrapper.vm as any;
      expect(vm.selectedIds).toContain('cat-2');
      wrapper.unmount();
    });

    it('unchecking a pre-selected category removes it from the selection', async () => {
      const wrapper = mountModal();
      await flushPromises();

      // Music (cat-1) is pre-selected
      const checkboxes = wrapper.findAll('input[type="checkbox"]');
      const musicCheckbox = checkboxes.find(
        cb => (cb.element as HTMLInputElement).value === 'cat-1',
      );
      expect(musicCheckbox).toBeTruthy();
      await musicCheckbox!.trigger('change');

      const vm = wrapper.vm as any;
      expect(vm.selectedIds).not.toContain('cat-1');
      wrapper.unmount();
    });
  });

  describe('Emitted events', () => {
    it('emits confirm with the current selectedIds when Repost is clicked', async () => {
      const wrapper = mountModal();
      await flushPromises();

      const buttons = wrapper.findAll('button');
      const repostButton = buttons.find(b => b.text() === 'Repost');
      await repostButton!.trigger('click');

      const emitted = wrapper.emitted('confirm');
      expect(emitted).toBeTruthy();
      expect(emitted!.length).toBe(1);
      // Only cat-1 pre-selected
      expect(emitted![0][0]).toEqual(['cat-1']);
      wrapper.unmount();
    });

    it('emits confirm with updated ids after toggling', async () => {
      const wrapper = mountModal();
      await flushPromises();

      // Add Sports (cat-2)
      const checkboxes = wrapper.findAll('input[type="checkbox"]');
      const sportsCheckbox = checkboxes.find(
        cb => (cb.element as HTMLInputElement).value === 'cat-2',
      );
      await sportsCheckbox!.trigger('change');

      const buttons = wrapper.findAll('button');
      const repostButton = buttons.find(b => b.text() === 'Repost');
      await repostButton!.trigger('click');

      const emitted = wrapper.emitted('confirm');
      expect(emitted).toBeTruthy();
      const ids = emitted![0][0] as string[];
      expect(ids).toContain('cat-1');
      expect(ids).toContain('cat-2');
      wrapper.unmount();
    });

    it('emits confirm with empty array when all categories are unchecked', async () => {
      const wrapper = mountModal({ preSelectedCategories: [] });
      await flushPromises();

      const buttons = wrapper.findAll('button');
      const repostButton = buttons.find(b => b.text() === 'Repost');
      await repostButton!.trigger('click');

      const emitted = wrapper.emitted('confirm');
      expect(emitted).toBeTruthy();
      expect(emitted![0][0]).toEqual([]);
      wrapper.unmount();
    });

    it('emits cancel when Cancel is clicked', async () => {
      const wrapper = mountModal();
      await flushPromises();

      const buttons = wrapper.findAll('button');
      const cancelButton = buttons.find(b => b.text() === 'Cancel');
      await cancelButton!.trigger('click');

      expect(wrapper.emitted('cancel')).toBeTruthy();
      wrapper.unmount();
    });

    it('does not emit confirm when Cancel is clicked', async () => {
      const wrapper = mountModal();
      await flushPromises();

      const buttons = wrapper.findAll('button');
      const cancelButton = buttons.find(b => b.text() === 'Cancel');
      await cancelButton!.trigger('click');

      expect(wrapper.emitted('confirm')).toBeFalsy();
      wrapper.unmount();
    });

    it('does not emit cancel when Repost is clicked', async () => {
      const wrapper = mountModal();
      await flushPromises();

      const buttons = wrapper.findAll('button');
      const repostButton = buttons.find(b => b.text() === 'Repost');
      await repostButton!.trigger('click');

      expect(wrapper.emitted('cancel')).toBeFalsy();
      wrapper.unmount();
    });

    it('cancel does not change selectedIds (no side effects)', async () => {
      const wrapper = mountModal();
      await flushPromises();

      const vmBefore = wrapper.vm as any;
      const idsBefore = [...vmBefore.selectedIds];

      const buttons = wrapper.findAll('button');
      const cancelButton = buttons.find(b => b.text() === 'Cancel');
      await cancelButton!.trigger('click');

      const vmAfter = wrapper.vm as any;
      expect(vmAfter.selectedIds).toEqual(idsBefore);
      wrapper.unmount();
    });
  });
});
