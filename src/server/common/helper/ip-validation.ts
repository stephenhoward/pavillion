/**
 * IP Address Validation Utilities
 *
 * Provides utilities for validating IP addresses to prevent SSRF (Server-Side
 * Request Forgery) attacks by blocking requests to private, internal, and
 * otherwise-unroutable IP address ranges.
 *
 * Blocked IPv4 ranges:
 * - Loopback: 127.0.0.0/8
 * - Private (RFC 1918): 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 * - Link-local: 169.254.0.0/16 (including 169.254.169.254 cloud metadata)
 * - CGNAT: 100.64.0.0/10 (RFC 6598)
 * - "This network": 0.0.0.0/8
 * - IETF Protocol Assignments: 192.0.0.0/24
 * - TEST-NET-1/2/3: 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24
 * - Multicast: 224.0.0.0/4
 * - Reserved for future use: 240.0.0.0/4 (includes 255.255.255.255 broadcast)
 *
 * Blocked IPv6 ranges:
 * - Loopback (::1), unspecified (::)
 * - Link-local: fe80::/10
 * - Unique local: fc00::/7
 * - Multicast: ff00::/8
 * - IPv4-mapped (::ffff:X.X.X.X) — unwrapped and the underlying IPv4 validated
 *
 * Alternate IPv4 literal encodings (octal 0177.0.0.1, decimal integer
 * 2130706433, hex 0x7f000001, shorthand 127.1) are rejected outright rather
 * than normalized — this avoids ambiguity and matches strict SSRF defenses.
 */

import dns from 'dns';
import { promisify } from 'util';
import ipaddr from 'ipaddr.js';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('ip-validation');

const dnsLookup = promisify(dns.lookup);

/**
 * IPv4 ranges reported by ipaddr.js that are considered private / non-routable
 * for SSRF purposes.
 */
const BLOCKED_IPV4_RANGES: ReadonlySet<string> = new Set([
  'unspecified',       // 0.0.0.0/8
  'broadcast',         // 255.255.255.255/32
  'multicast',         // 224.0.0.0/4
  'linkLocal',         // 169.254.0.0/16 (covers 169.254.169.254 cloud metadata)
  'loopback',          // 127.0.0.0/8
  'carrierGradeNat',   // 100.64.0.0/10 (RFC 6598 CGNAT)
  'private',           // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 (RFC 1918)
  'reserved',          // 192.0.0.0/24, 240.0.0.0/4, etc.
  'benchmarking',      // 198.18.0.0/15 (RFC 2544)
  'amt',               // 192.52.193.0/24
  'as112',             // 192.175.48.0/24
]);

/**
 * IPv6 ranges reported by ipaddr.js that are considered private / non-routable
 * for SSRF purposes. Note: `reserved` is intentionally NOT in this list so that
 * the documentation prefix (2001:db8::/32) remains allowed for test URLs.
 */
const BLOCKED_IPV6_RANGES: ReadonlySet<string> = new Set([
  'unspecified',   // ::
  'linkLocal',     // fe80::/10
  'multicast',     // ff00::/8
  'loopback',      // ::1
  'uniqueLocal',   // fc00::/7
  // ipv4Mapped is handled explicitly via unwrap + recursive IPv4 validation
]);

/**
 * Checks if an IPv4 address is a private or internal address.
 *
 * The input MUST be a valid four-part decimal IPv4 address
 * (e.g., "192.168.1.1"). Alternate encodings are rejected upstream in
 * `isPrivateIP`.
 *
 * @param ip - The IPv4 address to check
 * @returns True if the IP is private, internal, or reserved
 */
function isPrivateIPv4(ip: string): boolean {
  const parsed = ipaddr.IPv4.parse(ip);
  return BLOCKED_IPV4_RANGES.has(parsed.range());
}

/**
 * Checks if an IPv6 address is a private or internal address. IPv4-mapped IPv6
 * addresses (`::ffff:X.X.X.X`) are unwrapped and the underlying IPv4 is
 * validated, preventing bypass via IPv6 encoding of an IPv4 private address.
 *
 * @param ip - The IPv6 address to check
 * @returns True if the IP is private, internal, or an IPv4-mapped private IPv4
 */
function isPrivateIPv6(ip: string): boolean {
  const parsed = ipaddr.IPv6.parse(ip);

  // Unwrap IPv4-mapped IPv6 (::ffff:X.X.X.X) and validate underlying IPv4.
  // Without this, an attacker could use https://[::ffff:10.0.0.1]/ to bypass
  // the IPv4 private-range check.
  if (parsed.isIPv4MappedAddress()) {
    return BLOCKED_IPV4_RANGES.has(parsed.toIPv4Address().range());
  }

  return BLOCKED_IPV6_RANGES.has(parsed.range());
}

/**
 * Checks if an IP address literal (IPv4 or IPv6) is a private or internal
 * address.
 *
 * Alternate IPv4 encodings (octal, decimal-integer, hex, shorthand) are
 * rejected by returning `true` (treat as unsafe). This is the defensive choice:
 * a URL using `https://0x7f000001/` is almost certainly an SSRF probe, and we
 * have no legitimate reason to accept it.
 *
 * @param ip - The IP address to check (literal, not a hostname)
 * @returns True if the IP is private, internal, reserved, or uses a rejected
 *   alternate encoding
 */
export function isPrivateIP(ip: string): boolean {
  // IPv6 address (contains a colon)
  if (ip.includes(':')) {
    if (!ipaddr.IPv6.isValid(ip)) {
      // Malformed IPv6 — treat as unsafe
      return true;
    }
    return isPrivateIPv6(ip);
  }

  // IPv4: reject anything that is not a strict four-part decimal literal.
  // This blocks octal (0177.0.0.1), decimal-integer (2130706433),
  // hex (0x7f000001), and shorthand (127.1) encodings.
  if (!ipaddr.IPv4.isValidFourPartDecimal(ip)) {
    return true;
  }

  return isPrivateIPv4(ip);
}

/**
 * Resolves a hostname to its IP addresses and checks if any resolve to private
 * IPs. This prevents DNS rebinding attacks where a domain resolves to a
 * private IP.
 *
 * @param hostname - The hostname to resolve and check
 * @returns Promise resolving to true if the hostname resolves to a private IP
 */
export async function resolvesToPrivateIP(hostname: string): Promise<boolean> {
  // Special case: localhost always resolves to loopback
  if (hostname === 'localhost') {
    return true;
  }

  try {
    // Resolve both IPv4 and IPv6 addresses
    const addresses: string[] = [];

    try {
      const ipv4Result = await dnsLookup(hostname, { family: 4, all: true });
      if (Array.isArray(ipv4Result)) {
        addresses.push(...ipv4Result.map((result: any) => result.address));
      }
    }
    catch {
      // IPv4 resolution failed, continue
    }

    try {
      const ipv6Result = await dnsLookup(hostname, { family: 6, all: true });
      if (Array.isArray(ipv6Result)) {
        addresses.push(...ipv6Result.map((result: any) => result.address));
      }
    }
    catch {
      // IPv6 resolution failed, continue
    }

    // Check if any resolved address is private
    return addresses.some(ip => isPrivateIP(ip));
  }
  catch (error) {
    // If DNS resolution fails, treat as potentially unsafe
    logger.error({ err: error, hostname }, 'DNS resolution failed');
    return true;
  }
}

/**
 * Validates that a URL does not point to a private or internal IP address.
 * This prevents SSRF attacks by blocking requests to internal infrastructure.
 *
 * @param url - The URL to validate
 * @returns Promise resolving to true if the URL is safe to fetch
 * @throws Error if the URL points to a private IP address or uses a rejected
 *   scheme or encoding
 */
export async function validateUrlNotPrivate(url: string): Promise<boolean> {
  try {
    const parsedUrl = new URL(url);

    // Reject non-HTTPS URLs — ActivityPub federation must use HTTPS
    if (parsedUrl.protocol !== 'https:') {
      throw new Error(`URL must use HTTPS, got: ${parsedUrl.protocol}`);
    }

    let hostname = parsedUrl.hostname;

    // Remove brackets from IPv6 addresses (e.g., [::1] -> ::1)
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      hostname = hostname.slice(1, -1);
    }

    // Check if hostname looks like an IP literal (IPv4 or IPv6).
    // ipaddr.isValid accepts both IPv4 and IPv6 literal forms — including
    // alternate IPv4 encodings like 0x7f000001. We reject those explicitly
    // via the four-part-decimal check in isPrivateIP.
    const isLikelyIpLiteral = hostname.includes(':') || /^[0-9a-fA-Fx.]+$/.test(hostname);

    if (isLikelyIpLiteral && ipaddr.isValid(hostname)) {
      if (isPrivateIP(hostname)) {
        throw new Error(`Access to private IP address ${hostname} is not allowed`);
      }
      return true;
    }

    // If the hostname looks numeric but is not valid as a literal, reject it
    // rather than letting it fall through to DNS resolution. An "IP-shaped"
    // string that ipaddr doesn't accept is malformed and should not be
    // fetched.
    if (/^\d{1,3}(\.\d{1,3}){0,3}$/.test(hostname) || /^0x[0-9a-fA-F]+$/.test(hostname)) {
      throw new Error(`Access to private IP address ${hostname} is not allowed`);
    }

    // Allow private-IP hostnames in non-production federation test environments.
    // Docker-based federation tests use private bridge-network IPs for
    // alpha.federation.local / beta.federation.local. Literal private IP
    // addresses in the URL are still rejected above regardless of this flag.
    if (process.env.ALLOW_PRIVATE_FEDERATION === 'true') {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('ALLOW_PRIVATE_FEDERATION cannot be used in production');
      }
      logger.warn('SECURITY WARNING: ALLOW_PRIVATE_FEDERATION is set - skipping DNS-based private IP check. Never use in production.');
      return true;
    }

    // Resolve hostname to IP and check
    const resolvesPrivate = await resolvesToPrivateIP(hostname);
    if (resolvesPrivate) {
      throw new Error(`Hostname ${hostname} resolves to a private IP address`);
    }

    return true;
  }
  catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to validate URL');
  }
}
