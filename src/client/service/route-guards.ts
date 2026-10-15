import type { NavigationGuardNext, RouteLocationNormalized } from 'vue-router';

type LegacyGuard = (to: RouteLocationNormalized, from: RouteLocationNormalized, next: NavigationGuardNext) => void;

export interface RouteGuards {
  mustBeLoggedIn: LegacyGuard;
  mustBeAdmin: LegacyGuard;
  setupGuard: LegacyGuard;
  authRouteGuard: LegacyGuard;
}

/**
 * The client app's access guards. While setup mode is active every guarded
 * route goes to setup; otherwise a signed-out visitor, or a non-admin on an
 * admin route, goes to login.
 *
 * @param authentication - answers whether the session is signed in and admin
 * @param isSetupMode - read on every navigation, since setup mode ends at runtime
 */
export function createRouteGuards(
  authentication: { isLoggedIn(): boolean; isAdmin(): boolean },
  isSetupMode: () => boolean,
): RouteGuards {
  const requiring = (allowed: () => boolean): LegacyGuard => (to, _from, next) => {
    if (isSetupMode() && to.name !== 'setup') {
      next({ name: 'setup' });
      return;
    }
    if (!allowed()) {
      next({ name: 'login' });
    }
    else {
      next();
    }
  };

  return {
    mustBeLoggedIn: requiring(() => authentication.isLoggedIn()),
    mustBeAdmin: requiring(() => authentication.isAdmin()),

    /** Only allow the setup route while setup mode is active. */
    setupGuard: (_to, _from, next) => {
      if (!isSetupMode()) {
        next({ name: 'login' });
      }
      else {
        next();
      }
    },

    /** Send auth routes to setup while setup mode is active. */
    authRouteGuard: (to, _from, next) => {
      if (isSetupMode() && to.name !== 'setup') {
        next({ name: 'setup' });
      }
      else {
        next();
      }
    },
  };
}
