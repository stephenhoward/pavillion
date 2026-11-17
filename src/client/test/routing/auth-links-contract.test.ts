import { describe, it, expect } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { buildClientRoutes } from '@/client/routes';

/*
 * Server-built emails link to auth pages by path. Each literal below is
 * the same one src/server/common/test/helper/auth-links.test.ts pins
 * for the matching auth-links.ts function; neither test imports across
 * the layer boundary, so the shared literal is the contract. Change both
 * together.
 */
describe('auth links built outside the SPA', () => {
  /** The real client route table, with every guard passing through. */
  function createTestRouter() {
    const pass = () => true;
    return createRouter({
      history: createMemoryHistory(),
      routes: buildClientRoutes({
        mustBeLoggedIn: pass,
        mustBeAdmin: pass,
        setupGuard: pass,
        authRouteGuard: pass,
        currentCalendarRedirect: () => pass,
        settingsIndexRedirect: () => pass,
        calendarLeafGate: pass,
        fundingEnabledRedirect: pass,
      }),
    });
  }

  it('resolves calendar_reports to the path calendarReportsPath() builds', () => {
    const resolved = createTestRouter().resolve({ name: 'calendar_reports', params: { calendar: 'city-events' } });

    expect(resolved.href).toBe('/settings/calendar/city-events/reports');
  });

  it('resolves login to the path loginPath() builds', () => {
    const resolved = createTestRouter().resolve({ name: 'login' });

    expect(resolved.href).toBe('/auth/login');
  });

  it('resolves forgot_password to the path forgotPasswordPath() builds', () => {
    const resolved = createTestRouter().resolve({ name: 'forgot_password' });

    expect(resolved.href).toBe('/auth/forgot');
  });

  it('resolves reset_password to the path resetPasswordPath() builds', () => {
    const resolved = createTestRouter().resolve({ name: 'reset_password' });

    expect(resolved.href).toBe('/auth/password');
  });

  it('resolves accept_invite to the path acceptInvitePath() builds', () => {
    const resolved = createTestRouter().resolve({ name: 'accept_invite' });

    expect(resolved.href).toBe('/auth/invitation');
  });

  it('resolves apply-confirm to the path applyConfirmPath() builds', () => {
    const resolved = createTestRouter().resolve({ name: 'apply-confirm', params: { token: 'tok-123' } });

    expect(resolved.href).toBe('/auth/apply/confirm/tok-123');
  });

  it('resolves email-confirm to the path emailConfirmPath() builds', () => {
    const resolved = createTestRouter().resolve({ name: 'email-confirm', params: { token: 'tok-123' } });

    expect(resolved.href).toBe('/auth/email/confirm/tok-123');
  });
});
