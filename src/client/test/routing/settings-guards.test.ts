import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, type NavigationGuard, type RouteRecordRaw, type Router } from 'vue-router';
import { buildClientRoutes } from '@/client/routes';
import { createRouteGuards } from '@/client/service/route-guards';
import { createSettingsGuards } from '@/client/service/settings-guards';
import CalendarService from '@/client/service/calendar';
import FundingService from '@/client/service/funding';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { useFundingStore } from '@/client/stores/fundingStore';
import { useShellLayout, resetShellLayoutForTesting } from '@/client/composables/useShellLayout';
import { installMatchMedia, type FakeMatchMedia } from '@/client/test/lib/match-media';
import {
  SETTINGS_GROUP_INDEX_ROUTES,
  findLeafByRouteName,
  groupItems,
  isSettingsLeafGroup,
  type SettingsLeafGroup,
} from '@/client/components/logged_in/settings/nav-items';

/** A route record with its path joined to every ancestor's below /settings. */
interface FlatRecord {
  path: string;
  record: RouteRecordRaw;
}

/** The access guards the real table is built with, kept for identity checks. */
const accessGuards = createRouteGuards({ isLoggedIn: () => true, isAdmin: () => false }, () => false);

/** The real client route table behind the real access and settings guards. */
function buildRoutes(): RouteRecordRaw[] {
  return buildClientRoutes({
    ...accessGuards,
    currentCalendarRedirect: () => () => true,
    ...createSettingsGuards({
      loadCalendars: () => new CalendarService().ensureCalendarsLoaded(),
      isAdmin: () => false,
      loadInstanceFunding: () => new FundingService().ensureInstanceFundingLoaded(),
      treeIsSidebar: () => useShellLayout().mainNavIsSidebar.value,
    }),
  });
}

/** The /settings record of the real table. */
function settingsRecord(routes: RouteRecordRaw[]): RouteRecordRaw {
  const app = routes.find((route) => route.path === '/');
  const settings = app?.children?.find((child) => child.path === 'settings');
  if (!settings) {
    throw new Error('no /settings record in the client route table');
  }
  return settings;
}

/** Every record in a subtree, the root included, with its path relative to the root. */
function flatten(record: RouteRecordRaw, path = ''): FlatRecord[] {
  const own: FlatRecord = { path, record };
  const children = (record.children ?? []).flatMap((child) =>
    flatten(child, [path, child.path].filter(Boolean).join('/')),
  );
  return [own, ...children];
}

/** Path prefix (below /settings) of each group whose records have been converted to the tree. */
const CONVERTED_GROUP_PATHS: Partial<Record<SettingsLeafGroup, string>> = {
  account: 'account',
};

/** A record's own beforeEnter guards, as an array. */
function ownGuards(record: RouteRecordRaw): NavigationGuard[] {
  const guards = record.beforeEnter;
  if (!guards) {
    return [];
  }
  return Array.isArray(guards) ? guards : [guards];
}

describe('settings routes on the real route table', () => {
  let sandbox: sinon.SinonSandbox;
  let getOptions: sinon.SinonStub;
  let media: FakeMatchMedia;

  beforeEach(() => {
    setActivePinia(createPinia());
    sandbox = sinon.createSandbox();
    sandbox.stub(CalendarService.prototype, 'ensureCalendarsLoaded').callsFake(async () => {
      useCalendarStore().setCalendarInfos([]);
      return [];
    });
    getOptions = sandbox.stub(FundingService.prototype, 'getOptions').resolves({ enabled: false } as never);
    resetShellLayoutForTesting();
    media = installMatchMedia(false);
  });

  afterEach(() => {
    resetShellLayoutForTesting();
    media.restore();
    sandbox.restore();
  });

  /** A router over the real table, the viewport fake already set to `sidebar`. */
  function routerAt(sidebar: boolean): Router {
    media.setMatches(sidebar);
    return createRouter({ history: createMemoryHistory(), routes: buildRoutes() });
  }

  describe('account index', () => {
    it('renders the account list page below md', async () => {
      const router = routerAt(false);
      await router.push('/settings/account');
      expect(router.currentRoute.value.name).toBe('account');
      expect(router.currentRoute.value.path).toBe('/settings/account');
    });

    it('forwards to Profile at md+', async () => {
      const router = routerAt(true);
      await router.push('/settings/account');
      expect(router.currentRoute.value.name).toBe('profile');
      expect(router.currentRoute.value.path).toBe('/settings/account/profile');
    });
  });

  describe('account leaves', () => {
    it.each([
      ['/settings/account/profile', 'profile'],
      ['/settings/account/security', 'security'],
    ])('serves %s as %s', async (path, name) => {
      const router = routerAt(true);
      await router.push(path);
      expect(router.currentRoute.value.name).toBe(name);
    });
  });

  describe('funding plan', () => {
    it('redirects to Profile when instance funding is disabled', async () => {
      const router = routerAt(false);
      await router.push('/settings/account/funding');
      expect(router.currentRoute.value.name).toBe('profile');
    });

    it('loads the flag on a cold load and renders the page when funding is enabled', async () => {
      getOptions.resolves({ enabled: true } as never);
      expect(useFundingStore().instanceFundingEnabled).toBeNull();

      const router = routerAt(false);
      await router.push('/settings/account/funding');

      expect(getOptions.calledOnce).toBe(true);
      expect(router.currentRoute.value.name).toBe('funding_plan');
      expect(router.currentRoute.value.path).toBe('/settings/account/funding');
    });
  });

  describe('route tree invariants', () => {
    it('gives every settings record its own mustBeLoggedIn or mustBeAdmin', () => {
      const records = flatten(settingsRecord(buildRoutes()));
      const unguarded = records
        .filter(({ record }) => !ownGuards(record).some(
          (guard) => guard === accessGuards.mustBeLoggedIn || guard === accessGuards.mustBeAdmin,
        ))
        .map(({ path, record }) => String(record.name ?? path));

      expect(records.length).toBeGreaterThan(1);
      expect(unguarded).toEqual([]);
    });

    it.each(Object.entries(CONVERTED_GROUP_PATHS) as [SettingsLeafGroup, string][])(
      'names every %s record after its index or a leaf in the tree',
      (group, prefix) => {
        const records = flatten(settingsRecord(buildRoutes()))
          .filter(({ path }) => path === prefix || path.startsWith(`${prefix}/`));
        const names = records.map(({ record }) => record.name);

        expect(names).toContain(SETTINGS_GROUP_INDEX_ROUTES[group]);
        for (const name of names) {
          if (name === SETTINGS_GROUP_INDEX_ROUTES[group]) {
            continue;
          }
          expect(findLeafByRouteName(String(name))?.group, `record ${String(name)}`).toBe(group);
        }
      },
    );

    it.each(Object.keys(CONVERTED_GROUP_PATHS) as SettingsLeafGroup[])(
      'routes every %s leaf in the tree',
      (group) => {
        const router = createRouter({ history: createMemoryHistory(), routes: buildRoutes() });
        const leaves = groupItems(group, { calendarUrlName: 'cal', isOwner: true, isAdmin: true, fundingEnabled: true });
        for (const leaf of leaves) {
          if ('routeName' in leaf && leaf.routeName) {
            expect(router.hasRoute(leaf.routeName), `leaf ${leaf.routeName}`).toBe(true);
          }
        }
      },
    );

    it('never names an index record after a leaf or Profile, so no forward can loop', () => {
      const indexes = flatten(settingsRecord(buildRoutes()))
        .map(({ record }) => record)
        .filter((record) => record.meta?.settingsGroup !== undefined);

      expect(indexes.map((record) => record.meta?.settingsGroup)).toContain('account');
      for (const record of indexes) {
        const group = record.meta!.settingsGroup!;
        const name = String(record.name);
        if (isSettingsLeafGroup(group)) {
          expect(name).toBe(SETTINGS_GROUP_INDEX_ROUTES[group]);
        }
        expect(findLeafByRouteName(name), `index ${name}`).toBeNull();
        expect(name).not.toBe('profile');
      }
    });
  });
});
