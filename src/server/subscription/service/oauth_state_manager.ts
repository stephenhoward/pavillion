import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { Op } from 'sequelize';
import { OAuthStateTokenEntity } from '@/server/subscription/entity/oauth_state_token';
import { ProviderType } from '@/common/model/subscription';

/**
 * OAuth State Token Manager
 *
 * Manages state tokens for OAuth CSRF protection with:
 * - Cryptographically secure token generation
 * - 15-minute expiration window
 * - Single-use enforcement
 * - Automatic cleanup of expired tokens
 */
export class OAuthStateManager {
  private readonly TOKEN_EXPIRATION_MINUTES = 15;

  /**
   * Generate a new cryptographically secure state token
   *
   * @param providerType - The provider type (stripe or paypal)
   * @returns The generated token string (64-character hex)
   */
  async generateToken(providerType: ProviderType): Promise<string> {
    // Generate cryptographically secure random token (32 bytes)
    const token = crypto.randomBytes(32).toString('hex');

    // Calculate expiration time (15 minutes from now)
    const expiresAt = new Date(Date.now() + this.TOKEN_EXPIRATION_MINUTES * 60 * 1000);

    // Store token in database
    await OAuthStateTokenEntity.create({
      id: uuidv4(),
      token,
      provider_type: providerType,
      expires_at: expiresAt,
    });

    return token;
  }

  /**
   * Validate a state token and delete it (single use)
   *
   * @param token - The token string to validate
   * @param providerType - The expected provider type
   * @returns True if token is valid, false otherwise
   */
  async validateToken(token: string, providerType: ProviderType): Promise<boolean> {
    // Find token in database
    const entity = await OAuthStateTokenEntity.findOne({
      where: {
        token,
        provider_type: providerType,
      },
    });

    // Token not found
    if (!entity) {
      return false;
    }

    // Check if token is expired
    if (entity.isExpired()) {
      // Delete expired token
      await entity.destroy();
      return false;
    }

    // Token is valid - delete it (single use enforcement)
    await entity.destroy();

    return true;
  }

  /**
   * Clean up expired tokens from database
   *
   * @returns Number of tokens deleted
   */
  async cleanupExpired(): Promise<number> {
    const now = new Date();

    // Delete all tokens where expiration date is in the past
    const result = await OAuthStateTokenEntity.destroy({
      where: {
        expires_at: {
          [Op.lt]: now,
        },
      },
    });

    return result;
  }
}
