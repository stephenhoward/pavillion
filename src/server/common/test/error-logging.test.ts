import { describe, it, expect } from 'vitest';
import { logError, getSafeErrorMessage, isKnownError } from '@/server/common/helper/error-logger';

// Define some test error types
class KnownErrorType extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KnownErrorType';
  }
}

class AnotherKnownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnotherKnownError';
  }
}

describe('Error Logging Utilities', () => {
  describe('logError', () => {
    it('should log Error instances with stack trace', () => {
      const error = new Error('Test error message');
      // This test just verifies the function doesn't throw
      expect(() => logError(error, 'Test context')).not.toThrow();
    });

    it('should log non-Error values', () => {
      expect(() => logError('String error', 'Test context')).not.toThrow();
      expect(() => logError({ message: 'Object error' }, 'Test context')).not.toThrow();
      expect(() => logError(null, 'Test context')).not.toThrow();
    });
  });

  describe('getSafeErrorMessage', () => {
    it('should return error message for known error types', () => {
      const error = new KnownErrorType('This is a known error');
      const message = getSafeErrorMessage(error, [KnownErrorType]);
      expect(message).toBe('This is a known error');
    });

    it('should return generic message for unknown error types', () => {
      const error = new Error('Internal system details here');
      const message = getSafeErrorMessage(error, [KnownErrorType]);
      expect(message).toBe('An unexpected error occurred');
    });

    it('should return generic message for non-Error values', () => {
      const message1 = getSafeErrorMessage('string error', []);
      expect(message1).toBe('An unexpected error occurred');

      const message2 = getSafeErrorMessage({ foo: 'bar' }, []);
      expect(message2).toBe('An unexpected error occurred');

      const message3 = getSafeErrorMessage(null, []);
      expect(message3).toBe('An unexpected error occurred');
    });

    it('should work with multiple known error types', () => {
      const error1 = new KnownErrorType('Known error 1');
      const error2 = new AnotherKnownError('Known error 2');
      const error3 = new Error('Unknown error');

      const knownTypes = [KnownErrorType, AnotherKnownError];

      expect(getSafeErrorMessage(error1, knownTypes)).toBe('Known error 1');
      expect(getSafeErrorMessage(error2, knownTypes)).toBe('Known error 2');
      expect(getSafeErrorMessage(error3, knownTypes)).toBe('An unexpected error occurred');
    });

    it('should return generic message when no known types provided', () => {
      const error = new KnownErrorType('This should not be exposed');
      const message = getSafeErrorMessage(error, []);
      expect(message).toBe('An unexpected error occurred');
    });
  });

  describe('isKnownError', () => {
    it('should return true for known error types', () => {
      const error = new KnownErrorType('Test error');
      expect(isKnownError(error, [KnownErrorType])).toBe(true);
    });

    it('should return false for unknown error types', () => {
      const error = new Error('Test error');
      expect(isKnownError(error, [KnownErrorType])).toBe(false);
    });

    it('should return false for non-Error values', () => {
      expect(isKnownError('string', [KnownErrorType])).toBe(false);
      expect(isKnownError({ message: 'object' }, [KnownErrorType])).toBe(false);
      expect(isKnownError(null, [KnownErrorType])).toBe(false);
    });

    it('should work with multiple error types', () => {
      const error1 = new KnownErrorType('Error 1');
      const error2 = new AnotherKnownError('Error 2');
      const error3 = new Error('Unknown');

      const knownTypes = [KnownErrorType, AnotherKnownError];

      expect(isKnownError(error1, knownTypes)).toBe(true);
      expect(isKnownError(error2, knownTypes)).toBe(true);
      expect(isKnownError(error3, knownTypes)).toBe(false);
    });
  });
});
