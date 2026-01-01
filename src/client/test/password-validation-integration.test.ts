import { expect, describe, it, vi, beforeEach, afterEach } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import sinon from 'sinon';

import { mountComponent } from '@/client/test/lib/vue';
import AcceptInvite from '@/client/components/logged_out/accept_invite.vue';
import PasswordReset from '@/client/components/logged_out/password_reset.vue';

const routes: RouteRecordRaw[] = [
  { path: '/login', component: {}, name: 'login', props: true },
  { path: '/accept-invite', component: {}, name: 'accept_invite', props: true },
  { path: '/reset-password', component: {}, name: 'reset_password', props: true },
];

describe('Password Validation Integration', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('accept_invite.vue password validation', () => {
    const mountAcceptInvite = (authnMock?: any) => {
      const router: Router = createRouter({
        history: createMemoryHistory(),
        routes: routes,
      });

      const defaultAuthn = {
        check_invite_token: vi.fn().mockResolvedValue({ message: 'ok' }),
        accept_invitation: vi.fn().mockResolvedValue({ calendars: [] }),
      };

      const wrapper = mountComponent(AcceptInvite, router, {
        provide: {
          authn: authnMock || defaultAuthn,
        },
      });

      return { wrapper, router, authn: authnMock || defaultAuthn };
    };

    it('should show error for passwords that are too short', async () => {
      const { wrapper } = mountAcceptInvite({
        check_invite_token: vi.fn().mockResolvedValue({ message: 'ok' }),
        accept_invitation: vi.fn(),
      });

      // Wait for the component to check the invite code
      await wrapper.vm.$nextTick();

      // Set state to show password form
      (wrapper.vm as any).state.codeValidated = true;
      await wrapper.vm.$nextTick();

      // Enter a short password (less than 8 chars)
      await wrapper.find('#invite-password').setValue('short1!');
      await wrapper.find('#invite-password2').setValue('short1!');
      await wrapper.vm.$nextTick();

      // Submit the form
      await wrapper.find('form').trigger('submit.prevent');
      await wrapper.vm.$nextTick();

      // Check that validation error is displayed
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
      expect((wrapper.vm as any).state.form_error).toBeTruthy();
    });

    it('should show error for passwords lacking character variety', async () => {
      const { wrapper } = mountAcceptInvite({
        check_invite_token: vi.fn().mockResolvedValue({ message: 'ok' }),
        accept_invitation: vi.fn(),
      });

      await wrapper.vm.$nextTick();

      // Set state to show password form
      (wrapper.vm as any).state.codeValidated = true;
      await wrapper.vm.$nextTick();

      // Enter a password with only letters (no numbers or special chars)
      await wrapper.find('#invite-password').setValue('onlyletters');
      await wrapper.find('#invite-password2').setValue('onlyletters');
      await wrapper.vm.$nextTick();

      // Submit the form
      await wrapper.find('form').trigger('submit.prevent');
      await wrapper.vm.$nextTick();

      // Check that validation error is displayed
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
      expect((wrapper.vm as any).state.form_error).toBeTruthy();
    });

    it('should accept valid passwords', async () => {
      const acceptInvitationMock = vi.fn().mockResolvedValue({ calendars: [] });
      const { wrapper, router } = mountAcceptInvite({
        check_invite_token: vi.fn().mockResolvedValue({ message: 'ok' }),
        accept_invitation: acceptInvitationMock,
      });

      await wrapper.vm.$nextTick();

      // Set state to show password form with a code
      (wrapper.vm as any).state.codeValidated = true;
      (wrapper.vm as any).state.invite_code = 'valid-code';
      await wrapper.vm.$nextTick();

      // Enter a valid password (letters + numbers, 8+ chars)
      await wrapper.find('#invite-password').setValue('password123');
      await wrapper.find('#invite-password2').setValue('password123');
      await wrapper.vm.$nextTick();

      // Stub the router push to prevent navigation errors
      sandbox.stub(router, 'push');

      // Submit the form
      await wrapper.find('form').trigger('submit.prevent');
      await wrapper.vm.$nextTick();

      // API should have been called since validation passed
      expect(acceptInvitationMock).toHaveBeenCalledWith('valid-code', 'password123');
    });
  });

  describe('password_reset.vue password validation', () => {
    const mountPasswordReset = (authnMock?: any) => {
      const router: Router = createRouter({
        history: createMemoryHistory(),
        routes: routes,
      });

      const defaultAuthn = {
        check_password_reset_token: vi.fn().mockResolvedValue(true),
        use_password_reset_token: vi.fn().mockResolvedValue({}),
      };

      const wrapper = mountComponent(PasswordReset, router, {
        provide: {
          authn: authnMock || defaultAuthn,
        },
      });

      return { wrapper, router, authn: authnMock || defaultAuthn };
    };

    it('should show error for passwords that are too short', async () => {
      const { wrapper } = mountPasswordReset({
        check_password_reset_token: vi.fn().mockResolvedValue(true),
        use_password_reset_token: vi.fn(),
      });

      await wrapper.vm.$nextTick();

      // Set state to show password form
      (wrapper.vm as any).state.codeValidated = true;
      await wrapper.vm.$nextTick();

      // Enter a short password
      await wrapper.find('#new-password').setValue('short1!');
      await wrapper.find('#confirm-password').setValue('short1!');
      await wrapper.vm.$nextTick();

      // Submit the form
      await wrapper.find('form').trigger('submit.prevent');
      await wrapper.vm.$nextTick();

      // Check that validation error is displayed
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
      expect((wrapper.vm as any).state.form_error).toBeTruthy();
    });

    it('should show error for passwords lacking character variety', async () => {
      const { wrapper } = mountPasswordReset({
        check_password_reset_token: vi.fn().mockResolvedValue(true),
        use_password_reset_token: vi.fn(),
      });

      await wrapper.vm.$nextTick();

      // Set state to show password form
      (wrapper.vm as any).state.codeValidated = true;
      await wrapper.vm.$nextTick();

      // Enter a password with only numbers
      await wrapper.find('#new-password').setValue('12345678');
      await wrapper.find('#confirm-password').setValue('12345678');
      await wrapper.vm.$nextTick();

      // Submit the form
      await wrapper.find('form').trigger('submit.prevent');
      await wrapper.vm.$nextTick();

      // Check that validation error is displayed
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
      expect((wrapper.vm as any).state.form_error).toBeTruthy();
    });

    it('should accept valid passwords', async () => {
      const useTokenMock = vi.fn().mockResolvedValue({});
      const { wrapper, router } = mountPasswordReset({
        check_password_reset_token: vi.fn().mockResolvedValue(true),
        use_password_reset_token: useTokenMock,
      });

      await wrapper.vm.$nextTick();

      // Set state to show password form with a code
      (wrapper.vm as any).state.codeValidated = true;
      (wrapper.vm as any).state.reset_code = 'valid-code';
      await wrapper.vm.$nextTick();

      // Enter a valid password
      await wrapper.find('#new-password').setValue('password123');
      await wrapper.find('#confirm-password').setValue('password123');
      await wrapper.vm.$nextTick();

      // Stub the router push to prevent navigation errors
      sandbox.stub(router, 'push');

      // Submit the form
      await wrapper.find('form').trigger('submit.prevent');
      await wrapper.vm.$nextTick();

      // API should have been called since validation passed
      expect(useTokenMock).toHaveBeenCalledWith('valid-code', 'password123');
    });
  });
});
