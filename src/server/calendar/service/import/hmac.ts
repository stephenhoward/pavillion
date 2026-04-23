import crypto from 'crypto';
import config from 'config';

/**
 * HMAC helpers for ICS import DNS verification tokens.
 *
 * These helpers derive per-source verification tokens using HMAC-SHA256
 * keyed by the instance-wide `calendar.import.hmacSecret`. The derived
 * token is what is stored on ImportSourceEntity.verification_token and
 * what administrators publish in a DNS TXT record to prove ownership of
 * the source URL's domain.
 *
 * Security notes:
 * - The raw HMAC secret MUST never be logged or returned over the wire.
 * - In production, an empty or development-default secret is rejected at
 *   startup by validateProductionSecrets() in
 *   @/server/common/helper/production-validation.
 * - Derived tokens are deterministic per (secret, sourceId, calendarId);
 *   this is required so the DNS verifier can re-derive and compare.
 *
 * @see security-playbook — configuration
 * @see privacy-playbook — no secrets in logs
 */

/**
 * Returns the configured HMAC secret for import DNS verification.
 *
 * @throws Error if called in production with an empty or development-default secret
 */
export function getImportHmacSecret(): string {
  const secret = config.has('calendar.import.hmacSecret')
    ? config.get<string>('calendar.import.hmacSecret')
    : '';

  if (process.env.NODE_ENV === 'production') {
    if (!secret || secret.includes('development-only')) {
      throw new Error(
        'CALENDAR_IMPORT_HMAC_SECRET must be set in production.',
      );
    }
  }

  return secret;
}

/**
 * Derives a deterministic verification token for an import source.
 *
 * The token is an HMAC-SHA256 of `sourceId + calendarId` keyed by the
 * configured HMAC secret, encoded as base64url (no padding). This is the
 * value that must appear in a `pavillion-verify=v1:{host}:{token}` TXT
 * record for DNS ownership verification to succeed.
 *
 * @param sourceId - UUID of the import source
 * @param calendarId - UUID of the calendar owning the source
 * @returns base64url-encoded HMAC-SHA256 digest
 */
export function generateVerificationToken(sourceId: string, calendarId: string): string {
  const secret = getImportHmacSecret();
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(sourceId);
  hmac.update(calendarId);
  return hmac.digest('base64url');
}

/**
 * Returns the full verification record value that must appear in a TXT
 * record, including the fixed `pavillion-verify=v1:` prefix and the
 * instance host from the `domain` config key.
 *
 * Format: `pavillion-verify=v1:{instance-host}:{base64url-token}`
 */
export function formatVerificationRecord(sourceId: string, calendarId: string): string {
  const host = config.get<string>('domain');
  const token = generateVerificationToken(sourceId, calendarId);
  return `pavillion-verify=v1:${host}:${token}`;
}
