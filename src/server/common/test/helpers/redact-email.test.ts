import { describe, it, expect } from 'vitest';
import { redactEmail } from '@/server/common/helpers/redact-email';

describe('redactEmail', () => {
  describe('valid email addresses', () => {
    it('should redact a standard email address', () => {
      expect(redactEmail('admin@example.com')).toBe('ad***@example.com');
    });

    it('should redact email with long local part', () => {
      expect(redactEmail('administrator@example.com')).toBe('ad***@example.com');
    });

    it('should redact email with short local part (2 chars)', () => {
      expect(redactEmail('ab@example.com')).toBe('ab***@example.com');
    });

    it('should redact email with single character local part', () => {
      expect(redactEmail('a@example.com')).toBe('a***@example.com');
    });

    it('should preserve the full domain', () => {
      expect(redactEmail('user@subdomain.example.com')).toBe('us***@subdomain.example.com');
    });

    it('should handle email with numbers in local part', () => {
      expect(redactEmail('user123@example.com')).toBe('us***@example.com');
    });

    it('should handle email with special characters in local part', () => {
      expect(redactEmail('user.name+tag@example.com')).toBe('us***@example.com');
    });

    it('should handle email with hyphen in domain', () => {
      expect(redactEmail('user@my-domain.com')).toBe('us***@my-domain.com');
    });
  });

  describe('invalid email formats', () => {
    it('should return "unknown" for email without @ symbol', () => {
      expect(redactEmail('notanemail')).toBe('unknown');
    });

    it('should return "unknown" for email with multiple @ symbols', () => {
      expect(redactEmail('user@@example.com')).toBe('unknown');
    });

    it('should return "unknown" for email starting with @', () => {
      expect(redactEmail('@example.com')).toBe('unknown');
    });

    it('should return "unknown" for email ending with @', () => {
      expect(redactEmail('user@')).toBe('unknown');
    });

    it('should return "unknown" for email with only @', () => {
      expect(redactEmail('@')).toBe('unknown');
    });

    it('should return "unknown" for email with spaces', () => {
      expect(redactEmail('user @example.com')).toBe('unknown');
      expect(redactEmail('user@ example.com')).toBe('unknown');
    });
  });

  describe('undefined, null, and empty values', () => {
    it('should return "unknown" for undefined', () => {
      expect(redactEmail(undefined)).toBe('unknown');
    });

    it('should return "unknown" for empty string', () => {
      expect(redactEmail('')).toBe('unknown');
    });

    it('should return "unknown" for whitespace-only string', () => {
      expect(redactEmail('   ')).toBe('unknown');
    });
  });

  describe('non-string values', () => {
    // Forged request bodies can carry non-string credential values. redactEmail
    // must redact these to 'unknown' rather than throwing on .trim() (which
    // would degrade an over-limit 429 into a 500) or leaking the forged shape.
    it('should return "unknown" for an object', () => {
      expect(redactEmail({ x: 1 })).toBe('unknown');
    });

    it('should return "unknown" for a number', () => {
      expect(redactEmail(42)).toBe('unknown');
    });

    it('should return "unknown" for null', () => {
      expect(redactEmail(null)).toBe('unknown');
    });

    it('should return "unknown" for an array (no redaction bypass)', () => {
      // String(['x@y.com']) coerces to 'x@y.com'; the typeof guard prevents
      // an array-wrapped address from bypassing redaction.
      expect(redactEmail(['x@y.com'])).toBe('unknown');
    });
  });

  describe('edge cases', () => {
    it('should handle email with very long domain', () => {
      const longDomain = 'a'.repeat(50) + '.com';
      expect(redactEmail(`user@${longDomain}`)).toBe(`us***@${longDomain}`);
    });

    it('should handle email with IP address as domain', () => {
      expect(redactEmail('user@192.168.1.1')).toBe('us***@192.168.1.1');
    });

    it('should handle email with subdomain', () => {
      expect(redactEmail('user@mail.example.co.uk')).toBe('us***@mail.example.co.uk');
    });

    it('should handle email with uppercase letters', () => {
      expect(redactEmail('User@Example.COM')).toBe('Us***@Example.COM');
    });

    it('should handle email with dots in local part', () => {
      expect(redactEmail('first.last@example.com')).toBe('fi***@example.com');
    });

    it('should handle email with plus addressing', () => {
      expect(redactEmail('user+tag@example.com')).toBe('us***@example.com');
    });
  });
});
