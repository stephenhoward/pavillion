import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import ModerationSettings from '@/client/components/admin/moderation-settings.vue';
import { useModerationStore } from '@/client/stores/moderation-store';
import adminTranslations from '@/client/locales/en/admin.json';

/**
 * Tests for the admin moderation-settings.vue component.
 *
 * Coverage:
 * - Auto-escalation threshold field (rendering, value display, helper text)
 * - Validation (zero accepted, positive accepted, negative rejected)
 * - Save functionality (success, error, persistence)
 * - IP retention settings (rendering, validation, save behavior)
 * - Loading state (controlled-promise pattern)
 */
describe('ModerationSettings.vue', () => {
  let wrapper: VueWrapper | null = null;
  let moderationStore: ReturnType<typeof useModerationStore>;

  const defaultSettings = {
    autoEscalationHours: 72,
    adminReportEscalationHours: 24,
    reminderBeforeEscalationHours: 12,
    autoEscalationThreshold: 5,
    ipHashRetentionDays: 30,
    ipSubnetRetentionDays: 90,
  };

  beforeEach(async () => {
    await i18next.init({
      lng: 'en',
      fallbackLng: 'en',
      resources: {
        en: {
          admin: adminTranslations,
        },
      },
    });

    setActivePinia(createPinia());
    moderationStore = useModerationStore();
    // Stub fetch once; tests below don't need to re-stub it.
    vi.spyOn(moderationStore, 'fetchModerationSettings').mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
    vi.restoreAllMocks();
  });

  function mountComponent(): VueWrapper {
    return mount(ModerationSettings, {
      global: {
        plugins: [[I18NextVue, { i18next }]],
        stubs: {
          LoadingMessage: true,
        },
      },
    });
  }

  describe('Auto-Escalation Threshold Field', () => {
    it('should render auto-escalation threshold input field', async () => {
      moderationStore.moderationSettings = { ...defaultSettings, autoEscalationThreshold: 3 };

      wrapper = mountComponent();
      await nextTick();
      await nextTick();

      const thresholdInput = wrapper.find('#auto-escalation-threshold');
      expect(thresholdInput.exists()).toBe(true);
      expect(thresholdInput.attributes('type')).toBe('number');
    });

    it('should display current auto-escalation threshold value', async () => {
      moderationStore.moderationSettings = { ...defaultSettings, autoEscalationThreshold: 5 };

      wrapper = mountComponent();
      await nextTick();
      await nextTick();

      const thresholdInput = wrapper.find('#auto-escalation-threshold');
      expect((thresholdInput.element as HTMLInputElement).value).toBe('5');
    });

    it('should show helper text explaining that 0 disables auto-escalation', async () => {
      moderationStore.moderationSettings = { ...defaultSettings, autoEscalationThreshold: 3 };

      wrapper = mountComponent();
      await nextTick();
      await nextTick();

      const helpText = wrapper.find('#auto-escalation-threshold-help');
      expect(helpText.exists()).toBe(true);
      expect(helpText.text()).toContain('0 to disable');
    });
  });

  describe('Validation', () => {
    it('should accept zero as a valid value (disables auto-escalation)', async () => {
      moderationStore.moderationSettings = { ...defaultSettings, autoEscalationThreshold: 3 };
      const saveSpy = vi.spyOn(moderationStore, 'saveModerationSettings').mockResolvedValue(undefined);

      wrapper = mountComponent();
      await nextTick();
      await nextTick();

      const thresholdInput = wrapper.find('#auto-escalation-threshold');
      await thresholdInput.setValue(0);

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');

      await nextTick();

      expect(saveSpy).toHaveBeenCalledWith(
        expect.objectContaining({ autoEscalationThreshold: 0 }),
      );
    });

    it('should accept positive integers as valid values', async () => {
      moderationStore.moderationSettings = { ...defaultSettings, autoEscalationThreshold: 3 };
      const saveSpy = vi.spyOn(moderationStore, 'saveModerationSettings').mockResolvedValue(undefined);

      wrapper = mountComponent();
      await nextTick();
      await nextTick();

      const thresholdInput = wrapper.find('#auto-escalation-threshold');
      await thresholdInput.setValue(5);

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');

      await nextTick();

      expect(saveSpy).toHaveBeenCalledWith(
        expect.objectContaining({ autoEscalationThreshold: 5 }),
      );
    });

    it('should reject negative values', async () => {
      moderationStore.moderationSettings = { ...defaultSettings, autoEscalationThreshold: 3 };
      const saveSpy = vi.spyOn(moderationStore, 'saveModerationSettings').mockResolvedValue(undefined);

      wrapper = mountComponent();
      await nextTick();
      await nextTick();

      const thresholdInput = wrapper.find('#auto-escalation-threshold');
      await thresholdInput.setValue(-1);

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');

      await nextTick();

      const errorText = wrapper.find('#auto-escalation-threshold-error');
      expect(errorText.exists()).toBe(true);
      expect(errorText.text()).toContain('0 or greater');
      expect(saveSpy).not.toHaveBeenCalled();
    });
  });

  describe('Save Functionality', () => {
    it('should persist changes via configuration API when save button is clicked', async () => {
      moderationStore.moderationSettings = { ...defaultSettings, autoEscalationThreshold: 3 };
      const saveSpy = vi.spyOn(moderationStore, 'saveModerationSettings').mockResolvedValue(undefined);

      wrapper = mountComponent();
      await nextTick();
      await nextTick();

      const thresholdInput = wrapper.find('#auto-escalation-threshold');
      await thresholdInput.setValue(10);

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');

      await nextTick();

      expect(saveSpy).toHaveBeenCalledWith(
        expect.objectContaining({ autoEscalationThreshold: 10 }),
      );
    });

    it('should show success feedback after save', async () => {
      moderationStore.moderationSettings = { ...defaultSettings, autoEscalationThreshold: 3 };
      vi.spyOn(moderationStore, 'saveModerationSettings').mockResolvedValue(undefined);

      wrapper = mountComponent();
      await nextTick();
      await nextTick();

      const thresholdInput = wrapper.find('#auto-escalation-threshold');
      await thresholdInput.setValue(4);

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');

      await nextTick();
      await nextTick();

      const successMessage = wrapper.find('.message-success');
      expect(successMessage.exists()).toBe(true);
    });

    it('should show error feedback if save fails', async () => {
      moderationStore.moderationSettings = { ...defaultSettings, autoEscalationThreshold: 3 };
      vi.spyOn(moderationStore, 'saveModerationSettings').mockRejectedValue(new Error('Network error'));

      wrapper = mountComponent();
      await nextTick();
      await nextTick();

      const thresholdInput = wrapper.find('#auto-escalation-threshold');
      await thresholdInput.setValue(4);

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');

      await nextTick();
      await nextTick();

      const errorMessage = wrapper.find('.message-error');
      expect(errorMessage.exists()).toBe(true);
    });
  });

  describe('IP Retention Settings', () => {
    it('should display IP hash retention days input field', async () => {
      moderationStore.moderationSettings = { ...defaultSettings };

      wrapper = mountComponent();
      await nextTick();
      await nextTick();

      const ipHashInput = wrapper.find('#ip-hash-retention');
      expect(ipHashInput.exists()).toBe(true);
      expect((ipHashInput.element as HTMLInputElement).value).toBe('30');
    });

    it('should display IP subnet retention days input field', async () => {
      moderationStore.moderationSettings = { ...defaultSettings };

      wrapper = mountComponent();
      await nextTick();
      await nextTick();

      const ipSubnetInput = wrapper.find('#ip-subnet-retention');
      expect(ipSubnetInput.exists()).toBe(true);
      expect((ipSubnetInput.element as HTMLInputElement).value).toBe('90');
    });

    it('should validate IP hash retention days as positive integer', async () => {
      moderationStore.moderationSettings = { ...defaultSettings };

      wrapper = mountComponent();
      await nextTick();
      await nextTick();

      const ipHashInput = wrapper.find('#ip-hash-retention');
      await ipHashInput.setValue(0);

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');

      await nextTick();

      const errorText = wrapper.find('#ip-hash-retention-error');
      expect(errorText.exists()).toBe(true);
      expect(errorText.text()).toContain('must be greater than 0');
    });

    it('should validate IP subnet retention days as positive integer', async () => {
      moderationStore.moderationSettings = { ...defaultSettings };

      wrapper = mountComponent();
      await nextTick();
      await nextTick();

      const ipSubnetInput = wrapper.find('#ip-subnet-retention');
      await ipSubnetInput.setValue(-5);

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');

      await nextTick();

      const errorText = wrapper.find('#ip-subnet-retention-error');
      expect(errorText.exists()).toBe(true);
      expect(errorText.text()).toContain('must be greater than 0');
    });

    it('should save IP retention settings when valid', async () => {
      moderationStore.moderationSettings = { ...defaultSettings };
      const saveSpy = vi.spyOn(moderationStore, 'saveModerationSettings').mockResolvedValue(undefined);

      wrapper = mountComponent();
      await nextTick();
      await nextTick();

      const ipHashInput = wrapper.find('#ip-hash-retention');
      await ipHashInput.setValue(45);

      const ipSubnetInput = wrapper.find('#ip-subnet-retention');
      await ipSubnetInput.setValue(120);

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');

      await nextTick();

      expect(saveSpy).toHaveBeenCalledWith({
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
        autoEscalationThreshold: 5,
        ipHashRetentionDays: 45,
        ipSubnetRetentionDays: 120,
      });
    });

    it('should show success message after saving', async () => {
      moderationStore.moderationSettings = { ...defaultSettings };
      vi.spyOn(moderationStore, 'saveModerationSettings').mockResolvedValue(undefined);

      wrapper = mountComponent();
      await nextTick();
      await nextTick();

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');

      await nextTick();
      await nextTick();

      const successMessage = wrapper.find('.message-success');
      expect(successMessage.exists()).toBe(true);
    });
  });

  describe('Loading state', () => {
    it('should disable submit button and inputs while saving', async () => {
      moderationStore.moderationSettings = { ...defaultSettings };

      let resolveSave!: () => void;
      const savePromise = new Promise<void>((resolve) => {
        resolveSave = resolve;
      });
      vi.spyOn(moderationStore, 'saveModerationSettings').mockReturnValue(savePromise);

      wrapper = mountComponent();
      await nextTick();
      await nextTick();

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');

      await nextTick();

      const saveButton = wrapper.find('button[type="submit"]');
      expect(saveButton.attributes('disabled')).toBeDefined();

      const ipHashInput = wrapper.find('#ip-hash-retention');
      expect((ipHashInput.element as HTMLInputElement).disabled).toBe(true);

      const ipSubnetInput = wrapper.find('#ip-subnet-retention');
      expect((ipSubnetInput.element as HTMLInputElement).disabled).toBe(true);

      resolveSave();
      await savePromise;
      await nextTick();
    });
  });
});
