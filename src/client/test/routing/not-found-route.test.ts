import { describe, it, expect } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { buildClientRoutes } from '@/client/routes';

describe('client not-found route', () => {
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

  it.each(['/profile', '/funding', '/admin/accounts', '/nonsense/deeper/path'])(
    'resolves unmatched %s to not_found inside the app shell',
    (path) => {
      const resolved = createTestRouter().resolve(path);
      expect(resolved.name).toBe('not_found');
      expect(resolved.matched[0].name).toBe('app');
    },
  );

  it('does not shadow real routes', () => {
    const router = createTestRouter();
    expect(router.resolve('/inbox').name).toBe('inbox');
    expect(router.resolve('/settings/account/profile').name).toBe('profile');
    expect(router.resolve('/auth/login').name).toBe('login');
  });
});
