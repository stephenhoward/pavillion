import { Model, Table, Column, PrimaryKey, DataType, BeforeCreate, BeforeUpdate } from 'sequelize-typescript';
import { ProviderType } from '@/common/model/subscription';
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
 * Encrypt sensitive data using AES-256-CBC
 * Format: {iv_hex}:{encrypted_hex}
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
 * Platform OAuth Configuration Entity
 *
 * Stores platform-level OAuth app credentials (e.g., Stripe Connect client ID/secret)
 * for connecting payment providers via OAuth flows.
 *
 * Credentials are encrypted at rest using AES-256-CBC following the same pattern
 * as ProviderConfigEntity.
 */
@Table({ tableName: 'platform_oauth_config' })
class PlatformOAuthConfigEntity extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID })
  declare id: string;

  @Column({
    type: DataType.ENUM('stripe', 'paypal'),
  })
  declare provider_type: ProviderType;

  @Column({ type: DataType.STRING })
  declare client_id: string; // Encrypted

  @Column({ type: DataType.TEXT })
  declare client_secret: string; // Encrypted

  // Private fields to store decrypted values temporarily
  private _decryptedClientId?: string;
  private _decryptedClientSecret?: string;

  /**
   * Get decrypted credentials for OAuth flow
   * Returns the actual client ID and secret
   */
  getDecryptedCredentials(): { clientId: string; clientSecret: string } {
    return {
      clientId: this._decryptedClientId ?? decrypt(this.client_id),
      clientSecret: this._decryptedClientSecret ?? decrypt(this.client_secret),
    };
  }

  /**
   * Convert entity to plain object (sanitized - no secrets)
   * Used for API responses where credentials should not be exposed
   */
  toObject(): {
    id: string;
    providerType: ProviderType;
    configured: boolean;
  } {
    return {
      id: this.id,
      providerType: this.provider_type,
      configured: true, // If entity exists, it's configured
    };
  }

  /**
   * Create entity from credentials
   */
  static fromCredentials(
    id: string,
    providerType: ProviderType,
    clientId: string,
    clientSecret: string,
  ): PlatformOAuthConfigEntity {
    const entity = PlatformOAuthConfigEntity.build({
      id,
      provider_type: providerType,
      client_id: clientId, // Will be encrypted in BeforeCreate hook
      client_secret: clientSecret, // Will be encrypted in BeforeCreate hook
    });

    // Store unencrypted values temporarily so they can be encrypted in hooks
    entity._decryptedClientId = clientId;
    entity._decryptedClientSecret = clientSecret;

    return entity;
  }

  /**
   * Encrypt credentials before creating
   */
  @BeforeCreate
  static encryptFieldsOnCreate(instance: PlatformOAuthConfigEntity) {
    if (instance._decryptedClientId) {
      instance.client_id = encrypt(instance._decryptedClientId);
    }
    if (instance._decryptedClientSecret) {
      instance.client_secret = encrypt(instance._decryptedClientSecret);
    }
  }

  /**
   * Encrypt credentials before updating
   */
  @BeforeUpdate
  static encryptFieldsOnUpdate(instance: PlatformOAuthConfigEntity) {
    if (instance.changed('client_id') && instance._decryptedClientId) {
      instance.client_id = encrypt(instance._decryptedClientId);
    }
    if (instance.changed('client_secret') && instance._decryptedClientSecret) {
      instance.client_secret = encrypt(instance._decryptedClientSecret);
    }
  }
}

db.addModels([PlatformOAuthConfigEntity]);

export { PlatformOAuthConfigEntity };
