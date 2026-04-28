/**
 * Maps an error returned by `ImportSourceService` (verify or sync) to an
 * i18n key under `calendars.import.errors.*`. Centralizes the
 * exception-to-message classification so the component layer only owns
 * UI orchestration.
 *
 * Three call sites consume this:
 *  - `DnsChallengeStep.vue` (context: `'verify-dns'`)
 *  - `RelMeChallengeStep.vue` (context: `'verify-rel-me'`)
 *  - `ImportSourcesSection.vue` (context: `'sync'`)
 *
 * The verify contexts unwrap the discriminator-specific verification
 * exception to its `reason` field; the sync context skips that step.
 * Common transport-layer errors (fetch, SSRF, parse, rate-limit) map
 * uniformly across all contexts. Unrecognized errors fall back to
 * `errors.unknown_verify` or `errors.unknown_sync` so the UI never
 * shows a blank error surface.
 *
 * @see DnsChallengeStep.vue — verify-dns consumer
 * @see RelMeChallengeStep.vue — verify-rel-me consumer
 * @see ImportSourcesSection.vue — sync consumer
 */

import {
  ImportSourceDnsVerificationError,
  ImportSourceRelMeVerificationError,
} from '@/common/exceptions/import';

export type ImportSourceErrorContext = 'verify-dns' | 'verify-rel-me' | 'sync';

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
  if (name && name in COMMON_NAME_KEYS) {
    return COMMON_NAME_KEYS[name];
  }

  return context === 'sync' ? 'errors.unknown_sync' : 'errors.unknown_verify';
}
