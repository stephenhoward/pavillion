import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises, VueWrapper } from '@vue/test-utils';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';
import axios from 'axios';
import { createMemoryHistory, createRouter } from 'vue-router';

import ApplyConfirm from '@/site/components/apply-confirm.vue';

// Mock axios so the component never makes real network calls
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const TEST_TOKEN = 'test-confirm-token-abc123';

/**
 * i18next requires initialization to return key paths for missing keys.
 * Without init, t() returns undefined which breaks reactive state.
 * Keys are mapped to themselves so assertions can check for key paths.
 */
const applyConfirmTranslations: Record<string, string> = {
  'apply_confirm.heading': 'apply_confirm.heading',
  'apply_confirm.validating': 'apply_confirm.validating',
  'apply_confirm.valid_intro': 'apply_confirm.valid_intro',
  'apply_confirm.confirm_button': 'apply_confirm.confirm_button',
  'apply_confirm.confirming': 'apply_confirm.confirming',
  'apply_confirm.invalid_message': 'apply_confirm.invalid_message',
  'apply_confirm.reapply_link': 'apply_confirm.reapply_link',
  'apply_confirm.success_message': 'apply_confirm.success_message',
  'apply_confirm.go_home': 'apply_confirm.go_home',
};

/**
 * Build a stub router so vue-router composables (useRoute) work in component tests.
 * The route is pre-populated with the test token as a route parameter.
 */
function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/apply/confirm/:token', name: 'apply-confirm', component: ApplyConfirm },
      { path: '/', name: 'home', component: { template: '<div />' } },
    ],
  });
}

async function mountApplyConfirm(token: string = TEST_TOKEN): Promise<VueWrapper> {
  const router = buildRouter();
  await router.push(`/apply/confirm/${token}`);
  await router.isReady();
  return mount(ApplyConfirm, {
    global: {
      plugins: [router, [I18NextVue, { i18next }]],
    },
  });
}

describe('ApplyConfirm Component', () => {
  beforeAll(async () => {
    await i18next.init({
      lng: 'en',
      resources: {
        en: {
          system: applyConfirmTranslations,
        },
      },
    });
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
      expect(wrapper.text()).toContain('apply_confirm.validating');
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

      const button = wrapper.find('button.apply-confirm__button');
      expect(button.exists()).toBe(true);
      expect(button.text()).toBe('apply_confirm.confirm_button');
    });

    it('should NOT auto-trigger the POST request on mount or render', async () => {
      // CRITICAL: email scanners and prefetch services follow GET links.
      // The POST must only happen on explicit user click.
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { valid: true } });

      const wrapper = await mountApplyConfirm();
      await flushPromises();

      // The valid state has rendered (button is visible)
      expect(wrapper.find('button.apply-confirm__button').exists()).toBe(true);

      // But POST must NEVER be called automatically
      expect(axios.post).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it('should not render the invalid copy in the valid state', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { valid: true } });

      const wrapper = await mountApplyConfirm();
      await flushPromises();

      expect(wrapper.text()).not.toContain('apply_confirm.invalid_message');
      wrapper.unmount();
    });
  });

  describe('Invalid / Expired Token State', () => {
    it('should render the generic invalid/expired copy when GET returns valid=false', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { valid: false } });

      const wrapper = await mountApplyConfirm();
      await flushPromises();

      expect(wrapper.text()).toContain('apply_confirm.invalid_message');
      // No confirm button in the invalid state
      expect(wrapper.find('button.apply-confirm__button').exists()).toBe(false);
      wrapper.unmount();
    });

    it('should render the same generic copy when GET fails entirely (network error)', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('Network down'));

      const wrapper = await mountApplyConfirm();
      await flushPromises();

      expect(wrapper.text()).toContain('apply_confirm.invalid_message');
      expect(wrapper.find('button.apply-confirm__button').exists()).toBe(false);
      wrapper.unmount();
    });

    it('should render a link back to the apply form in the invalid state', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { valid: false } });

      const wrapper = await mountApplyConfirm();
      await flushPromises();

      const reapplyLink = wrapper.find('a.apply-confirm__reapply-link');
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
      await wrapper.find('button.apply-confirm__button').trigger('click');
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

      await wrapper.find('button.apply-confirm__button').trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('apply_confirm.success_message');
      // Confirm button is no longer rendered after success
      expect(wrapper.find('button.apply-confirm__button').exists()).toBe(false);
      wrapper.unmount();
    });

    it('should render a link back to the homepage in the success state', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { valid: true } });
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { success: true } });

      const wrapper = await mountApplyConfirm();
      await flushPromises();

      await wrapper.find('button.apply-confirm__button').trigger('click');
      await flushPromises();

      const homeLink = wrapper.find('a.apply-confirm__home-link');
      expect(homeLink.exists()).toBe(true);
      expect(homeLink.attributes('href')).toBe('/');
      wrapper.unmount();
    });
  });

  describe('POST Failure', () => {
    it('should fall back to the generic invalid copy when POST returns valid=false', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { valid: true } });
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { valid: false } });

      const wrapper = await mountApplyConfirm();
      await flushPromises();

      await wrapper.find('button.apply-confirm__button').trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('apply_confirm.invalid_message');
      // The success copy must NOT appear
      expect(wrapper.text()).not.toContain('apply_confirm.success_message');
      wrapper.unmount();
    });

    it('should fall back to the generic invalid copy when POST throws a network error', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { valid: true } });
      vi.mocked(axios.post).mockRejectedValueOnce(new Error('Network down'));

      const wrapper = await mountApplyConfirm();
      await flushPromises();

      await wrapper.find('button.apply-confirm__button').trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('apply_confirm.invalid_message');
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

      const button = wrapper.find('button.apply-confirm__button');
      await button.trigger('click');
      await flushPromises();

      // Button is now disabled and shows the in-progress label
      expect(button.attributes('disabled')).toBeDefined();

      // Resolve so afterEach does not leak a pending promise
      resolvePost({ data: { success: true } });
      await flushPromises();
      wrapper.unmount();
    });
  });
});
