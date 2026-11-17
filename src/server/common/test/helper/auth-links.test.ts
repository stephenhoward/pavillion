import { describe, it, expect } from 'vitest';
import {
  loginPath,
  forgotPasswordPath,
  resetPasswordPath,
  acceptInvitePath,
  applyConfirmPath,
  emailConfirmPath,
} from '@/server/common/helper/auth-links';

/*
 * These paths are a contract with the client route table: each literal below
 * is the same one src/client/test/routing/auth-links-contract.test.ts
 * resolves from the matching named route. Change both together.
 */
describe('auth links', () => {
  it('loginPath addresses the login page', () => {
    expect(loginPath()).toBe('/auth/login');
  });

  it('forgotPasswordPath addresses the forgot-password page', () => {
    expect(forgotPasswordPath()).toBe('/auth/forgot');
  });

  it('resetPasswordPath addresses the password page', () => {
    expect(resetPasswordPath()).toBe('/auth/password');
  });

  it('acceptInvitePath addresses the invitation page', () => {
    expect(acceptInvitePath()).toBe('/auth/invitation');
  });

  it('applyConfirmPath addresses the apply-confirm page by token', () => {
    expect(applyConfirmPath('tok-123')).toBe('/auth/apply/confirm/tok-123');
  });

  it('emailConfirmPath addresses the email-confirm page by token', () => {
    expect(emailConfirmPath('tok-123')).toBe('/auth/email/confirm/tok-123');
  });

  it('encodes each token as a single path segment', () => {
    expect(applyConfirmPath('a/b c')).toBe('/auth/apply/confirm/a%2Fb%20c');
    expect(emailConfirmPath('a/b c')).toBe('/auth/email/confirm/a%2Fb%20c');
  });
});
