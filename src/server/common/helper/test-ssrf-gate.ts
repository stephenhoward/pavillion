/**
 * Env-gated test hook that selectively relaxes SSRF defenses for the
 * ICS-import pipeline so Playwright e2e tests can run a mock DoH + ICS
 * fixture server on localhost.
 *
 * The gate is OFF by default and is byte-invisible unless BOTH of the
 * following hold:
 *
 *   1. `process.env.NODE_ENV === 'test'` or `'e2e'` (never in production)
 *   2. `process.env.ALLOW_LOCALHOST_ICS_IMPORT === 'true'`
 *
 * When the gate is open, ICS-import callers (Fetcher, DnsVerifier,
 * ImportSourceService) substitute a relaxed URL validator that allows:
 *   - http:// URLs
 *   - Private-IP literals (e.g. 127.0.0.1, ::1)
 *   - DNS-resolved private IPs (resolved-IP check is localised in Fetcher)
 *
 * CRITICAL SCOPE: The gate is NOT consulted by `validateUrlNotPrivate`
 * itself. That helper is strict in every environment so ActivityPub
 * federation paths, which share the helper, CANNOT be relaxed via this env
 * var. The gate's effect is narrowed to the ICS-owned call sites that
 * opt-in via `createIcsUrlValidator()` (or equivalent per-call wiring).
 *
 * This gate is DELIBERATELY SEPARATE from `ALLOW_PRIVATE_FEDERATION`:
 *   - `ALLOW_PRIVATE_FEDERATION` is for Docker-based federation tests where
 *     non-IP hostnames (alpha.federation.local) resolve to private subnet
 *     IPs. It does NOT allow http:// or literal private IPs.
 *   - This gate targets the narrower localhost + http combination needed by
 *     an in-process mock DoH + ICS server.
 *
 * Production safety: the NODE_ENV guard runs first, so setting
 * ALLOW_LOCALHOST_ICS_IMPORT=true in production is a no-op and the gate
 * stays closed.
 *
 * @see bead pv-1qcp.13 (original gate), pv-gdqp (scope narrowing)
 */
export function isLocalhostIcsImportAllowed(): boolean {
  const env = process.env.NODE_ENV;
  if (env !== 'test' && env !== 'e2e') {
    return false;
  }
  return process.env.ALLOW_LOCALHOST_ICS_IMPORT === 'true';
}

/**
 * Relaxed URL validator used by ICS-import callers when the
 * ALLOW_LOCALHOST_ICS_IMPORT gate is open. Performs minimal structural
 * validation (parseable URL, http/https scheme) but does NOT reject
 * http:// or private-IP literals/resolutions. Never call this directly in
 * production paths — it is intentionally permissive for e2e fixtures.
 */
export async function relaxedIcsUrlValidator(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  }
  catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`URL must use http or https, got: ${parsed.protocol}`);
  }
  return true;
}

/**
 * Returns the URL validator appropriate for ICS-owned SSRF check sites:
 * strict `validateUrlNotPrivate` when the gate is closed (always in
 * production), relaxed localhost-friendly validator when the gate is open
 * (test/e2e only with the env var set).
 *
 * The check is evaluated lazily on each call so env-var manipulation in
 * tests flows through without reconstructing the caller.
 */
export function createIcsUrlValidator(
  strict: (url: string) => Promise<boolean>,
): (url: string) => Promise<boolean> {
  return async (url: string) => {
    if (isLocalhostIcsImportAllowed()) {
      return relaxedIcsUrlValidator(url);
    }
    return strict(url);
  };
}
