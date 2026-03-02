import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import dns from 'dns';
import { promisify } from 'util';
import * as ipValidation from '@/server/activitypub/helper/ip-validation';
import { isPrivateIP } from '@/server/activitypub/helper/ip-validation';

describe('IP Validation', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
    vi.restoreAllMocks();
  });

  describe('isPrivateIP', () => {
    describe('IPv4 Private Ranges (RFC 1918)', () => {
      it('should block 10.0.0.0/8 range', () => {
        expect(isPrivateIP('10.0.0.0')).toBe(true);
        expect(isPrivateIP('10.0.0.1')).toBe(true);
        expect(isPrivateIP('10.255.255.255')).toBe(true);
        expect(isPrivateIP('10.123.45.67')).toBe(true);
      });

      it('should block 172.16.0.0/12 range', () => {
        expect(isPrivateIP('172.16.0.0')).toBe(true);
        expect(isPrivateIP('172.16.0.1')).toBe(true);
        expect(isPrivateIP('172.31.255.255')).toBe(true);
        expect(isPrivateIP('172.20.10.5')).toBe(true);
      });

      it('should block 192.168.0.0/16 range', () => {
        expect(isPrivateIP('192.168.0.0')).toBe(true);
        expect(isPrivateIP('192.168.0.1')).toBe(true);
        expect(isPrivateIP('192.168.255.255')).toBe(true);
        expect(isPrivateIP('192.168.1.100')).toBe(true);
      });
    });

    describe('IPv4 Loopback', () => {
      it('should block 127.0.0.0/8 range', () => {
        expect(isPrivateIP('127.0.0.0')).toBe(true);
        expect(isPrivateIP('127.0.0.1')).toBe(true);
        expect(isPrivateIP('127.255.255.255')).toBe(true);
        expect(isPrivateIP('127.123.45.67')).toBe(true);
      });
    });

    describe('IPv4 Link-Local', () => {
      it('should block 169.254.0.0/16 range', () => {
        expect(isPrivateIP('169.254.0.0')).toBe(true);
        expect(isPrivateIP('169.254.0.1')).toBe(true);
        expect(isPrivateIP('169.254.255.255')).toBe(true);
        expect(isPrivateIP('169.254.169.254')).toBe(true); // AWS metadata service
      });
    });

    describe('IPv4 Multicast', () => {
      it('should block 224.0.0.0/4 range', () => {
        expect(isPrivateIP('224.0.0.0')).toBe(true);
        expect(isPrivateIP('224.0.0.1')).toBe(true);
        expect(isPrivateIP('239.255.255.255')).toBe(true);
        expect(isPrivateIP('230.123.45.67')).toBe(true);
      });
    });

    describe('IPv4 Reserved Ranges', () => {
      it('should block 0.0.0.0/8 range', () => {
        expect(isPrivateIP('0.0.0.0')).toBe(true);
        expect(isPrivateIP('0.0.0.1')).toBe(true);
        expect(isPrivateIP('0.255.255.255')).toBe(true);
      });

      it('should block 100.64.0.0/10 range (Shared Address Space)', () => {
        expect(isPrivateIP('100.64.0.0')).toBe(true);
        expect(isPrivateIP('100.64.0.1')).toBe(true);
        expect(isPrivateIP('100.127.255.255')).toBe(true);
      });

      it('should block 192.0.0.0/24 range (IETF Protocol Assignments)', () => {
        expect(isPrivateIP('192.0.0.0')).toBe(true);
        expect(isPrivateIP('192.0.0.1')).toBe(true);
        expect(isPrivateIP('192.0.0.255')).toBe(true);
      });

      it('should block 192.0.2.0/24 range (TEST-NET-1)', () => {
        expect(isPrivateIP('192.0.2.0')).toBe(true);
        expect(isPrivateIP('192.0.2.1')).toBe(true);
        expect(isPrivateIP('192.0.2.255')).toBe(true);
      });

      it('should block 198.51.100.0/24 range (TEST-NET-2)', () => {
        expect(isPrivateIP('198.51.100.0')).toBe(true);
        expect(isPrivateIP('198.51.100.1')).toBe(true);
        expect(isPrivateIP('198.51.100.255')).toBe(true);
      });

      it('should block 203.0.113.0/24 range (TEST-NET-3)', () => {
        expect(isPrivateIP('203.0.113.0')).toBe(true);
        expect(isPrivateIP('203.0.113.1')).toBe(true);
        expect(isPrivateIP('203.0.113.255')).toBe(true);
      });

      it('should block 240.0.0.0/4 range (Reserved)', () => {
        expect(isPrivateIP('240.0.0.0')).toBe(true);
        expect(isPrivateIP('240.0.0.1')).toBe(true);
        expect(isPrivateIP('255.255.255.254')).toBe(true);
      });

      it('should block 255.255.255.255 (Broadcast)', () => {
        expect(isPrivateIP('255.255.255.255')).toBe(true);
      });
    });

    describe('IPv4 Public Addresses', () => {
      it('should allow public IPv4 addresses', () => {
        expect(isPrivateIP('8.8.8.8')).toBe(false); // Google DNS
        expect(isPrivateIP('1.1.1.1')).toBe(false); // Cloudflare DNS
        expect(isPrivateIP('93.184.216.34')).toBe(false); // example.com
        expect(isPrivateIP('151.101.1.69')).toBe(false); // reddit.com
        expect(isPrivateIP('172.15.255.255')).toBe(false); // Just outside 172.16.0.0/12
        expect(isPrivateIP('172.32.0.0')).toBe(false); // Just outside 172.16.0.0/12
      });
    });

    describe('IPv6 Addresses', () => {
      it('should block ::1 loopback address', () => {
        expect(isPrivateIP('::1')).toBe(true);
        expect(isPrivateIP('0:0:0:0:0:0:0:1')).toBe(true);
      });

      it('should block :: unspecified address', () => {
        expect(isPrivateIP('::')).toBe(true);
        expect(isPrivateIP('0:0:0:0:0:0:0:0')).toBe(true);
      });

      it('should block fe80::/10 link-local addresses', () => {
        expect(isPrivateIP('fe80::1')).toBe(true);
        expect(isPrivateIP('fe80:0000:0000:0000:0000:0000:0000:0001')).toBe(true);
        expect(isPrivateIP('fe80::a00:27ff:fe4e:66a1')).toBe(true);
        expect(isPrivateIP('fe90::1')).toBe(true);
        expect(isPrivateIP('fea0::1')).toBe(true);
        expect(isPrivateIP('feb0::1')).toBe(true);
      });

      it('should block fc00::/7 unique local addresses', () => {
        expect(isPrivateIP('fc00::1')).toBe(true);
        expect(isPrivateIP('fd00::1')).toBe(true);
        expect(isPrivateIP('fd12:3456:789a:1::1')).toBe(true);
      });

      it('should block ff00::/8 multicast addresses', () => {
        expect(isPrivateIP('ff00::1')).toBe(true);
        expect(isPrivateIP('ff02::1')).toBe(true);
        expect(isPrivateIP('ffff::1')).toBe(true);
      });

      it('should allow public IPv6 addresses', () => {
        expect(isPrivateIP('2001:4860:4860::8888')).toBe(false); // Google DNS
        expect(isPrivateIP('2606:4700:4700::1111')).toBe(false); // Cloudflare DNS
        expect(isPrivateIP('2001:db8::1')).toBe(false); // Documentation prefix (not reserved)
      });
    });
  });

  describe('resolvesToPrivateIP', () => {
    it('should detect localhost', async () => {
      const result = await ipValidation.resolvesToPrivateIP('localhost');
      expect(result).toBe(true);
    });

    // Note: The remaining tests in this section would require mocking promisified DNS lookup
    // which is complex due to how promisify works. The real-world behavior is tested through
    // integration tests and the validateUrlNotPrivate function tests below.
    // The isPrivateIP function tests above cover the core IP validation logic.
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
