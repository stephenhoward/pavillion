import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import ModerationSettings from '@/client/components/admin/moderation-settings.vue';
import { useModerationStore } from '@/client/stores/moderation-store';

// Mock i18next-vue
vi.mock('i18next-vue', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('ModerationSettings.vue', () => {
  let pinia: ReturnType<typeof createPinia>;
  let moderationStore: ReturnType<typeof useModerationStore>;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    moderationStore = useModerationStore();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Auto-Escalation Threshold Field', () => {
    it('should render auto-escalation threshold input field', async () => {
      // Mock the store method
      vi.spyOn(moderationStore, 'fetchModerationSettings').mockResolvedValue(undefined);
      moderationStore.loadingSettings = false;
      moderationStore.moderationSettings = {
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
        autoEscalationThreshold: 3,
        ipHashRetentionDays: 30,
        ipSubnetRetentionDays: 90,
      };

      const wrapper = mount(ModerationSettings, {
        global: {
          plugins: [pinia],
          stubs: {
            LoadingMessage: true,
          },
        },
      });

      await wrapper.vm.$nextTick();

      const thresholdInput = wrapper.find('#auto-escalation-threshold');
      expect(thresholdInput.exists()).toBe(true);
      expect(thresholdInput.attributes('type')).toBe('number');
    });

    it('should display current auto-escalation threshold value', async () => {
      vi.spyOn(moderationStore, 'fetchModerationSettings').mockResolvedValue(undefined);
      moderationStore.loadingSettings = false;
      moderationStore.moderationSettings = {
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
        autoEscalationThreshold: 5,
        ipHashRetentionDays: 30,
        ipSubnetRetentionDays: 90,
      };

      const wrapper = mount(ModerationSettings, {
        global: {
          plugins: [pinia],
          stubs: {
            LoadingMessage: true,
          },
        },
      });

      await wrapper.vm.$nextTick();

      const thresholdInput = wrapper.find('#auto-escalation-threshold');
      expect(thresholdInput.element.value).toBe('5');
    });

    it('should show helper text explaining that 0 disables auto-escalation', async () => {
      vi.spyOn(moderationStore, 'fetchModerationSettings').mockResolvedValue(undefined);
      moderationStore.loadingSettings = false;
      moderationStore.moderationSettings = {
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
        autoEscalationThreshold: 3,
        ipHashRetentionDays: 30,
        ipSubnetRetentionDays: 90,
      };

      const wrapper = mount(ModerationSettings, {
        global: {
          plugins: [pinia],
          stubs: {
            LoadingMessage: true,
          },
        },
      });

      await wrapper.vm.$nextTick();

      const helpText = wrapper.find('#auto-escalation-threshold-help');
      expect(helpText.exists()).toBe(true);
      expect(helpText.text()).toBe('auto_escalation_threshold_help');
    });
  });

  describe('Validation', () => {
    it('should accept zero as a valid value (disables auto-escalation)', async () => {
      vi.spyOn(moderationStore, 'fetchModerationSettings').mockResolvedValue(undefined);
      vi.spyOn(moderationStore, 'saveModerationSettings').mockResolvedValue(undefined);
      moderationStore.loadingSettings = false;
      moderationStore.moderationSettings = {
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
        autoEscalationThreshold: 3,
        ipHashRetentionDays: 30,
        ipSubnetRetentionDays: 90,
      };

      const wrapper = mount(ModerationSettings, {
        global: {
          plugins: [pinia],
          stubs: {
            LoadingMessage: true,
          },
        },
      });

      await wrapper.vm.$nextTick();

      const thresholdInput = wrapper.find('#auto-escalation-threshold');
      await thresholdInput.setValue(0);

      const form = wrapper.find('form');
      await form.trigger('submit');

      await wrapper.vm.$nextTick();

      expect(moderationStore.saveModerationSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          autoEscalationThreshold: 0,
        }),
      );
    });

    it('should accept positive integers as valid values', async () => {
      vi.spyOn(moderationStore, 'fetchModerationSettings').mockResolvedValue(undefined);
      vi.spyOn(moderationStore, 'saveModerationSettings').mockResolvedValue(undefined);
      moderationStore.loadingSettings = false;
      moderationStore.moderationSettings = {
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
        autoEscalationThreshold: 3,
        ipHashRetentionDays: 30,
        ipSubnetRetentionDays: 90,
      };

      const wrapper = mount(ModerationSettings, {
        global: {
          plugins: [pinia],
          stubs: {
            LoadingMessage: true,
          },
        },
      });

      await wrapper.vm.$nextTick();

      const thresholdInput = wrapper.find('#auto-escalation-threshold');
      await thresholdInput.setValue(5);

      const form = wrapper.find('form');
      await form.trigger('submit');

      await wrapper.vm.$nextTick();

      expect(moderationStore.saveModerationSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          autoEscalationThreshold: 5,
        }),
      );
    });

    it('should reject negative values', async () => {
      vi.spyOn(moderationStore, 'fetchModerationSettings').mockResolvedValue(undefined);
      vi.spyOn(moderationStore, 'saveModerationSettings').mockResolvedValue(undefined);
      moderationStore.loadingSettings = false;
      moderationStore.moderationSettings = {
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
        autoEscalationThreshold: 3,
        ipHashRetentionDays: 30,
        ipSubnetRetentionDays: 90,
      };

      const wrapper = mount(ModerationSettings, {
        global: {
          plugins: [pinia],
          stubs: {
            LoadingMessage: true,
          },
        },
      });

      await wrapper.vm.$nextTick();

      const thresholdInput = wrapper.find('#auto-escalation-threshold');
      await thresholdInput.setValue(-1);

      const form = wrapper.find('form');
      await form.trigger('submit');

      await wrapper.vm.$nextTick();

      const errorText = wrapper.find('#auto-escalation-threshold-error');
      expect(errorText.exists()).toBe(true);
      expect(moderationStore.saveModerationSettings).not.toHaveBeenCalled();
    });
  });

  describe('Save Functionality', () => {
    it('should persist changes via configuration API when save button is clicked', async () => {
      vi.spyOn(moderationStore, 'fetchModerationSettings').mockResolvedValue(undefined);
      vi.spyOn(moderationStore, 'saveModerationSettings').mockResolvedValue(undefined);
      moderationStore.loadingSettings = false;
      moderationStore.loadingSettings = false;
      moderationStore.moderationSettings = {
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
        autoEscalationThreshold: 3,
        ipHashRetentionDays: 30,
        ipSubnetRetentionDays: 90,
      };

      const wrapper = mount(ModerationSettings, {
        global: {
          plugins: [pinia],
          stubs: {
            LoadingMessage: true,
          },
        },
      });

      await wrapper.vm.$nextTick();

      const thresholdInput = wrapper.find('#auto-escalation-threshold');
      await thresholdInput.setValue(10);

      const form = wrapper.find('form');
      await form.trigger('submit');

      await wrapper.vm.$nextTick();

      expect(moderationStore.saveModerationSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          autoEscalationThreshold: 10,
        }),
      );
    });

    it('should show loading state while saving', async () => {
      vi.spyOn(moderationStore, 'fetchModerationSettings').mockResolvedValue(undefined);
      vi.spyOn(moderationStore, 'saveModerationSettings').mockImplementation(() => {
        return new Promise((resolve) => setTimeout(resolve, 100));
      });
      moderationStore.loadingSettings = false;
      moderationStore.moderationSettings = {
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
        autoEscalationThreshold: 3,
        ipHashRetentionDays: 30,
        ipSubnetRetentionDays: 90,
      };

      const wrapper = mount(ModerationSettings, {
        global: {
          plugins: [pinia],
          stubs: {
            LoadingMessage: true,
          },
        },
      });

      await wrapper.vm.$nextTick();

      const thresholdInput = wrapper.find('#auto-escalation-threshold');
      await thresholdInput.setValue(7);

      const form = wrapper.find('form');
      await form.trigger('submit');

      await wrapper.vm.$nextTick();

      const saveButton = wrapper.find('button[type="submit"]');
      expect(saveButton.attributes('disabled')).toBeDefined();
    });

    it('should show success feedback after save', async () => {
      vi.spyOn(moderationStore, 'fetchModerationSettings').mockResolvedValue(undefined);
      vi.spyOn(moderationStore, 'saveModerationSettings').mockResolvedValue(undefined);
      moderationStore.loadingSettings = false;
      moderationStore.moderationSettings = {
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
        autoEscalationThreshold: 3,
        ipHashRetentionDays: 30,
        ipSubnetRetentionDays: 90,
      };

      const wrapper = mount(ModerationSettings, {
        global: {
          plugins: [pinia],
          stubs: {
            LoadingMessage: true,
          },
        },
      });

      await wrapper.vm.$nextTick();

      const thresholdInput = wrapper.find('#auto-escalation-threshold');
      await thresholdInput.setValue(4);

      const form = wrapper.find('form');
      await form.trigger('submit');

      await wrapper.vm.$nextTick();

      const successMessage = wrapper.find('.message-success');
      expect(successMessage.exists()).toBe(true);
    });

    it('should show error feedback if save fails', async () => {
      vi.spyOn(moderationStore, 'fetchModerationSettings').mockResolvedValue(undefined);
      vi.spyOn(moderationStore, 'saveModerationSettings').mockRejectedValue(new Error('Network error'));
      moderationStore.loadingSettings = false;
      moderationStore.moderationSettings = {
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
        autoEscalationThreshold: 3,
        ipHashRetentionDays: 30,
        ipSubnetRetentionDays: 90,
      };

      const wrapper = mount(ModerationSettings, {
        global: {
          plugins: [pinia],
          stubs: {
            LoadingMessage: true,
          },
        },
      });

      await wrapper.vm.$nextTick();

      const thresholdInput = wrapper.find('#auto-escalation-threshold');
      await thresholdInput.setValue(4);

      const form = wrapper.find('form');
      await form.trigger('submit');

      await wrapper.vm.$nextTick();

      const errorMessage = wrapper.find('.message-error');
      expect(errorMessage.exists()).toBe(true);
    });
  });
});
