import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { Op } from 'sequelize';
import { ProviderType } from '@/common/model/funding-plan';
import { ProviderConfigEntity } from '@/server/funding/entity/provider_config';
import { FundingPlanEntity } from '@/server/funding/entity/funding_plan';
import { ProviderFactory } from '@/server/funding/service/provider/factory';
import { PaymentProviderAdapter, ProviderCredentials } from '@/server/funding/service/provider/adapter';
import { StripeAdapter } from '@/server/funding/service/provider/stripe';
import FundingService from '@/server/funding/service/funding';
import {
  InvalidProviderTypeError,
  InvalidEnvironmentError,
  MissingRequiredFieldError,
  InvalidCredentialsError,
} from '@/common/exceptions/funding';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('funding');

/**
 * User object for admin operations
 */
interface AdminUser {
  id: string;
  email: string;
}

/**
 * Stripe credential inputs for configuration
 */
interface StripeCredentialInputs {
  publishable_key: string;
  secret_key: string;
  webhook_secret: string;
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
  activeFundingPlanCount?: number;
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
  private fundingService: FundingService;

  constructor(eventBus: EventEmitter) {
    this.eventBus = eventBus;
    this.fundingService = new FundingService(eventBus);
  }

  /**
   * Configure Stripe credentials via direct API key entry
   *
   * Validates key formats, encrypts, and stores Stripe credentials.
   * Hard-fails if encryption key is unavailable (no plaintext fallback).
   *
   * @param credentials - Stripe credentials (publishable_key, secret_key, webhook_secret)
   * @param adminUser - Admin user performing the configuration
   * @returns True if configuration successful
   */
  async configureStripe(credentials: StripeCredentialInputs, adminUser: AdminUser): Promise<boolean> {
    // Validate required fields
    if (!credentials.publishable_key || credentials.publishable_key.trim() === '') {
      throw new MissingRequiredFieldError('publishable_key');
    }

    if (!credentials.secret_key || credentials.secret_key.trim() === '') {
      throw new MissingRequiredFieldError('secret_key');
    }

    if (!credentials.webhook_secret || credentials.webhook_secret.trim() === '') {
      throw new MissingRequiredFieldError('webhook_secret');
    }

    // Validate key formats (prefix check only, no test API call)
    const formatCheck = StripeAdapter.validateKeyFormats(
      credentials.publishable_key,
      credentials.secret_key,
      credentials.webhook_secret,
    );

    if (!formatCheck.valid) {
      throw new InvalidCredentialsError(formatCheck.error);
    }

    // Build credentials object for storage
    // Store apiKey as secret_key for adapter compatibility
    const storedCredentials = {
      apiKey: credentials.secret_key,
      publishableKey: credentials.publishable_key,
    };

    // Check if provider config already exists
    let entity = await ProviderConfigEntity.findOne({
      where: { provider_type: 'stripe' },
    });

    if (entity) {
      // Update existing configuration
      entity._decryptedCredentials = JSON.stringify(storedCredentials);
      entity._decryptedWebhookSecret = credentials.webhook_secret;
      await entity.save();
    }
    else {
      // Create new configuration
      entity = await ProviderConfigEntity.create({
        id: uuidv4(),
        provider_type: 'stripe',
        enabled: false, // Admin must explicitly enable
        display_name: 'Stripe',
        credentials: JSON.stringify(storedCredentials),
        webhook_secret: credentials.webhook_secret,
      } as any);

      // Set decrypted values for encryption hook
      entity._decryptedCredentials = JSON.stringify(storedCredentials);
      entity._decryptedWebhookSecret = credentials.webhook_secret;
    }

    // Clear cached adapter so new credentials are picked up
    ProviderFactory.clearCache(entity.id);

    // Emit event
    this.eventBus.emit('provider:configured', {
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

    // Store credentials
    const credentialsToStore = {
      ...credentials,
    };

    // Check if provider config already exists
    let entity = await ProviderConfigEntity.findOne({
      where: { provider_type: 'paypal' },
    });

    if (entity) {
      // Update existing configuration
      entity._decryptedCredentials = JSON.stringify(credentialsToStore);
      await entity.save();
    }
    else {
      // Create new configuration
      entity = await ProviderConfigEntity.create({
        id: uuidv4(),
        provider_type: 'paypal',
        enabled: false, // Admin must explicitly enable
        display_name: 'PayPal',
        credentials: JSON.stringify(credentialsToStore),
        webhook_secret: '',
      } as any);

      // Set decrypted values for encryption hook
      entity._decryptedCredentials = JSON.stringify(credentialsToStore);
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
   * Checks for active funding plans and requires confirmation before proceeding.
   * If confirmed, cancels all active funding plans, deletes webhook, and removes credentials.
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

    // Count active funding plans
    const activeCount = await FundingPlanEntity.count({
      where: {
        provider_config_id: entity.id,
        status: {
          [Op.in]: ['active', 'past_due'],
        },
      },
    });

    // If active funding plans exist and not confirmed, return warning
    if (activeCount > 0 && !confirmed) {
      return {
        requiresConfirmation: true,
        activeFundingPlanCount: activeCount,
        message: `This provider has ${activeCount} active funding plan(s). Disconnecting will cancel all active funding plans.`,
      };
    }

    // If confirmed, proceed with disconnection
    if (activeCount > 0 && confirmed) {
      // Force-cancel all active funding plans
      const activeFundingPlans = await FundingPlanEntity.findAll({
        where: {
          provider_config_id: entity.id,
          status: {
            [Op.in]: ['active', 'past_due'],
          },
        },
      });

      for (const plan of activeFundingPlans) {
        await this.fundingService.forceCancel(plan.id);
      }
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
   * Get count of active funding plans for a provider
   *
   * @param providerType - Type of provider
   * @returns Count of active funding plans
   */
  async getActiveFundingPlanCount(providerType: ProviderType): Promise<number> {
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
