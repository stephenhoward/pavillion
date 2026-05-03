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
    get: vi.fn(),
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
    vi.mocked(axios.get).mockReset();
    vi.mocked(axios.post).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Validating State', () => {
    it('should render a loading indicator while the GET request is in flight', async () => {
      // Arrange a pending GET so the component stays in the validating state
      vi.mocked(axios.get).mockReturnValueOnce(new Promise(() => {
        // never resolves
      }));

      const wrapper = await mountApplyConfirm();

      // The validating message must render
      expect(wrapper.text()).toContain('Checking your confirmation link');
      // The confirm button must NOT render in the validating state
      expect(wrapper.find('button[type="button"]').exists()).toBe(false);
      wrapper.unmount();
    });

    it('should call the GET endpoint with the route token on mount', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { valid: true } });

      const wrapper = await mountApplyConfirm();
      await flushPromises();

      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(axios.get).toHaveBeenCalledWith(
        `/api/v1/applications/confirm/${TEST_TOKEN}`,
      );
      wrapper.unmount();
    });
  });

  describe('Valid Token State', () => {
    it('should render an explicit "Confirm my email" button when the token is valid', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { valid: true } });

      const wrapper = await mountApplyConfirm();
      await flushPromises();

      const button = wrapper.find('button.btn--primary');
      expect(button.exists()).toBe(true);
      expect(button.text()).toBe('Confirm my email');
    });

    it('should fire POST only on explicit user click, never on mount', async () => {
      // CRITICAL: email scanners and prefetch services follow GET links.
      // The POST must only happen on explicit user click. This test proves
      // the causal relationship in a single self-contained assertion: the
      // mere fact of mounting and rendering must NOT call POST, and only
      // an explicit click triggers it — exactly once.
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { valid: true } });
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { success: true } });

      const wrapper = await mountApplyConfirm();
      await flushPromises();

      // The valid state has rendered (button is visible)
      expect(wrapper.find('button.btn--primary').exists()).toBe(true);

      // Mount + render alone must NEVER call POST
      expect(axios.post).not.toHaveBeenCalled();

      // Now an explicit user click must trigger POST exactly once
      await wrapper.find('button.btn--primary').trigger('click');
      await flushPromises();

      expect(axios.post).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    });

    it('should not render the invalid copy in the valid state', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { valid: true } });

      const wrapper = await mountApplyConfirm();
      await flushPromises();

      expect(wrapper.text()).not.toContain('confirmation link is invalid');
      wrapper.unmount();
    });
  });

  describe('Invalid / Expired Token State', () => {
    it('should render the generic invalid/expired copy when GET returns valid=false', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { valid: false } });

      const wrapper = await mountApplyConfirm();
      await flushPromises();

      expect(wrapper.text()).toContain('confirmation link is invalid');
      // No confirm button in the invalid state
      expect(wrapper.find('button.btn--primary').exists()).toBe(false);
      wrapper.unmount();
    });

    it('should render the same generic copy when GET fails entirely (network error)', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('Network down'));

      const wrapper = await mountApplyConfirm();
      await flushPromises();

      expect(wrapper.text()).toContain('confirmation link is invalid');
      expect(wrapper.find('button.btn--primary').exists()).toBe(false);
      wrapper.unmount();
    });

    it('should render a router-link back to the apply form in the invalid state', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { valid: false } });

      const wrapper = await mountApplyConfirm();
      await flushPromises();

      const reapplyLink = wrapper.find('a.forgot');
      expect(reapplyLink.exists()).toBe(true);
      expect(reapplyLink.attributes('href')).toBe('/auth/apply');
      wrapper.unmount();
    });
  });

  describe('Successful Confirmation', () => {
    it('should POST to the confirm endpoint when the user clicks the button', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { valid: true } });
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { success: true } });

      const wrapper = await mountApplyConfirm();
      await flushPromises();

      // POST has not been called yet
      expect(axios.post).not.toHaveBeenCalled();

      // User clicks the confirm button
      await wrapper.find('button.btn--primary').trigger('click');
      await flushPromises();

      // POST must have been called exactly once with the right URL
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(axios.post).toHaveBeenCalledWith(
        `/api/v1/applications/confirm/${TEST_TOKEN}`,
      );
      wrapper.unmount();
    });

    it('should render the success message after a successful POST', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { valid: true } });
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { success: true } });

      const wrapper = await mountApplyConfirm();
      await flushPromises();

      await wrapper.find('button.btn--primary').trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('application is now under review');
      // Confirm button is no longer rendered after success
      expect(wrapper.find('button.btn--primary').exists()).toBe(false);
      wrapper.unmount();
    });

    it('should render a router-link back to login in the success state', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { valid: true } });
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { success: true } });

      const wrapper = await mountApplyConfirm();
      await flushPromises();

      await wrapper.find('button.btn--primary').trigger('click');
      await flushPromises();

      const homeLink = wrapper.find('a.forgot');
      expect(homeLink.exists()).toBe(true);
      expect(homeLink.attributes('href')).toBe('/auth/login');
      wrapper.unmount();
    });
  });

  describe('POST Failure', () => {
    it('should fall back to the generic invalid copy when POST returns valid=false', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { valid: true } });
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { valid: false } });

      const wrapper = await mountApplyConfirm();
      await flushPromises();

      await wrapper.find('button.btn--primary').trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('confirmation link is invalid');
      // The success copy must NOT appear
      expect(wrapper.text()).not.toContain('application is now under review');
      wrapper.unmount();
    });

    it('should fall back to the generic invalid copy when POST throws a network error', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { valid: true } });
      vi.mocked(axios.post).mockRejectedValueOnce(new Error('Network down'));

      const wrapper = await mountApplyConfirm();
      await flushPromises();

      await wrapper.find('button.btn--primary').trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('confirmation link is invalid');
      wrapper.unmount();
    });
  });

  describe('Submit-In-Progress State', () => {
    it('should disable the confirm button while POST is in flight', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { valid: true } });

      let resolvePost!: (value: any) => void;
      vi.mocked(axios.post).mockReturnValueOnce(new Promise((resolve) => {
        resolvePost = resolve;
      }));

      const wrapper = await mountApplyConfirm();
      await flushPromises();

      const button = wrapper.find('button.btn--primary');
      await button.trigger('click');
      await flushPromises();

      // Button is now disabled, exposes aria-disabled, and shows the
      // in-progress label — all three are observable and asserted.
      expect(button.attributes('disabled')).toBeDefined();
      expect(button.attributes('aria-disabled')).toBe('true');
      expect(button.text()).toBe('Confirming…');

      // Resolve so afterEach does not leak a pending promise
      resolvePost({ data: { success: true } });
      await flushPromises();
      wrapper.unmount();
    });
  });
});
