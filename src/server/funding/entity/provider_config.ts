import { Model, Table, Column, PrimaryKey, DataType, BeforeCreate, BeforeUpdate } from 'sequelize-typescript';
import { ProviderConfig, ProviderType } from '@/common/model/funding-plan';
import db from '@/server/common/entity/db';
import crypto from 'crypto';
import config from 'config';

// Get encryption key from config - required; no fallback allowed
if (!config.has('funding.encryptionKey')) {
  throw new Error(
    'Missing required configuration: funding.encryptionKey. ' +
    'Set the ENCRYPTION_KEY environment variable or add funding.encryptionKey to your config.',
  );
}

const ENCRYPTION_KEY_HEX = config.get<string>('funding.encryptionKey');
const ENCRYPTION_KEY = Buffer.from(ENCRYPTION_KEY_HEX, 'hex');

if (ENCRYPTION_KEY.length !== 32) {
  throw new Error(
    `Invalid encryption key: expected 32 bytes (64 hex chars), got ${ENCRYPTION_KEY.length} bytes. ` +
    'Generate with: openssl rand -hex 32',
  );
}

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

/**
 * Encrypt sensitive data
 */
function encrypt(text: string): string {
  // TODO: REMOVE DEBUG LOGGING - Stripe credential save debugging
  console.log('[DEBUG][ENTITY] encrypt() called, input length:', text?.length);
  const iv = crypto.randomBytes(IV_LENGTH);
  // TODO: REMOVE DEBUG LOGGING - Stripe credential save debugging
  console.log('[DEBUG][ENTITY] encryption key buffer length:', ENCRYPTION_KEY.length, '(must be 32 for aes-256-cbc)');
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const result = iv.toString('hex') + ':' + encrypted;
  // TODO: REMOVE DEBUG LOGGING - Stripe credential save debugging
  console.log('[DEBUG][ENTITY] encrypt() succeeded, output length:', result.length);
  return result;
}

/**
 * Decrypt sensitive data
 */
function decrypt(text: string): string {
  const parts = text.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encryptedText = parts[1];
  const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Provider Configuration Entity
 *
 * Stores payment provider credentials and configuration with encryption.
 *
 * Credentials JSON Structure:
 *
 * Stripe (direct API keys - Embedded Checkout):
 * {
 *   apiKey: string,             // Stripe secret key (sk_test_ or sk_live_)
 *   publishableKey: string      // Stripe publishable key (pk_test_ or pk_live_)
 * }
 * The webhook signing secret (whsec_) is stored in the webhook_secret column.
 *
 * PayPal (manual configuration):
 * {
 *   client_id: string,          // PayPal app client ID
 *   client_secret: string,      // PayPal app client secret
 *   environment: string,        // 'sandbox' or 'production'
 *   webhook_id: string,         // Webhook endpoint ID for deletion
 *   webhook_secret: string      // Webhook verification token
 * }
 *
 * All credential values are stored encrypted using AES-256-CBC.
 */
@Table({ tableName: 'provider_config' })
class ProviderConfigEntity extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID })
  declare id: string;

  @Column({
    type: DataType.ENUM('stripe', 'paypal'),
  })
  declare provider_type: ProviderType;

  @Column({ type: DataType.BOOLEAN, defaultValue: false })
  declare enabled: boolean;

  @Column({ type: DataType.STRING })
  declare display_name: string;

  @Column({ type: DataType.TEXT })
  declare credentials: string; // Encrypted JSON (see structure documentation above)

  @Column({ type: DataType.TEXT })
  declare webhook_secret: string; // Encrypted (deprecated - now stored in credentials JSON)

  // Fields to store plaintext values temporarily for encryption hooks
  _decryptedCredentials?: string;
  _decryptedWebhookSecret?: string;

  /**
   * Convert entity to domain model (credentials remain encrypted/excluded)
   */
  toModel(): ProviderConfig {
    const config = new ProviderConfig(this.id, this.provider_type);
    config.enabled = this.enabled;
    config.displayName = this.display_name;
    return config;
  }

  /**
   * Decrypt and return the credentials JSON string.
   * Call only where decrypted credentials are actually needed.
   */
  decryptCredentials(): string {
    return this._decryptedCredentials ?? (this.credentials ? decrypt(this.credentials) : '');
  }

  /**
   * Decrypt and return the webhook secret.
   * Call only where the webhook secret is actually needed.
   */
  decryptWebhookSecret(): string {
    return this._decryptedWebhookSecret ?? (this.webhook_secret ? decrypt(this.webhook_secret) : '');
  }

  /**
   * Convert domain model to entity
   */
  static fromModel(config: ProviderConfig): ProviderConfigEntity {
    return ProviderConfigEntity.build({
      id: config.id,
      provider_type: config.providerType,
      enabled: config.enabled,
      display_name: config.displayName,
    });
  }

  /**
   * Encrypt credentials before creating
   */
  @BeforeCreate
  static encryptFieldsOnCreate(instance: ProviderConfigEntity) {
    // TODO: REMOVE DEBUG LOGGING - Stripe credential save debugging
    console.log('[DEBUG][ENTITY] BeforeCreate hook fired');
    console.log('[DEBUG][ENTITY] BeforeCreate: _decryptedCredentials present?', !!instance._decryptedCredentials);
    console.log('[DEBUG][ENTITY] BeforeCreate: _decryptedWebhookSecret present?', !!instance._decryptedWebhookSecret);

    if (instance._decryptedCredentials) {
      instance.credentials = encrypt(instance._decryptedCredentials);
      // TODO: REMOVE DEBUG LOGGING - Stripe credential save debugging
      console.log('[DEBUG][ENTITY] BeforeCreate: credentials encrypted successfully');
    }
    if (instance._decryptedWebhookSecret) {
      instance.webhook_secret = encrypt(instance._decryptedWebhookSecret);
      // TODO: REMOVE DEBUG LOGGING - Stripe credential save debugging
      console.log('[DEBUG][ENTITY] BeforeCreate: webhook_secret encrypted successfully');
    }
  }

  /**
   * Encrypt credentials before updating
   */
  @BeforeUpdate
  static encryptFieldsOnUpdate(instance: ProviderConfigEntity) {
    // TODO: REMOVE DEBUG LOGGING - Stripe credential save debugging
    console.log('[DEBUG][ENTITY] BeforeUpdate hook fired');
    console.log('[DEBUG][ENTITY] BeforeUpdate: _decryptedCredentials present?', !!instance._decryptedCredentials);
    console.log('[DEBUG][ENTITY] BeforeUpdate: _decryptedWebhookSecret present?', !!instance._decryptedWebhookSecret);

    if (instance._decryptedCredentials && instance._decryptedCredentials.length > 1) {
      instance.credentials = encrypt(instance._decryptedCredentials);
      // TODO: REMOVE DEBUG LOGGING - Stripe credential save debugging
      console.log('[DEBUG][ENTITY] BeforeUpdate: credentials encrypted successfully');
    }
    if (instance._decryptedWebhookSecret && instance._decryptedWebhookSecret.length > 1) {
      instance.webhook_secret = encrypt(instance._decryptedWebhookSecret);
      // TODO: REMOVE DEBUG LOGGING - Stripe credential save debugging
      console.log('[DEBUG][ENTITY] BeforeUpdate: webhook_secret encrypted successfully');
    }
  }
}

db.addModels([ProviderConfigEntity]);

export { ProviderConfigEntity };
