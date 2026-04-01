import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';

import { mountComponent } from '@/client/test/lib/vue';

// Shared mock fns -- vi.hoisted ensures they're available before vi.mock runs
const {
  mockGetOptions,
  mockCreateCheckoutSession,
  mockGetCheckoutSessionStatus,
  mockLoadStripe,
} = vi.hoisted(() => ({
  mockGetOptions: vi.fn(),
  mockCreateCheckoutSession: vi.fn(),
  mockGetCheckoutSessionStatus: vi.fn(),
  mockLoadStripe: vi.fn(),
}));

vi.mock('@/client/service/funding', () => {
  const MockClass = vi.fn().mockImplementation(() => ({
    getOptions: mockGetOptions,
    createCheckoutSession: mockCreateCheckoutSession,
    getCheckoutSessionStatus: mockGetCheckoutSessionStatus,
  }));
  MockClass.formatCurrency = (millicents: number, currency: string) => {
    const amount = millicents / 100000;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  };
  MockClass.displayToMillicents = (amount: number) => Math.round(amount * 100000);
  MockClass.millicentsToDisplay = (millicents: number) => millicents / 100000;
  return { default: MockClass };
});

vi.mock('@/client/service/stripe-loader', () => ({
  loadStripe: (...args: any[]) => mockLoadStripe(...args),
}));

// Import component after mocks are set up
import FundingForm from '@/client/components/account/FundingForm.vue';

const routes: RouteRecordRaw[] = [
  { path: '/', component: {}, name: 'home' },
];

function makeStripeOptions(overrides: Record<string, any> = {}) {
  return {
    enabled: true,
    providers: [
      { providerType: 'stripe', displayName: 'Credit Card', publishableKey: 'pk_test_abc123' },
    ],
    monthlyPrice: 1000000,
    yearlyPrice: 10000000,
    currency: 'USD',
    payWhatYouCan: false,
    ...overrides,
  };
}

function makePayPalOptions() {
  return {
    enabled: true,
    providers: [
      { providerType: 'paypal', displayName: 'PayPal' },
    ],
    monthlyPrice: 1000000,
    yearlyPrice: 10000000,
    currency: 'USD',
    payWhatYouCan: false,
  };
}

function makeMultiProviderOptions() {
  return {
    enabled: true,
    providers: [
      { providerType: 'stripe', displayName: 'Credit Card', publishableKey: 'pk_test_abc123' },
      { providerType: 'paypal', displayName: 'PayPal' },
    ],
    monthlyPrice: 1000000,
    yearlyPrice: 10000000,
    currency: 'USD',
    payWhatYouCan: false,
  };
}

/**
 * Creates a mock Stripe instance that captures the onComplete callback
 * passed to initEmbeddedCheckout, allowing tests to trigger it manually.
 */
function makeMockStripeWithCallbackCapture() {
  let capturedOnComplete: (() => void) | null = null;
  const mockCheckout = { mount: vi.fn(), destroy: vi.fn() };
  const mockStripeInstance = {
    initEmbeddedCheckout: vi.fn().mockImplementation((opts: any) => {
      capturedOnComplete = opts.onComplete || null;
      return Promise.resolve(mockCheckout);
    }),
  };

  return {
    mockCheckout,
    mockStripeInstance,
    triggerOnComplete: () => {
      if (capturedOnComplete) {
        capturedOnComplete();
      }
    },
  };
}

const mountFundingForm = async (props: Record<string, any> = {}) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });

  await router.push('/');
  await router.isReady();

  const wrapper = mountComponent(FundingForm, router, { props });

  // Wait for loadOptions to complete
  await flushPromises();

  return wrapper;
};

describe('FundingForm', () => {
  let currentWrapper: any = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (currentWrapper) {
      currentWrapper.unmount();
      currentWrapper = null;
    }
  });

  describe('Configure state', () => {
    it('renders loading state initially', async () => {
      mockGetOptions.mockReturnValue(new Promise(() => {}));

      const router = createRouter({
        history: createMemoryHistory(),
        routes,
      });
      await router.push('/');
      await router.isReady();

      const wrapper = mountComponent(FundingForm, router, {});
      currentWrapper = wrapper;

      expect(wrapper.find('.loading').exists()).toBe(true);
    });

    it('renders billing cycle options after loading', async () => {
      mockGetOptions.mockResolvedValue(makeStripeOptions());

      const wrapper = await mountFundingForm();
      currentWrapper = wrapper;

      expect(wrapper.find('.loading').exists()).toBe(false);
      expect(wrapper.findAll('.cycle-option')).toHaveLength(2);
    });

    it('hides provider selection when only available provider is stripe (paypal filtered)', async () => {
      mockGetOptions.mockResolvedValue(makeMultiProviderOptions());

      const wrapper = await mountFundingForm();
      currentWrapper = wrapper;

      expect(wrapper.find('.provider-options').exists()).toBe(false);
    });

    it('hides provider selection when single provider', async () => {
      mockGetOptions.mockResolvedValue(makeStripeOptions());

      const wrapper = await mountFundingForm();
      currentWrapper = wrapper;

      expect(wrapper.find('.provider-options').exists()).toBe(false);
    });

    it('shows PWYC amount input when payWhatYouCan is true', async () => {
      mockGetOptions.mockResolvedValue(makeStripeOptions({ payWhatYouCan: true }));

      const wrapper = await mountFundingForm();
      currentWrapper = wrapper;

      expect(wrapper.find('input[type="number"]').exists()).toBe(true);
    });

    it('hides PWYC amount input when payWhatYouCan is false', async () => {
      mockGetOptions.mockResolvedValue(makeStripeOptions());

      const wrapper = await mountFundingForm();
      currentWrapper = wrapper;

      expect(wrapper.find('input[type="number"]').exists()).toBe(false);
    });

    it('renders confirm button', async () => {
      mockGetOptions.mockResolvedValue(makeStripeOptions());

      const wrapper = await mountFundingForm();
      currentWrapper = wrapper;

      const button = wrapper.find('button.btn--primary');
      expect(button.exists()).toBe(true);
    });

    it('shows error when loading options fails', async () => {
      mockGetOptions.mockRejectedValue(new Error('Network error'));

      const wrapper = await mountFundingForm();
      currentWrapper = wrapper;

      expect(wrapper.find('.error-message').exists()).toBe(true);
    });
  });

  describe('Stripe embedded checkout flow', () => {
    it('creates checkout session when submit clicked with Stripe provider', async () => {
      mockGetOptions.mockResolvedValue(makeStripeOptions());

      const { mockStripeInstance } = makeMockStripeWithCallbackCapture();
      mockLoadStripe.mockResolvedValue(mockStripeInstance);

      mockCreateCheckoutSession.mockResolvedValue({
        clientSecret: 'cs_test_secret',
        sessionId: 'cs_test_session',
      });

      const wrapper = await mountFundingForm();
      currentWrapper = wrapper;

      await wrapper.find('button.btn--primary').trigger('click');
      await flushPromises();

      expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          billingCycle: 'monthly',
          returnUrl: expect.any(String),
        }),
      );
    });

    it('passes onComplete callback to initEmbeddedCheckout', async () => {
      mockGetOptions.mockResolvedValue(makeStripeOptions());

      const { mockStripeInstance } = makeMockStripeWithCallbackCapture();
      mockLoadStripe.mockResolvedValue(mockStripeInstance);

      mockCreateCheckoutSession.mockResolvedValue({
        clientSecret: 'cs_test_secret',
        sessionId: 'cs_test_session',
      });

      const wrapper = await mountFundingForm();
      currentWrapper = wrapper;

      await wrapper.find('button.btn--primary').trigger('click');
      await flushPromises();

      expect(mockStripeInstance.initEmbeddedCheckout).toHaveBeenCalledWith(
        expect.objectContaining({
          clientSecret: 'cs_test_secret',
          onComplete: expect.any(Function),
        }),
      );
    });

    it('passes calendarIds when calendarId prop is provided', async () => {
      mockGetOptions.mockResolvedValue(makeStripeOptions());

      const { mockStripeInstance } = makeMockStripeWithCallbackCapture();
      mockLoadStripe.mockResolvedValue(mockStripeInstance);

      mockCreateCheckoutSession.mockResolvedValue({
        clientSecret: 'cs_test_secret',
        sessionId: 'cs_test_session',
      });

      const wrapper = await mountFundingForm({ calendarId: 'cal-123' });
      currentWrapper = wrapper;

      await wrapper.find('button.btn--primary').trigger('click');
      await flushPromises();

      expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarIds: ['cal-123'],
        }),
      );
    });

    it('switches to checkout state after session creation', async () => {
      mockGetOptions.mockResolvedValue(makeStripeOptions());

      const { mockStripeInstance } = makeMockStripeWithCallbackCapture();
      mockLoadStripe.mockResolvedValue(mockStripeInstance);

      mockCreateCheckoutSession.mockResolvedValue({
        clientSecret: 'cs_test_secret',
        sessionId: 'cs_test_session',
      });

      const wrapper = await mountFundingForm();
      currentWrapper = wrapper;

      await wrapper.find('button.btn--primary').trigger('click');
      await flushPromises();

      expect(wrapper.find('.stripe-checkout-container').exists()).toBe(true);
    });

    it('shows error when Stripe fails to load', async () => {
      mockGetOptions.mockResolvedValue(makeStripeOptions());

      mockLoadStripe.mockRejectedValue(new Error('Failed to load Stripe.js'));

      mockCreateCheckoutSession.mockResolvedValue({
        clientSecret: 'cs_test_secret',
        sessionId: 'cs_test_session',
      });

      const wrapper = await mountFundingForm();
      currentWrapper = wrapper;

      await wrapper.find('button.btn--primary').trigger('click');
      await flushPromises();

      expect(wrapper.find('.error-message').exists()).toBe(true);
    });
  });

  describe('PayPal checkout (stub)', () => {
    it('shows error when PayPal provider is selected — not yet implemented', async () => {
      mockGetOptions.mockResolvedValue(makePayPalOptions());

      const wrapper = await mountFundingForm();
      currentWrapper = wrapper;

      await wrapper.find('button.btn--primary').trigger('click');
      await flushPromises();

      expect(wrapper.find('.error-message').exists()).toBe(true);
    });
  });

  describe('Result state via onComplete callback', () => {
    it('shows success message when onComplete fires and API confirms completion', async () => {
      mockGetOptions.mockResolvedValue(makeStripeOptions());

      const { mockStripeInstance, triggerOnComplete } = makeMockStripeWithCallbackCapture();
      mockLoadStripe.mockResolvedValue(mockStripeInstance);

      mockCreateCheckoutSession.mockResolvedValue({
        clientSecret: 'cs_test_secret',
        sessionId: 'cs_test_session',
      });

      mockGetCheckoutSessionStatus.mockResolvedValue({
        status: 'complete',
        customer_email: 'test@example.com',
      });

      const wrapper = await mountFundingForm();
      currentWrapper = wrapper;

      await wrapper.find('button.btn--primary').trigger('click');
      await flushPromises();

      // Trigger the onComplete callback that Stripe would fire
      triggerOnComplete();
      await flushPromises();

      expect(mockGetCheckoutSessionStatus).toHaveBeenCalledWith('cs_test_session');
      expect(wrapper.find('.success-message').exists()).toBe(true);
    });

    it('shows error message when onComplete fires and API reports expired', async () => {
      mockGetOptions.mockResolvedValue(makeStripeOptions());

      const { mockStripeInstance, triggerOnComplete } = makeMockStripeWithCallbackCapture();
      mockLoadStripe.mockResolvedValue(mockStripeInstance);

      mockCreateCheckoutSession.mockResolvedValue({
        clientSecret: 'cs_test_secret',
        sessionId: 'cs_test_session',
      });

      mockGetCheckoutSessionStatus.mockResolvedValue({
        status: 'expired',
      });

      const wrapper = await mountFundingForm();
      currentWrapper = wrapper;

      await wrapper.find('button.btn--primary').trigger('click');
      await flushPromises();

      triggerOnComplete();
      await flushPromises();

      expect(wrapper.find('.error-message').exists()).toBe(true);
    });

    it('shows error when API verification fails after onComplete', async () => {
      mockGetOptions.mockResolvedValue(makeStripeOptions());

      const { mockStripeInstance, triggerOnComplete } = makeMockStripeWithCallbackCapture();
      mockLoadStripe.mockResolvedValue(mockStripeInstance);

      mockCreateCheckoutSession.mockResolvedValue({
        clientSecret: 'cs_test_secret',
        sessionId: 'cs_test_session',
      });

      mockGetCheckoutSessionStatus.mockRejectedValue(new Error('Network error'));

      const wrapper = await mountFundingForm();
      currentWrapper = wrapper;

      await wrapper.find('button.btn--primary').trigger('click');
      await flushPromises();

      triggerOnComplete();
      await flushPromises();

      // Should show error since payment verification could not be confirmed
      expect(wrapper.find('.error-message').exists()).toBe(true);
    });

    it('emits subscribed when done button clicked after success', async () => {
      mockGetOptions.mockResolvedValue(makeStripeOptions());

      const { mockStripeInstance, triggerOnComplete } = makeMockStripeWithCallbackCapture();
      mockLoadStripe.mockResolvedValue(mockStripeInstance);

      mockCreateCheckoutSession.mockResolvedValue({
        clientSecret: 'cs_test_secret',
        sessionId: 'cs_test_session',
      });

      mockGetCheckoutSessionStatus.mockResolvedValue({
        status: 'complete',
      });

      const wrapper = await mountFundingForm();
      currentWrapper = wrapper;

      await wrapper.find('button.btn--primary').trigger('click');
      await flushPromises();

      triggerOnComplete();
      await flushPromises();

      const doneButton = wrapper.find('.result-state button.btn--primary');
      expect(doneButton.exists()).toBe(true);
      await doneButton.trigger('click');
      await flushPromises();

      expect(wrapper.emitted('subscribed')).toBeTruthy();
    });

    it('returns to configure state when try again clicked after error', async () => {
      mockGetOptions.mockResolvedValue(makeStripeOptions());

      const { mockStripeInstance, triggerOnComplete } = makeMockStripeWithCallbackCapture();
      mockLoadStripe.mockResolvedValue(mockStripeInstance);

      mockCreateCheckoutSession.mockResolvedValue({
        clientSecret: 'cs_test_secret',
        sessionId: 'cs_test_session',
      });

      mockGetCheckoutSessionStatus.mockResolvedValue({
        status: 'expired',
      });

      const wrapper = await mountFundingForm();
      currentWrapper = wrapper;

      await wrapper.find('button.btn--primary').trigger('click');
      await flushPromises();

      triggerOnComplete();
      await flushPromises();

      const tryAgainButton = wrapper.find('.result-state button.btn--secondary');
      expect(tryAgainButton.exists()).toBe(true);
      await tryAgainButton.trigger('click');
      await flushPromises();

      expect(wrapper.findAll('.cycle-option')).toHaveLength(2);
    });
  });
});
