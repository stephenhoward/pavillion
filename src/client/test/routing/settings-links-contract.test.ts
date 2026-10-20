import { describe, it, expect } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { buildClientRoutes } from '@/client/routes';

/*
 * Server-built emails link to settings leaves by path. The literal below is
 * the same one src/server/moderation/test/model/settings-links.test.ts pins
 * for calendarReportsPath(); neither test imports across the layer boundary,
 * so the shared literal is the contract. Change both together.
 */
describe('settings links built outside the SPA', () => {
  it('resolves calendar_reports to the path the moderation emails link to', () => {
    const pass = () => true;
    const router = createRouter({
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

    const resolved = router.resolve({ name: 'calendar_reports', params: { calendar: 'city-events' } });

    expect(resolved.href).toBe('/settings/calendar/city-events/reports');
  });
});
