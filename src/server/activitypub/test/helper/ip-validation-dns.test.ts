/**
 * DNS-rebinding tests for resolvesToPrivateIP.
 *
 * These tests are in a separate file because vi.mock('dns') is hoisted to the
 * top of the module graph and would interfere with the real DNS calls used by
 * other ip-validation tests (e.g. the validateUrlNotPrivate tests that rely on
 * real DNS behaviour for localhost / public IPs).
 */
import { describe, it, expect, vi } from 'vitest';

// vi.mock is hoisted before all imports, so the ip-validation module will load
// with our mocked dns.lookup already in place — this means dnsLookup (which is
// created as promisify(dns.lookup) at module load time) captures the mock.
vi.mock('dns', () => ({
  default: {
    lookup: vi.fn(),
  },
}));

import dns from 'dns';
import { resolvesToPrivateIP } from '@/server/activitypub/helper/ip-validation';

describe('resolvesToPrivateIP - DNS rebinding', () => {
  it('should return true when hostname resolves to a private IPv4 address', async () => {
    // Simulate a DNS rebinding attack: attacker registers a public domain but
    // its A record points to an internal IP (10.0.0.5).
    // dns.lookup with { all: true } calls the callback as:
    //   callback(null, [{address, family}, ...])
    vi.mocked(dns.lookup).mockImplementation((_hostname: any, _options: any, callback: any) => {
      // IPv4 family=4 call: simulate resolving to a private address
      if (_options && _options.family === 4) {
        callback(null, [{ address: '10.0.0.5', family: 4 }]);
      }
      else {
        // IPv6 family=6 call: simulate no results
        callback(new Error('ENOTFOUND'), []);
      }
    });

    const result = await resolvesToPrivateIP('evil.example.com');
    expect(result).toBe(true);
  });

  it('should return false when hostname resolves only to public IP addresses', async () => {
    vi.mocked(dns.lookup).mockImplementation((_hostname: any, _options: any, callback: any) => {
      if (_options && _options.family === 4) {
        callback(null, [{ address: '93.184.216.34', family: 4 }]); // example.com public IP
      }
      else {
        callback(new Error('ENOTFOUND'), []);
      }
    });

    const result = await resolvesToPrivateIP('example.com');
    expect(result).toBe(false);
  });
});
