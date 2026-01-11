import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import funding from '@/client/components/admin/funding.vue';
import AddProviderWizard from '@/client/components/admin/AddProviderWizard.vue';
import SubscriptionService from '@/client/service/subscription';
import enAdmin from '@/client/locales/en/admin.json';

// Mock SubscriptionService
vi.mock('@/client/service/subscription', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      getSettings: vi.fn().mockResolvedValue({
        enabled: true,
        monthlyPrice: 1000000, // 10.00 in millicents
        yearlyPrice: 10000000, // 100.00 in millicents
        currency: 'USD',
        payWhatYouCan: false,
        gracePeriodDays: 7,
      }),
      getProviders: vi.fn().mockResolvedValue([
        {
          provider_type: 'stripe',
          display_name: 'Stripe',
          configured: false,
          enabled: false,
        },
        {
          provider_type: 'paypal',
          display_name: 'PayPal',
          configured: false,
          enabled: false,
        },
      ]),
      getPlatformOAuthStatus: vi.fn().mockResolvedValue({ configured: true }),
      listSubscriptions: vi.fn().mockResolvedValue({ subscriptions: [], total: 0 }),
    })),
    formatCurrency: vi.fn((millicents, currency) => `${currency} ${(millicents / 1000000).toFixed(2)}`),
    millicentsToDisplay: vi.fn((millicents) => millicents / 1000000),
    displayToMillicents: vi.fn((amount) => amount * 1000000),
  };
});

// Mock vue-router
vi.mock('vue-router', () => ({
  useRoute: vi.fn(() => ({
    query: {},
  })),
  useRouter: vi.fn(() => ({
    replace: vi.fn(),
  })),
}));

describe('Funding Page Wizard Integration', () => {
  let wrapper: VueWrapper<any>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Initialize i18next
    await i18next.init({
      lng: 'en',
      resources: {
        en: {
          admin: enAdmin,
        },
      },
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  function mountWithI18n(options: any = {}) {
    return mount(funding, {
      ...options,
      global: {
        ...options.global,
        plugins: [[I18NextVue, { i18next }]],
      },
    });
  }

  it('renders "Add Provider" button when unconfigured providers exist', async () => {
    wrapper = mountWithI18n({
      global: {
        stubs: {
          PayPalConfigModal: true,
          ConfirmDisconnectModal: true,
          AddProviderWizard: true,
        },
      },
    });

    // Wait for component to load data
    await wrapper.vm.$nextTick();
    await new Promise(resolve => setTimeout(resolve, 100));

    const addProviderButton = wrapper.find('button.add-provider-button');
    expect(addProviderButton.exists()).toBe(true);
    expect(addProviderButton.text()).toBe('Add Provider');
  });

  it('disables "Add Provider" button with tooltip when all providers are connected', async () => {
    const mockService = {
      getSettings: vi.fn().mockResolvedValue({
        enabled: true,
        monthlyPrice: 1000000,
        yearlyPrice: 10000000,
        currency: 'USD',
        payWhatYouCan: false,
        gracePeriodDays: 7,
      }),
      getProviders: vi.fn().mockResolvedValue([
        {
          provider_type: 'stripe',
          display_name: 'Stripe',
          configured: true,
          enabled: true,
        },
        {
          provider_type: 'paypal',
          display_name: 'PayPal',
          configured: true,
          enabled: true,
        },
      ]),
      getPlatformOAuthStatus: vi.fn().mockResolvedValue({ configured: true }),
      listSubscriptions: vi.fn().mockResolvedValue({ subscriptions: [], total: 0 }),
    };

    vi.mocked(SubscriptionService).mockImplementation(() => mockService as any);

    wrapper = mountWithI18n({
      global: {
        stubs: {
          PayPalConfigModal: true,
          ConfirmDisconnectModal: true,
          AddProviderWizard: true,
        },
      },
    });

    await wrapper.vm.$nextTick();
    await new Promise(resolve => setTimeout(resolve, 100));

    const addProviderButton = wrapper.find('button.add-provider-button');
    expect(addProviderButton.exists()).toBe(true);
    expect(addProviderButton.attributes('disabled')).toBeDefined();
    expect(addProviderButton.attributes('title')).toBe('All available providers are already connected');
  });

  it('opens wizard with correct provider list when "Add Provider" button is clicked', async () => {
    wrapper = mountWithI18n({
      global: {
        stubs: {
          PayPalConfigModal: true,
          ConfirmDisconnectModal: true,
        },
      },
    });

    await wrapper.vm.$nextTick();
    await new Promise(resolve => setTimeout(resolve, 100));

    const addProviderButton = wrapper.find('button.add-provider-button');
    await addProviderButton.trigger('click');
    await wrapper.vm.$nextTick();

    const wizardComponent = wrapper.findComponent(AddProviderWizard);
    expect(wizardComponent.exists()).toBe(true);
    expect(wizardComponent.props('show')).toBe(true);

    const unconfiguredProviders = wizardComponent.props('unconfiguredProviders');
    expect(unconfiguredProviders).toHaveLength(2);
    expect(unconfiguredProviders[0].provider_type).toBe('stripe');
    expect(unconfiguredProviders[1].provider_type).toBe('paypal');
  });

  it('updates provider list after successful wizard completion', async () => {
    const mockService = {
      getSettings: vi.fn().mockResolvedValue({
        enabled: true,
        monthlyPrice: 1000000,
        yearlyPrice: 10000000,
        currency: 'USD',
        payWhatYouCan: false,
        gracePeriodDays: 7,
      }),
      getProviders: vi.fn()
        .mockResolvedValueOnce([
          {
            provider_type: 'stripe',
            display_name: 'Stripe',
            configured: false,
            enabled: false,
          },
          {
            provider_type: 'paypal',
            display_name: 'PayPal',
            configured: false,
            enabled: false,
          },
        ])
        .mockResolvedValueOnce([
          {
            provider_type: 'stripe',
            display_name: 'Stripe',
            configured: true,
            enabled: true,
          },
          {
            provider_type: 'paypal',
            display_name: 'PayPal',
            configured: false,
            enabled: false,
          },
        ]),
      getPlatformOAuthStatus: vi.fn().mockResolvedValue({ configured: true }),
      listSubscriptions: vi.fn().mockResolvedValue({ subscriptions: [], total: 0 }),
    };

    vi.mocked(SubscriptionService).mockImplementation(() => mockService as any);

    wrapper = mountWithI18n({
      global: {
        stubs: {
          PayPalConfigModal: true,
          ConfirmDisconnectModal: true,
        },
      },
    });

    await wrapper.vm.$nextTick();
    await new Promise(resolve => setTimeout(resolve, 100));

    // Open wizard
    const addProviderButton = wrapper.find('button.add-provider-button');
    await addProviderButton.trigger('click');
    await wrapper.vm.$nextTick();

    // Emit provider-connected event
    const wizardComponent = wrapper.findComponent(AddProviderWizard);
    wizardComponent.vm.$emit('provider-connected');
    await wrapper.vm.$nextTick();
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify getProviders was called again
    expect(mockService.getProviders).toHaveBeenCalledTimes(2);
  });

  it('shows "Connected Payment Providers" as section title', async () => {
    wrapper = mountWithI18n({
      global: {
        stubs: {
          PayPalConfigModal: true,
          ConfirmDisconnectModal: true,
          AddProviderWizard: true,
        },
      },
    });

    await wrapper.vm.$nextTick();
    await new Promise(resolve => setTimeout(resolve, 100));

    const providersSection = wrapper.find('.providers-section');
    expect(providersSection.exists()).toBe(true);

    const sectionTitle = providersSection.find('h2');
    expect(sectionTitle.text()).toBe('Connected Payment Providers');
  });

  it('closes wizard when close event is emitted', async () => {
    wrapper = mountWithI18n({
      global: {
        stubs: {
          PayPalConfigModal: true,
          ConfirmDisconnectModal: true,
        },
      },
    });

    await wrapper.vm.$nextTick();
    await new Promise(resolve => setTimeout(resolve, 100));

    // Open wizard
    const addProviderButton = wrapper.find('button.add-provider-button');
    await addProviderButton.trigger('click');
    await wrapper.vm.$nextTick();

    let wizardComponent = wrapper.findComponent(AddProviderWizard);
    expect(wizardComponent.props('show')).toBe(true);

    // Close wizard
    wizardComponent.vm.$emit('close');
    await wrapper.vm.$nextTick();

    wizardComponent = wrapper.findComponent(AddProviderWizard);
    expect(wizardComponent.props('show')).toBe(false);
  });
});
