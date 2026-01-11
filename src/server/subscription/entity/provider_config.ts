import { Model, Table, Column, PrimaryKey, DataType, BeforeCreate, BeforeUpdate } from 'sequelize-typescript';
import { ProviderConfig, ProviderType } from '@/common/model/subscription';
import db from '@/server/common/entity/db';
import crypto from 'crypto';
import config from 'config';

// Get encryption key from config or generate a default (for development)
const ENCRYPTION_KEY = config.has('subscription.encryptionKey')
  ? config.get<string>('subscription.encryptionKey')
  : '0123456789abcdef0123456789abcdef'; // 32 bytes for AES-256

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

/**
 * Encrypt sensitive data
 */
function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt sensitive data
 */
function decrypt(text: string): string {
  const parts = text.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encryptedText = parts[1];
  const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
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
 * Stripe (via OAuth):
 * {
 *   stripe_user_id: string,    // The connected account ID (REQUIRED)
 *   scope: string,              // OAuth scope granted (read_write or read_only)
 *   livemode: boolean,          // Whether account is in live mode
 *   webhook_id: string,         // Webhook endpoint ID for deletion
 *   webhook_secret: string      // Webhook signing secret (moved from webhook_secret field)
 * }
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

  // Private fields to store decrypted values temporarily
  private _decryptedCredentials?: string;
  private _decryptedWebhookSecret?: string;

  /**
   * Convert entity to domain model
   */
  toModel(): ProviderConfig {
    const config = new ProviderConfig(this.id, this.provider_type);
    config.enabled = this.enabled;
    config.displayName = this.display_name;

    // Decrypt credentials when converting to model (only if not empty)
    config.credentials = this._decryptedCredentials ?? (this.credentials ? decrypt(this.credentials) : '');
    config.webhookSecret = this._decryptedWebhookSecret ?? (this.webhook_secret ? decrypt(this.webhook_secret) : '');

    return config;
  }

  /**
   * Convert domain model to entity
   */
  static fromModel(config: ProviderConfig): ProviderConfigEntity {
    const entity = ProviderConfigEntity.build({
      id: config.id,
      provider_type: config.providerType,
      enabled: config.enabled,
      display_name: config.displayName,
      credentials: config.credentials, // Will be encrypted in BeforeCreate/BeforeUpdate
      webhook_secret: config.webhookSecret, // Will be encrypted in BeforeCreate/BeforeUpdate
    });

    // Store unencrypted values temporarily so they can be encrypted in hooks
    entity._decryptedCredentials = config.credentials;
    entity._decryptedWebhookSecret = config.webhookSecret;

    return entity;
  }

  /**
   * Encrypt credentials before creating
   */
  @BeforeCreate
  static encryptFieldsOnCreate(instance: ProviderConfigEntity) {
    if (instance._decryptedCredentials) {
      instance.credentials = encrypt(instance._decryptedCredentials);
    }
    if (instance._decryptedWebhookSecret) {
      instance.webhook_secret = encrypt(instance._decryptedWebhookSecret);
    }
  }

  /**
   * Encrypt credentials before updating
   */
  @BeforeUpdate
  static encryptFieldsOnUpdate(instance: ProviderConfigEntity) {
    if (instance.changed('credentials') && instance._decryptedCredentials) {
      instance.credentials = encrypt(instance._decryptedCredentials);
    }
    if (instance.changed('webhook_secret') && instance._decryptedWebhookSecret) {
      instance.webhook_secret = encrypt(instance._decryptedWebhookSecret);
    }
  }
}

db.addModels([ProviderConfigEntity]);

export { ProviderConfigEntity };
