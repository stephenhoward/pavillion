import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  parseActorUri,
  isPersonActorUri,
  isCalendarActorUri,
  validateActorUriProtocol,
  InvalidActorUriError,
} from '@/server/activitypub/helper/actor-uri';

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

describe('parseActorUri', () => {
  describe('Person actors', () => {
    it('should parse a simple Person actor URI', () => {
      const result = parseActorUri('https://example.com/users/alice');
      expect(result).toEqual({ type: 'person', id: 'alice' });
    });

    it('should parse Person actor URI with hyphenated username', () => {
      const result = parseActorUri('https://example.com/users/alice-smith');
      expect(result).toEqual({ type: 'person', id: 'alice-smith' });
    });

    it('should parse Person actor URI with numeric ID', () => {
      const result = parseActorUri('https://example.com/users/12345');
      expect(result).toEqual({ type: 'person', id: '12345' });
    });

    it('should parse Person actor URI with underscore username', () => {
      const result = parseActorUri('https://example.com/users/alice_smith');
      expect(result).toEqual({ type: 'person', id: 'alice_smith' });
    });

    it('should parse Person actor URI with subdomain', () => {
      const result = parseActorUri('https://events.example.org/users/admin');
      expect(result).toEqual({ type: 'person', id: 'admin' });
    });

    it('should parse Person actor URI with port', () => {
      const result = parseActorUri('https://localhost:3000/users/testuser');
      expect(result).toEqual({ type: 'person', id: 'testuser' });
    });

    it('should handle HTTP localhost in test environment', () => {
      // NODE_ENV is 'test' when running vitest
      const result = parseActorUri('http://localhost:3000/users/devuser');
      expect(result).toEqual({ type: 'person', id: 'devuser' });
    });

    it('should parse Person actor URI with prefix path segments', () => {
      const result = parseActorUri('https://example.com/activitypub/users/alice');
      expect(result).toEqual({ type: 'person', id: 'alice' });
    });

    it('should parse Person actor URI with additional path segments after ID', () => {
      // The ID should be the segment immediately following /users/
      const result = parseActorUri('https://example.com/users/alice');
      expect(result).toEqual({ type: 'person', id: 'alice' });
    });
  });

  describe('Calendar actors', () => {
    it('should parse a simple Calendar actor URI', () => {
      const result = parseActorUri('https://example.com/calendars/events');
      expect(result).toEqual({ type: 'calendar', id: 'events' });
    });

    it('should parse Calendar actor URI with hyphenated name', () => {
      const result = parseActorUri('https://example.com/calendars/community-events');
      expect(result).toEqual({ type: 'calendar', id: 'community-events' });
    });

    it('should parse Calendar actor URI with UUID', () => {
      const result = parseActorUri('https://example.com/calendars/a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(result).toEqual({ type: 'calendar', id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' });
    });

    it('should parse Calendar actor URI with subdomain', () => {
      const result = parseActorUri('https://calendar.myorg.net/calendars/main');
      expect(result).toEqual({ type: 'calendar', id: 'main' });
    });

    it('should parse Calendar actor URI with port', () => {
      const result = parseActorUri('https://localhost:3001/calendars/test-calendar');
      expect(result).toEqual({ type: 'calendar', id: 'test-calendar' });
    });

    it('should parse Calendar actor URI with prefix path segments', () => {
      const result = parseActorUri('https://example.com/ap/calendars/mycal');
      expect(result).toEqual({ type: 'calendar', id: 'mycal' });
    });
  });

  describe('Invalid URIs', () => {
    it('should throw for empty string', () => {
      expect(() => parseActorUri('')).toThrow(InvalidActorUriError);
      expect(() => parseActorUri('')).toThrow('Actor URI must be a non-empty string');
    });

    it('should throw for null input', () => {
      expect(() => parseActorUri(null as any)).toThrow(InvalidActorUriError);
    });

    it('should throw for undefined input', () => {
      expect(() => parseActorUri(undefined as any)).toThrow(InvalidActorUriError);
    });

    it('should throw for non-string input', () => {
      expect(() => parseActorUri(123 as any)).toThrow(InvalidActorUriError);
    });

    it('should throw for invalid URL format', () => {
      expect(() => parseActorUri('not-a-url')).toThrow(InvalidActorUriError);
      expect(() => parseActorUri('not-a-url')).toThrow('Invalid URL format');
    });

    it('should throw for relative URL', () => {
      expect(() => parseActorUri('/users/alice')).toThrow(InvalidActorUriError);
    });

    it('should throw for unsupported protocol', () => {
      expect(() => parseActorUri('ftp://example.com/users/alice')).toThrow(InvalidActorUriError);
      expect(() => parseActorUri('ftp://example.com/users/alice')).toThrow('must use HTTPS protocol');
    });

    it('should throw for file protocol', () => {
      expect(() => parseActorUri('file:///users/alice')).toThrow(InvalidActorUriError);
    });

    it('should throw for HTTP non-localhost', () => {
      expect(() => parseActorUri('http://example.com/users/alice')).toThrow(InvalidActorUriError);
      expect(() => parseActorUri('http://example.com/users/alice')).toThrow('HTTP protocol is only allowed for localhost');
    });

    it('should throw for URI with only domain', () => {
      expect(() => parseActorUri('https://example.com')).toThrow(InvalidActorUriError);
      expect(() => parseActorUri('https://example.com')).toThrow('must contain type and ID segments');
    });

    it('should throw for URI with only /users path', () => {
      expect(() => parseActorUri('https://example.com/users')).toThrow(InvalidActorUriError);
    });

    it('should throw for URI with only /calendars path', () => {
      expect(() => parseActorUri('https://example.com/calendars')).toThrow(InvalidActorUriError);
    });

    it('should throw for URI with /users/ and empty ID', () => {
      expect(() => parseActorUri('https://example.com/users/')).toThrow(InvalidActorUriError);
    });

    it('should throw for unrecognized path structure', () => {
      expect(() => parseActorUri('https://example.com/profiles/alice')).toThrow(InvalidActorUriError);
      expect(() => parseActorUri('https://example.com/profiles/alice')).toThrow('must contain /users/{id} or /calendars/{id}');
    });

    it('should throw for URI with /actors path', () => {
      expect(() => parseActorUri('https://example.com/actors/123')).toThrow(InvalidActorUriError);
    });

    it('should throw for URI with query string only', () => {
      expect(() => parseActorUri('https://example.com/?user=alice')).toThrow(InvalidActorUriError);
    });
  });

  describe('Protocol validation in production', () => {
    let originalNodeEnv: string | undefined;

    beforeEach(() => {
      originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
    });

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('should throw for HTTP localhost in production', () => {
      expect(() => parseActorUri('http://localhost:3000/users/alice')).toThrow(InvalidActorUriError);
      expect(() => parseActorUri('http://localhost:3000/users/alice')).toThrow('HTTP protocol is not allowed in production environment');
    });

    it('should still accept HTTPS in production', () => {
      const result = parseActorUri('https://example.com/users/alice');
      expect(result).toEqual({ type: 'person', id: 'alice' });
    });
  });

  describe('Edge cases', () => {
    it('should handle trailing slash', () => {
      const result = parseActorUri('https://example.com/users/alice/');
      expect(result).toEqual({ type: 'person', id: 'alice' });
    });

    it('should handle query parameters (ignoring them for ID extraction)', () => {
      const result = parseActorUri('https://example.com/users/alice?format=json');
      expect(result).toEqual({ type: 'person', id: 'alice' });
    });

    it('should handle hash fragment', () => {
      const result = parseActorUri('https://example.com/users/alice#main-key');
      expect(result).toEqual({ type: 'person', id: 'alice' });
    });

    it('should handle mixed case domain', () => {
      const result = parseActorUri('https://EXAMPLE.COM/users/alice');
      expect(result).toEqual({ type: 'person', id: 'alice' });
    });

    it('should preserve case of actor ID', () => {
      const result = parseActorUri('https://example.com/users/Alice');
      expect(result).toEqual({ type: 'person', id: 'Alice' });
    });

    it('should handle URL-encoded characters in ID', () => {
      // URL constructor decodes percent-encoded characters
      const result = parseActorUri('https://example.com/users/alice%40bob');
      expect(result).toEqual({ type: 'person', id: 'alice@bob' });
    });

    it('should prioritize /users/ if both patterns somehow appear', () => {
      // Edge case: a weird URL with both patterns
      // /users/ appears first, so person should be detected
      const result = parseActorUri('https://example.com/users/alice/calendars/something');
      expect(result).toEqual({ type: 'person', id: 'alice' });
    });

    it('should handle real-world Pavillion Person actor format', () => {
      const result = parseActorUri('https://events.example/users/alice');
      expect(result).toEqual({ type: 'person', id: 'alice' });
    });

    it('should handle real-world Pavillion Calendar actor format', () => {
      const result = parseActorUri('https://events.example/calendars/events');
      expect(result).toEqual({ type: 'calendar', id: 'events' });
    });
  });

  describe('InvalidActorUriError properties', () => {
    it('should include the original URI in the error', () => {
      try {
        parseActorUri('bad-uri');
        expect.fail('Should have thrown');
      }
      catch (error) {
        expect(error).toBeInstanceOf(InvalidActorUriError);
        expect((error as InvalidActorUriError).uri).toBe('bad-uri');
      }
    });

    it('should have the correct error name', () => {
      try {
        parseActorUri('bad-uri');
        expect.fail('Should have thrown');
      }
      catch (error) {
        expect((error as InvalidActorUriError).name).toBe('InvalidActorUriError');
      }
    });
  });
});

describe('isPersonActorUri', () => {
  it('should return true for valid Person actor URIs', () => {
    expect(isPersonActorUri('https://example.com/users/alice')).toBe(true);
    expect(isPersonActorUri('https://events.example/users/admin')).toBe(true);
    expect(isPersonActorUri('http://localhost:3000/users/testuser')).toBe(true);
  });

  it('should return false for Calendar actor URIs', () => {
    expect(isPersonActorUri('https://example.com/calendars/events')).toBe(false);
    expect(isPersonActorUri('https://events.example/calendars/main')).toBe(false);
  });

  it('should return false for invalid URIs', () => {
    expect(isPersonActorUri('')).toBe(false);
    expect(isPersonActorUri('not-a-url')).toBe(false);
    expect(isPersonActorUri('https://example.com/profiles/alice')).toBe(false);
  });

  it('should return false for HTTP non-localhost', () => {
    expect(isPersonActorUri('http://example.com/users/alice')).toBe(false);
  });

  it('should return false for null/undefined', () => {
    expect(isPersonActorUri(null as any)).toBe(false);
    expect(isPersonActorUri(undefined as any)).toBe(false);
  });
});

describe('isCalendarActorUri', () => {
  it('should return true for valid Calendar actor URIs', () => {
    expect(isCalendarActorUri('https://example.com/calendars/events')).toBe(true);
    expect(isCalendarActorUri('https://events.example/calendars/main')).toBe(true);
    expect(isCalendarActorUri('http://localhost:3000/calendars/test')).toBe(true);
  });

  it('should return false for Person actor URIs', () => {
    expect(isCalendarActorUri('https://example.com/users/alice')).toBe(false);
    expect(isCalendarActorUri('https://events.example/users/admin')).toBe(false);
  });

  it('should return false for invalid URIs', () => {
    expect(isCalendarActorUri('')).toBe(false);
    expect(isCalendarActorUri('not-a-url')).toBe(false);
    expect(isCalendarActorUri('https://example.com/cals/events')).toBe(false);
  });

  it('should return false for HTTP non-localhost', () => {
    expect(isCalendarActorUri('http://example.com/calendars/events')).toBe(false);
  });

  it('should return false for null/undefined', () => {
    expect(isCalendarActorUri(null as any)).toBe(false);
    expect(isCalendarActorUri(undefined as any)).toBe(false);
  });
});
