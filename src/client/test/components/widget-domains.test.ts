import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import WidgetDomains from '@/client/components/logged_in/calendar-management/widget-domains.vue';
import axios from 'axios';

// Mock axios
vi.mock('axios');

// Mock i18next-vue
vi.mock('i18next-vue', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('WidgetDomains', () => {
  let mockAuthn;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Default mock for authn - non-admin user
    mockAuthn = {
      isAdmin: vi.fn(() => false),
    };
  });

  const createWrapper = (authnOverride = null) => {
    return mount(WidgetDomains, {
      props: {
        calendarId: 'test-calendar-id',
      },
      global: {
        provide: {
          authn: authnOverride || mockAuthn,
        },
        stubs: {
          PillButton: {
            template: '<button @click="$emit(\'click\')"><slot /></button>',
          },
          LoadingMessage: {
            template: '<div>Loading...</div>',
          },
        },
      },
    });
  };

  describe('subscription error handling', () => {
    it('should show subscription error for non-admin users', async () => {
      const wrapper = createWrapper();

      // Mock axios PUT to return 402 subscription error
      vi.mocked(axios.put).mockRejectedValue({
        response: {
          status: 402,
          data: {
            errorName: 'SubscriptionRequiredError',
          },
        },
      });

      // Set domain input
      wrapper.vm.state.newDomain = 'example.com';
      await nextTick();

      // Trigger add domain
      await wrapper.vm.addDomain();
      await nextTick();

      // Should show subscription error
      expect(wrapper.vm.state.error).toBe('subscription_required');
      expect(wrapper.vm.state.isSubscriptionError).toBe(true);
    });

    it('should NOT show subscription error for admin users', async () => {
      // Create wrapper with admin user
      const adminAuthn = {
        isAdmin: vi.fn(() => true),
      };
      const wrapper = createWrapper(adminAuthn);

      // Mock axios PUT to return 402 subscription error
      vi.mocked(axios.put).mockRejectedValue({
        response: {
          status: 402,
          data: {
            errorName: 'SubscriptionRequiredError',
          },
        },
      });

      // Set domain input
      wrapper.vm.state.newDomain = 'example.com';
      await nextTick();

      // Trigger add domain
      await wrapper.vm.addDomain();
      await nextTick();

      // Should show generic error instead of subscription error
      expect(wrapper.vm.state.error).toBe('error_adding');
      expect(wrapper.vm.state.isSubscriptionError).toBe(false);

      // Verify isAdmin was called
      expect(adminAuthn.isAdmin).toHaveBeenCalled();
    });

    it('should show generic error for other errors (non-admin)', async () => {
      const wrapper = createWrapper();

      // Mock axios PUT to return generic 500 error
      vi.mocked(axios.put).mockRejectedValue({
        response: {
          status: 500,
          data: {
            errorName: 'InternalServerError',
          },
        },
      });

      // Set domain input
      wrapper.vm.state.newDomain = 'example.com';
      await nextTick();

      // Trigger add domain
      await wrapper.vm.addDomain();
      await nextTick();

      // Should show generic error
      expect(wrapper.vm.state.error).toBe('error_adding');
      expect(wrapper.vm.state.isSubscriptionError).toBe(false);
    });

    it('should show generic error for other errors (admin)', async () => {
      // Create wrapper with admin user
      const adminAuthn = {
        isAdmin: vi.fn(() => true),
      };
      const wrapper = createWrapper(adminAuthn);

      // Mock axios PUT to return generic 500 error
      vi.mocked(axios.put).mockRejectedValue({
        response: {
          status: 500,
          data: {
            errorName: 'InternalServerError',
          },
        },
      });

      // Set domain input
      wrapper.vm.state.newDomain = 'example.com';
      await nextTick();

      // Trigger add domain
      await wrapper.vm.addDomain();
      await nextTick();

      // Should show generic error
      expect(wrapper.vm.state.error).toBe('error_adding');
      expect(wrapper.vm.state.isSubscriptionError).toBe(false);
    });

    it('should show invalid domain error for InvalidDomainFormatError (non-admin)', async () => {
      const wrapper = createWrapper();

      // Mock axios PUT to return invalid domain error
      vi.mocked(axios.put).mockRejectedValue({
        response: {
          status: 400,
          data: {
            errorName: 'InvalidDomainFormatError',
          },
        },
      });

      // Set domain input
      wrapper.vm.state.newDomain = 'invalid domain';
      await nextTick();

      // Trigger add domain
      await wrapper.vm.addDomain();
      await nextTick();

      // Should show invalid domain error
      expect(wrapper.vm.state.error).toBe('error_invalid_domain');
      expect(wrapper.vm.state.isSubscriptionError).toBe(false);
    });

    it('should successfully add domain for admin user', async () => {
      // Create wrapper with admin user
      const adminAuthn = {
        isAdmin: vi.fn(() => true),
      };
      const wrapper = createWrapper(adminAuthn);

      // Mock successful response
      vi.mocked(axios.put).mockResolvedValue({
        data: {
          domain: 'example.com',
        },
      });

      // Set domain input
      wrapper.vm.state.newDomain = 'example.com';
      await nextTick();

      // Trigger add domain
      await wrapper.vm.addDomain();
      await nextTick();

      // Should succeed
      expect(wrapper.vm.state.success).toBe('add_success');
      expect(wrapper.vm.state.error).toBe('');
      expect(wrapper.vm.state.currentDomain).toBe('example.com');
    });

    it('should successfully add domain for non-admin user with subscription', async () => {
      const wrapper = createWrapper();

      // Mock successful response
      vi.mocked(axios.put).mockResolvedValue({
        data: {
          domain: 'example.com',
        },
      });

      // Set domain input
      wrapper.vm.state.newDomain = 'example.com';
      await nextTick();

      // Trigger add domain
      await wrapper.vm.addDomain();
      await nextTick();

      // Should succeed
      expect(wrapper.vm.state.success).toBe('add_success');
      expect(wrapper.vm.state.error).toBe('');
      expect(wrapper.vm.state.currentDomain).toBe('example.com');
    });
  });
});
