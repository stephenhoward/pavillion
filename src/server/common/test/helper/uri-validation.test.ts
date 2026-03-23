import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateActorUriProtocol } from '@/server/common/helper/uri-validation';

describe('validateActorUriProtocol', () => {
  describe('HTTPS protocol', () => {
    it('should return true for HTTPS URLs', () => {
      expect(validateActorUriProtocol('https://example.com/users/alice')).toBe(true);
      expect(validateActorUriProtocol('https://localhost:3000/users/alice')).toBe(true);
      expect(validateActorUriProtocol('https://events.example.org/calendars/main')).toBe(true);
    });
  });

  describe('HTTP protocol in test environment', () => {
    // NODE_ENV is 'test' when running vitest, so HTTP localhost should work
    it('should return true for HTTP localhost in test environment', () => {
      expect(validateActorUriProtocol('http://localhost:3000/users/alice')).toBe(true);
      expect(validateActorUriProtocol('http://localhost/calendars/events')).toBe(true);
    });

    it('should return true for HTTP 127.0.0.1 in test environment', () => {
      expect(validateActorUriProtocol('http://127.0.0.1:3000/users/alice')).toBe(true);
      expect(validateActorUriProtocol('http://127.0.0.1/calendars/events')).toBe(true);
    });

    it('should return false for HTTP non-localhost even in test environment', () => {
      expect(validateActorUriProtocol('http://example.com/users/alice')).toBe(false);
      expect(validateActorUriProtocol('http://events.example.org/calendars/main')).toBe(false);
    });
  });

  describe('HTTP protocol in production environment', () => {
    let originalNodeEnv: string | undefined;

    beforeEach(() => {
      originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
    });

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('should return false for HTTP localhost in production', () => {
      expect(validateActorUriProtocol('http://localhost:3000/users/alice')).toBe(false);
      expect(validateActorUriProtocol('http://127.0.0.1/calendars/events')).toBe(false);
    });

    it('should return false for HTTP non-localhost in production', () => {
      expect(validateActorUriProtocol('http://example.com/users/alice')).toBe(false);
    });

    it('should still return true for HTTPS in production', () => {
      expect(validateActorUriProtocol('https://example.com/users/alice')).toBe(true);
      expect(validateActorUriProtocol('https://localhost:3000/users/alice')).toBe(true);
    });
  });

  describe('Invalid protocols and inputs', () => {
    it('should return false for FTP protocol', () => {
      expect(validateActorUriProtocol('ftp://example.com/users/alice')).toBe(false);
    });

    it('should return false for file protocol', () => {
      expect(validateActorUriProtocol('file:///users/alice')).toBe(false);
    });

    it('should return false for invalid URLs', () => {
      expect(validateActorUriProtocol('not-a-url')).toBe(false);
      expect(validateActorUriProtocol('/users/alice')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(validateActorUriProtocol('')).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(validateActorUriProtocol(null as any)).toBe(false);
      expect(validateActorUriProtocol(undefined as any)).toBe(false);
    });
  });
});
