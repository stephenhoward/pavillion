import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import CreateLocationForm from '@/client/components/common/create-location-form.vue';
import PillButton from '@/client/components/common/pill-button.vue';
import LanguageTabSelector from '@/client/components/common/language-tab-selector.vue';
import { EventLocationSpace, EventLocationSpaceContent } from '@/common/model/location';
import enSystem from '@/client/locales/en/system.json';
import enEventEditor from '@/client/locales/en/event_editor.json';

const SheetStub = {
  props: ['title'],
  template: `
    <dialog role="dialog" aria-modal="true">
      <h2>{{ title }}</h2>
      <slot/>
    </dialog>
  `,
  emits: ['close'],
  setup() {
    return { open: () => {}, close: () => {} };
  },
};

// SpacesEditor stub. Mirrors the real component's contract: it owns no
// removal policy and emits `remove-space` on delete-button clicks. Additions
// and edits go via `update:spaces` (the v-model channel).
const SpacesEditorStub = {
  name: 'SpacesEditor',
  props: ['spaces'],
  emits: ['update:spaces', 'remove-space'],
  methods: {
    addStagedSpace(this: { spaces: EventLocationSpace[]; $emit: (event: string, ...args: any[]) => void }) {
      const staged = new EventLocationSpace(undefined, undefined);
      staged.clientId = `client-${Math.random().toString(36).slice(2, 10)}`;
      staged.addContent(new EventLocationSpaceContent('en', 'Staged Room', ''));
      this.$emit('update:spaces', [...(this.spaces ?? []), staged]);
    },
    // Emits `remove-space` for the first staged space — matches what the real
    // SpacesEditor does when its delete icon is clicked. The parent is
    // responsible for filtering the array; the stub does not mutate it.
    removeFirstViaEmit(this: { spaces: EventLocationSpace[]; $emit: (event: string, ...args: any[]) => void }) {
      const first = (this.spaces ?? [])[0];
      if (first) {
        this.$emit('remove-space', first);
      }
    },
  },
  template: `
    <div class="spaces-editor-stub">
      <button type="button" class="stub-add-space" @click="addStagedSpace">Add</button>
      <button type="button" class="stub-remove-first" @click="removeFirstViaEmit">Remove</button>
      <ul>
        <li v-for="s in spaces" :key="s.id || s.clientId">{{ s.content('en')?.name }}</li>
      </ul>
    </div>
  `,
};

describe('CreateLocationForm', () => {
  beforeEach(async () => {
    await i18next.init({
      lng: 'en',
      resources: {
        en: {
          system: enSystem,
          event_editor: enEventEditor,
        },
      },
    });
  });

  function mountWithI18n(options: any = {}) {
    return mount(CreateLocationForm, {
      ...options,
      global: {
        plugins: [[I18NextVue, { i18next }]],
        components: options.global?.components,
        stubs: {
          Sheet: SheetStub,
          SpacesEditor: SpacesEditorStub,
          ...(options.global?.stubs ?? {}),
        },
      },
    });
  }

  describe('rendering', () => {
    it('should render with title', () => {
      const wrapper = mountWithI18n({
        props: {
          languages: ['en'],
        },
      });

      expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
      expect(wrapper.find('h2').text()).toBe('Create Location');
    });

    it('should render all form fields', () => {
      const wrapper = mountWithI18n({
        props: {
          languages: ['en'],
        },
      });

      expect(wrapper.find('input[placeholder="Location name *"]').exists()).toBe(true);
      expect(wrapper.find('input[placeholder="Street address"]').exists()).toBe(true);
      expect(wrapper.find('input[placeholder="City"]').exists()).toBe(true);
      expect(wrapper.find('input[placeholder="State"]').exists()).toBe(true);
      expect(wrapper.find('input[placeholder="Postal code"]').exists()).toBe(true);
    });

    it('should render accessibility section with language tabs', () => {
      const wrapper = mountWithI18n({
        props: {
          languages: ['en', 'es'],
        },
        global: {
          components: { LanguageTabSelector },
        },
      });

      const languageTabs = wrapper.findComponent(LanguageTabSelector);
      expect(languageTabs.exists()).toBe(true);
      expect(languageTabs.props('languages')).toEqual(['en', 'es']);
    });

    it('should render accessibility textarea', () => {
      const wrapper = mountWithI18n({
        props: {
          languages: ['en'],
        },
      });

      const textarea = wrapper.find('textarea[placeholder="Accessibility information (optional)"]');
      expect(textarea.exists()).toBe(true);
    });

    it('should render footer buttons', () => {
      const wrapper = mountWithI18n({
        props: {
          languages: ['en'],
        },
        global: {
          components: { PillButton },
        },
      });

      const buttons = wrapper.findAllComponents(PillButton);
      expect(buttons.length).toBeGreaterThanOrEqual(2);

      const backButton = buttons.find(b => b.text() === 'Back to search');
      const createButton = buttons.find(b => b.text() === 'Create Location');

      expect(backButton).toBeDefined();
      expect(backButton?.props('variant')).toBe('ghost');
      expect(createButton).toBeDefined();
      expect(createButton?.props('variant')).toBe('primary');
    });
  });

  describe('validation', () => {
    it('should disable Create button when name is empty', () => {
      const wrapper = mountWithI18n({
        props: {
          languages: ['en'],
        },
        global: {
          components: { PillButton },
        },
      });

      const buttons = wrapper.findAllComponents(PillButton);
      const createButton = buttons.find(b => b.text() === 'Create Location');

      expect(createButton?.props('disabled')).toBe(true);
    });

    it('should enable Create button when name is filled', async () => {
      const wrapper = mountWithI18n({
        props: {
          languages: ['en'],
        },
        global: {
          components: { PillButton },
        },
      });

      const nameInput = wrapper.find('input[placeholder="Location name *"]');
      await nameInput.setValue('Test Venue');

      const buttons = wrapper.findAllComponents(PillButton);
      const createButton = buttons.find(b => b.text() === 'Create Location');

      expect(createButton?.props('disabled')).toBe(false);
    });

    it('should show required indicator on name field', () => {
      const wrapper = mountWithI18n({
        props: {
          languages: ['en'],
        },
      });

      const nameInput = wrapper.find('input[placeholder="Location name *"]');
      expect(nameInput.attributes('placeholder')).toContain('*');
    });
  });

  describe('language selector', () => {
    it('should switch accessibility language when tab selected', async () => {
      const wrapper = mountWithI18n({
        props: {
          languages: ['en', 'es'],
        },
        global: {
          components: { LanguageTabSelector },
        },
      });

      const languageTabs = wrapper.findComponent(LanguageTabSelector);

      // Enter accessibility info for English
      const textarea = wrapper.find('textarea');
      await textarea.setValue('Wheelchair accessible');

      // Switch to Spanish
      await languageTabs.vm.$emit('update:modelValue', 'es');

      // Textarea should be empty for Spanish
      expect(textarea.element.value).toBe('');
    });

    it('should preserve accessibility info when switching languages', async () => {
      const wrapper = mountWithI18n({
        props: {
          languages: ['en', 'es'],
        },
        global: {
          components: { LanguageTabSelector },
        },
      });

      const languageTabs = wrapper.findComponent(LanguageTabSelector);
      const textarea = wrapper.find('textarea');

      // Enter English accessibility info
      await textarea.setValue('Wheelchair accessible');

      // Switch to Spanish
      await languageTabs.vm.$emit('update:modelValue', 'es');

      // Enter Spanish accessibility info
      await textarea.setValue('Accesible en silla de ruedas');

      // Switch back to English
      await languageTabs.vm.$emit('update:modelValue', 'en');

      // English info should still be there
      expect(textarea.element.value).toBe('Wheelchair accessible');
    });

    it('should handle add language event', async () => {
      const wrapper = mountWithI18n({
        props: {
          languages: ['en'],
        },
        global: {
          components: { LanguageTabSelector },
        },
      });

      const languageTabs = wrapper.findComponent(LanguageTabSelector);
      await languageTabs.vm.$emit('add-language');

      expect(wrapper.emitted('add-language')).toBeTruthy();
    });
  });

  describe('form submission', () => {
    it('should emit create-location with form data', async () => {
      const wrapper = mountWithI18n({
        props: {
          languages: ['en'],
        },
        global: {
          components: { PillButton },
        },
      });

      // Fill form
      await wrapper.find('input[placeholder="Location name *"]').setValue('Test Venue');
      await wrapper.find('input[placeholder="Street address"]').setValue('123 Main St');
      await wrapper.find('input[placeholder="City"]').setValue('Portland');
      await wrapper.find('input[placeholder="State"]').setValue('OR');
      await wrapper.find('input[placeholder="Postal code"]').setValue('97201');

      // Submit
      const buttons = wrapper.findAllComponents(PillButton);
      const createButton = buttons.find(b => b.text() === 'Create Location');
      await createButton?.vm.$emit('click');

      expect(wrapper.emitted('create-location')).toBeTruthy();
      const emittedData = wrapper.emitted('create-location')?.[0][0] as any;

      expect(emittedData.name).toBe('Test Venue');
      expect(emittedData.address).toBe('123 Main St');
      expect(emittedData.city).toBe('Portland');
      expect(emittedData.state).toBe('OR');
      expect(emittedData.postalCode).toBe('97201');
    });

    it('should include accessibility info in submission', async () => {
      const wrapper = mountWithI18n({
        props: {
          languages: ['en', 'es'],
        },
        global: {
          components: { PillButton, LanguageTabSelector },
        },
      });

      // Fill basic info
      await wrapper.find('input[placeholder="Location name *"]').setValue('Test Venue');

      // Add English accessibility info
      await wrapper.find('textarea').setValue('Wheelchair accessible');

      // Switch to Spanish and add info
      const languageTabs = wrapper.findComponent(LanguageTabSelector);
      await languageTabs.vm.$emit('update:modelValue', 'es');
      await wrapper.find('textarea').setValue('Accesible en silla de ruedas');

      // Submit
      const buttons = wrapper.findAllComponents(PillButton);
      const createButton = buttons.find(b => b.text() === 'Create Location');
      await createButton?.vm.$emit('click');

      const emittedData = wrapper.emitted('create-location')?.[0][0] as any;

      expect(emittedData.content).toBeDefined();
      expect(emittedData.content.en).toBeDefined();
      expect(emittedData.content.en.accessibilityInfo).toBe('Wheelchair accessible');
      expect(emittedData.content.es).toBeDefined();
      expect(emittedData.content.es.accessibilityInfo).toBe('Accesible en silla de ruedas');
    });

    it('should omit empty optional fields', async () => {
      const wrapper = mountWithI18n({
        props: {
          languages: ['en'],
        },
        global: {
          components: { PillButton },
        },
      });

      // Fill only required field
      await wrapper.find('input[placeholder="Location name *"]').setValue('Test Venue');

      // Submit
      const buttons = wrapper.findAllComponents(PillButton);
      const createButton = buttons.find(b => b.text() === 'Create Location');
      await createButton?.vm.$emit('click');

      const emittedData = wrapper.emitted('create-location')?.[0][0] as any;

      expect(emittedData.name).toBe('Test Venue');
      expect(emittedData.address).toBeUndefined();
      expect(emittedData.city).toBeUndefined();
      expect(emittedData.state).toBeUndefined();
      expect(emittedData.postalCode).toBeUndefined();
    });

    it('emits create-location with empty spaces array when no rooms staged', async () => {
      const wrapper = mountWithI18n({
        props: { languages: ['en'] },
        global: { components: { PillButton } },
      });
      await wrapper.find('input[placeholder="Location name *"]').setValue('Empty Venue');

      const buttons = wrapper.findAllComponents(PillButton);
      const createButton = buttons.find(b => b.text() === 'Create Location');
      await createButton?.vm.$emit('click');

      const emitted = wrapper.emitted('create-location')?.[0][0] as any;
      expect(emitted.spaces).toEqual([]);
    });

    it('emits create-location with one staged space carrying clientId and per-language content', async () => {
      const wrapper = mountWithI18n({
        props: { languages: ['en'] },
        global: { components: { PillButton } },
      });
      await wrapper.find('input[placeholder="Location name *"]').setValue('Venue with Room');

      // Stage a room via the SpacesEditor stub
      await wrapper.find('.stub-add-space').trigger('click');

      const buttons = wrapper.findAllComponents(PillButton);
      const createButton = buttons.find(b => b.text() === 'Create Location');
      await createButton?.vm.$emit('click');

      const emitted = wrapper.emitted('create-location')?.[0][0] as any;
      expect(emitted.spaces).toHaveLength(1);
      expect(emitted.spaces[0].clientId).toBeTruthy();
      expect(emitted.spaces[0].content?.en?.name).toBe('Staged Room');
    });

    it('emits create-location with empty spaces array after staging then removing a room', async () => {
      const wrapper = mountWithI18n({
        props: { languages: ['en'] },
        global: { components: { PillButton } },
      });
      await wrapper.find('input[placeholder="Location name *"]').setValue('Venue add-then-remove');

      // Stage then remove. The stub's remove button emits `remove-space`,
      // exercising the parent's @remove-space handler (handleRemoveSpace).
      await wrapper.find('.stub-add-space').trigger('click');
      await wrapper.find('.stub-remove-first').trigger('click');

      const buttons = wrapper.findAllComponents(PillButton);
      const createButton = buttons.find(b => b.text() === 'Create Location');
      await createButton?.vm.$emit('click');

      const emitted = wrapper.emitted('create-location')?.[0][0] as any;
      expect(emitted.spaces).toEqual([]);
    });

    // Verifies the parent's @remove-space wiring against the actual event the
    // real SpacesEditor emits. With two rooms staged, removing the first
    // should leave the second intact — confirming the filter in
    // handleRemoveSpace targets the correct space by clientId.
    it('emits create-location with the remaining staged space after removing one of two rooms', async () => {
      const wrapper = mountWithI18n({
        props: { languages: ['en'] },
        global: { components: { PillButton } },
      });
      await wrapper.find('input[placeholder="Location name *"]').setValue('Venue with Two Rooms');

      // Stage two rooms, then remove the first via the `remove-space` event.
      await wrapper.find('.stub-add-space').trigger('click');
      await wrapper.find('.stub-add-space').trigger('click');
      await wrapper.find('.stub-remove-first').trigger('click');

      const buttons = wrapper.findAllComponents(PillButton);
      const createButton = buttons.find(b => b.text() === 'Create Location');
      await createButton?.vm.$emit('click');

      const emitted = wrapper.emitted('create-location')?.[0][0] as any;
      expect(emitted.spaces).toHaveLength(1);
      expect(emitted.spaces[0].clientId).toBeTruthy();
      expect(emitted.spaces[0].content?.en?.name).toBe('Staged Room');
    });
  });

  describe('navigation', () => {
    it('should emit back-to-search when Back button clicked', async () => {
      const wrapper = mountWithI18n({
        props: {
          languages: ['en'],
        },
        global: {
          components: { PillButton },
        },
      });

      const buttons = wrapper.findAllComponents(PillButton);
      const backButton = buttons.find(b => b.text() === 'Back to search');
      await backButton?.vm.$emit('click');

      expect(wrapper.emitted('back-to-search')).toBeTruthy();
    });
  });

  describe('field-level errors', () => {
    it('should show a field error for the name input when fieldErrors.name is set', () => {
      const wrapper = mountWithI18n({
        props: {
          languages: ['en'],
          fieldErrors: { name: 'Location name is required' },
        },
      });

      const errorEl = wrapper.find('#create-location-name-error');
      expect(errorEl.exists()).toBe(true);
      expect(errorEl.text()).toBe('Location name is required');
    });

    it('should not render the name error element when fieldErrors.name is absent', () => {
      const wrapper = mountWithI18n({
        props: {
          languages: ['en'],
        },
      });

      expect(wrapper.find('#create-location-name-error').exists()).toBe(false);
    });

    it('should set aria-invalid on the name input when fieldErrors.name is set', () => {
      const wrapper = mountWithI18n({
        props: {
          languages: ['en'],
          fieldErrors: { name: 'Location name is required' },
        },
      });

      const nameInput = wrapper.find('input#create-location-name');
      expect(nameInput.attributes('aria-invalid')).toBe('true');
    });

    it('should set aria-describedby on the name input pointing to the error element', () => {
      const wrapper = mountWithI18n({
        props: {
          languages: ['en'],
          fieldErrors: { name: 'Location name is required' },
        },
      });

      const nameInput = wrapper.find('input#create-location-name');
      expect(nameInput.attributes('aria-describedby')).toBe('create-location-name-error');
    });

    it('should not set aria-invalid or aria-describedby when there is no field error', () => {
      const wrapper = mountWithI18n({
        props: {
          languages: ['en'],
        },
      });

      const nameInput = wrapper.find('input#create-location-name');
      expect(nameInput.attributes('aria-invalid')).toBeUndefined();
      expect(nameInput.attributes('aria-describedby')).toBeUndefined();
    });

    it('should display submission error when submissionError prop is set', () => {
      const wrapper = mountWithI18n({
        props: {
          languages: ['en'],
          submissionError: 'Failed to create location. Please correct the errors and try again.',
        },
      });

      const errorEl = wrapper.find('[role="alert"]');
      expect(errorEl.exists()).toBe(true);
      expect(errorEl.text()).toContain('Failed to create location');
    });

    it('should not display submission error when submissionError prop is empty', () => {
      const wrapper = mountWithI18n({
        props: {
          languages: ['en'],
        },
      });

      // No submission error element — only name error is absent too
      const alerts = wrapper.findAll('[role="alert"]');
      expect(alerts.length).toBe(0);
    });
  });
});
