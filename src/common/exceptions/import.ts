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
export const IMPORT_SOURCE_NOT_VERIFIED = 'IMPORT_SOURCE_NOT_VERIFIED';

// File-upload intake codes (pv-84da.1.4). These describe failures unique to
// the multipart file-upload path — an in-memory buffer with no remote URL to
// fetch. Like every other code here they are opaque, sanitized identifiers
// safe to surface over the HTTP wire and to key client i18n lookups.
export const IMPORT_FILE_EMPTY = 'IMPORT_FILE_EMPTY';
export const IMPORT_FILE_TOO_LARGE = 'IMPORT_FILE_TOO_LARGE';
export const IMPORT_FILE_BAD_FORMAT = 'IMPORT_FILE_BAD_FORMAT';
export const IMPORT_FILE_TOO_MANY_EVENTS = 'IMPORT_FILE_TOO_MANY_EVENTS';
export const IMPORT_SOURCE_CAP_EXCEEDED = 'IMPORT_SOURCE_CAP_EXCEEDED';

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

// rel="me" verification reason codes — exactly one of these is used as the
// user-visible message for ImportSourceRelMeVerificationError. SSRF blocks
// during page fetch reuse ImportSourceSsrfBlockedError and are NOT
// represented here.
export const IMPORT_RELME_PAGE_FETCH_ERROR = 'IMPORT_RELME_PAGE_FETCH_ERROR';
export const IMPORT_RELME_PARSE_ERROR = 'IMPORT_RELME_PARSE_ERROR';
export const IMPORT_RELME_LINK_NOT_FOUND = 'IMPORT_RELME_LINK_NOT_FOUND';
export const IMPORT_RELME_HOSTNAME_MISMATCH = 'IMPORT_RELME_HOSTNAME_MISMATCH';
export const IMPORT_RELME_PSL_VIOLATION = 'IMPORT_RELME_PSL_VIOLATION';

export type ImportRelMeVerificationReason =
  | typeof IMPORT_RELME_PAGE_FETCH_ERROR
  | typeof IMPORT_RELME_PARSE_ERROR
  | typeof IMPORT_RELME_LINK_NOT_FOUND
  | typeof IMPORT_RELME_HOSTNAME_MISMATCH
  | typeof IMPORT_RELME_PSL_VIOLATION;

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
 * Thrown when `rel="me"` ownership verification fails. The constructor
 * requires one of the fixed reason codes; fetched URLs, hostnames, and
 * raw HTML must only be placed on `details`.
 *
 * SSRF policy blocks during the verification page fetch are NOT signaled
 * here — they reuse the existing `ImportSourceSsrfBlockedError` so that
 * SSRF handling stays uniform across all outbound import fetches.
 */
export class ImportSourceRelMeVerificationError extends Error {
  public readonly reason: ImportRelMeVerificationReason;
  public readonly details?: Record<string, unknown>;

  constructor(reason: ImportRelMeVerificationReason, details?: Record<string, unknown>) {
    super(reason);
    this.name = 'ImportSourceRelMeVerificationError';
    this.reason = reason;
    this.details = details;
    Object.setPrototypeOf(this, ImportSourceRelMeVerificationError.prototype);
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

/**
 * Thrown when a sync is attempted against an import source whose verification
 * state blocks it (unverified, or expired beyond the grace window). Maps to
 * HTTP 409 Conflict in the API handler.
 */
export class ImportSourceNotVerifiedError extends Error {
  public readonly details?: Record<string, unknown>;

  constructor(details?: Record<string, unknown>) {
    super(IMPORT_SOURCE_NOT_VERIFIED);
    this.name = 'ImportSourceNotVerifiedError';
    this.details = details;
    Object.setPrototypeOf(this, ImportSourceNotVerifiedError.prototype);
  }
}

/**
 * Thrown when a file upload carries no bytes (missing multipart field or a
 * zero-length buffer). Maps to HTTP 400 in the API handler.
 */
export class ImportSourceFileEmptyError extends Error {
  public readonly details?: Record<string, unknown>;

  constructor(details?: Record<string, unknown>) {
    super(IMPORT_FILE_EMPTY);
    this.name = 'ImportSourceFileEmptyError';
    this.details = details;
    Object.setPrototypeOf(this, ImportSourceFileEmptyError.prototype);
  }
}

/**
 * Thrown when an uploaded file exceeds the 10 MiB intake cap. Maps to HTTP
 * 400 in the API handler. The raw byte length is kept on `details` only.
 */
export class ImportSourceFileTooLargeError extends Error {
  public readonly details?: Record<string, unknown>;

  constructor(details?: Record<string, unknown>) {
    super(IMPORT_FILE_TOO_LARGE);
    this.name = 'ImportSourceFileTooLargeError';
    this.details = details;
    Object.setPrototypeOf(this, ImportSourceFileTooLargeError.prototype);
  }
}

/**
 * Thrown when an uploaded file fails the intake format checks before any
 * events are persisted: a disallowed content type / extension, a payload
 * that does not begin with `BEGIN:VCALENDAR`, or ICS bytes that the parser
 * cannot read at all (malformed). Maps to HTTP 400 in the API handler.
 *
 * NOTE: a file that parses as a valid VCALENDAR but yields zero usable
 * VEVENTs is NOT this error — that reuses {@link ImportSourceParseError}
 * (HTTP 422) to distinguish "the file is broken" from "the file is fine but
 * empty of events".
 */
export class ImportSourceFileBadFormatError extends Error {
  public readonly details?: Record<string, unknown>;

  constructor(details?: Record<string, unknown>) {
    super(IMPORT_FILE_BAD_FORMAT);
    this.name = 'ImportSourceFileBadFormatError';
    this.details = details;
    Object.setPrototypeOf(this, ImportSourceFileBadFormatError.prototype);
  }
}

/**
 * Thrown when an uploaded file carries more VEVENTs than the per-file import
 * ceiling ({@link IMPORT_FILE_TOO_MANY_EVENTS}). The bound is a DoS mitigation:
 * a 10 MiB file of minimal VEVENTs can hold ~130k+ events, each an INSERT in a
 * single transaction, and `parseICS` is synchronous/CPU-bound. The check runs
 * after VEVENT extraction but before the create loop, so no events are written.
 * Maps to HTTP 422 in the API handler (the file is well-formed but its event
 * count is not acceptable). The parsed/limit counts are kept on `details` only.
 */
export class ImportSourceFileTooManyEventsError extends Error {
  public readonly details?: Record<string, unknown>;

  constructor(details?: Record<string, unknown>) {
    super(IMPORT_FILE_TOO_MANY_EVENTS);
    this.name = 'ImportSourceFileTooManyEventsError';
    this.details = details;
    Object.setPrototypeOf(this, ImportSourceFileTooManyEventsError.prototype);
  }
}

/**
 * Thrown when creating another import source would exceed the per-calendar
 * source cap. Maps to HTTP 409 Conflict in the API handler (the request
 * conflicts with the current state of the calendar). Distinct from the
 * URL-create path's generic {@link ValidationError} cap rejection so the
 * file-upload frontend can key an actionable message off `errorName`.
 */
export class ImportSourceCapExceededError extends Error {
  public readonly details?: Record<string, unknown>;

  constructor(details?: Record<string, unknown>) {
    super(IMPORT_SOURCE_CAP_EXCEEDED);
    this.name = 'ImportSourceCapExceededError';
    this.details = details;
    Object.setPrototypeOf(this, ImportSourceCapExceededError.prototype);
  }
}
