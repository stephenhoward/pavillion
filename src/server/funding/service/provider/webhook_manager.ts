import { ProviderType } from '@/common/model/funding-plan';
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
   * Format: https://{domain}/api/funding/webhooks/{provider_type}
   *
   * The webhook route is intentionally mounted without the /v1 prefix in
   * src/server/funding/api/v1.ts — webhook URLs are pasted into third-party
   * provider dashboards and should not churn with internal API version bumps.
   *
   * @param providerType - The provider type (stripe or paypal)
   * @returns Fully qualified webhook URL
   */
  generateWebhookUrl(providerType: ProviderType): string {
    const domain = this.getInstanceDomain();
    return `${domain}/api/funding/webhooks/${providerType}`;
  }

  /**
   * Get instance domain from configuration or environment
   *
   * @returns Instance domain with protocol
   * @private
   */
  private getInstanceDomain(): string {
    return this.enforceHttpsForRemoteHosts(this.resolveRawDomain());
  }

  private resolveRawDomain(): string {
    // The instance domain comes from the canonical `domain` config key — the
    // same key every other URL-minting call site in the codebase reads, with
    // `config/default.yaml` guaranteeing a value in every environment and
    // LOCAL_DOMAIN as the env override (config/custom-environment-variables.yaml).
    //
    // Decision: no BASE_URL or localhost fallback. This method previously read
    // the nonexistent `server.domain` key and silently fell through to
    // process.env.BASE_URL or a hardcoded localhost URL, so a misconfigured
    // instance registered a webhook against the wrong domain with no error —
    // a payment-integration failure that presents as "webhooks never arrive."
    // A webhook URL pasted into a provider dashboard must use the real
    // instance domain, so a missing or blank domain fails loudly instead.
    const domain = config.get<string>('domain');
    if (typeof domain !== 'string' || domain.trim().length === 0) {
      throw new Error(
        'Instance domain is not configured: the "domain" config key is blank. '
        + 'Refusing to generate a payment-provider webhook URL without it.',
      );
    }
    // Ensure domain has protocol
    return domain.startsWith('http') ? domain : `https://${domain}`;
  }

  /**
   * Upgrade http:// to https:// for any non-localhost host.
   *
   * Payment provider dashboards (Stripe, PayPal) reject non-HTTPS webhook URLs
   * in production. An operator who sets the `domain` config value with an
   * explicit http:// prefix (typical when a reverse proxy terminates TLS in
   * front of the app) would otherwise leak that scheme through into the URL
   * we hand to the operator.
   *
   * Localhost is left as http:// so local development still works without
   * generating a TLS certificate.
   */
  private enforceHttpsForRemoteHosts(url: string): string {
    const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url);
    if (isLocalhost) return url;
    if (url.startsWith('http://')) return `https://${url.slice('http://'.length)}`;
    return url;
  }
}
