import { describe, it, expect } from 'vitest';
import { validatePassword } from '@/common/validation/password';

describe('Password Validation', () => {
  describe('minimum length requirement', () => {
    it('should reject passwords shorter than 8 characters', () => {
      const result = validatePassword('short1!');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('password_too_short');
    });

    it('should accept passwords with exactly 8 characters when meeting other requirements', () => {
      const result = validatePassword('pass1234');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject empty string', () => {
      const result = validatePassword('');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('password_too_short');
    });
  });

  describe('character type requirements (at least 2 of 3 types)', () => {
    it('should accept password with letters and numbers', () => {
      const result = validatePassword('password1');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept password with letters and special characters', () => {
      const result = validatePassword('pass@word');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept password with numbers and special characters', () => {
      const result = validatePassword('12345678!@');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept password with all three character types', () => {
      const result = validatePassword('Pass1234!');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject password with only letters', () => {
      const result = validatePassword('password');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('password_needs_variety');
    });

    it('should reject password with only numbers', () => {
      const result = validatePassword('12345678');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('password_needs_variety');
    });

    it('should reject password with only special characters', () => {
      const result = validatePassword('!@#$%^&*');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('password_needs_variety');
    });
  });

  describe('edge cases', () => {
    it('should handle unicode characters as special characters', () => {
      // Unicode characters should count as special characters
      const result = validatePassword('password\u00A9');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle password with mixed case letters', () => {
      const result = validatePassword('PassWord1');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return multiple errors when both requirements fail', () => {
      const result = validatePassword('abc');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('password_too_short');
      expect(result.errors).toContain('password_needs_variety');
    });
  });

  describe('error message format', () => {
    it('should return i18n-friendly error keys', () => {
      const shortResult = validatePassword('ab1');
      const varietyResult = validatePassword('abcdefgh');

      // Error keys should be simple lowercase snake_case strings for i18n
      expect(shortResult.errors.every(e => /^[a-z_]+$/.test(e))).toBe(true);
      expect(varietyResult.errors.every(e => /^[a-z_]+$/.test(e))).toBe(true);
    });

    it('should return empty errors array for valid password', () => {
      const result = validatePassword('validPass1');

      expect(result.errors).toEqual([]);
    });
  });
});
