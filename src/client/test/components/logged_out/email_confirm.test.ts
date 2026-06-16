import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { flushPromises, VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';

import { mountComponent } from '@/client/test/lib/vue';
import { initI18Next } from '@/client/service/locale';
import EmailConfirm from '@/client/components/logged_out/email_confirm.vue';

const TEST_TOKEN = 'abcdef0123456789abcdef0123456789';

const routes: RouteRecordRaw[] = [
  { path: '/', component: { template: '<div />' }, name: 'app' },
  { path: '/auth/login', component: { template: '<div />' }, name: 'login' },
  { path: '/auth/email/confirm/:token', component: EmailConfirm, name: 'email-confirm' },
];

interface MockAuthn {
  confirmEmailChange: ReturnType<typeof vi.fn>;
  refreshToken: ReturnType<typeof vi.fn>;
}

function makeAuthn(overrides: Partial<MockAuthn> = {}): MockAuthn {
  return {
    confirmEmailChange: vi.fn().mockResolvedValue({ valid: true }),
    refreshToken: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

async function mountEmailConfirm(
  authn: MockAuthn,
  token: string = TEST_TOKEN,
): Promise<VueWrapper> {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });
  await router.push(`/auth/email/confirm/${token}`);
  await router.isReady();
  return mountComponent(EmailConfirm, router, { provide: { authn } });
}

describe('EmailConfirm Component (client logged_out)', () => {
  beforeAll(() => {
    initI18Next();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Confirming State', () => {
    it('should render the in-progress message while the consume is in flight', async () => {
      // A pending confirm keeps the component in the confirming state.
      const authn = makeAuthn({
        confirmEmailChange: vi.fn().mockReturnValueOnce(new Promise(() => {
          // never resolves
        })),
      });

      const wrapper = await mountEmailConfirm(authn);

      expect(wrapper.text()).toContain('Confirming your new email address');
      // No button is ever rendered — the confirm fires automatically on mount.
      expect(wrapper.find('button').exists()).toBe(false);
      wrapper.unmount();
    });

    it('should consume the token automatically on mount with the route token', async () => {
      const authn = makeAuthn();

      const wrapper = await mountEmailConfirm(authn);
      await flushPromises();

      expect(authn.confirmEmailChange).toHaveBeenCalledTimes(1);
      expect(authn.confirmEmailChange).toHaveBeenCalledWith(TEST_TOKEN);
      wrapper.unmount();
    });
  });

  describe('Successful Confirmation', () => {
    it('should render the success message after a successful confirm', async () => {
      const authn = makeAuthn();

      const wrapper = await mountEmailConfirm(authn);
      await flushPromises();

      expect(wrapper.text()).toContain('Your email address has been updated');
      expect(wrapper.find('button').exists()).toBe(false);
      wrapper.unmount();
    });

    it('should refresh the JWT after a successful confirm', async () => {
      const authn = makeAuthn();

      const wrapper = await mountEmailConfirm(authn);
      await flushPromises();

      expect(authn.refreshToken).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    });

    it('should still render success when the token refresh fails (non-fatal)', async () => {
      // refreshToken returning false models the anonymous / no-session case and
      // a failed refresh — neither must downgrade the committed change.
      const authn = makeAuthn({
        refreshToken: vi.fn().mockResolvedValue(false),
      });

      const wrapper = await mountEmailConfirm(authn);
      await flushPromises();

      expect(wrapper.text()).toContain('Your email address has been updated');
      wrapper.unmount();
    });

    it('should render a router-link back to login in the success state', async () => {
      const authn = makeAuthn();

      const wrapper = await mountEmailConfirm(authn);
      await flushPromises();

      const loginLink = wrapper.find('a.forgot');
      expect(loginLink.exists()).toBe(true);
      expect(loginLink.attributes('href')).toBe('/auth/login');
      wrapper.unmount();
    });
  });

  describe('Invalid / Expired Token State', () => {
    it('should render the generic invalid/expired copy when confirm returns valid=false', async () => {
      const authn = makeAuthn({
        confirmEmailChange: vi.fn().mockResolvedValue({ valid: false }),
      });

      const wrapper = await mountEmailConfirm(authn);
      await flushPromises();

      expect(wrapper.text()).toContain('confirmation link is invalid');
      // The success copy must NOT appear.
      expect(wrapper.text()).not.toContain('Your email address has been updated');
      wrapper.unmount();
    });

    it('should not refresh the JWT when confirm fails', async () => {
      const authn = makeAuthn({
        confirmEmailChange: vi.fn().mockResolvedValue({ valid: false }),
      });

      const wrapper = await mountEmailConfirm(authn);
      await flushPromises();

      expect(authn.refreshToken).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it('should render the same generic copy when confirm throws an error', async () => {
      const authn = makeAuthn({
        confirmEmailChange: vi.fn().mockRejectedValue(new Error('Network down')),
      });

      const wrapper = await mountEmailConfirm(authn);
      await flushPromises();

      expect(wrapper.text()).toContain('confirmation link is invalid');
      wrapper.unmount();
    });

    it('should short-circuit to invalid without calling confirm when the token is empty', async () => {
      // The component's `if (!token)` guard renders the generic invalid copy
      // without ever hitting the network.
      const authn = makeAuthn();

      const wrapper = await mountEmailConfirm(authn, '');
      await flushPromises();

      expect(wrapper.text()).toContain('confirmation link is invalid');
      expect(authn.confirmEmailChange).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it('should render a router-link back to login in the invalid state', async () => {
      const authn = makeAuthn({
        confirmEmailChange: vi.fn().mockResolvedValue({ valid: false }),
      });

      const wrapper = await mountEmailConfirm(authn);
      await flushPromises();

      const loginLink = wrapper.find('a.forgot');
      expect(loginLink.exists()).toBe(true);
      expect(loginLink.attributes('href')).toBe('/auth/login');
      wrapper.unmount();
    });
  });
});
