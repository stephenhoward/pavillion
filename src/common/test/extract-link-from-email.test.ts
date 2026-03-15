import { describe, it, expect } from 'vitest';

import { extractLinkFromEmail, StoredEmail } from '../../../tests/e2e/helpers/emails';

/**
 * Unit tests for the extractLinkFromEmail e2e helper utility.
 */
describe('extractLinkFromEmail', () => {
  function createEmail(overrides: Partial<StoredEmail> = {}): StoredEmail {
    return {
      id: '<test@test>',
      date: new Date().toISOString(),
      from: 'noreply@test.com',
      to: 'user@test.com',
      subject: 'Test',
      text: '',
      raw: '',
      ...overrides,
    };
  }

  it('should extract a token from the text body', () => {
    const email = createEmail({
      text: 'Reset your password: http://localhost:3000/auth/reset-password?token=abc-123-def',
    });

    const token = extractLinkFromEmail(email, /reset-password\?token=([a-zA-Z0-9-]+)/);
    expect(token).toBe('abc-123-def');
  });

  it('should extract a link from HTML body when text has no match', () => {
    const email = createEmail({
      text: 'Please check your email',
      html: '<a href="http://localhost:3000/auth/reset-password?token=html-token-456">Reset</a>',
    });

    const token = extractLinkFromEmail(email, /reset-password\?token=([a-zA-Z0-9-]+)/);
    expect(token).toBe('html-token-456');
  });

  it('should prefer text body over HTML body', () => {
    const email = createEmail({
      text: 'http://localhost:3000/auth/reset-password?token=text-token',
      html: '<a href="http://localhost:3000/auth/reset-password?token=html-token">Reset</a>',
    });

    const token = extractLinkFromEmail(email, /reset-password\?token=([a-zA-Z0-9-]+)/);
    expect(token).toBe('text-token');
  });

  it('should return null when pattern not found', () => {
    const email = createEmail({ text: 'Welcome to Pavillion!' });

    const token = extractLinkFromEmail(email, /reset-password\?token=([a-zA-Z0-9-]+)/);
    expect(token).toBeNull();
  });

  it('should extract an invitation code', () => {
    const email = createEmail({
      text: 'You have been invited! Use code: INVITE-789-XYZ to join.',
    });

    const code = extractLinkFromEmail(email, /code:\s*([A-Z0-9-]+)/);
    expect(code).toBe('INVITE-789-XYZ');
  });
});
