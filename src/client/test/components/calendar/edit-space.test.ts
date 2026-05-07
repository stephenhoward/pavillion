import { describe, it, expect, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { createPinia, setActivePinia, Pinia } from 'pinia';
import { mountComponent } from '@/client/test/lib/vue';
import EditSpaceView from '@/client/components/logged_in/calendar/edit-space.vue';
import { EventLocationSpace, EventLocationSpaceContent } from '@/common/model/location';

/**
 * Build an `EventLocationSpace` populated with translated content for the
 * supplied languages. Used as the `space` prop in edit-mode tests so the
 * component reads existing content directly from the parent's working buffer.
 */
const createMockSpace = (
  id: string | undefined,
  placeId: string,
  contents: Array<{ language: string; name: string; accessibilityInfo?: string }>,
) => {
  const space = new EventLocationSpace(id, placeId);
  for (const c of contents) {
    space.addContent(new EventLocationSpaceContent(c.language, c.name, c.accessibilityInfo ?? ''));
  }
  return space;
};

const createWrapper = async (
  props: { space?: EventLocationSpace | null } = {},
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
    it('renders with the New Space title when no space prop is provided', async () => {
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

    it('emits save with a staged EventLocationSpace carrying per-language content', async () => {
      const wrapper = await createWrapper();

      await wrapper.find('[id^="space-name-"]').setValue('Pacific Room');
      await wrapper.find('[id^="space-accessibility-"]').setValue('Wheelchair accessible');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      const saveEvents = wrapper.emitted('save');
      expect(saveEvents).toBeTruthy();
      expect(saveEvents).toHaveLength(1);

      const payload = saveEvents![0][0] as EventLocationSpace;
      expect(payload).toBeInstanceOf(EventLocationSpace);
      // No source row → identity fields are blank; parent stamps a clientId.
      expect(payload.id).toBe('');
      expect(payload.clientId).toBeUndefined();
      expect(payload.content('en').name).toBe('Pacific Room');
      expect(payload.content('en').accessibilityInfo).toBe('Wheelchair accessible');
    });

    it('emits save when only the name is filled (accessibility info optional)', async () => {
      const wrapper = await createWrapper();

      await wrapper.find('[id^="space-name-"]').setValue('Pacific Room');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      const saveEvents = wrapper.emitted('save');
      expect(saveEvents).toBeTruthy();
      const payload = saveEvents![0][0] as EventLocationSpace;
      expect(payload.content('en').name).toBe('Pacific Room');
      expect(payload.content('en').accessibilityInfo).toBe('');
    });
  });

  describe('Validation', () => {
    it('shows an error and does not emit save when no language has a non-empty name', async () => {
      const wrapper = await createWrapper();

      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(wrapper.emitted('save')).toBeFalsy();
      const error = wrapper.find('[role="alert"]');
      expect(error.exists()).toBe(true);
    });

    it('treats whitespace-only names as empty for validation', async () => {
      const wrapper = await createWrapper();

      await wrapper.find('[id^="space-name-"]').setValue('   ');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(wrapper.emitted('save')).toBeFalsy();
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
    it('renders with the Edit Space title when an existing space is passed in', async () => {
      const space = createMockSpace('space-1', 'place-1', [
        { language: 'en', name: 'Pacific Room', accessibilityInfo: 'Step-free entry' },
      ]);
      const wrapper = await createWrapper({ space });

      const heading = wrapper.find('.space-editor-title');
      expect(heading.text()).toBe('Edit Space');
    });

    it('populates the form from the source space prop', async () => {
      const space = createMockSpace('space-1', 'place-1', [
        { language: 'en', name: 'Pacific Room', accessibilityInfo: 'Step-free entry' },
      ]);
      const wrapper = await createWrapper({ space });

      const nameInput = wrapper.find('[id^="space-name-"]');
      const textarea = wrapper.find('[id^="space-accessibility-"]');
      expect((nameInput.element as HTMLInputElement).value).toBe('Pacific Room');
      expect((textarea.element as HTMLTextAreaElement).value).toBe('Step-free entry');
    });

    it('emits save with a staged copy preserving the source row identity', async () => {
      const space = createMockSpace('space-1', 'place-1', [
        { language: 'en', name: 'Pacific Room' },
      ]);
      const wrapper = await createWrapper({ space });

      await wrapper.find('[id^="space-name-"]').setValue('Atlantic Room');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      const saveEvents = wrapper.emitted('save');
      expect(saveEvents).toBeTruthy();
      const payload = saveEvents![0][0] as EventLocationSpace;
      expect(payload).toBeInstanceOf(EventLocationSpace);
      expect(payload.id).toBe('space-1');
      expect(payload.placeId).toBe('place-1');
      expect(payload.content('en').name).toBe('Atlantic Room');
    });

    it('preserves the source row clientId when editing a staged-but-unsaved space', async () => {
      const stagedSpace = createMockSpace(undefined, 'place-1', [
        { language: 'en', name: 'Pacific Room' },
      ]);
      stagedSpace.clientId = 'client-abc';

      const wrapper = await createWrapper({ space: stagedSpace });

      await wrapper.find('[id^="space-name-"]').setValue('Atlantic Room');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      const payload = wrapper.emitted('save')![0][0] as EventLocationSpace;
      expect(payload.id).toBe('');
      expect(payload.clientId).toBe('client-abc');
      expect(payload.content('en').name).toBe('Atlantic Room');
    });

    it('preserves the source row eventCount on the staged payload', async () => {
      const space = createMockSpace('space-1', 'place-1', [
        { language: 'en', name: 'Pacific Room' },
      ]);
      space.eventCount = 5;

      const wrapper = await createWrapper({ space });

      await wrapper.find('form').trigger('submit');
      await flushPromises();

      const payload = wrapper.emitted('save')![0][0] as EventLocationSpace;
      expect(payload.eventCount).toBe(5);
    });
  });

  describe('Cancel', () => {
    it('emits cancel when the cancel button is clicked', async () => {
      const wrapper = await createWrapper();

      await wrapper.find('.btn-cancel').trigger('click');

      expect(wrapper.emitted('cancel')).toBeTruthy();
      expect(wrapper.emitted('cancel')).toHaveLength(1);
    });

    it('does not emit save when cancelled without changes', async () => {
      const wrapper = await createWrapper();

      await wrapper.find('.btn-cancel').trigger('click');
      await flushPromises();

      expect(wrapper.emitted('save')).toBeFalsy();
    });

    it('does not emit save when cancelled after typing into the form', async () => {
      const wrapper = await createWrapper();

      await wrapper.find('[id^="space-name-"]').setValue('Typed but cancelled');
      await wrapper.find('.btn-cancel').trigger('click');
      await flushPromises();

      expect(wrapper.emitted('save')).toBeFalsy();
    });
  });

  describe('Done button label', () => {
    it('renders the submit button with the "Done" label', async () => {
      const wrapper = await createWrapper();
      const submitBtn = wrapper.find('button[type="submit"]');
      expect(submitBtn.exists()).toBe(true);
      expect(submitBtn.text()).toBe('Done');
    });
  });

  describe('Error dismissal', () => {
    it('allows dismissing the validation error', async () => {
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
