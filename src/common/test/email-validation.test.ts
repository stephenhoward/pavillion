import { describe, it, expect } from 'vitest';
import { isValidEmail } from '@/common/validation/email';

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
