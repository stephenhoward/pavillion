/**
 * Pure validators for the user-supplied verification page URL in the
 * `rel="me"` ownership-verification flow. Extracted from the Vue
 * component so the rules can be exercised without mounting and stay in
 * sync with the server-side `validateRelMePageUrl()` contract.
 *
 * @see RelMeChallengeStep.vue — sole UI consumer
 * @see server validateRelMePageUrl — the server contract this mirrors
 */

/**
 * Maximum allowed length for the verification page URL. Mirrors the
 * server-side `RELME_PAGE_URL_MAX_LENGTH` constant so client-side
 * validation rejects the same inputs the server would.
 */
export const RELME_PAGE_URL_MAX_LENGTH = 2048;

const SCHEME_PREFIX_PATTERN = /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//;

/**
 * Normalize raw user input by prepending `https://` when the user omits
 * the scheme. Pasting a URL from a browser address bar usually includes
 * the scheme, but typing a hostname does not — auto-prepending rather
 * than rejecting avoids punishing either habit. Inputs that already
 * declare a scheme (including non-https schemes such as `http://`) are
 * passed through unchanged so the downstream scheme check can reject
 * them with a precise error.
 */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || SCHEME_PREFIX_PATTERN.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

export type RelMePageUrlValidationResult =
  | { ok: true; url: string }
  | { ok: false; key: string };

/**
 * Validate the user-supplied page URL against the same rules as the
 * server-side `validateRelMePageUrl()`. On success, returns the
 * normalized URL ready to send to the verifier; on failure, returns an
 * i18n key under `calendars.import.rel_me_challenge.*` describing the
 * specific rule that failed.
 *
 * Rules (mirroring server):
 *  1. Required, non-empty after trim
 *  2. Length <= RELME_PAGE_URL_MAX_LENGTH (after normalization)
 *  3. Parses as a URL
 *  4. Scheme is `https:`
 *  5. Hostname equals the source hostname (case-insensitive)
 */
export function validateRelMePageUrl(
  raw: string,
  expectedHostname: string,
): RelMePageUrlValidationResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, key: 'rel_me_challenge.page_url_required' };
  }

  const normalized = normalizeUrl(trimmed);
  if (normalized.length > RELME_PAGE_URL_MAX_LENGTH) {
    return { ok: false, key: 'rel_me_challenge.page_url_too_long' };
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  }
  catch {
    return { ok: false, key: 'rel_me_challenge.page_url_invalid' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, key: 'rel_me_challenge.page_url_invalid_scheme' };
  }
  if (parsed.hostname.toLowerCase() !== expectedHostname.toLowerCase()) {
    return { ok: false, key: 'rel_me_challenge.page_url_hostname_mismatch' };
  }
  return { ok: true, url: normalized };
}
