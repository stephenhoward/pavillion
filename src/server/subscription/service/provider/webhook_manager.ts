import { ProviderType } from '@/common/model/subscription';
import config from 'config';

/**
 * Webhook Manager Utility Service
 *
 * Manages webhook URL generation for payment provider integrations.
 * Generates properly formatted webhook URLs based on instance domain configuration.
 */
export class WebhookManager {
  /**
   * Generate webhook URL for a specific provider
   *
   * Format: https://{domain}/api/subscription/v1/webhooks/{provider_type}
   *
   * @param providerType - The provider type (stripe or paypal)
   * @returns Fully qualified webhook URL
   */
  generateWebhookUrl(providerType: ProviderType): string {
    const domain = this.getInstanceDomain();
    return `${domain}/api/subscription/v1/webhooks/${providerType}`;
  }

  /**
   * Get instance domain from configuration or environment
   *
   * @returns Instance domain with protocol
   * @private
   */
  private getInstanceDomain(): string {
    // Try to get domain from config
    try {
      if (config.has('server.domain')) {
        const domain = config.get<string>('server.domain');
        if (domain && typeof domain === 'string' && domain.trim().length > 0) {
          // Ensure domain has protocol
          return domain.startsWith('http') ? domain : `https://${domain}`;
        }
      }
    }
    catch (e) {
      // Config doesn't have server.domain, continue to fallback
    }

    // Try environment variable
    const baseUrl = process.env.BASE_URL;
    if (baseUrl && typeof baseUrl === 'string' && baseUrl.trim().length > 0) {
      return baseUrl;
    }

    // Unconditional fallback to localhost for development/test environments
    // This handles cases where NODE_ENV might not be properly set in test environments
    return 'http://localhost:3000';
  }
}
