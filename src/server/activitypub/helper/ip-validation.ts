/**
 * IP Address Validation Utilities
 *
 * Provides utilities for validating IP addresses to prevent SSRF (Server-Side Request Forgery)
 * attacks by blocking requests to private and internal IP address ranges.
 *
 * This module blocks access to:
 * - Private IPv4 ranges (RFC 1918): 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 * - Loopback addresses: 127.0.0.0/8 (IPv4), ::1 (IPv6)
 * - Link-local addresses: 169.254.0.0/16 (IPv4), fe80::/10 (IPv6)
 * - Multicast addresses: 224.0.0.0/4 (IPv4), ff00::/8 (IPv6)
 * - Other reserved ranges
 */

import dns from 'dns';
import { promisify } from 'util';

const dnsLookup = promisify(dns.lookup);

/**
 * Checks if an IPv4 address falls within a CIDR range.
 *
 * @param ip - The IPv4 address to check (e.g., "192.168.1.1")
 * @param cidr - The CIDR range to check against (e.g., "192.168.0.0/16")
 * @returns True if the IP is within the CIDR range
 */
function isIpInCidrRange(ip: string, cidr: string): boolean {
  const [rangeIp, prefixLengthStr] = cidr.split('/');
  const prefixLength = parseInt(prefixLengthStr, 10);

  const ipParts = ip.split('.').map(Number);
  const rangeParts = rangeIp.split('.').map(Number);

  // Convert IP addresses to 32-bit integers
  const ipInt = (ipParts[0] << 24) + (ipParts[1] << 16) + (ipParts[2] << 8) + ipParts[3];
  const rangeInt = (rangeParts[0] << 24) + (rangeParts[1] << 16) + (rangeParts[2] << 8) + rangeParts[3];

  // Create subnet mask
  const mask = (-1 << (32 - prefixLength)) >>> 0;

  // Check if IP is in range
  return (ipInt & mask) === (rangeInt & mask);
}

/**
 * Checks if an IPv4 address is a private or internal address.
 *
 * @param ip - The IPv4 address to check
 * @returns True if the IP is private or internal
 */
function isPrivateIPv4(ip: string): boolean {
  // Private ranges (RFC 1918)
  const privateRanges = [
    '10.0.0.0/8',       // 10.0.0.0 - 10.255.255.255
    '172.16.0.0/12',    // 172.16.0.0 - 172.31.255.255
    '192.168.0.0/16',   // 192.168.0.0 - 192.168.255.255
  ];

  // Check private ranges
  for (const range of privateRanges) {
    if (isIpInCidrRange(ip, range)) {
      return true;
    }
  }

  // Loopback (127.0.0.0/8)
  if (isIpInCidrRange(ip, '127.0.0.0/8')) {
    return true;
  }

  // Link-local (169.254.0.0/16)
  if (isIpInCidrRange(ip, '169.254.0.0/16')) {
    return true;
  }

  // Multicast (224.0.0.0/4)
  if (isIpInCidrRange(ip, '224.0.0.0/4')) {
    return true;
  }

  // Reserved and special-purpose addresses
  // 0.0.0.0/8 - Current network (only valid as source address)
  if (isIpInCidrRange(ip, '0.0.0.0/8')) {
    return true;
  }

  // 100.64.0.0/10 - Shared Address Space (RFC 6598)
  if (isIpInCidrRange(ip, '100.64.0.0/10')) {
    return true;
  }

  // 192.0.0.0/24 - IETF Protocol Assignments
  if (isIpInCidrRange(ip, '192.0.0.0/24')) {
    return true;
  }

  // 192.0.2.0/24 - TEST-NET-1 (RFC 5737)
  if (isIpInCidrRange(ip, '192.0.2.0/24')) {
    return true;
  }

  // 198.51.100.0/24 - TEST-NET-2 (RFC 5737)
  if (isIpInCidrRange(ip, '198.51.100.0/24')) {
    return true;
  }

  // 203.0.113.0/24 - TEST-NET-3 (RFC 5737)
  if (isIpInCidrRange(ip, '203.0.113.0/24')) {
    return true;
  }

  // 240.0.0.0/4 - Reserved for future use
  if (isIpInCidrRange(ip, '240.0.0.0/4')) {
    return true;
  }

  // 255.255.255.255/32 - Broadcast address
  if (ip === '255.255.255.255') {
    return true;
  }

  return false;
}

/**
 * Checks if an IPv6 address is a private or internal address.
 *
 * @param ip - The IPv6 address to check
 * @returns True if the IP is private or internal
 */
function isPrivateIPv6(ip: string): boolean {
  // Normalize IPv6 address to lowercase
  const normalizedIp = ip.toLowerCase();

  // Loopback address ::1
  if (normalizedIp === '::1' || normalizedIp === '0:0:0:0:0:0:0:1') {
    return true;
  }

  // Link-local addresses fe80::/10
  if (normalizedIp.startsWith('fe80:') || normalizedIp.startsWith('fe8') || normalizedIp.startsWith('fe9') ||
      normalizedIp.startsWith('fea') || normalizedIp.startsWith('feb')) {
    return true;
  }

  // Unique local addresses fc00::/7 (fd00::/8 is commonly used)
  if (normalizedIp.startsWith('fc') || normalizedIp.startsWith('fd')) {
    return true;
  }

  // Multicast addresses ff00::/8
  if (normalizedIp.startsWith('ff')) {
    return true;
  }

  // Unspecified address ::
  if (normalizedIp === '::' || normalizedIp === '0:0:0:0:0:0:0:0') {
    return true;
  }

  return false;
}

/**
 * Checks if an IP address (IPv4 or IPv6) is a private or internal address.
 *
 * @param ip - The IP address to check
 * @returns True if the IP is private or internal
 */
export function isPrivateIP(ip: string): boolean {
  // Check if it's an IPv6 address
  if (ip.includes(':')) {
    return isPrivateIPv6(ip);
  }

  // Otherwise treat as IPv4
  return isPrivateIPv4(ip);
}

/**
 * Resolves a hostname to its IP addresses and checks if any resolve to private IPs.
 * This prevents DNS rebinding attacks where a domain resolves to a private IP.
 *
 * @param hostname - The hostname to resolve and check
 * @returns Promise resolving to true if the hostname resolves to a private IP
 */
export async function resolvesToPrivateIP(hostname: string): boolean {
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
    console.error(`DNS resolution failed for ${hostname}:`, error);
    return true;
  }
}

/**
 * Validates that a URL does not point to a private or internal IP address.
 * This prevents SSRF attacks by blocking requests to internal infrastructure.
 *
 * @param url - The URL to validate
 * @returns Promise resolving to true if the URL is safe to fetch
 * @throws Error if the URL points to a private IP address
 */
export async function validateUrlNotPrivate(url: string): Promise<boolean> {
  try {
    const parsedUrl = new URL(url);
    let hostname = parsedUrl.hostname;

    // Remove brackets from IPv6 addresses (e.g., [::1] -> ::1)
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      hostname = hostname.slice(1, -1);
    }

    // Check if hostname is directly an IPv4 address
    if (hostname.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)) {
      if (isPrivateIP(hostname)) {
        throw new Error(`Access to private IP address ${hostname} is not allowed`);
      }
      return true;
    }

    // Check if hostname is directly an IPv6 address (contains colons)
    if (hostname.includes(':')) {
      if (isPrivateIP(hostname)) {
        throw new Error(`Access to private IP address ${hostname} is not allowed`);
      }
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
