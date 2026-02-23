import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, VueWrapper, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import LanguageSettings from '../language-settings.vue';
import Config from '@/client/service/config';

// Initialize i18next for tests
i18next.init({
  lng: 'en',
  resources: {
    en: {
      admin: {
        settings: {
          language_settings: 'Language Settings',
          language_settings_subtitle: 'Configure language options',
          enabled_languages: 'Enabled Languages',
          enabled_languages_description: 'Select languages',
          force_language: 'Force Language',
          force_language_none: 'None',
          force_language_description: 'Force a specific language',
          save_settings_button: 'Save Settings',
          settings_update_success: 'Settings saved successfully',
          settings_update_failed: 'Failed to save settings',
        },
      },
    },
  },
});

describe('LanguageSettings.vue', () => {
  let wrapper: VueWrapper;

  const mockConfigService = {
    settings: () => ({
      registrationMode: 'open',
      defaultDateRange: 'month' as const,
      defaultLanguage: 'en',
      enabledLanguages: ['en', 'es'],
      forceLanguage: null,
    }),
    updateSettings: vi.fn().mockResolvedValue(true),
  };

  beforeEach(() => {
    vi.spyOn(Config, 'init').mockResolvedValue(mockConfigService as unknown as Config);
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.restoreAllMocks();
  });

  async function mountComponent(): Promise<VueWrapper> {
    const w = mount(LanguageSettings, {
      global: {
        plugins: [[I18NextVue, { i18next }]],
      },
    });
    await flushPromises();
    await nextTick();
    return w;
  }

  describe('ARIA live region roles', () => {
    it('should render success message with role=status aria-live=polite after successful save', async () => {
      vi.spyOn(Config, 'init').mockResolvedValue({
        ...mockConfigService,
        updateSettings: vi.fn().mockResolvedValue(true),
      } as unknown as Config);

      wrapper = await mountComponent();

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();
      await nextTick();

      // The message element itself carries role=status and class message-success
      const successMessage = wrapper.find('[role="status"][aria-live="polite"].message-success');
      expect(successMessage.exists()).toBe(true);
    });

    it('should render error message with role=alert aria-live=assertive after failed save', async () => {
      vi.spyOn(Config, 'init').mockResolvedValue({
        ...mockConfigService,
        updateSettings: vi.fn().mockResolvedValue(false),
      } as unknown as Config);

      wrapper = await mountComponent();

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();
      await nextTick();

      // The message element itself carries role=alert and class message-error
      const errorMessage = wrapper.find('[role="alert"][aria-live="assertive"].message-error');
      expect(errorMessage.exists()).toBe(true);
    });

    it('should NOT render live region elements on initial load (no spurious announcements)', async () => {
      wrapper = await mountComponent();

      // On initial mount, no messages are shown — live regions must not exist in DOM
      expect(wrapper.find('[role="status"]').exists()).toBe(false);
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    });

    it('should render success message with role=status container after successful save', async () => {
      const updateSettingsMock = vi.fn().mockResolvedValue(true);
      vi.spyOn(Config, 'init').mockResolvedValue({
        ...mockConfigService,
        updateSettings: updateSettingsMock,
      } as unknown as Config);

      wrapper = await mountComponent();

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();
      await nextTick();

      const successMessage = wrapper.find('.message-success');
      expect(successMessage.exists()).toBe(true);
      expect(successMessage.attributes('role')).toBe('status');
      expect(successMessage.attributes('aria-live')).toBe('polite');
    });

    it('should render error message inside role=alert container after failed save', async () => {
      vi.spyOn(Config, 'init').mockResolvedValue({
        ...mockConfigService,
        updateSettings: vi.fn().mockResolvedValue(false),
      } as unknown as Config);

      wrapper = await mountComponent();

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();
      await nextTick();

      const errorMessage = wrapper.find('.message-error');
      expect(errorMessage.exists()).toBe(true);
      expect(errorMessage.attributes('role')).toBe('alert');
      expect(errorMessage.attributes('aria-live')).toBe('assertive');
    });

    it('should render error message inside role=alert container when save throws', async () => {
      vi.spyOn(Config, 'init').mockResolvedValue({
        ...mockConfigService,
        updateSettings: vi.fn().mockRejectedValue(new Error('Network error')),
      } as unknown as Config);

      wrapper = await mountComponent();

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();
      await nextTick();

      const errorMessage = wrapper.find('.message-error');
      expect(errorMessage.exists()).toBe(true);
      expect(errorMessage.attributes('role')).toBe('alert');
      expect(errorMessage.attributes('aria-live')).toBe('assertive');
    });
  });

  describe('decorative SVG accessibility', () => {
    it('should have aria-hidden="true" on the SVG icon in the success message', async () => {
      vi.spyOn(Config, 'init').mockResolvedValue({
        ...mockConfigService,
        updateSettings: vi.fn().mockResolvedValue(true),
      } as unknown as Config);

      wrapper = await mountComponent();

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();
      await nextTick();

      const successMessage = wrapper.find('.message-success');
      expect(successMessage.exists()).toBe(true);

      const svg = successMessage.find('svg');
      expect(svg.exists()).toBe(true);
      expect(svg.attributes('aria-hidden')).toBe('true');
    });

    it('should have aria-hidden="true" on the SVG icon in the error message', async () => {
      vi.spyOn(Config, 'init').mockResolvedValue({
        ...mockConfigService,
        updateSettings: vi.fn().mockResolvedValue(false),
      } as unknown as Config);

      wrapper = await mountComponent();

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();
      await nextTick();

      const errorMessage = wrapper.find('.message-error');
      expect(errorMessage.exists()).toBe(true);

      const svg = errorMessage.find('svg');
      expect(svg.exists()).toBe(true);
      expect(svg.attributes('aria-hidden')).toBe('true');
    });
  });
});
