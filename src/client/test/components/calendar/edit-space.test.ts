import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { createPinia, setActivePinia, Pinia } from 'pinia';
import { mountComponent } from '@/client/test/lib/vue';
import EditSpaceView from '@/client/components/logged_in/calendar/edit-space.vue';
import { useLocationStore } from '@/client/stores/locationStore';
import { EventLocationSpace, EventLocationSpaceContent } from '@/common/model/location';

/**
 * Build an `EventLocationSpace` populated with translated content for the
 * supplied languages. Used to seed the locationStore cache so the edit-mode
 * component can read existing content via `getSpacesForPlace`.
 */
const createMockSpace = (id: string, placeId: string, contents: Array<{ language: string; name: string; accessibilityInfo?: string }>) => {
  const space = new EventLocationSpace(id, placeId);
  for (const c of contents) {
    space.addContent(new EventLocationSpaceContent(c.language, c.name, c.accessibilityInfo ?? ''));
  }
  return space;
};

const createWrapper = async (
  props: { calendarUrlName: string; placeId: string; spaceId?: string | null } = { calendarUrlName: 'test-calendar', placeId: 'place-1' },
  pinia?: Pinia,
) => {
  // edit-space does not navigate, but mountComponent requires a router instance.
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: {} }],
  });
  await router.push('/');
  await router.isReady();

  const wrapper = mountComponent(EditSpaceView, router, { props, pinia });
  await flushPromises();
  return wrapper;
};

describe('EditSpaceView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('Create mode', () => {
    it('renders with the New Space title', async () => {
      const wrapper = await createWrapper();
      const heading = wrapper.find('.space-editor-title');
      expect(heading.exists()).toBe(true);
      expect(heading.text()).toBe('New Space');
    });

    it('renders with empty name and accessibility-info inputs', async () => {
      const wrapper = await createWrapper();
      const nameInput = wrapper.find('[id^="space-name-"]');
      const textarea = wrapper.find('[id^="space-accessibility-"]');
      expect(nameInput.exists()).toBe(true);
      expect(textarea.exists()).toBe(true);
      expect((nameInput.element as HTMLInputElement).value).toBe('');
      expect((textarea.element as HTMLTextAreaElement).value).toBe('');
    });

    it('shows a visible required indicator on the name field label', async () => {
      const wrapper = await createWrapper();
      const nameLabel = wrapper.find('label[for^="space-name-"]');
      expect(nameLabel.exists()).toBe(true);
      const indicator = nameLabel.find('.required-indicator');
      expect(indicator.exists()).toBe(true);
      expect(indicator.text()).toBe('*');
      expect(indicator.attributes('aria-hidden')).toBe('true');
    });

    it('calls locationStore.createSpace with content keyed by language on save', async () => {
      const wrapper = await createWrapper();
      const store = useLocationStore();
      const createSpy = vi.spyOn(store, 'createSpace').mockResolvedValue(
        createMockSpace('space-new', 'place-1', [{ language: 'en', name: 'Pacific Room' }]),
      );

      await wrapper.find('[id^="space-name-"]').setValue('Pacific Room');
      await wrapper.find('[id^="space-accessibility-"]').setValue('Wheelchair accessible');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(createSpy).toHaveBeenCalledWith(
        'test-calendar',
        'place-1',
        {
          en: { name: 'Pacific Room', accessibilityInfo: 'Wheelchair accessible' },
        },
      );
    });

    it('does not call updateSpace in create mode', async () => {
      const wrapper = await createWrapper();
      const store = useLocationStore();
      vi.spyOn(store, 'createSpace').mockResolvedValue(
        createMockSpace('space-new', 'place-1', [{ language: 'en', name: 'Pacific Room' }]),
      );
      const updateSpy = vi.spyOn(store, 'updateSpace').mockResolvedValue(
        createMockSpace('space-new', 'place-1', [{ language: 'en', name: 'Pacific Room' }]),
      );

      await wrapper.find('[id^="space-name-"]').setValue('Pacific Room');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('emits save after a successful create', async () => {
      const wrapper = await createWrapper();
      const store = useLocationStore();
      vi.spyOn(store, 'createSpace').mockResolvedValue(
        createMockSpace('space-new', 'place-1', [{ language: 'en', name: 'Pacific Room' }]),
      );

      await wrapper.find('[id^="space-name-"]').setValue('Pacific Room');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(wrapper.emitted('save')).toBeTruthy();
      expect(wrapper.emitted('save')).toHaveLength(1);
    });
  });

  describe('Validation', () => {
    it('shows an error and does not call the store when no language has a non-empty name', async () => {
      const wrapper = await createWrapper();
      const store = useLocationStore();
      const createSpy = vi.spyOn(store, 'createSpace').mockResolvedValue(
        createMockSpace('space-new', 'place-1', [{ language: 'en', name: 'x' }]),
      );

      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(createSpy).not.toHaveBeenCalled();
      const error = wrapper.find('[role="alert"]');
      expect(error.exists()).toBe(true);
    });

    it('treats whitespace-only names as empty for validation', async () => {
      const wrapper = await createWrapper();
      const store = useLocationStore();
      const createSpy = vi.spyOn(store, 'createSpace').mockResolvedValue(
        createMockSpace('space-new', 'place-1', [{ language: 'en', name: 'x' }]),
      );

      await wrapper.find('[id^="space-name-"]').setValue('   ');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(createSpy).not.toHaveBeenCalled();
      const error = wrapper.find('[role="alert"]');
      expect(error.exists()).toBe(true);
    });

    it('does not emit save on validation failure', async () => {
      const wrapper = await createWrapper();
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(wrapper.emitted('save')).toBeFalsy();
    });
  });

  describe('Edit mode', () => {
    it('renders with the Edit Space title when spaceId is set', async () => {
      // Seed the store cache so the edit-mode populates from cached state.
      const pinia = createPinia();
      setActivePinia(pinia);
      const store = useLocationStore();
      store.setSpacesForPlace('place-1', [
        createMockSpace('space-1', 'place-1', [
          { language: 'en', name: 'Pacific Room', accessibilityInfo: 'Step-free entry' },
        ]),
      ]);

      const wrapper = await createWrapper({
        calendarUrlName: 'test-calendar',
        placeId: 'place-1',
        spaceId: 'space-1',
      }, pinia);

      const heading = wrapper.find('.space-editor-title');
      expect(heading.text()).toBe('Edit Space');
    });

    it('populates the form from cached Space content', async () => {
      const pinia = createPinia();
      setActivePinia(pinia);
      const store = useLocationStore();
      store.setSpacesForPlace('place-1', [
        createMockSpace('space-1', 'place-1', [
          { language: 'en', name: 'Pacific Room', accessibilityInfo: 'Step-free entry' },
        ]),
      ]);

      const wrapper = await createWrapper({
        calendarUrlName: 'test-calendar',
        placeId: 'place-1',
        spaceId: 'space-1',
      }, pinia);

      const nameInput = wrapper.find('[id^="space-name-"]');
      const textarea = wrapper.find('[id^="space-accessibility-"]');
      expect((nameInput.element as HTMLInputElement).value).toBe('Pacific Room');
      expect((textarea.element as HTMLTextAreaElement).value).toBe('Step-free entry');
    });

    it('calls locationStore.updateSpace on save with the spaceId', async () => {
      const pinia = createPinia();
      setActivePinia(pinia);
      const store = useLocationStore();
      store.setSpacesForPlace('place-1', [
        createMockSpace('space-1', 'place-1', [
          { language: 'en', name: 'Pacific Room' },
        ]),
      ]);
      const updateSpy = vi.spyOn(store, 'updateSpace').mockResolvedValue(
        createMockSpace('space-1', 'place-1', [{ language: 'en', name: 'Atlantic Room' }]),
      );

      const wrapper = await createWrapper({
        calendarUrlName: 'test-calendar',
        placeId: 'place-1',
        spaceId: 'space-1',
      }, pinia);

      await wrapper.find('[id^="space-name-"]').setValue('Atlantic Room');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(updateSpy).toHaveBeenCalledWith(
        'test-calendar',
        'place-1',
        'space-1',
        { en: expect.objectContaining({ name: 'Atlantic Room' }) },
      );
    });

    it('does not call createSpace in edit mode', async () => {
      const pinia = createPinia();
      setActivePinia(pinia);
      const store = useLocationStore();
      store.setSpacesForPlace('place-1', [
        createMockSpace('space-1', 'place-1', [{ language: 'en', name: 'Pacific Room' }]),
      ]);
      const createSpy = vi.spyOn(store, 'createSpace').mockResolvedValue(
        createMockSpace('space-x', 'place-1', [{ language: 'en', name: 'x' }]),
      );
      vi.spyOn(store, 'updateSpace').mockResolvedValue(
        createMockSpace('space-1', 'place-1', [{ language: 'en', name: 'x' }]),
      );

      const wrapper = await createWrapper({
        calendarUrlName: 'test-calendar',
        placeId: 'place-1',
        spaceId: 'space-1',
      }, pinia);

      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(createSpy).not.toHaveBeenCalled();
    });

    it('emits save after a successful update', async () => {
      const pinia = createPinia();
      setActivePinia(pinia);
      const store = useLocationStore();
      store.setSpacesForPlace('place-1', [
        createMockSpace('space-1', 'place-1', [{ language: 'en', name: 'Pacific Room' }]),
      ]);
      vi.spyOn(store, 'updateSpace').mockResolvedValue(
        createMockSpace('space-1', 'place-1', [{ language: 'en', name: 'Atlantic Room' }]),
      );

      const wrapper = await createWrapper({
        calendarUrlName: 'test-calendar',
        placeId: 'place-1',
        spaceId: 'space-1',
      }, pinia);

      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(wrapper.emitted('save')).toBeTruthy();
    });
  });

  describe('Cancel', () => {
    it('emits cancel when the cancel button is clicked', async () => {
      const wrapper = await createWrapper();

      await wrapper.find('.btn-cancel').trigger('click');

      expect(wrapper.emitted('cancel')).toBeTruthy();
      expect(wrapper.emitted('cancel')).toHaveLength(1);
    });

    it('does not call the store when cancelled without changes', async () => {
      const wrapper = await createWrapper();
      const store = useLocationStore();
      const createSpy = vi.spyOn(store, 'createSpace').mockResolvedValue(
        createMockSpace('space-new', 'place-1', [{ language: 'en', name: 'x' }]),
      );
      const updateSpy = vi.spyOn(store, 'updateSpace').mockResolvedValue(
        createMockSpace('space-1', 'place-1', [{ language: 'en', name: 'x' }]),
      );

      await wrapper.find('.btn-cancel').trigger('click');
      await flushPromises();

      expect(createSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('does not call the store when cancelled after typing into the form', async () => {
      const wrapper = await createWrapper();
      const store = useLocationStore();
      const createSpy = vi.spyOn(store, 'createSpace').mockResolvedValue(
        createMockSpace('space-new', 'place-1', [{ language: 'en', name: 'x' }]),
      );

      await wrapper.find('[id^="space-name-"]').setValue('Typed but cancelled');
      await wrapper.find('.btn-cancel').trigger('click');
      await flushPromises();

      expect(createSpy).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('shows an error when save fails', async () => {
      const wrapper = await createWrapper();
      const store = useLocationStore();
      vi.spyOn(store, 'createSpace').mockRejectedValueOnce(new Error('Server error'));

      await wrapper.find('[id^="space-name-"]').setValue('Pacific Room');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      const error = wrapper.find('[role="alert"]');
      expect(error.exists()).toBe(true);
    });

    it('does not emit save when the store throws', async () => {
      const wrapper = await createWrapper();
      const store = useLocationStore();
      vi.spyOn(store, 'createSpace').mockRejectedValueOnce(new Error('Server error'));

      await wrapper.find('[id^="space-name-"]').setValue('Pacific Room');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(wrapper.emitted('save')).toBeFalsy();
    });

    it('allows dismissing the error', async () => {
      const wrapper = await createWrapper();

      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(wrapper.find('[role="alert"]').exists()).toBe(true);

      await wrapper.find('.error-dismiss').trigger('click');
      await flushPromises();

      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    });
  });
});
