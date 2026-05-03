import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { flushPromises, VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import axios from 'axios';

import { mountComponent } from '@/client/test/lib/vue';
import { initI18Next } from '@/client/service/locale';
import ApplyConfirm from '@/client/components/logged_out/apply_confirm.vue';

// Mock axios so the component never makes real network calls
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}));

const TEST_TOKEN = 'test-confirm-token-abc123';

const routes: RouteRecordRaw[] = [
  { path: '/', component: { template: '<div />' }, name: 'app' },
  { path: '/auth/login', component: { template: '<div />' }, name: 'login' },
  { path: '/auth/apply', component: { template: '<div />' }, name: 'register-apply' },
  { path: '/auth/apply/confirm/:token', component: ApplyConfirm, name: 'apply-confirm' },
];

async function mountApplyConfirm(token: string = TEST_TOKEN): Promise<VueWrapper> {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });
  await router.push(`/auth/apply/confirm/${token}`);
  await router.isReady();
  return mountComponent(ApplyConfirm, router);
}

describe('ApplyConfirm Component (client logged_out)', () => {
  beforeAll(() => {
    initI18Next();
  });

  beforeEach(() => {
    vi.mocked(axios.post).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Confirming State', () => {
    it('should render the in-progress message while the POST is in flight', async () => {
      // Arrange a pending POST so the component stays in the confirming state
      vi.mocked(axios.post).mockReturnValueOnce(new Promise(() => {
        // never resolves
      }));

      const wrapper = await mountApplyConfirm();

      expect(wrapper.text()).toContain('Confirming your email address');
      // No button is ever rendered — the confirm fires automatically on mount
      expect(wrapper.find('button').exists()).toBe(false);
      wrapper.unmount();
    });

    it('should fire POST automatically on mount with the route token', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { success: true } });

      const wrapper = await mountApplyConfirm();
      await flushPromises();

      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(axios.post).toHaveBeenCalledWith(
        `/api/v1/applications/confirm/${TEST_TOKEN}`,
      );
      wrapper.unmount();
    });
  });

  describe('Successful Confirmation', () => {
    it('should render the success message after a successful POST', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { success: true } });

      const wrapper = await mountApplyConfirm();
      await flushPromises();

      expect(wrapper.text()).toContain('application is now under review');
      expect(wrapper.find('button').exists()).toBe(false);
      wrapper.unmount();
    });

    it('should render a router-link back to login in the success state', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { success: true } });

      const wrapper = await mountApplyConfirm();
      await flushPromises();

      const homeLink = wrapper.find('a.forgot');
      expect(homeLink.exists()).toBe(true);
      expect(homeLink.attributes('href')).toBe('/auth/login');
      wrapper.unmount();
    });
  });

  describe('Invalid / Expired Token State', () => {
    it('should render the generic invalid/expired copy when POST returns valid=false', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { valid: false } });

      const wrapper = await mountApplyConfirm();
      await flushPromises();

      expect(wrapper.text()).toContain('confirmation link is invalid');
      // The success copy must NOT appear
      expect(wrapper.text()).not.toContain('application is now under review');
      wrapper.unmount();
    });

    it('should render the same generic copy when POST throws a network error', async () => {
      vi.mocked(axios.post).mockRejectedValueOnce(new Error('Network down'));

      const wrapper = await mountApplyConfirm();
      await flushPromises();

      expect(wrapper.text()).toContain('confirmation link is invalid');
      wrapper.unmount();
    });

    it('should render a router-link back to the apply form in the invalid state', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { valid: false } });

      const wrapper = await mountApplyConfirm();
      await flushPromises();

      const reapplyLink = wrapper.find('a.forgot');
      expect(reapplyLink.exists()).toBe(true);
      expect(reapplyLink.attributes('href')).toBe('/auth/apply');
      wrapper.unmount();
    });
  });
});
