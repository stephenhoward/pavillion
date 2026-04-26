import { PrimaryModel } from '@/common/model/model';

/**
 * Allowed values for the `verification_state` column on import_source.
 *
 * Lifecycle:
 * - 'unverified' — row just created; no DNS verification attempted yet.
 * - 'pending'    — DNS challenge token issued; waiting for the owner to
 *                  publish a TXT record.
 * - 'verified'   — DNS challenge observed and validated.
 * - 'expired'    — a previously-verified source has aged out of the
 *                  verification TTL and must be re-verified before use.
 */
export type ImportSourceVerificationState =
  | 'unverified'
  | 'pending'
  | 'verified'
  | 'expired';

export const IMPORT_SOURCE_VERIFICATION_STATES: readonly ImportSourceVerificationState[] =
  ['unverified', 'pending', 'verified', 'expired'];

/**
 * Allowed values for the `verification_type` column on import_source.
 *
 * This column is a **discriminator** (not a state): it answers "which trust
 * mechanism was used" for this source and remains stable for the life of
 * the row. It is orthogonal to `verification_state`, which answers
 * "is the current trust still valid" and continues to be the single
 * readiness gate used by the sync pipeline.
 *
 * - `'dns-txt'` — verified via a DNS TXT record on the source hostname.
 * - `'rel-me'`  — verified via a `rel="me"` backlink on a page hosted on
 *                 the source hostname.
 *
 * Future verifier beads extend this union (and the matching DB enum) in the
 * same change that introduces the verifier implementation.
 */
export type ImportSourceVerificationType = 'dns-txt' | 'rel-me';

export const IMPORT_SOURCE_VERIFICATION_TYPES: readonly ImportSourceVerificationType[] = [
  'dns-txt',
  'rel-me',
];

/**
 * Allowed values for the `last_status` column on import_source. Captures the
 * outcome of the most recent fetch attempt so the admin UI can render a
 * status indicator and operators can filter the run history.
 */
export type ImportSourceLastStatus =
  | 'ok'
  | 'fetch_error'
  | 'parse_error'
  | 'ssrf_blocked'
  | 'dns_error'
  | 'rate_limited';

export const IMPORT_SOURCE_LAST_STATUSES: readonly ImportSourceLastStatus[] = [
  'ok',
  'fetch_error',
  'parse_error',
  'ssrf_blocked',
  'dns_error',
  'rate_limited',
];

/**
 * Plain domain model for an ICS import source.
 *
 * Represents a subscribed ICS feed URL that a calendar owner has registered
 * for automatic import. Usable in both frontend (admin UI) and backend
 * (service layer) for type-safe round-trip serialization.
 *
 * NOTE: The verification token is deliberately NOT exposed on this model.
 * The token is an owner-only secret used to complete DNS verification; it
 * is returned separately (once) by the verification-issue API and never
 * included in generic list/read responses.
 */
export class ImportSource extends PrimaryModel {
  calendarId: string;
  url: string;
  enabled: boolean;
  verificationType: ImportSourceVerificationType;
  verificationState: ImportSourceVerificationState;
  verifiedAt: Date | null;
  verificationExpiresAt: Date | null;
  etag: string | null;
  contentHash: string | null;
  lastFetchedAt: Date | null;
  lastStatus: ImportSourceLastStatus | null;
  createdAt: Date | null;
  updatedAt: Date | null;

  /**
   * Constructor for ImportSource.
   *
   * @param id - Unique identifier (UUID)
   * @param calendarId - UUID of the owning calendar
   * @param url - The ICS feed URL
   */
  constructor(id: string = '', calendarId: string = '', url: string = '') {
    super(id);
    this.calendarId = calendarId;
    this.url = url;
    this.enabled = true;
    this.verificationType = 'dns-txt';
    this.verificationState = 'unverified';
    this.verifiedAt = null;
    this.verificationExpiresAt = null;
    this.etag = null;
    this.contentHash = null;
    this.lastFetchedAt = null;
    this.lastStatus = null;
    this.createdAt = null;
    this.updatedAt = null;
  }

  /**
   * Converts the model to a plain object suitable for API serialization.
   *
   * The verification token is intentionally omitted — it is a one-time
   * secret surfaced only by the verification-issue flow.
   *
   * @returns Plain object with camelCase keys
   */
  toObject(): Record<string, any> {
    return {
      id: this.id,
      calendarId: this.calendarId,
      url: this.url,
      enabled: this.enabled,
      verificationType: this.verificationType,
      verificationState: this.verificationState,
      verifiedAt: this.verifiedAt ? this.verifiedAt.toISOString() : null,
      verificationExpiresAt: this.verificationExpiresAt
        ? this.verificationExpiresAt.toISOString()
        : null,
      etag: this.etag,
      contentHash: this.contentHash,
      lastFetchedAt: this.lastFetchedAt ? this.lastFetchedAt.toISOString() : null,
      lastStatus: this.lastStatus,
      createdAt: this.createdAt ? this.createdAt.toISOString() : null,
      updatedAt: this.updatedAt ? this.updatedAt.toISOString() : null,
    };
  }

  /**
   * Creates an ImportSource from a plain object.
   *
   * Date-valued fields accept either ISO 8601 strings or Date instances to
   * tolerate both serialized payloads and in-process entity conversions.
   *
   * @param obj - Plain object possibly containing ImportSource fields
   * @returns A new ImportSource instance
   */
  static fromObject(obj: Record<string, any>): ImportSource {
    const model = new ImportSource(obj.id ?? '', obj.calendarId ?? '', obj.url ?? '');
    model.enabled = obj.enabled ?? true;
    model.verificationType =
      (obj.verificationType as ImportSourceVerificationType) ?? 'dns-txt';
    model.verificationState =
      (obj.verificationState as ImportSourceVerificationState) ?? 'unverified';
    model.verifiedAt = parseDate(obj.verifiedAt);
    model.verificationExpiresAt = parseDate(obj.verificationExpiresAt);
    model.etag = obj.etag ?? null;
    model.contentHash = obj.contentHash ?? null;
    model.lastFetchedAt = parseDate(obj.lastFetchedAt);
    model.lastStatus = (obj.lastStatus as ImportSourceLastStatus) ?? null;
    model.createdAt = parseDate(obj.createdAt);
    model.updatedAt = parseDate(obj.updatedAt);
    return model;
  }
}

/**
 * Parses a date-valued field that may arrive as an ISO string, a Date, or
 * null/undefined. Invalid inputs collapse to null so downstream code does
 * not have to branch on every access.
 */
function parseDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(value as string);
  return isNaN(parsed.getTime()) ? null : parsed;
}
