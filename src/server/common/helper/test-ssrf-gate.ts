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
 * When the gate is open, the ip-validation and ICS fetcher layers allow:
 *   - http:// URLs
 *   - Private-IP literals (e.g. 127.0.0.1, ::1)
 *   - DNS-resolved private IPs in the ICS fetch path
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
 * @see bead pv-1qcp.13
 */
export function isLocalhostIcsImportAllowed(): boolean {
  const env = process.env.NODE_ENV;
  if (env !== 'test' && env !== 'e2e') {
    return false;
  }
  return process.env.ALLOW_LOCALHOST_ICS_IMPORT === 'true';
}
