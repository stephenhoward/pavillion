import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { Op } from 'sequelize';
import { ProviderType } from '@/common/model/subscription';
import { ProviderConfigEntity } from '@/server/subscription/entity/provider_config';
import { SubscriptionEntity } from '@/server/subscription/entity/subscription';
import { OAuthStateManager } from '@/server/subscription/service/oauth_state_manager';
import { WebhookManager } from '@/server/subscription/service/provider/webhook_manager';
import { ProviderFactory } from '@/server/subscription/service/provider/factory';
import { PaymentProviderAdapter, ProviderCredentials } from '@/server/subscription/service/provider/adapter';
import SubscriptionService from '@/server/subscription/service/subscription';

/**
 * User object for admin operations
 */
interface AdminUser {
  id: string;
  email: string;
}

/**
 * Result of OAuth initiation
 */
interface OAuthInitiationResult {
  oauthUrl: string;
  state: string;
}

/**
 * Provider status information
 */
interface ProviderStatus {
  configured: boolean;
  providerType?: ProviderType;
  enabled?: boolean;
  displayName?: string;
}

/**
 * Disconnection result
 */
interface DisconnectionResult {
  requiresConfirmation?: boolean;
  activeSubscriptionCount?: number;
  message?: string;
}

/**
 * Provider Connection Service
 *
 * Manages OAuth flows and credential configuration for payment providers (Stripe and PayPal).
 * Handles state token management, credential storage, and webhook registration.
 */
export class ProviderConnectionService {
  private eventBus: EventEmitter;
  private oauthStateManager: OAuthStateManager;
  private webhookManager: WebhookManager;
  private subscriptionService: SubscriptionService;

  constructor(eventBus: EventEmitter) {
    this.eventBus = eventBus;
    this.oauthStateManager = new OAuthStateManager();
    this.webhookManager = new WebhookManager();
    this.subscriptionService = new SubscriptionService(eventBus);
  }

  /**
   * Initiate Stripe OAuth flow
   *
   * Generates a state token and builds the OAuth authorization URL.
   *
   * @param adminUser - Admin user initiating the connection
   * @returns OAuth URL and state token
   */
  async initiateStripeOAuth(adminUser: AdminUser): Promise<OAuthInitiationResult> {
    // Generate CSRF protection state token
    const state = await this.oauthStateManager.generateToken('stripe');

    // Get Stripe adapter to build OAuth URL
    const adapter = this.getAdapter('stripe', {});

    // Build redirect URI (callback endpoint)
    const redirectUri = this.buildRedirectUri('stripe');

    // Build OAuth authorization URL
    const oauthUrl = await adapter.buildOAuthUrl(state, redirectUri);

    return {
      oauthUrl,
      state,
    };
  }

  /**
   * Handle Stripe OAuth callback
   *
   * Validates state token, exchanges authorization code for credentials,
   * registers webhook, and stores encrypted credentials.
   *
   * @param code - Authorization code from Stripe
   * @param state - State token for CSRF protection
   * @returns True if callback handled successfully, false otherwise
   */
  async handleStripeCallback(code: string, state: string): Promise<boolean> {
    // Validate state token
    const isValidState = await this.oauthStateManager.validateToken(state, 'stripe');
    if (!isValidState) {
      return false;
    }

    // Get Stripe adapter
    const adapter = this.getAdapter('stripe', {});

    // Exchange authorization code for credentials
    const credentials = await adapter.exchangeCodeForCredentials(code);

    // Generate webhook URL
    const webhookUrl = this.webhookManager.generateWebhookUrl('stripe');

    // Register webhook with provider
    let webhookId: string | undefined;
    let webhookSecret: string | undefined;

    try {
      const webhookRegistration = await adapter.registerWebhook(webhookUrl, credentials);
      webhookId = webhookRegistration.webhookId;
      webhookSecret = webhookRegistration.webhookSecret;
    }
    catch (error) {
      // Log warning but don't block connection
      console.warn('Failed to register Stripe webhook:', error);
    }

    // Store credentials with webhook info
    const credentialsWithWebhook = {
      ...credentials,
      webhook_id: webhookId,
      webhook_secret: webhookSecret,
    };

    // Check if provider config already exists
    let entity = await ProviderConfigEntity.findOne({
      where: { provider_type: 'stripe' },
    });

    if (entity) {
      // Update existing configuration
      entity._decryptedCredentials = JSON.stringify(credentialsWithWebhook);
      if (webhookSecret) {
        entity._decryptedWebhookSecret = webhookSecret;
      }
      await entity.save();
    }
    else {
      // Create new configuration
      entity = await ProviderConfigEntity.create({
        id: uuidv4(),
        provider_type: 'stripe',
        enabled: false, // Admin must explicitly enable
        display_name: 'Stripe',
        credentials: JSON.stringify(credentialsWithWebhook),
        webhook_secret: webhookSecret || '',
      } as any);

      // Set decrypted values for encryption hook
      entity._decryptedCredentials = JSON.stringify(credentialsWithWebhook);
      if (webhookSecret) {
        entity._decryptedWebhookSecret = webhookSecret;
      }
    }

    // Emit event
    this.eventBus.emit('provider:connected', {
      providerType: 'stripe',
      providerId: entity.id,
    });

    return true;
  }

  /**
   * Configure PayPal credentials manually
   *
   * Validates, encrypts, and stores PayPal credentials with automatic webhook registration.
   *
   * @param credentials - PayPal credentials (client_id, client_secret, environment)
   * @param adminUser - Admin user performing the configuration
   * @returns True if configuration successful
   */
  async configurePayPal(credentials: ProviderCredentials, adminUser: AdminUser): Promise<boolean> {
    // Get PayPal adapter for validation
    const adapter = this.getAdapter('paypal', credentials);

    // Validate credentials format
    const isValid = await adapter.validateCredentials(credentials);
    if (!isValid) {
      throw new Error('Invalid PayPal credentials');
    }

    // Generate webhook URL
    const webhookUrl = this.webhookManager.generateWebhookUrl('paypal');

    // Register webhook with provider
    let webhookId: string | undefined;
    let webhookSecret: string | undefined;

    try {
      const webhookRegistration = await adapter.registerWebhook(webhookUrl, credentials);
      webhookId = webhookRegistration.webhookId;
      webhookSecret = webhookRegistration.webhookSecret;
    }
    catch (error) {
      // Log warning but don't block configuration
      console.warn('Failed to register PayPal webhook:', error);
    }

    // Store credentials with webhook info
    const credentialsWithWebhook = {
      ...credentials,
      webhook_id: webhookId,
      webhook_secret: webhookSecret,
    };

    // Check if provider config already exists
    let entity = await ProviderConfigEntity.findOne({
      where: { provider_type: 'paypal' },
    });

    if (entity) {
      // Update existing configuration
      entity._decryptedCredentials = JSON.stringify(credentialsWithWebhook);
      if (webhookSecret) {
        entity._decryptedWebhookSecret = webhookSecret;
      }
      await entity.save();
    }
    else {
      // Create new configuration
      entity = await ProviderConfigEntity.create({
        id: uuidv4(),
        provider_type: 'paypal',
        enabled: false, // Admin must explicitly enable
        display_name: 'PayPal',
        credentials: JSON.stringify(credentialsWithWebhook),
        webhook_secret: webhookSecret || '',
      } as any);

      // Set decrypted values for encryption hook
      entity._decryptedCredentials = JSON.stringify(credentialsWithWebhook);
      if (webhookSecret) {
        entity._decryptedWebhookSecret = webhookSecret;
      }
    }

    // Emit event
    this.eventBus.emit('provider:configured', {
      providerType: 'paypal',
      providerId: entity.id,
    });

    return true;
  }

  /**
   * Get provider connection status
   *
   * Checks if provider has credentials configured.
   *
   * @param providerType - Type of provider (stripe or paypal)
   * @returns Provider status information
   */
  async getProviderStatus(providerType: ProviderType): Promise<ProviderStatus> {
    const entity = await ProviderConfigEntity.findOne({
      where: { provider_type: providerType },
    });

    if (!entity) {
      return { configured: false };
    }

    // Check if credentials exist and have required fields
    const config = entity.toModel();
    let hasRequiredFields = false;

    try {
      const credentials = JSON.parse(config.credentials);

      if (providerType === 'stripe') {
        hasRequiredFields = !!credentials.stripe_user_id;
      }
      else if (providerType === 'paypal') {
        hasRequiredFields = !!credentials.client_id && !!credentials.client_secret;
      }
    }
    catch (e) {
      hasRequiredFields = false;
    }

    return {
      configured: hasRequiredFields,
      providerType,
      enabled: config.enabled,
      displayName: config.displayName,
    };
  }

  /**
   * Disconnect a payment provider
   *
   * Checks for active subscriptions and requires confirmation before proceeding.
   * If confirmed, cancels all active subscriptions, deletes webhook, and removes credentials.
   *
   * @param providerType - Type of provider to disconnect
   * @param confirmed - Whether admin has confirmed the disconnection
   * @returns Disconnection result with confirmation requirement if needed
   */
  async disconnectProvider(
    providerType: ProviderType,
    confirmed: boolean = false,
  ): Promise<DisconnectionResult> {
    // Find provider configuration
    const entity = await ProviderConfigEntity.findOne({
      where: { provider_type: providerType },
    });

    if (!entity) {
      throw new Error('Provider not found');
    }

    // Count active subscriptions
    const activeCount = await SubscriptionEntity.count({
      where: {
        provider_config_id: entity.id,
        status: {
          [Op.in]: ['active', 'past_due'],
        },
      },
    });

    // If active subscriptions exist and not confirmed, return warning
    if (activeCount > 0 && !confirmed) {
      return {
        requiresConfirmation: true,
        activeSubscriptionCount: activeCount,
        message: `This provider has ${activeCount} active subscription(s). Disconnecting will cancel all active subscriptions.`,
      };
    }

    // If confirmed, proceed with disconnection
    if (activeCount > 0 && confirmed) {
      // Force-cancel all active subscriptions
      const activeSubscriptions = await SubscriptionEntity.findAll({
        where: {
          provider_config_id: entity.id,
          status: {
            [Op.in]: ['active', 'past_due'],
          },
        },
      });

      for (const subscription of activeSubscriptions) {
        await this.subscriptionService.forceCancel(subscription.id);
      }
    }

    // Delete webhook at provider
    try {
      const config = entity.toModel();
      const credentials = JSON.parse(config.credentials);
      const webhookId = credentials.webhook_id;

      if (webhookId) {
        const adapter = this.getAdapter(providerType, credentials);
        await adapter.deleteWebhook(webhookId, credentials);
      }
    }
    catch (error) {
      // Log warning but proceed with disconnection
      console.warn('Failed to delete webhook:', error);
    }

    // Delete provider configuration
    await entity.destroy();

    // Emit event
    this.eventBus.emit('provider:disconnected', {
      providerType,
      providerId: entity.id,
    });

    return {};
  }

  /**
   * Get count of active subscriptions for a provider
   *
   * @param providerType - Type of provider
   * @returns Count of active subscriptions
   */
  async getActiveSubscriptionCount(providerType: ProviderType): Promise<number> {
    const entity = await ProviderConfigEntity.findOne({
      where: { provider_type: providerType },
    });

    if (!entity) {
      return 0;
    }

    return SubscriptionEntity.count({
      where: {
        provider_config_id: entity.id,
        status: {
          [Op.in]: ['active', 'past_due'],
        },
      },
    });
  }

  /**
   * Get adapter for provider type
   *
   * @param providerType - Type of provider
   * @param credentials - Provider credentials
   * @returns Provider adapter instance
   * @private
   */
  private getAdapter(providerType: ProviderType, credentials: ProviderCredentials): PaymentProviderAdapter {
    // For OAuth initiation, we use empty credentials and the adapter will use platform config
    const dummyConfig = {
      id: 'dummy',
      providerType,
      enabled: false,
      displayName: providerType === 'stripe' ? 'Stripe' : 'PayPal',
      credentials: JSON.stringify(credentials),
      webhookSecret: '',
    };

    return ProviderFactory.getAdapter(dummyConfig);
  }

  /**
   * Build OAuth callback redirect URI
   *
   * @param providerType - Type of provider
   * @returns Redirect URI for OAuth callback
   * @private
   */
  private buildRedirectUri(providerType: ProviderType): string {
    // Use webhook manager to get base domain
    const webhookUrl = this.webhookManager.generateWebhookUrl(providerType);
    const baseDomain = webhookUrl.split('/api/subscription')[0];

    return `${baseDomain}/api/subscription/v1/admin/providers/${providerType}/callback`;
  }
}
