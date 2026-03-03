import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import CreateLocationForm from '@/client/components/common/CreateLocationForm.vue';
import PillButton from '@/client/components/common/PillButton.vue';
import LanguageTabSelector from '@/client/components/common/LanguageTabSelector.vue';
import enSystem from '@/client/locales/en/system.json';

describe('CreateLocationForm', () => {
  beforeEach(async () => {
    // Initialize i18next for tests
    await i18next.init({
      lng: 'en',
      resources: {
        en: {
          system: enSystem,
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
      },
    });
  }

  describe('rendering', () => {
    it('should render dialog with title', () => {
      const wrapper = mountWithI18n({
        props: {
          languages: ['en'],
        },
      });

      expect(wrapper.find('dialog').exists()).toBe(true);
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
});
