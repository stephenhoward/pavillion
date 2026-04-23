/**
 * Exception types for ICS import.
 *
 * All user-visible messages are drawn from the fixed sanitized set of
 * constants exported below. Raw failure detail (URLs, IPs, resolver
 * responses, parser output) is kept on the optional `details` field so
 * that it can be included in structured debug logs but never leaks over
 * the HTTP wire: only `name` and `message` are serialized to API clients
 * via the standard `{ error, errorName }` envelope.
 *
 * @see privacy-playbook — no PII/resolver-raw data in user-visible messages
 * @see backend-error-serialization — `errorName` drives cross-HTTP reconstruction
 */

// ---------------------------------------------------------------------------
// Fixed sanitized message codes
//
// These are stable identifiers intended for use in API responses and client
// i18n lookups. They are deliberately opaque: no URLs, IPs, hostnames, or
// resolver responses appear in any of these strings.
// ---------------------------------------------------------------------------

export const IMPORT_NOT_FOUND = 'IMPORT_NOT_FOUND';
export const IMPORT_FETCH_ERROR = 'IMPORT_FETCH_ERROR';
export const IMPORT_SSRF_BLOCKED = 'IMPORT_SSRF_BLOCKED';
export const IMPORT_PARSE_ERROR = 'IMPORT_PARSE_ERROR';
export const IMPORT_VERIFY_RATE_LIMITED = 'IMPORT_VERIFY_RATE_LIMITED';

// DNS verification reason codes — exactly one of these is used as the
// user-visible message for ImportSourceDnsVerificationError.
export const IMPORT_DNS_NOT_FOUND = 'IMPORT_DNS_NOT_FOUND';
export const IMPORT_DNS_MISMATCH = 'IMPORT_DNS_MISMATCH';
export const IMPORT_DNS_RESOLVER_DISAGREEMENT = 'IMPORT_DNS_RESOLVER_DISAGREEMENT';
export const IMPORT_DNS_RESOLVER_UNAVAILABLE = 'IMPORT_DNS_RESOLVER_UNAVAILABLE';
export const IMPORT_DNS_PSL_VIOLATION = 'IMPORT_DNS_PSL_VIOLATION';

export type ImportDnsVerificationReason =
  | typeof IMPORT_DNS_NOT_FOUND
  | typeof IMPORT_DNS_MISMATCH
  | typeof IMPORT_DNS_RESOLVER_DISAGREEMENT
  | typeof IMPORT_DNS_RESOLVER_UNAVAILABLE
  | typeof IMPORT_DNS_PSL_VIOLATION;

// ---------------------------------------------------------------------------
// Exception classes
// ---------------------------------------------------------------------------

/**
 * Thrown when a referenced import source cannot be located.
 */
export class ImportSourceNotFoundError extends Error {
  public readonly details?: Record<string, unknown>;

  constructor(details?: Record<string, unknown>) {
    super(IMPORT_NOT_FOUND);
    this.name = 'ImportSourceNotFoundError';
    this.details = details;
    Object.setPrototypeOf(this, ImportSourceNotFoundError.prototype);
  }
}

/**
 * Thrown when fetching an import source fails for any reason other than
 * an SSRF policy block (network error, non-2xx, timeout, malformed redirect).
 * Raw detail (URL, status code, IP) is preserved in `details` only.
 */
export class ImportSourceFetchError extends Error {
  public readonly details?: Record<string, unknown>;

  constructor(details?: Record<string, unknown>) {
    super(IMPORT_FETCH_ERROR);
    this.name = 'ImportSourceFetchError';
    this.details = details;
    Object.setPrototypeOf(this, ImportSourceFetchError.prototype);
  }
}

/**
 * Thrown when a fetch attempt was blocked by SSRF protections (private
 * IP range, disallowed scheme, redirect to private address, etc.).
 * The blocked IP/host is never included in the user-visible message.
 */
export class ImportSourceSsrfBlockedError extends Error {
  public readonly details?: Record<string, unknown>;

  constructor(details?: Record<string, unknown>) {
    super(IMPORT_SSRF_BLOCKED);
    this.name = 'ImportSourceSsrfBlockedError';
    this.details = details;
    Object.setPrototypeOf(this, ImportSourceSsrfBlockedError.prototype);
  }
}

/**
 * Thrown when the fetched ICS payload cannot be parsed. Raw parser output
 * is preserved in `details` only.
 */
export class ImportSourceParseError extends Error {
  public readonly details?: Record<string, unknown>;

  constructor(details?: Record<string, unknown>) {
    super(IMPORT_PARSE_ERROR);
    this.name = 'ImportSourceParseError';
    this.details = details;
    Object.setPrototypeOf(this, ImportSourceParseError.prototype);
  }
}

/**
 * Thrown when DNS-based ownership verification fails. The constructor
 * requires one of the fixed reason codes; resolver answers and hostnames
 * must only be placed on `details`.
 */
export class ImportSourceDnsVerificationError extends Error {
  public readonly reason: ImportDnsVerificationReason;
  public readonly details?: Record<string, unknown>;

  constructor(reason: ImportDnsVerificationReason, details?: Record<string, unknown>) {
    super(reason);
    this.name = 'ImportSourceDnsVerificationError';
    this.reason = reason;
    this.details = details;
    Object.setPrototypeOf(this, ImportSourceDnsVerificationError.prototype);
  }
}

/**
 * Thrown when a caller exceeds the rate limit for DNS-verification
 * attempts on an import source.
 */
export class ImportSourceVerifyRateLimitError extends Error {
  public readonly details?: Record<string, unknown>;

  constructor(details?: Record<string, unknown>) {
    super(IMPORT_VERIFY_RATE_LIMITED);
    this.name = 'ImportSourceVerifyRateLimitError';
    this.details = details;
    Object.setPrototypeOf(this, ImportSourceVerifyRateLimitError.prototype);
  }
}
