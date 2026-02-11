import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import ModerationSettings from '../moderation-settings.vue';
import { useModerationStore } from '@/client/stores/moderation-store';

// Initialize i18next for tests
i18next.init({
  lng: 'en',
  resources: {
    en: {
      admin: {
        moderation: {
          settings: {
            error: {
              must_be_positive: 'Value must be greater than 0',
            },
          },
        },
      },
    },
  },
});

describe('ModerationSettings.vue', () => {
  let wrapper: VueWrapper;
  let moderationStore: ReturnType<typeof useModerationStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    moderationStore = useModerationStore();
    // Mock fetchModerationSettings to prevent API call
    vi.spyOn(moderationStore, 'fetchModerationSettings').mockResolvedValue();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.restoreAllMocks();
  });

  describe('IP Retention Settings', () => {
    it('should display IP hash retention days input field', async () => {
      moderationStore.moderationSettings = {
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
        autoEscalationThreshold: 5,
        ipHashRetentionDays: 30,
        ipSubnetRetentionDays: 90,
      };

      wrapper = mount(ModerationSettings, {
        global: {
          plugins: [[I18NextVue, { i18next }]],
          stubs: {
            LoadingMessage: true,
          },
        },
      });

      await nextTick();
      await nextTick();

      const ipHashInput = wrapper.find('#ip-hash-retention');
      expect(ipHashInput.exists()).toBe(true);
      expect((ipHashInput.element as HTMLInputElement).value).toBe('30');
    });

    it('should display IP subnet retention days input field', async () => {
      moderationStore.moderationSettings = {
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
        autoEscalationThreshold: 5,
        ipHashRetentionDays: 30,
        ipSubnetRetentionDays: 90,
      };

      wrapper = mount(ModerationSettings, {
        global: {
          plugins: [[I18NextVue, { i18next }]],
          stubs: {
            LoadingMessage: true,
          },
        },
      });

      await nextTick();
      await nextTick();

      const ipSubnetInput = wrapper.find('#ip-subnet-retention');
      expect(ipSubnetInput.exists()).toBe(true);
      expect((ipSubnetInput.element as HTMLInputElement).value).toBe('90');
    });

    it('should validate IP hash retention days as positive integer', async () => {
      moderationStore.moderationSettings = {
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
        autoEscalationThreshold: 5,
        ipHashRetentionDays: 30,
        ipSubnetRetentionDays: 90,
      };

      wrapper = mount(ModerationSettings, {
        global: {
          plugins: [[I18NextVue, { i18next }]],
          stubs: {
            LoadingMessage: true,
          },
        },
      });

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
      moderationStore.moderationSettings = {
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
        autoEscalationThreshold: 5,
        ipHashRetentionDays: 30,
        ipSubnetRetentionDays: 90,
      };

      wrapper = mount(ModerationSettings, {
        global: {
          plugins: [[I18NextVue, { i18next }]],
          stubs: {
            LoadingMessage: true,
          },
        },
      });

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
      moderationStore.moderationSettings = {
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
        autoEscalationThreshold: 5,
        ipHashRetentionDays: 30,
        ipSubnetRetentionDays: 90,
      };

      const saveSpy = vi.spyOn(moderationStore, 'saveModerationSettings').mockResolvedValue();

      wrapper = mount(ModerationSettings, {
        global: {
          plugins: [[I18NextVue, { i18next }]],
          stubs: {
            LoadingMessage: true,
          },
        },
      });

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
      moderationStore.moderationSettings = {
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
        autoEscalationThreshold: 5,
        ipHashRetentionDays: 30,
        ipSubnetRetentionDays: 90,
      };

      vi.spyOn(moderationStore, 'saveModerationSettings').mockResolvedValue();

      wrapper = mount(ModerationSettings, {
        global: {
          plugins: [[I18NextVue, { i18next }]],
          stubs: {
            LoadingMessage: true,
          },
        },
      });

      await nextTick();
      await nextTick();

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');

      await nextTick();
      await nextTick();

      const successMessage = wrapper.find('.message-success');
      expect(successMessage.exists()).toBe(true);
    });

    it('should disable inputs while saving', async () => {
      moderationStore.moderationSettings = {
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
        autoEscalationThreshold: 5,
        ipHashRetentionDays: 30,
        ipSubnetRetentionDays: 90,
      };

      let resolveSave: () => void;
      const savePromise = new Promise<void>((resolve) => {
        resolveSave = resolve;
      });
      vi.spyOn(moderationStore, 'saveModerationSettings').mockReturnValue(savePromise);

      wrapper = mount(ModerationSettings, {
        global: {
          plugins: [[I18NextVue, { i18next }]],
          stubs: {
            LoadingMessage: true,
          },
        },
      });

      await nextTick();
      await nextTick();

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');

      await nextTick();

      const ipHashInput = wrapper.find('#ip-hash-retention');
      expect((ipHashInput.element as HTMLInputElement).disabled).toBe(true);

      const ipSubnetInput = wrapper.find('#ip-subnet-retention');
      expect((ipSubnetInput.element as HTMLInputElement).disabled).toBe(true);

      resolveSave!();
    });
  });
});
