import { getPublicSuffix, parse as parseTld } from 'tldts';

/**
 * Extracts the lowercased hostname from a URL string. Returns null if the
 * URL is unparseable or has no hostname.
 */
export function hostnameFromUrl(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    return u.hostname.toLowerCase() || null;
  }
  catch {
    return null;
  }
}

/**
 * PSL guard: a hostname must sit strictly below its public suffix on the
 * Public Suffix List. Returns true when the hostname is safe (a registrable
 * domain or a label below one), false when the hostname equals or sits at
 * the public suffix (e.g. `co.uk`, `github.io`, bare `com`).
 *
 * Used by both DNS-TXT and rel-me verification to reject shared-tenancy
 * hosts where ownership semantics would be ambiguous: a DNS challenge
 * record at a public suffix would land at the registry boundary, and a
 * rel-me verification page on a bare-suffix host would sit on shared
 * multi-tenant infrastructure.
 */
export function passesPslCheck(hostname: string): boolean {
  // parseTld returns the public-suffix breakdown, or a null hostname when
  // the input is not a valid host.
  const parsed = parseTld(hostname);
  if (!parsed || !parsed.hostname) {
    return false;
  }
  // A registrable domain must exist below the public suffix. `domain` is
  // null when the hostname equals or sits above the suffix.
  if (!parsed.domain) {
    return false;
  }
  // Belt-and-suspenders: ensure hostname != public suffix itself.
  const suffix = getPublicSuffix(hostname);
  if (suffix && suffix === hostname) {
    return false;
  }
  return true;
}
