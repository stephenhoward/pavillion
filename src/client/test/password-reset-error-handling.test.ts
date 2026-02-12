import { expect, describe, it, vi, beforeEach, afterEach } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import sinon from 'sinon';

import { mountComponent } from '@/client/test/lib/vue';
import PasswordReset from '@/client/components/logged_out/password_reset.vue';
import PasswordForgot from '@/client/components/logged_out/password_forgot.vue';

const routes: RouteRecordRaw[] = [
  { path: '/login', component: {}, name: 'login', props: true },
  { path: '/reset-password', component: {}, name: 'reset_password', props: true },
  { path: '/forgot-password', component: {}, name: 'forgot_password', props: true },
];

describe('Password Reset Error Handling Security', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('password_reset.vue error handling', () => {
    const mountPasswordReset = (authnMock?: any) => {
      const router: Router = createRouter({
        history: createMemoryHistory(),
        routes: routes,
      });

      const defaultAuthn = {
        check_password_reset_token: vi.fn().mockResolvedValue({ valid: true }),
        use_password_reset_token: vi.fn().mockResolvedValue({}),
      };

      const wrapper = mountComponent(PasswordReset, router, {
        provide: {
          authn: authnMock || defaultAuthn,
        },
      });

      return { wrapper, router, authn: authnMock || defaultAuthn };
    };

    it('should extract errorName from error responses with errorName field', async () => {
      // Create a mock error with errorName field (simulating backend response)
      const errorWithErrorName = {
        response: {
          data: {
            errorName: 'InvalidResetTokenError',
            error: 'The reset token is invalid',
            stack: 'Error: The reset token is invalid\n    at /src/server/authentication/service.ts:123',
          },
        },
      };

      const useTokenMock = vi.fn().mockRejectedValue(errorWithErrorName);
      const { wrapper, router } = mountPasswordReset({
        check_password_reset_token: vi.fn().mockResolvedValue({ valid: true }),
        use_password_reset_token: useTokenMock,
      });

      await wrapper.vm.$nextTick();

      // Set state to show password form
      (wrapper.vm as any).state.codeValidated = true;
      (wrapper.vm as any).state.reset_code = 'test-code';
      await wrapper.vm.$nextTick();

      // Enter valid password and submit
      await wrapper.find('#new-password').setValue('password123');
      await wrapper.find('#confirm-password').setValue('password123');
      await wrapper.vm.$nextTick();

      // Stub router to prevent navigation
      sandbox.stub(router, 'push');

      // Submit form
      await wrapper.find('form').trigger('submit.prevent');
      await wrapper.vm.$nextTick();

      // Get the rendered HTML
      const html = wrapper.html();

      // Verify error alert is shown
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);

      // Verify errorName was extracted and used for translation
      // The component should display t('InvalidResetTokenError') not the raw error
      expect((wrapper.vm as any).state.form_error).toBeTruthy();

      // Critical: Verify stack trace is NOT exposed in the UI
      expect(html).not.toContain('/src/server/authentication/service.ts');
      expect(html).not.toContain('at /src/server');
      expect(html).not.toContain('Error: The reset token is invalid');
    });

    it('should not expose stack traces in UI when error contains stack property', async () => {
      // Create error with detailed stack trace
      const errorWithStack = {
        response: {
          data: {
            errorName: 'DatabaseError',
            error: 'Database connection failed',
            stack: `Error: Database connection failed
    at DatabaseConnection.connect (/src/server/database/connection.ts:45:15)
    at CalendarService.getCalendar (/src/server/calendar/service.ts:89:22)
    at API.resetPassword (/src/server/authentication/api.ts:156:10)`,
            filePath: '/src/server/authentication/api.ts',
          },
        },
      };

      const useTokenMock = vi.fn().mockRejectedValue(errorWithStack);
      const { wrapper, router } = mountPasswordReset({
        check_password_reset_token: vi.fn().mockResolvedValue({ valid: true }),
        use_password_reset_token: useTokenMock,
      });

      await wrapper.vm.$nextTick();

      // Set up password form
      (wrapper.vm as any).state.codeValidated = true;
      (wrapper.vm as any).state.reset_code = 'test-code';
      await wrapper.vm.$nextTick();

      // Submit with valid password
      await wrapper.find('#new-password').setValue('validPassword1');
      await wrapper.find('#confirm-password').setValue('validPassword1');
      await wrapper.vm.$nextTick();

      sandbox.stub(router, 'push');

      await wrapper.find('form').trigger('submit.prevent');
      await wrapper.vm.$nextTick();

      const html = wrapper.html();

      // Verify no stack trace details are exposed
      expect(html).not.toContain('DatabaseConnection.connect');
      expect(html).not.toContain('/src/server/database/connection.ts');
      expect(html).not.toContain('/src/server/calendar/service.ts');
      expect(html).not.toContain('/src/server/authentication/api.ts');
      expect(html).not.toContain('at DatabaseConnection');
      expect(html).not.toContain('Database connection failed');

      // Should only show translated error key
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    });

    it('should not expose file paths in UI when error contains filePath property', async () => {
      // Create error with explicit file path
      const errorWithFilePath = {
        response: {
          data: {
            errorName: 'ValidationError',
            error: 'Invalid input',
            filePath: '/Users/dev/pavillion/src/server/authentication/service.ts',
            lineNumber: 234,
          },
        },
      };

      const useTokenMock = vi.fn().mockRejectedValue(errorWithFilePath);
      const { wrapper, router } = mountPasswordReset({
        check_password_reset_token: vi.fn().mockResolvedValue({ valid: true }),
        use_password_reset_token: useTokenMock,
      });

      await wrapper.vm.$nextTick();

      (wrapper.vm as any).state.codeValidated = true;
      (wrapper.vm as any).state.reset_code = 'test-code';
      await wrapper.vm.$nextTick();

      await wrapper.find('#new-password').setValue('password456');
      await wrapper.find('#confirm-password').setValue('password456');
      await wrapper.vm.$nextTick();

      sandbox.stub(router, 'push');

      await wrapper.find('form').trigger('submit.prevent');
      await wrapper.vm.$nextTick();

      const html = wrapper.html();

      // Verify no file paths are exposed
      expect(html).not.toContain('/Users/dev/pavillion');
      expect(html).not.toContain('/src/server/authentication/service.ts');
      expect(html).not.toContain('lineNumber');
      expect(html).not.toContain('234');

      // Should display error alert with translated message
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    });

    it('should handle errors with only errorName field correctly', async () => {
      // Minimal error response with just errorName
      const minimalError = {
        response: {
          data: {
            errorName: 'ExpiredTokenError',
          },
        },
      };

      const useTokenMock = vi.fn().mockRejectedValue(minimalError);
      const { wrapper, router } = mountPasswordReset({
        check_password_reset_token: vi.fn().mockResolvedValue({ valid: true }),
        use_password_reset_token: useTokenMock,
      });

      await wrapper.vm.$nextTick();

      (wrapper.vm as any).state.codeValidated = true;
      (wrapper.vm as any).state.reset_code = 'test-code';
      await wrapper.vm.$nextTick();

      await wrapper.find('#new-password').setValue('testPass123');
      await wrapper.find('#confirm-password').setValue('testPass123');
      await wrapper.vm.$nextTick();

      sandbox.stub(router, 'push');

      await wrapper.find('form').trigger('submit.prevent');
      await wrapper.vm.$nextTick();

      // Should extract and use errorName
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
      expect((wrapper.vm as any).state.form_error).toBeTruthy();
    });

    it('should fallback to error field if errorName is missing', async () => {
      // Error response without errorName (legacy format)
      const legacyError = {
        response: {
          data: {
            error: 'token_expired',
          },
        },
      };

      const useTokenMock = vi.fn().mockRejectedValue(legacyError);
      const { wrapper, router } = mountPasswordReset({
        check_password_reset_token: vi.fn().mockResolvedValue({ valid: true }),
        use_password_reset_token: useTokenMock,
      });

      await wrapper.vm.$nextTick();

      (wrapper.vm as any).state.codeValidated = true;
      (wrapper.vm as any).state.reset_code = 'test-code';
      await wrapper.vm.$nextTick();

      await wrapper.find('#new-password').setValue('myPassword1');
      await wrapper.find('#confirm-password').setValue('myPassword1');
      await wrapper.vm.$nextTick();

      sandbox.stub(router, 'push');

      await wrapper.find('form').trigger('submit.prevent');
      await wrapper.vm.$nextTick();

      // Should fallback to error field
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
      expect((wrapper.vm as any).state.form_error).toBeTruthy();
    });

    it('should handle string errors gracefully', async () => {
      // Simple string error
      const stringError = 'network_error';

      const useTokenMock = vi.fn().mockRejectedValue(stringError);
      const { wrapper, router } = mountPasswordReset({
        check_password_reset_token: vi.fn().mockResolvedValue({ valid: true }),
        use_password_reset_token: useTokenMock,
      });

      await wrapper.vm.$nextTick();

      (wrapper.vm as any).state.codeValidated = true;
      (wrapper.vm as any).state.reset_code = 'test-code';
      await wrapper.vm.$nextTick();

      await wrapper.find('#new-password').setValue('testString1');
      await wrapper.find('#confirm-password').setValue('testString1');
      await wrapper.vm.$nextTick();

      sandbox.stub(router, 'push');

      await wrapper.find('form').trigger('submit.prevent');
      await wrapper.vm.$nextTick();

      // Should handle string error
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
      expect((wrapper.vm as any).state.form_error).toBeTruthy();
    });

    it('should show unknown_error for unrecognized error formats', async () => {
      // Completely unknown error format
      const unknownError = {
        someRandomProperty: 'value',
      };

      const useTokenMock = vi.fn().mockRejectedValue(unknownError);
      const { wrapper, router } = mountPasswordReset({
        check_password_reset_token: vi.fn().mockResolvedValue({ valid: true }),
        use_password_reset_token: useTokenMock,
      });

      await wrapper.vm.$nextTick();

      (wrapper.vm as any).state.codeValidated = true;
      (wrapper.vm as any).state.reset_code = 'test-code';
      await wrapper.vm.$nextTick();

      await wrapper.find('#new-password').setValue('unknownErr1');
      await wrapper.find('#confirm-password').setValue('unknownErr1');
      await wrapper.vm.$nextTick();

      sandbox.stub(router, 'push');

      await wrapper.find('form').trigger('submit.prevent');
      await wrapper.vm.$nextTick();

      // Should default to unknown_error
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
      expect((wrapper.vm as any).state.form_error).toBeTruthy();
    });
  });

  describe('password_forgot.vue error handling', () => {
    const mountPasswordForgot = (authnMock?: any) => {
      const router: Router = createRouter({
        history: createMemoryHistory(),
        routes: routes,
      });

      const defaultAuthn = {
        reset_password: vi.fn().mockResolvedValue({}),
      };

      const wrapper = mountComponent(PasswordForgot, router, {
        provide: {
          authn: authnMock || defaultAuthn,
        },
      });

      return { wrapper, router, authn: authnMock || defaultAuthn };
    };

    it('should extract errorName from error responses', async () => {
      // Error with errorName field
      const errorWithErrorName = {
        response: {
          data: {
            errorName: 'AccountNotFoundError',
            error: 'Account does not exist',
            stack: 'Error: Account does not exist\n    at /src/server/authentication/service.ts:98',
          },
        },
      };

      const resetPasswordMock = vi.fn().mockRejectedValue(errorWithErrorName);
      const { wrapper } = mountPasswordForgot({
        reset_password: resetPasswordMock,
      });

      await wrapper.vm.$nextTick();

      // Enter email and submit
      await wrapper.find('#reset-email').setValue('test@example.com');
      await wrapper.vm.$nextTick();

      await wrapper.find('form').trigger('submit.prevent');
      await wrapper.vm.$nextTick();

      const html = wrapper.html();

      // Verify error is displayed
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
      expect((wrapper.vm as any).state.error).toBeTruthy();

      // Critical: Verify stack trace is NOT exposed
      expect(html).not.toContain('/src/server/authentication/service.ts');
      expect(html).not.toContain('at /src/server');
      expect(html).not.toContain('Account does not exist');
    });

    it('should not expose stack traces in UI', async () => {
      // Error with detailed stack trace
      const errorWithStack = {
        response: {
          data: {
            errorName: 'EmailServiceError',
            error: 'Failed to send email',
            stack: `Error: Failed to send email
    at EmailService.send (/src/server/email/service.ts:67:12)
    at AuthenticationService.resetPassword (/src/server/authentication/service.ts:145:8)
    at API.forgotPassword (/src/server/authentication/api.ts:89:15)`,
          },
        },
      };

      const resetPasswordMock = vi.fn().mockRejectedValue(errorWithStack);
      const { wrapper } = mountPasswordForgot({
        reset_password: resetPasswordMock,
      });

      await wrapper.vm.$nextTick();

      await wrapper.find('#reset-email').setValue('user@test.com');
      await wrapper.vm.$nextTick();

      await wrapper.find('form').trigger('submit.prevent');
      await wrapper.vm.$nextTick();

      const html = wrapper.html();

      // Verify no stack trace information is exposed
      expect(html).not.toContain('EmailService.send');
      expect(html).not.toContain('/src/server/email/service.ts');
      expect(html).not.toContain('/src/server/authentication/service.ts');
      expect(html).not.toContain('/src/server/authentication/api.ts');
      expect(html).not.toContain('Failed to send email');

      // Should show error alert
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    });

    it('should not expose file paths in UI', async () => {
      // Error with file path information
      const errorWithFilePath = {
        response: {
          data: {
            errorName: 'RateLimitError',
            error: 'Too many requests',
            filePath: '/Users/dev/pavillion/src/server/authentication/api.ts',
            lineNumber: 123,
          },
        },
      };

      const resetPasswordMock = vi.fn().mockRejectedValue(errorWithFilePath);
      const { wrapper } = mountPasswordForgot({
        reset_password: resetPasswordMock,
      });

      await wrapper.vm.$nextTick();

      await wrapper.find('#reset-email').setValue('rate@limit.com');
      await wrapper.vm.$nextTick();

      await wrapper.find('form').trigger('submit.prevent');
      await wrapper.vm.$nextTick();

      const html = wrapper.html();

      // Verify no file paths are exposed
      expect(html).not.toContain('/Users/dev/pavillion');
      expect(html).not.toContain('/src/server/authentication/api.ts');
      expect(html).not.toContain('lineNumber');
      expect(html).not.toContain('123');

      // Should display error
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    });

    it('should handle minimal error with only errorName', async () => {
      // Minimal error with just errorName
      const minimalError = {
        response: {
          data: {
            errorName: 'InvalidEmailError',
          },
        },
      };

      const resetPasswordMock = vi.fn().mockRejectedValue(minimalError);
      const { wrapper } = mountPasswordForgot({
        reset_password: resetPasswordMock,
      });

      await wrapper.vm.$nextTick();

      await wrapper.find('#reset-email').setValue('invalid@email.com');
      await wrapper.vm.$nextTick();

      await wrapper.find('form').trigger('submit.prevent');
      await wrapper.vm.$nextTick();

      // Should extract errorName
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
      expect((wrapper.vm as any).state.error).toBeTruthy();
    });

    it('should fallback to error field if errorName missing', async () => {
      // Legacy error format without errorName
      const legacyError = {
        response: {
          data: {
            error: 'invalid_email',
          },
        },
      };

      const resetPasswordMock = vi.fn().mockRejectedValue(legacyError);
      const { wrapper } = mountPasswordForgot({
        reset_password: resetPasswordMock,
      });

      await wrapper.vm.$nextTick();

      await wrapper.find('#reset-email').setValue('legacy@test.com');
      await wrapper.vm.$nextTick();

      await wrapper.find('form').trigger('submit.prevent');
      await wrapper.vm.$nextTick();

      // Should use error field
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
      expect((wrapper.vm as any).state.error).toBeTruthy();
    });

    it('should handle string errors', async () => {
      // Simple string error
      const stringError = 'connection_timeout';

      const resetPasswordMock = vi.fn().mockRejectedValue(stringError);
      const { wrapper } = mountPasswordForgot({
        reset_password: resetPasswordMock,
      });

      await wrapper.vm.$nextTick();

      await wrapper.find('#reset-email').setValue('string@error.com');
      await wrapper.vm.$nextTick();

      await wrapper.find('form').trigger('submit.prevent');
      await wrapper.vm.$nextTick();

      // Should handle string error
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
      expect((wrapper.vm as any).state.error).toBeTruthy();
    });

    it('should show unknown_error for unrecognized formats', async () => {
      // Unknown error format
      const unknownError = {
        randomProperty: 'random value',
      };

      const resetPasswordMock = vi.fn().mockRejectedValue(unknownError);
      const { wrapper } = mountPasswordForgot({
        reset_password: resetPasswordMock,
      });

      await wrapper.vm.$nextTick();

      await wrapper.find('#reset-email').setValue('unknown@error.com');
      await wrapper.vm.$nextTick();

      await wrapper.find('form').trigger('submit.prevent');
      await wrapper.vm.$nextTick();

      // Should default to unknown_error
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
      expect((wrapper.vm as any).state.error).toBeTruthy();
    });
  });
});
