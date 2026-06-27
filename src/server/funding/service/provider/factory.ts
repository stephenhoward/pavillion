import { PaymentProviderAdapter, ProviderCredentials } from './adapter';
import { StripeAdapter } from './stripe';
import { PayPalAdapter } from './paypal';
import { MockStripeAdapter, MockPayPalAdapter } from './mock_adapters';
import { ProviderConfigEntity } from '@/server/funding/entity/provider_config';

/**
 * Factory for instantiating payment provider adapters
 *
 * Creates and caches adapter instances based on provider configuration.
 * Uses mock adapters in development/test when real credentials are unavailable.
 */
export class ProviderFactory {
  private static adapterCache: Map<string, PaymentProviderAdapter> = new Map();

  /**
   * Create or retrieve cached adapter instance for a provider config entity.
   * Decrypts credentials on demand — never passes through the domain model.
   *
   * @param entity - Provider config entity with encrypted credentials
   * @returns Initialized payment provider adapter
   */
  static getAdapter(entity: ProviderConfigEntity): PaymentProviderAdapter {
    // Check cache first
    const cached = this.adapterCache.get(entity.id);
    if (cached) {
      return cached;
    }

    // Decrypt and parse credentials
    let credentials: ProviderCredentials;
    try {
      credentials = JSON.parse(entity.decryptCredentials());
    }
    catch {
      throw new Error(`Invalid credentials format for provider ${entity.id}`);
    }

    const webhookSecret = entity.decryptWebhookSecret();

    // Create adapter based on provider type
    let adapter: PaymentProviderAdapter;
    const useMock = this.shouldUseMock(credentials);

    switch (entity.provider_type) {
      case 'stripe':
        adapter = useMock
          ? new MockStripeAdapter()
          : new StripeAdapter(credentials, webhookSecret);
        break;

      case 'paypal':
        adapter = useMock
          ? new MockPayPalAdapter()
          : new PayPalAdapter(credentials, webhookSecret);
        break;

      default:
        throw new Error(`Unsupported provider type: ${entity.provider_type}`);
    }

    // Cache the adapter instance
    this.adapterCache.set(entity.id, adapter);

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
