import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import * as ipValidation from '@/server/common/helper/ip-validation';
import { isPrivateIP } from '@/server/common/helper/ip-validation';

/**
 * Parameterized SSRF fixture.
 *
 * Each entry: [input, blocked, reason]
 *   input   — the literal or hostname-shaped value passed to isPrivateIP
 *   blocked — expected return of isPrivateIP (true = treated as unsafe)
 *   reason  — human-readable category used for assertion messaging
 *
 * Coverage per testing-advisor:
 *   - literal loopback (IPv4 + IPv6)
 *   - full RFC 1918 ranges (all three, including 172.16-31 boundary)
 *   - link-local incl. cloud metadata (169.254.169.254)
 *   - CGNAT (100.64.0.0/10)
 *   - IPv4-mapped IPv6 (both private and public underlying)
 *   - alternate IPv4 encodings (octal, decimal integer, hex, shorthand)
 *   - valid public IPv4 and IPv6 (positive cases)
 *   - full RFC 1918 / reserved boundary tests
 */
type SsrfFixture = readonly [input: string, blocked: boolean, reason: string];

const SSRF_FIXTURES: readonly SsrfFixture[] = [
  // --- Loopback (literal)
  ['127.0.0.1', true, 'IPv4 loopback'],
  ['127.255.255.255', true, 'IPv4 loopback (top of range)'],
  ['::1', true, 'IPv6 loopback'],
  ['0:0:0:0:0:0:0:1', true, 'IPv6 loopback (expanded)'],

  // --- RFC 1918 private
  ['10.0.0.0', true, 'RFC 1918 10/8 (bottom)'],
  ['10.255.255.255', true, 'RFC 1918 10/8 (top)'],
  ['172.16.0.0', true, 'RFC 1918 172.16/12 (bottom)'],
  ['172.20.10.5', true, 'RFC 1918 172.16/12 (middle)'],
  ['172.31.255.255', true, 'RFC 1918 172.16/12 (top)'],
  ['192.168.0.0', true, 'RFC 1918 192.168/16 (bottom)'],
  ['192.168.1.100', true, 'RFC 1918 192.168/16 (middle)'],
  ['192.168.255.255', true, 'RFC 1918 192.168/16 (top)'],

  // --- Link-local / cloud metadata
  ['169.254.0.0', true, 'IPv4 link-local (bottom)'],
  ['169.254.169.254', true, 'AWS/GCP/Azure instance metadata endpoint'],
  ['169.254.255.255', true, 'IPv4 link-local (top)'],
  ['fe80::1', true, 'IPv6 link-local'],
  ['fe80::a00:27ff:fe4e:66a1', true, 'IPv6 link-local (MAC-derived)'],

  // --- Unique local IPv6 (fc00::/7)
  ['fc00::1', true, 'IPv6 unique local fc00::/8'],
  ['fd00::1', true, 'IPv6 unique local fd00::/8'],
  ['fd12:3456:789a:1::1', true, 'IPv6 unique local (realistic)'],

  // --- CGNAT (RFC 6598)
  ['100.64.0.0', true, 'CGNAT 100.64/10 (bottom)'],
  ['100.64.0.1', true, 'CGNAT 100.64/10'],
  ['100.127.255.255', true, 'CGNAT 100.64/10 (top)'],

  // --- IPv4-mapped IPv6 (SSRF bypass attempt)
  ['::ffff:127.0.0.1', true, 'IPv4-mapped loopback'],
  ['::ffff:10.0.0.1', true, 'IPv4-mapped RFC 1918'],
  ['::ffff:169.254.169.254', true, 'IPv4-mapped metadata endpoint'],

  // --- Multicast + broadcast
  ['224.0.0.1', true, 'IPv4 multicast'],
  ['239.255.255.255', true, 'IPv4 multicast (top)'],
  ['ff02::1', true, 'IPv6 multicast'],
  ['255.255.255.255', true, 'IPv4 broadcast'],

  // --- Reserved / unspecified
  ['0.0.0.0', true, 'IPv4 unspecified (this network)'],
  ['::', true, 'IPv6 unspecified'],
  ['240.0.0.0', true, 'IPv4 reserved (240/4)'],
  ['192.0.2.1', true, 'TEST-NET-1'],
  ['198.51.100.1', true, 'TEST-NET-2'],
  ['203.0.113.1', true, 'TEST-NET-3'],

  // --- Alternate IPv4 encodings (MUST be rejected even in "literal" form)
  ['0177.0.0.1', true, 'octal-encoded 127.0.0.1'],
  ['2130706433', true, 'decimal-integer-encoded 127.0.0.1'],
  ['0x7f000001', true, 'hex-encoded 127.0.0.1'],
  ['127.1', true, 'shorthand-encoded 127.0.0.1'],
  ['0x1', true, 'hex literal (malformed/alt encoding)'],

  // --- Malformed / unparseable input
  ['not-an-ip', true, 'non-IP string (fallthrough to IPv4 path, rejected)'],
  ['999.999.999.999', true, 'malformed IPv4'],
  ['fe80:::1', true, 'malformed IPv6'],

  // --- Positive cases: valid public IPv4
  ['8.8.8.8', false, 'Google DNS'],
  ['1.1.1.1', false, 'Cloudflare DNS'],
  ['93.184.216.34', false, 'example.com'],
  ['151.101.1.69', false, 'reddit.com CDN'],
  ['172.15.255.255', false, 'just outside RFC 1918 172.16/12 lower boundary'],
  ['172.32.0.0', false, 'just outside RFC 1918 172.16/12 upper boundary'],
  ['100.63.255.255', false, 'just outside CGNAT 100.64/10 lower boundary'],
  ['100.128.0.0', false, 'just outside CGNAT 100.64/10 upper boundary'],

  // --- Positive cases: valid public IPv6
  ['2001:4860:4860::8888', false, 'Google public DNS IPv6'],
  ['2606:4700:4700::1111', false, 'Cloudflare public DNS IPv6'],

  // --- IPv4-mapped IPv6 with PUBLIC underlying (should pass)
  ['::ffff:8.8.8.8', false, 'IPv4-mapped public IPv4'],
];

describe('IP Validation', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
    vi.restoreAllMocks();
  });

  describe('isPrivateIP (SSRF fixture table)', () => {
    it.each(SSRF_FIXTURES)(
      '%s -> blocked=%s (%s)',
      (input, blocked, reason) => {
        const actual = isPrivateIP(input);
        expect(actual, `expected ${input} to be ${blocked ? 'blocked' : 'allowed'}: ${reason}`).toBe(blocked);
      },
    );
  });

  describe('resolvesToPrivateIP', () => {
    it('should detect localhost', async () => {
      const result = await ipValidation.resolvesToPrivateIP('localhost');
      expect(result).toBe(true);
    });

    // Additional DNS-based tests live in ip-validation-dns.test.ts because
    // vi.mock('dns') must be hoisted before the module under test is loaded,
    // and mocking dns globally in this file would break the real-DNS tests
    // in validateUrlNotPrivate below.
  });

  describe('validateUrlNotPrivate', () => {
    it('should reject URLs with private IPv4 addresses', async () => {
      // http:// URLs are blocked by the HTTPS-only check before the IP check runs
      await expect(ipValidation.validateUrlNotPrivate('http://10.0.0.1/api')).rejects.toThrow(
        'URL must use HTTPS',
      );
      // https:// with private IP is blocked by the IP check
      await expect(ipValidation.validateUrlNotPrivate('https://192.168.1.1/api')).rejects.toThrow(
        'Access to private IP address 192.168.1.1 is not allowed',
      );
      await expect(ipValidation.validateUrlNotPrivate('http://127.0.0.1:3000')).rejects.toThrow(
        'URL must use HTTPS',
      );
      await expect(ipValidation.validateUrlNotPrivate('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
        'URL must use HTTPS',
      );
    });

    it('should reject URLs with private IPv6 addresses', async () => {
      // http:// URLs are blocked by the HTTPS-only check before the IP check runs
      await expect(ipValidation.validateUrlNotPrivate('http://[::1]/api')).rejects.toThrow(
        'URL must use HTTPS',
      );
      // https:// with private IPv6 is blocked by the IP check
      await expect(ipValidation.validateUrlNotPrivate('https://[::1]/api')).rejects.toThrow(
        'Access to private IP address ::1 is not allowed',
      );
      await expect(ipValidation.validateUrlNotPrivate('https://[fe80::1]/api')).rejects.toThrow(
        'Access to private IP address fe80::1 is not allowed',
      );
      await expect(ipValidation.validateUrlNotPrivate('https://[fc00::1]/api')).rejects.toThrow(
        'Access to private IP address fc00::1 is not allowed',
      );
    });

    it('should reject IPv4-mapped IPv6 URLs pointing to private IPv4', async () => {
      // URL class preserves ::ffff: notation in brackets. The underlying
      // private IPv4 must be unwrapped and rejected.
      await expect(ipValidation.validateUrlNotPrivate('https://[::ffff:10.0.0.1]/api')).rejects.toThrow(
        /Access to private IP address/,
      );
    });

    it('should reject URLs using alternate IPv4 literal encodings that normalize to private IPs', async () => {
      // Node's URL class normalizes these alternate encodings to 127.0.0.1
      // before we see them, so the loopback check rejects the normalized form.
      await expect(ipValidation.validateUrlNotPrivate('https://0177.0.0.1/api')).rejects.toThrow(
        /Access to private IP address/,
      );
      await expect(ipValidation.validateUrlNotPrivate('https://2130706433/api')).rejects.toThrow(
        /Access to private IP address/,
      );
      await expect(ipValidation.validateUrlNotPrivate('https://0x7f000001/api')).rejects.toThrow(
        /Access to private IP address/,
      );
      await expect(ipValidation.validateUrlNotPrivate('https://127.1/api')).rejects.toThrow(
        /Access to private IP address/,
      );
    });

    it('should allow URLs with public IP addresses', async () => {
      const result = await ipValidation.validateUrlNotPrivate('https://8.8.8.8/api');
      expect(result).toBe(true);
    });

    it('should handle invalid URLs', async () => {
      await expect(ipValidation.validateUrlNotPrivate('not-a-url')).rejects.toThrow();
    });

    it('should reject localhost hostname', async () => {
      // http:// is blocked by the HTTPS-only check
      await expect(ipValidation.validateUrlNotPrivate('http://localhost:3000/api')).rejects.toThrow(
        'URL must use HTTPS',
      );
      // https:// with localhost is blocked by the private IP check
      await expect(ipValidation.validateUrlNotPrivate('https://localhost:3000/api')).rejects.toThrow(
        'Hostname localhost resolves to a private IP address',
      );
    });

    describe('ALLOW_PRIVATE_FEDERATION bypass', () => {
      const originalEnv = process.env.NODE_ENV;
      const originalFlag = process.env.ALLOW_PRIVATE_FEDERATION;

      afterEach(() => {
        process.env.NODE_ENV = originalEnv;
        if (originalFlag === undefined) {
          delete process.env.ALLOW_PRIVATE_FEDERATION;
        }
        else {
          process.env.ALLOW_PRIVATE_FEDERATION = originalFlag;
        }
      });

      it('should skip DNS check when ALLOW_PRIVATE_FEDERATION=true in non-production', async () => {
        process.env.ALLOW_PRIVATE_FEDERATION = 'true';
        process.env.NODE_ENV = 'federation';
        // localhost would normally fail DNS resolution to a private IP,
        // but ALLOW_PRIVATE_FEDERATION skips that check
        const result = await ipValidation.validateUrlNotPrivate('https://localhost/api');
        expect(result).toBe(true);
      });

      it('should still block literal private IPs even with ALLOW_PRIVATE_FEDERATION=true', async () => {
        process.env.ALLOW_PRIVATE_FEDERATION = 'true';
        process.env.NODE_ENV = 'federation';
        await expect(ipValidation.validateUrlNotPrivate('https://172.18.0.4/api')).rejects.toThrow(
          'Access to private IP address 172.18.0.4 is not allowed',
        );
      });

      it('should throw when ALLOW_PRIVATE_FEDERATION=true in production', async () => {
        process.env.ALLOW_PRIVATE_FEDERATION = 'true';
        process.env.NODE_ENV = 'production';
        await expect(ipValidation.validateUrlNotPrivate('https://localhost/api')).rejects.toThrow(
          'ALLOW_PRIVATE_FEDERATION cannot be used in production',
        );
      });
    });

    // Note: Testing DNS resolution requires mocking promisified dns.lookup which is complex.
    // The core IP validation logic is thoroughly tested above with isPrivateIP tests.
    // Integration tests with http_signature.test.ts cover the end-to-end behavior.
  });
});
