/**
 * Validation of ActivityPub actor URIs for the notifications domain.
 *
 * This validator is used by the Flag actor anonymization policy when an
 * inbound Flag's actor is a remote AP actor: the URI is the only piece of
 * input the notifications domain ever inspects, and it is reduced to a
 * single normalized hostname for display attribution. The original URI is
 * discarded.
 *
 * The validation rules:
 *
 *  1. Parses cleanly with `new URL(uri)`.
 *  2. Scheme is `https` (no http, no file, no javascript, etc.).
 *  3. No userinfo component (`username` and `password` must be empty).
 *  4. Hostname is not an IP literal (IPv4 or IPv6).
 *  5. Hostname is lowercased and Unicode-normalized (NFKC) before storage,
 *     to defeat homograph variants such as fullwidth ASCII.
 *  6. Normalized hostname matches the RFC 1123 DNS allowlist (ASCII
 *     letters, digits, hyphens, dots only). Node's WHATWG URL parser
 *     tolerates characters such as `{`, `}`, `,`, spaces that DNS does
 *     not; without this check, a hostile actor could craft a URI whose
 *     stored attribution token spoofs the recipient's display.
 *
 * Any failure returns `{ kind: 'invalid' }`. Callers (the anonymization
 * policy) fall back to the fully-anonymous form with no display URL.
 *
 * This is **not** a general SSRF-prevention guard — the AP inbox has
 * already authenticated the actor when this code runs. The HTTPS-only,
 * no-userinfo, no-IP-literal rules are about presentational hygiene of
 * the *stored* attribution string, not about whether we are about to
 * fetch the URI (we are not — the notifications domain never fetches AP
 * actor URIs).
 */

/**
 * RFC 1123 hostname segment regex. Used to reject IPv4 literals.
 * An IPv4 literal is four 1–3 digit segments separated by dots, no letters.
 */
const IPV4_LITERAL_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

/**
 * RFC 1123 DNS hostname allowlist. Each label is 1–63 chars of
 * ASCII letters, digits, or hyphens, and may not begin or end with a hyphen.
 * Labels are joined by dots. This positively allowlists the character set
 * permitted in DNS hostnames, rejecting anything Node's WHATWG URL parser
 * tolerates but DNS does not (e.g. `{`, `}`, `,`, spaces, etc.).
 *
 * This complements the IPv4/IPv6 literal rejections above: anything that
 * passes this regex is a syntactically valid DNS name and is not an IP
 * literal (because IPv4 dotted-quad would match this too, the IPv4 check
 * must run first; IPv6 contains colons which this regex excludes).
 */
const RFC_1123_HOSTNAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/**
 * Validates an ActivityPub actor URI and returns either the normalized
 * hostname or an invalid marker. See module docstring for the full rule set.
 *
 * @param {string} uri - Raw URI string (e.g., from an inbound AP activity)
 * @returns {{ kind: 'valid', host: string } | { kind: 'invalid' }}
 */
export function validateApActorUri(uri: string): { kind: 'valid'; host: string } | { kind: 'invalid' } {
  if (!uri) {
    return { kind: 'invalid' };
  }

  // Rule 1: parses cleanly with new URL().
  let parsed: URL;
  try {
    parsed = new URL(uri);
  }
  catch {
    return { kind: 'invalid' };
  }

  // Rule 2: HTTPS only.
  if (parsed.protocol !== 'https:') {
    return { kind: 'invalid' };
  }

  // Rule 3: no userinfo. WHATWG URL parses `user[:pass]@host` into `username`/`password`.
  if (parsed.username !== '' || parsed.password !== '') {
    return { kind: 'invalid' };
  }

  // WHATWG URL strips the surrounding brackets from IPv6 literal hostnames
  // (so parsed.hostname is e.g. "::1" for the URI "https://[::1]/"). We use
  // the raw `host` to detect bracket notation and also reject the bracketless
  // forms by checking for a colon (which never appears in a normal DNS name).
  const rawHost = parsed.hostname;

  // Rule 4a: reject IPv6 literals — any colon in a hostname indicates an IPv6
  // address (DNS hostnames never contain a colon).
  if (rawHost.includes(':')) {
    return { kind: 'invalid' };
  }

  // Rule 4b: reject IPv4 dotted-quad literals.
  if (IPV4_LITERAL_RE.test(rawHost)) {
    return { kind: 'invalid' };
  }

  // Rule 5: normalize. NFKC collapses compatibility variants (fullwidth ASCII,
  // ligatures, etc.) onto their canonical forms. Lowercase after NFKC so that
  // any case-bearing characters introduced by normalization are also folded.
  const normalized = rawHost.normalize('NFKC').toLowerCase();

  // Re-check IPv4 after normalization in case NFKC produced one (fullwidth
  // digits normalize to ASCII digits).
  if (IPV4_LITERAL_RE.test(normalized)) {
    return { kind: 'invalid' };
  }

  // Empty hostname after normalization (defensive — WHATWG URL parsing
  // usually rejects this earlier, but normalize() could theoretically erode
  // a string to empty).
  if (normalized.length === 0) {
    return { kind: 'invalid' };
  }

  // Rule 6: positively allowlist the RFC 1123 DNS character set. Node's
  // WHATWG URL parser accepts characters that DNS does not (e.g. `{`, `}`,
  // `,`, spaces); without this check a URI such as
  // `https://evil.com}attacker.bad.org/` would slip through and produce a
  // stored display token of `i18n:flag_actor_remote{host:evil.com}attacker.bad.org}`.
  // That string parses as the malformed host on the client and is
  // presentationally spoofable (no XSS — Vue/i18next auto-escape — but the
  // recipient sees the attacker's chosen text).
  if (!RFC_1123_HOSTNAME_RE.test(normalized)) {
    return { kind: 'invalid' };
  }

  return { kind: 'valid', host: normalized };
}
