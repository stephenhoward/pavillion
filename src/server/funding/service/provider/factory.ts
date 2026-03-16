import { PaymentProviderAdapter, ProviderCredentials } from './adapter';
import { StripeAdapter } from './stripe';
import { PayPalAdapter } from './paypal';
import { MockStripeAdapter, MockPayPalAdapter } from './mock_adapters';
import { ProviderConfig } from '@/common/model/funding-plan';

/**
 * Factory for instantiating payment provider adapters
 *
 * Creates and caches adapter instances based on provider configuration.
 * Uses mock adapters in development/test when real credentials are unavailable.
 */
export class ProviderFactory {
  private static adapterCache: Map<string, PaymentProviderAdapter> = new Map();

  /**
   * Create or retrieve cached adapter instance for a provider config
   *
   * @param config - Provider configuration with encrypted credentials
   * @returns Initialized payment provider adapter
   */
  static getAdapter(config: ProviderConfig): PaymentProviderAdapter {
    // Check cache first
    const cached = this.adapterCache.get(config.id);
    if (cached) {
      return cached;
    }

    // Parse credentials from JSON string
    let credentials: ProviderCredentials;
    try {
      credentials = JSON.parse(config.credentials);
    }
    catch (err) {
      throw new Error(`Invalid credentials format for provider ${config.id}`);
    }

    // Create adapter based on provider type
    let adapter: PaymentProviderAdapter;
    const useMock = this.shouldUseMock(credentials);

    switch (config.providerType) {
      case 'stripe':
        adapter = useMock
          ? new MockStripeAdapter()
          : new StripeAdapter(credentials, config.webhookSecret);
        break;

      case 'paypal':
        adapter = useMock
          ? new MockPayPalAdapter()
          : new PayPalAdapter(credentials, config.webhookSecret);
        break;

      default:
        throw new Error(`Unsupported provider type: ${config.providerType}`);
    }

    // Cache the adapter instance
    this.adapterCache.set(config.id, adapter);

    return adapter;
  }

  /**
   * Determine whether to use mock adapters
   *
   * Uses mock adapters in development/test when real credentials are unavailable.
   *
   * @param credentials - Provider credentials to check
   * @returns True if mock adapters should be used
   * @private
   */
  private static shouldUseMock(credentials: ProviderCredentials): boolean {
    const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
    const hasCredentials = credentials.apiKey || credentials.client_id || credentials.clientId;

    return isDev && !hasCredentials;
  }

  /**
   * Clear cached adapter for a specific provider config
   *
   * @param configId - Provider config ID
   */
  static clearCache(configId: string): void {
    this.adapterCache.delete(configId);
  }

  /**
   * Clear all cached adapters
   */
  static clearAllCaches(): void {
    this.adapterCache.clear();
  }
}
