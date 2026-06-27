import { describe, it, expect } from 'vitest';
import { isValidEmail, normalizeEmail } from '@/common/validation/email';

describe('isValidEmail', () => {

  const validEmails = [
    'user@example.com',
    'user.name@example.com',
    'user+tag@example.com',
    'user@sub.domain.com',
  ];

  const invalidEmails = [
    '',
    'not-an-email',
    'missing@tld',
    '@no-local.com',
    'spaces in@email.com',
    'no@dots',
  ];

  for (const email of validEmails) {
    it(`accepts "${email}"`, () => {
      expect(isValidEmail(email)).toBe(true);
    });
  }

  for (const email of invalidEmails) {
    it(`rejects "${email}"`, () => {
      expect(isValidEmail(email)).toBe(false);
    });
  }
});

describe('normalizeEmail', () => {
  it('lowercases mixed-case addresses', () => {
    expect(normalizeEmail('Victim@X.com')).toBe('victim@x.com');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeEmail('  user@example.com  ')).toBe('user@example.com');
  });

  it('trims and lowercases together', () => {
    expect(normalizeEmail('  User@Example.COM\t')).toBe('user@example.com');
  });

  it('leaves an already-normalized address unchanged', () => {
    expect(normalizeEmail('user@example.com')).toBe('user@example.com');
  });

  it('returns an empty string for an empty input', () => {
    expect(normalizeEmail('')).toBe('');
  });

  it('returns an empty string for nullish input without throwing', () => {
    expect(normalizeEmail(null as unknown as string)).toBe('');
    expect(normalizeEmail(undefined as unknown as string)).toBe('');
  });
});
