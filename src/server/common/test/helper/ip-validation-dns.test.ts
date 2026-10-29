/**
 * DNS-rebinding tests for resolvesToPrivateIP.
 *
 * These tests are in a separate file because vi.mock('dns') is hoisted to the
 * top of the module graph and would interfere with the real DNS calls used by
 * other ip-validation tests (e.g. the validateUrlNotPrivate tests that rely on
 * real DNS behaviour for localhost / public IPs).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// vi.mock is hoisted before all imports, so the ip-validation module will load
// with our mocked dns.lookup already in place — this means dnsLookup (which is
// created as promisify(dns.lookup) at module load time) captures the mock.
vi.mock('dns', () => ({
  default: {
    lookup: vi.fn(),
  },
}));

import dns from 'dns';
import { resolvesToPrivateIP, resolvePublicAddress, validateUrlNotPrivate } from '@/server/common/helper/ip-validation';

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

/**
 * Answer IPv4 lookups with `v4` and IPv6 lookups with `v6`; an empty list
 * fails that family with ENOTFOUND.
 */
function answer(v4: string[], v6: string[] = []) {
  vi.mocked(dns.lookup).mockImplementation((_hostname: any, options: any, callback: any) => {
    const list = options?.family === 6 ? v6 : v4;
    if (list.length === 0) {
      callback(new Error('ENOTFOUND'), []);
      return;
    }
    callback(null, list.map(address => ({ address, family: options.family })));
  });
}

describe('resolvePublicAddress', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the first address when every resolved address is public', async () => {
    answer(['93.184.216.34', '93.184.216.35'], ['2606:2800:220:1::1']);

    await expect(resolvePublicAddress('https://example.com/actor')).resolves.toBe('93.184.216.34');
  });

  it('returns an IPv6 address when the hostname has no IPv4 record', async () => {
    answer([], ['2606:2800:220:1::1']);

    await expect(resolvePublicAddress('https://example.com/actor')).resolves.toBe('2606:2800:220:1::1');
  });

  it('rejects when any resolved address is private, even if the first is public', async () => {
    answer(['93.184.216.34'], ['fd00::1']);

    await expect(resolvePublicAddress('https://evil.example/actor')).rejects.toThrow(
      'resolves to a private IP address',
    );
  });

  it('rejects a hostname that resolves to nothing, since there is no address to pin', async () => {
    answer([]);

    await expect(resolvePublicAddress('https://nowhere.example/actor')).rejects.toThrow(
      'did not resolve to any address',
    );
  });

  it('returns a public IP literal as-is without resolving it', async () => {
    vi.mocked(dns.lookup).mockClear();

    await expect(resolvePublicAddress('https://8.8.8.8/actor')).resolves.toBe('8.8.8.8');
    await expect(resolvePublicAddress('https://[2606:4700::1111]/actor')).resolves.toBe('2606:4700::1111');
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it('returns the first address without the private check under ALLOW_PRIVATE_FEDERATION', async () => {
    vi.stubEnv('ALLOW_PRIVATE_FEDERATION', 'true');
    vi.stubEnv('NODE_ENV', 'test');
    answer(['172.18.0.4']);

    await expect(resolvePublicAddress('https://alpha.federation.local/actor')).resolves.toBe('172.18.0.4');
  });

  it('is what validateUrlNotPrivate checks: a rejected address rejects both', async () => {
    answer(['10.0.0.5']);

    await expect(validateUrlNotPrivate('https://evil.example/actor')).rejects.toThrow(
      'resolves to a private IP address',
    );

    answer(['93.184.216.34']);
    await expect(validateUrlNotPrivate('https://example.com/actor')).resolves.toBe(true);
  });

  it('leaves validateUrlNotPrivate passing a hostname that resolves to nothing', async () => {
    // The boolean form opens no connection, so an unresolvable name is not a
    // reason to reject; only the pinning form needs an address to return.
    answer([]);

    await expect(validateUrlNotPrivate('https://nowhere.example/actor')).resolves.toBe(true);
  });
});
