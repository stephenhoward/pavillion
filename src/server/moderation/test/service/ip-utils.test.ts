import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import {
  extractIpFromRequest,
  hashIp,
  extractSubnet,
  lookupRegion,
} from '@/server/moderation/service/ip-utils';

describe('IP Utilities', () => {
  describe('extractIpFromRequest', () => {
    it('should extract IP from req.ip', () => {
      const req = {
        ip: '192.168.1.100',
        socket: { remoteAddress: '10.0.0.1' },
      } as unknown as Request;

      const result = extractIpFromRequest(req);

      expect(result).toBe('192.168.1.100');
    });

    it('should fallback to req.socket.remoteAddress when req.ip is undefined', () => {
      const req = {
        socket: { remoteAddress: '10.0.0.1' },
      } as unknown as Request;

      const result = extractIpFromRequest(req);

      expect(result).toBe('10.0.0.1');
    });

    it('should return "unknown" when neither IP source is available', () => {
      const req = {
        socket: {},
      } as unknown as Request;

      const result = extractIpFromRequest(req);

      expect(result).toBe('unknown');
    });

    it('should handle localhost IPv4', () => {
      const req = {
        ip: '127.0.0.1',
        socket: {},
      } as unknown as Request;

      const result = extractIpFromRequest(req);

      expect(result).toBe('127.0.0.1');
    });

    it('should handle IPv6 addresses', () => {
      const req = {
        ip: '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
        socket: {},
      } as unknown as Request;

      const result = extractIpFromRequest(req);

      expect(result).toBe('2001:0db8:85a3:0000:0000:8a2e:0370:7334');
    });

    it('should handle localhost IPv6', () => {
      const req = {
        ip: '::1',
        socket: {},
      } as unknown as Request;

      const result = extractIpFromRequest(req);

      expect(result).toBe('::1');
    });
  });

  describe('hashIp', () => {
    const testSalt = 'test-salt-123';

    it('should generate consistent hash for same IP and salt', () => {
      const ip = '192.168.1.100';

      const hash1 = hashIp(ip, testSalt);
      const hash2 = hashIp(ip, testSalt);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA256 hex output is 64 chars
    });

    it('should generate different hashes for different IPs with same salt', () => {
      const ip1 = '192.168.1.100';
      const ip2 = '192.168.1.101';

      const hash1 = hashIp(ip1, testSalt);
      const hash2 = hashIp(ip2, testSalt);

      expect(hash1).not.toBe(hash2);
    });

    it('should generate different hashes for same IP with different salts', () => {
      const ip = '192.168.1.100';

      const hash1 = hashIp(ip, 'salt1');
      const hash2 = hashIp(ip, 'salt2');

      expect(hash1).not.toBe(hash2);
    });

    it('should handle IPv6 addresses', () => {
      const ip = '2001:0db8:85a3:0000:0000:8a2e:0370:7334';

      const hash = hashIp(ip, testSalt);

      expect(hash).toHaveLength(64);
    });

    it('should handle localhost addresses', () => {
      const ipv4 = '127.0.0.1';
      const ipv6 = '::1';

      const hash1 = hashIp(ipv4, testSalt);
      const hash2 = hashIp(ipv6, testSalt);

      expect(hash1).toHaveLength(64);
      expect(hash2).toHaveLength(64);
      expect(hash1).not.toBe(hash2);
    });

    it('should handle unknown IP placeholder', () => {
      const ip = 'unknown';

      const hash = hashIp(ip, testSalt);

      expect(hash).toHaveLength(64);
    });
  });

  describe('extractSubnet', () => {
    it('should extract first 3 octets from IPv4 address', () => {
      const ip = '192.168.1.100';

      const subnet = extractSubnet(ip);

      expect(subnet).toBe('192.168.1.0');
    });

    it('should handle private IPv4 ranges', () => {
      expect(extractSubnet('10.0.0.1')).toBe('10.0.0.0');
      expect(extractSubnet('172.16.0.1')).toBe('172.16.0.0');
      expect(extractSubnet('192.168.255.255')).toBe('192.168.255.0');
    });

    it('should handle localhost IPv4', () => {
      const ip = '127.0.0.1';

      const subnet = extractSubnet(ip);

      expect(subnet).toBe('127.0.0.0');
    });

    it('should extract first 64 bits from IPv6 address', () => {
      const ip = '2001:0db8:85a3:0000:0000:8a2e:0370:7334';

      const subnet = extractSubnet(ip);

      expect(subnet).toBe('2001:0db8:85a3:0000');
    });

    it('should handle compressed IPv6 addresses', () => {
      const ip = '2001:db8::1';

      const subnet = extractSubnet(ip);

      // Should expand and take first 64 bits
      expect(subnet).toBe('2001:0db8:0000:0000');
    });

    it('should handle localhost IPv6', () => {
      const ip = '::1';

      const subnet = extractSubnet(ip);

      expect(subnet).toBe('0000:0000:0000:0000');
    });

    it('should return original value for unknown IP', () => {
      const ip = 'unknown';

      const subnet = extractSubnet(ip);

      expect(subnet).toBe('unknown');
    });

    it('should handle IPv4-mapped IPv6 addresses', () => {
      const ip = '::ffff:192.168.1.100';

      const subnet = extractSubnet(ip);

      // For IPv4-mapped IPv6, extract the IPv4 subnet
      expect(subnet).toBe('192.168.1.0');
    });
  });

  describe('lookupRegion', () => {
    it('should return placeholder for public IPv4', () => {
      const ip = '8.8.8.8';

      const region = lookupRegion(ip);

      expect(region).toEqual({
        city: 'Unknown',
        country: 'Unknown',
      });
    });

    it('should return placeholder for private IPv4', () => {
      const ip = '192.168.1.100';

      const region = lookupRegion(ip);

      expect(region).toEqual({
        city: 'Unknown',
        country: 'Unknown',
      });
    });

    it('should return placeholder for localhost IPv4', () => {
      const ip = '127.0.0.1';

      const region = lookupRegion(ip);

      expect(region).toEqual({
        city: 'Unknown',
        country: 'Unknown',
      });
    });

    it('should return placeholder for IPv6', () => {
      const ip = '2001:0db8:85a3:0000:0000:8a2e:0370:7334';

      const region = lookupRegion(ip);

      expect(region).toEqual({
        city: 'Unknown',
        country: 'Unknown',
      });
    });

    it('should return placeholder for localhost IPv6', () => {
      const ip = '::1';

      const region = lookupRegion(ip);

      expect(region).toEqual({
        city: 'Unknown',
        country: 'Unknown',
      });
    });

    it('should return placeholder for unknown IP', () => {
      const ip = 'unknown';

      const region = lookupRegion(ip);

      expect(region).toEqual({
        city: 'Unknown',
        country: 'Unknown',
      });
    });
  });
});
