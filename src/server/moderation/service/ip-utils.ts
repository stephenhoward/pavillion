import { createHmac } from 'crypto';
import type { Request } from 'express';
import config from 'config';

/**
 * Region information returned by IP geolocation lookup.
 */
export interface RegionInfo {
  city: string;
  country: string;
}

/**
 * Extracts IP address from Express request object.
 *
 * Tries to get IP from req.ip first (which handles proxies via Express trust proxy),
 * then falls back to req.socket.remoteAddress for direct connections.
 *
 * @param req - Express request object
 * @returns IP address string or "unknown" if not available
 *
 * @example
 * const ip = extractIpFromRequest(req);
 * // => "192.168.1.100" or "::1" or "unknown"
 */
export function extractIpFromRequest(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Generates a salted HMAC-SHA256 hash of an IP address.
 *
 * Uses the configured salt from config moderation.emailHashSecret
 * (or custom salt parameter) to create a privacy-preserving hash.
 * Same IP + salt always produces same hash for tracking purposes.
 *
 * @param ip - IP address to hash
 * @param salt - Secret salt for HMAC (defaults to config value)
 * @returns Hex-encoded HMAC-SHA256 hash (64 characters)
 *
 * @example
 * const hashedIp = hashIp("192.168.1.100");
 * // => "a3f5b2c1..." (64 char hex string)
 */
export function hashIp(ip: string, salt?: string): string {
  const secret = salt ?? config.get<string>('moderation.emailHashSecret');
  return createHmac('sha256', secret)
    .update(ip)
    .digest('hex');
}

/**
 * Extracts subnet prefix from an IP address.
 *
 * For IPv4: Returns first 3 octets with .0 suffix (e.g., "192.168.1.0")
 * For IPv6: Returns first 64 bits (first 4 groups)
 * For IPv4-mapped IPv6 (::ffff:x.x.x.x): Extracts IPv4 subnet
 *
 * @param ip - IPv4 or IPv6 address
 * @returns Subnet prefix string
 *
 * @example
 * extractSubnet("192.168.1.100") // => "192.168.1.0"
 * extractSubnet("2001:db8::1")   // => "2001:0db8:0000:0000"
 * extractSubnet("::ffff:192.168.1.100") // => "192.168.1.0"
 */
export function extractSubnet(ip: string): string {
  // Handle IPv4
  if (ip.includes('.') && !ip.includes('::ffff:')) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    }
  }

  // Handle IPv4-mapped IPv6 (::ffff:192.168.1.100)
  if (ip.includes('::ffff:')) {
    const ipv4Part = ip.split('::ffff:')[1];
    if (ipv4Part && ipv4Part.includes('.')) {
      const parts = ipv4Part.split('.');
      if (parts.length === 4) {
        return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
      }
    }
  }

  // Handle IPv6
  if (ip.includes(':')) {
    // Expand compressed IPv6 notation
    const expandedIp = expandIPv6(ip);
    const groups = expandedIp.split(':');

    // Return first 64 bits (first 4 groups)
    if (groups.length >= 4) {
      return groups.slice(0, 4).join(':');
    }
  }

  // Fallback for unknown format
  return ip;
}

/**
 * Expands compressed IPv6 notation to full form.
 *
 * Converts "2001:db8::1" to "2001:0db8:0000:0000:0000:0000:0000:0001"
 *
 * @param ip - IPv6 address (possibly compressed)
 * @returns Fully expanded IPv6 address
 */
function expandIPv6(ip: string): string {
  // Handle IPv4-mapped IPv6 separately
  if (ip.includes('.')) {
    return ip;
  }

  // Split on ::
  const parts = ip.split('::');

  if (parts.length === 1) {
    // No compression, just pad each group
    return ip.split(':')
      .map(group => group.padStart(4, '0'))
      .join(':');
  }

  // Handle :: compression
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts[1] ? parts[1].split(':') : [];

  // Calculate number of zero groups
  const totalGroups = 8;
  const zeroGroups = totalGroups - left.length - right.length;

  // Build expanded groups
  const leftPadded = left.map(g => g.padStart(4, '0'));
  const zeros = Array(zeroGroups).fill('0000');
  const rightPadded = right.map(g => g.padStart(4, '0'));

  return [...leftPadded, ...zeros, ...rightPadded].join(':');
}

/**
 * Looks up geographic region information for an IP address.
 *
 * PLACEHOLDER IMPLEMENTATION: Currently returns "Unknown" for all IPs.
 * Future enhancement: Integrate with GeoIP database (MaxMind, IP2Location, etc.)
 *
 * @param _ip - IP address to lookup
 * @returns Region information with city and country
 *
 * @example
 * const region = lookupRegion("8.8.8.8");
 * // => { city: "Unknown", country: "Unknown" }
 */
export function lookupRegion(_ip: string): RegionInfo {
  // Placeholder implementation
  // Future: Integrate with GeoIP database (MaxMind, IP2Location, etc.)
  return {
    city: 'Unknown',
    country: 'Unknown',
  };
}
