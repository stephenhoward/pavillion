import { describe, it, expect } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { buildClientRoutes } from '@/client/routes';

/*
 * Server-built emails link to settings leaves by path. Each literal below is
 * the same one src/server/common/test/helper/settings-links.test.ts pins
 * for the matching settings-links.ts function; neither test imports across
 * the layer boundary, so the shared literal is the contract. Change both
 * together.
 */
describe('settings links built outside the SPA', () => {
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
        legacyTabReportsRedirect: pass,
        fundingEnabledRedirect: pass,
      }),
    });
  }

  it('resolves calendar_reports to the path calendarReportsPath() builds', () => {
    const resolved = createTestRouter().resolve({ name: 'calendar_reports', params: { calendar: 'city-events' } });

    expect(resolved.href).toBe('/settings/calendar/city-events/reports');
  });

  it('resolves moderation_report_detail to the path adminModerationReportPath() builds', () => {
    const resolved = createTestRouter().resolve({ name: 'moderation_report_detail', params: { reportId: 'report-uuid-123' } });

    expect(resolved.href).toBe('/settings/admin/moderation/reports/report-uuid-123');
  });

  it('resolves accounts to the path adminAccountsPath() builds', () => {
    const resolved = createTestRouter().resolve({ name: 'accounts' });

    expect(resolved.href).toBe('/settings/admin/accounts');
  });
});
