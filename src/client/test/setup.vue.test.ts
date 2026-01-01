import { expect, describe, it, vi, beforeEach, afterEach } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import { VueWrapper } from '@vue/test-utils';
import sinon from 'sinon';

import { mountComponent } from '@/client/test/lib/vue';
import Setup from '@/client/components/logged_out/setup.vue';

const routes: RouteRecordRaw[] = [
  { path: '/setup', component: {}, name: 'setup' },
  { path: '/auth/login', component: {}, name: 'login' },
];

/**
 * Helper to create a mounted setup component with mocked dependencies
 */
const mountSetup = (setupService?: any) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });

  const mockSetupService = setupService || {
    completeSetup: vi.fn().mockResolvedValue(undefined),
    checkSetupStatus: vi.fn().mockResolvedValue({ setupRequired: true }),
  };

  const wrapper = mountComponent(Setup, router, {
    provide: {
      setupService: mockSetupService,
    },
  });

  return {
    wrapper,
    router,
    setupService: mockSetupService,
  };
};

/**
 * Helper to fill in all form fields with valid data
 */
async function fillValidForm(wrapper: VueWrapper) {
  await wrapper.find('input[type="email"]').setValue('admin@example.com');
  await wrapper.find('input#setup-password').setValue('password123');
  await wrapper.find('input#setup-password-confirm').setValue('password123');
  await wrapper.find('input#setup-site-title').setValue('My Calendar');
  await wrapper.find('select#setup-registration-mode').setValue('closed');
}

describe('Setup Component', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Form Rendering', () => {
    it('should render form with all required fields', () => {
      const { wrapper } = mountSetup();

      // Check for email field
      expect(wrapper.find('input[type="email"]').exists()).toBe(true);

      // Check for password field
      expect(wrapper.find('input#setup-password').exists()).toBe(true);

      // Check for password confirmation field
      expect(wrapper.find('input#setup-password-confirm').exists()).toBe(true);

      // Check for site title field
      expect(wrapper.find('input#setup-site-title').exists()).toBe(true);

      // Check for registration mode dropdown
      expect(wrapper.find('select#setup-registration-mode').exists()).toBe(true);

      // Check for submit button
      expect(wrapper.find('button[type="submit"]').exists()).toBe(true);
    });
  });

  describe('Password Validation', () => {
    it('should show error for passwords that are too short', async () => {
      const { wrapper } = mountSetup();

      // Enter a short password
      await wrapper.find('input#setup-password').setValue('short1');
      await wrapper.find('input#setup-password').trigger('blur');
      await wrapper.vm.$nextTick();

      // Check that validation error is displayed
      const errorEl = wrapper.find('.password-validation-error');
      expect(errorEl.exists()).toBe(true);
    });

    it('should show error for passwords lacking variety', async () => {
      const { wrapper } = mountSetup();

      // Enter a password with only letters (no numbers or special chars)
      await wrapper.find('input#setup-password').setValue('onlyletters');
      await wrapper.find('input#setup-password').trigger('blur');
      await wrapper.vm.$nextTick();

      // Check that validation error is displayed
      const errorEl = wrapper.find('.password-validation-error');
      expect(errorEl.exists()).toBe(true);
    });
  });

  describe('Password Confirmation', () => {
    it('should show error when passwords do not match', async () => {
      const { wrapper } = mountSetup();

      // Enter valid password
      await wrapper.find('input#setup-password').setValue('password123');
      // Enter non-matching confirmation
      await wrapper.find('input#setup-password-confirm').setValue('different456');
      await wrapper.find('input#setup-password-confirm').trigger('blur');
      await wrapper.vm.$nextTick();

      // Trigger form submission
      await wrapper.find('form').trigger('submit.prevent');
      await wrapper.vm.$nextTick();

      // Check that password mismatch error is displayed
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    });
  });

  describe('Form Submission', () => {
    it('should call API with correct data on valid submission', async () => {
      // Create a mock that doesn't immediately resolve to avoid DOM update issues
      let resolveSetup: () => void;
      const setupPromise = new Promise<void>((resolve) => {
        resolveSetup = resolve;
      });
      const mockSetupService = {
        completeSetup: vi.fn().mockReturnValue(setupPromise),
        checkSetupStatus: vi.fn().mockResolvedValue({ setupRequired: true }),
      };
      const { wrapper } = mountSetup(mockSetupService);

      // Fill in all fields
      await fillValidForm(wrapper);

      // Submit form (this will call the API but not resolve yet)
      await wrapper.find('form').trigger('submit.prevent');
      await wrapper.vm.$nextTick();

      // Verify API was called with correct data before resolving
      expect(mockSetupService.completeSetup).toHaveBeenCalledWith({
        email: 'admin@example.com',
        password: 'password123',
        siteTitle: 'My Calendar',
        registrationMode: 'closed',
      });

      // Clean up - unmount before resolving to avoid DOM update issues
      wrapper.unmount();
      resolveSetup!();
    });

    it('should disable submit button while submitting', async () => {
      // Create a mock that doesn't resolve until we want it to
      const setupPromise = new Promise<void>(() => {
        // Never resolves during test
      });
      const mockSetupService = {
        completeSetup: vi.fn().mockReturnValue(setupPromise),
        checkSetupStatus: vi.fn().mockResolvedValue({ setupRequired: true }),
      };
      const { wrapper } = mountSetup(mockSetupService);

      // Fill in all fields
      await fillValidForm(wrapper);

      // Verify button is enabled before submission
      const submitButton = wrapper.find('button[type="submit"]');
      expect(submitButton.attributes('disabled')).toBeUndefined();

      // Submit form
      await wrapper.find('form').trigger('submit.prevent');
      await wrapper.vm.$nextTick();

      // Button should now be disabled
      expect(submitButton.attributes('disabled')).toBeDefined();

      // Clean up
      wrapper.unmount();
    });
  });

  describe('API Error Handling', () => {
    it('should display error when validation fails', async () => {
      const mockSetupService = {
        completeSetup: vi.fn(),
        checkSetupStatus: vi.fn().mockResolvedValue({ setupRequired: true }),
      };
      const { wrapper } = mountSetup(mockSetupService);

      // Fill form with missing email
      await wrapper.find('input#setup-password').setValue('password123');
      await wrapper.find('input#setup-password-confirm').setValue('password123');
      await wrapper.find('input#setup-site-title').setValue('My Calendar');
      await wrapper.find('select#setup-registration-mode').setValue('closed');

      // Submit form - should fail validation
      await wrapper.find('form').trigger('submit.prevent');
      await wrapper.vm.$nextTick();

      // Check that error alert is shown
      expect(wrapper.find('.alert--error').exists()).toBe(true);

      // API should NOT have been called since validation failed
      expect(mockSetupService.completeSetup).not.toHaveBeenCalled();
    });
  });
});
