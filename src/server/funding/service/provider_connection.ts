import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { Op } from 'sequelize';
import { ProviderType } from '@/common/model/funding-plan';
import { ProviderConfigEntity } from '@/server/funding/entity/provider_config';
import { FundingPlanEntity } from '@/server/funding/entity/funding_plan';
import { WebhookManager } from '@/server/funding/service/provider/webhook_manager';
import { ProviderFactory } from '@/server/funding/service/provider/factory';
import { PaymentProviderAdapter, ProviderCredentials } from '@/server/funding/service/provider/adapter';
import FundingService from '@/server/funding/service/funding';
import {
  InvalidProviderTypeError,
  InvalidEnvironmentError,
  MissingRequiredFieldError,
  InvalidCredentialsError,
} from '@/server/funding/exceptions';

/**
 * User object for admin operations
 */
interface AdminUser {
  id: string;
  email: string;
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
 * Manages credential configuration for payment providers (Stripe and PayPal).
 * Handles credential storage, webhook registration, and provider disconnection.
 */
export class ProviderConnectionService {
  private eventBus: EventEmitter;
  private webhookManager: WebhookManager;
  private subscriptionService: FundingService;

  constructor(eventBus: EventEmitter) {
    this.eventBus = eventBus;
    this.webhookManager = new WebhookManager();
    this.subscriptionService = new FundingService(eventBus);
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
    // Validate required fields (check for both undefined and empty string)
    if (!credentials.client_id || credentials.client_id.trim() === '') {
      throw new MissingRequiredFieldError('client_id');
    }

    if (!credentials.client_secret || credentials.client_secret.trim() === '') {
      throw new MissingRequiredFieldError('client_secret');
    }

    if (!credentials.environment || credentials.environment.trim() === '') {
      throw new MissingRequiredFieldError('environment');
    }

    // Validate environment value
    if (credentials.environment !== 'sandbox' && credentials.environment !== 'production') {
      throw new InvalidEnvironmentError();
    }

    // Get PayPal adapter for validation
    const adapter = this.getAdapter('paypal', credentials);

    // Validate credentials format
    const isValid = await adapter.validateCredentials(credentials);
    if (!isValid) {
      throw new InvalidCredentialsError('Invalid PayPal credentials');
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
    // Validate provider type
    if (providerType !== 'stripe' && providerType !== 'paypal') {
      throw new InvalidProviderTypeError();
    }

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
        hasRequiredFields = !!credentials.apiKey;
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
    // Validate provider type
    if (providerType !== 'stripe' && providerType !== 'paypal') {
      throw new InvalidProviderTypeError();
    }

    // Find provider configuration
    const entity = await ProviderConfigEntity.findOne({
      where: { provider_type: providerType },
    });

    if (!entity) {
      throw new Error('Provider not found');
    }

    // Count active subscriptions
    const activeCount = await FundingPlanEntity.count({
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
      const activeSubscriptions = await FundingPlanEntity.findAll({
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

    return FundingPlanEntity.count({
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
}
