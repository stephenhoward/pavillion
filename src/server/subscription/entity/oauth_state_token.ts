import { Model, Table, Column, PrimaryKey, DataType, Index } from 'sequelize-typescript';
import { ProviderType } from '@/common/model/subscription';
import db from '@/server/common/entity/db';

/**
 * OAuth State Token Entity
 *
 * Stores temporary state tokens for OAuth CSRF protection.
 * Tokens expire after 15 minutes and are deleted after single use.
 */
@Table({ tableName: 'oauth_state_tokens' })
class OAuthStateTokenEntity extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID })
  declare id: string;

  @Index({ unique: true })
  @Column({ type: DataType.STRING })
  declare token: string; // 64-character hex string (32 bytes)

  @Column({
    type: DataType.ENUM('stripe', 'paypal'),
  })
  declare provider_type: ProviderType;

  @Index
  @Column({ type: DataType.DATE })
  declare expires_at: Date;

  /**
   * Check if token is expired
   */
  isExpired(): boolean {
    return this.expires_at < new Date();
  }

  /**
   * Convert entity to plain object
   */
  toObject(): {
    id: string;
    token: string;
    providerType: ProviderType;
    expiresAt: Date;
    isExpired: boolean;
  } {
    return {
      id: this.id,
      token: this.token,
      providerType: this.provider_type,
      expiresAt: this.expires_at,
      isExpired: this.isExpired(),
    };
  }

  /**
   * Create token entity
   */
  static fromToken(
    id: string,
    token: string,
    providerType: ProviderType,
    expiresAt: Date
  ): OAuthStateTokenEntity {
    return OAuthStateTokenEntity.build({
      id,
      token,
      provider_type: providerType,
      expires_at: expiresAt,
    });
  }
}

db.addModels([OAuthStateTokenEntity]);

export { OAuthStateTokenEntity };
