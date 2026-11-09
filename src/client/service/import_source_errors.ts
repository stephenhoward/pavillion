/**
 * Maps an error returned by `ImportSourceService` (verify, sync or file
 * upload) to an i18n key under `calendars.import`. Centralizes the
 * exception-to-message classification so the component layer only owns
 * UI orchestration.
 *
 * Four call sites consume this:
 *  - `DnsChallengeStep.vue` (context: `'verify-dns'`)
 *  - `RelMeChallengeStep.vue` (context: `'verify-rel-me'`)
 *  - `ImportSourcesSection.vue` (contexts: `'sync'`, `'file-upload'` and `'create-url'`)
 *
 * The create-url context maps the cap, permission and URL-validation
 * failures of adding a feed first. The verify contexts unwrap the discriminator-specific verification
 * exception to its `reason` field; the sync context skips that step.
 * The file-upload context maps the upload's own exceptions first — where
 * `ImportSourceParseError` means a readable file with no events, not an
 * unreadable feed. Common transport-layer errors (fetch, SSRF, parse,
 * rate-limit) map uniformly across all contexts. Unrecognized errors fall
 * back to a per-context `errors.unknown_*` key so the UI never shows a
 * blank error surface or a raw exception message.
 *
 * @see DnsChallengeStep.vue — verify-dns consumer
 * @see RelMeChallengeStep.vue — verify-rel-me consumer
 * @see ImportSourcesSection.vue — sync consumer
 */

import {
  ImportSourceDnsVerificationError,
  ImportSourceRelMeVerificationError,
} from '@/common/exceptions/import';

export type ImportSourceErrorContext = 'verify-dns' | 'verify-rel-me' | 'sync' | 'file-upload' | 'create-url';

const DNS_REASON_KEYS: Record<string, string> = {
  IMPORT_DNS_NOT_FOUND: 'errors.dns_not_found',
  IMPORT_DNS_MISMATCH: 'errors.dns_mismatch',
  IMPORT_DNS_RESOLVER_DISAGREEMENT: 'errors.dns_resolver_disagreement',
  IMPORT_DNS_RESOLVER_UNAVAILABLE: 'errors.dns_resolver_unavailable',
  IMPORT_DNS_PSL_VIOLATION: 'errors.dns_psl_violation',
};

const RELME_REASON_KEYS: Record<string, string> = {
  IMPORT_RELME_PAGE_FETCH_ERROR: 'errors.relme_page_fetch_error',
  IMPORT_RELME_PARSE_ERROR: 'errors.relme_parse_error',
  IMPORT_RELME_LINK_NOT_FOUND: 'errors.relme_link_not_found',
  IMPORT_RELME_HOSTNAME_MISMATCH: 'errors.relme_hostname_mismatch',
  IMPORT_RELME_PSL_VIOLATION: 'errors.relme_psl_violation',
};

const COMMON_NAME_KEYS: Record<string, string> = {
  ImportSourceFetchError: 'errors.fetch_error',
  ImportSourceSsrfBlockedError: 'errors.ssrf_blocked',
  ImportSourceParseError: 'errors.parse_error',
  ImportSourceVerifyRateLimitError: 'errors.rate_limited',
  RateLimitError: 'errors.rate_limited',
};

const FILE_UPLOAD_NAME_KEYS: Record<string, string> = {
  ImportSourceFileEmptyError: 'errors.file_empty',
  ImportSourceFileTooLargeError: 'file_too_large',
  ImportSourceFileBadFormatError: 'errors.file_bad_format',
  ImportSourceFileTooManyEventsError: 'errors.file_too_many_events',
  ImportSourceParseError: 'errors.file_no_events',
  ImportSourceCapExceededError: 'errors.source_cap_exceeded',
  CalendarEditorPermissionError: 'errors.no_edit_permission',
};

const CREATE_URL_NAME_KEYS: Record<string, string> = {
  ImportSourceCapExceededError: 'errors.source_cap_exceeded_url',
  CalendarEditorPermissionError: 'errors.no_edit_permission',
  ValidationError: 'errors.invalid_url',
};

const UNKNOWN_KEYS: Record<ImportSourceErrorContext, string> = {
  'verify-dns': 'errors.unknown_verify',
  'verify-rel-me': 'errors.unknown_verify',
  'sync': 'errors.unknown_sync',
  'file-upload': 'errors.unknown_file_upload',
  'create-url': 'errors.unknown_create_url',
};

export function importSourceErrorKey(
  err: unknown,
  context: ImportSourceErrorContext,
): string {
  if (
    context === 'verify-dns'
    && err instanceof ImportSourceDnsVerificationError
  ) {
    return DNS_REASON_KEYS[err.reason] ?? 'errors.unknown_verify';
  }
  if (
    context === 'verify-rel-me'
    && err instanceof ImportSourceRelMeVerificationError
  ) {
    return RELME_REASON_KEYS[err.reason] ?? 'errors.unknown_verify';
  }

  const name = (err as { name?: string })?.name;
  if (context === 'file-upload' && name && name in FILE_UPLOAD_NAME_KEYS) {
    return FILE_UPLOAD_NAME_KEYS[name];
  }
  if (context === 'create-url' && name && name in CREATE_URL_NAME_KEYS) {
    return CREATE_URL_NAME_KEYS[name];
  }
  if (name && name in COMMON_NAME_KEYS) {
    return COMMON_NAME_KEYS[name];
  }

  return UNKNOWN_KEYS[context];
}
