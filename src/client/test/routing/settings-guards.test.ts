import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import axios from 'axios';
import { defineComponent, h } from 'vue';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { createMemoryHistory, createRouter, createWebHistory, type NavigationGuard, type RouteRecordRaw, type Router } from 'vue-router';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { Calendar } from '@/common/model/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';
import { mountComponent } from '@/client/test/lib/vue';
import PageHeader from '@/client/components/logged_in/settings/page-header.vue';
import SettingsListPage from '@/client/components/logged_in/settings/list-page.vue';
import CalendarSwitcher from '@/client/components/logged_in/calendar-switcher/CalendarSwitcher.vue';
import { buildClientRoutes } from '@/client/routes';
import enSettings from '@/client/locales/en/settings.json';
import { createRouteGuards } from '@/client/service/route-guards';
import { createSettingsGuards, historyPath } from '@/client/service/settings-guards';
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

// The real-layout cases mount the real settings layout under these stand-ins,
// so the shell around it and the sign-out page stay out of the test.
vi.mock('@/client/components/logged_in/root.vue', () => ({
  default: defineComponent({ name: 'AppShell', template: '<RouterView />' }),
}));
vi.mock('@/client/components/logged_out/root.vue', () => ({
  default: defineComponent({ name: 'AuthShell', template: '<RouterView />' }),
}));
vi.mock('@/client/components/logged_out/logout.vue', () => ({
  default: defineComponent({ name: 'LogoutPage', render: () => h('main', { 'data-page': 'logout' }) }),
}));

const owned = (id: string, urlName: string) => new CalendarInfo(new Calendar(id, urlName), 'owner');
const edited = (id: string, urlName: string) => new CalendarInfo(new Calendar(id, urlName), 'editor');

/** A route record with its path joined to every ancestor's below /settings. */
interface FlatRecord {
  path: string;
  record: RouteRecordRaw;
}

/** The real access guards for a session; kept by callers for identity checks. */
function accessGuardsFor(loggedIn: boolean, admin = false) {
  return createRouteGuards({ isLoggedIn: () => loggedIn, isAdmin: () => admin }, () => false);
}

/** The access guards of a signed-in, non-admin session. */
const accessGuards = accessGuardsFor(true);

/** The access guards of a signed-in admin's session. */
const adminAccessGuards = accessGuardsFor(true, true);

/** The router the guards read history from; set by every test that navigates. */
let activeRouter: Router | null = null;

/**
 * The real client route table behind the real access and settings guards;
 * `isAdmin` is the settings guards' view of the same session as `access`.
 */
function buildRoutes(access = accessGuards, isAdmin = false): RouteRecordRaw[] {
  return buildClientRoutes({
    ...access,
    currentCalendarRedirect: () => () => true,
    ...createSettingsGuards({
      loadCalendars: () => new CalendarService().ensureCalendarsLoaded(),
      isAdmin: () => isAdmin,
      loadInstanceFunding: () => new FundingService().ensureInstanceFundingLoaded(),
      treeIsSidebar: () => useShellLayout().mainNavIsSidebar.value,
      historyLocation: () => (activeRouter ? historyPath(activeRouter) : ''),
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

/** Path prefix (below /settings) of each group's records. */
const GROUP_PATHS: Readonly<Record<SettingsLeafGroup, string>> = {
  calendar: 'calendar/:calendar',
  account: 'account',
  admin: 'admin',
};

/** Route names of the index records: the root's and each group's list page. */
const INDEX_ROUTE_NAMES = new Set<string>(['settings', ...Object.values(SETTINGS_GROUP_INDEX_ROUTES)]);

/** A named route's path, every `:param` in its record path filled with a placeholder. */
function resolvedPathOf(router: Router, name: string): string {
  const record = router.getRoutes().find((candidate) => candidate.name === name);
  if (!record) {
    throw new Error(`no route named ${name}`);
  }
  const params = Object.fromEntries([...record.path.matchAll(/:(\w+)/g)].map(([, key]) => [key, `${key}-x`]));
  return router.resolve({ name, params }).path;
}

/** A record path prefix as a pattern over resolved paths: each `:param` matches one segment. */
function resolvedPrefix(prefix: string): RegExp {
  return new RegExp(`^/settings/${prefix.replace(/:[^/]+/g, '[^/]+')}/`);
}

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
  let pinia: Pinia;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
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
  function routerAt(sidebar: boolean, access = accessGuards, isAdmin = false): Router {
    media.setMatches(sidebar);
    activeRouter = createRouter({ history: createMemoryHistory(), routes: buildRoutes(access, isAdmin) });
    return activeRouter;
  }

  /** Back or Forward, then let the guards and the navigation settle. */
  async function traverse(router: Router, delta: number): Promise<void> {
    router.go(delta);
    await flushPromises();
  }

  const loadStub = () => CalendarService.prototype.ensureCalendarsLoaded as sinon.SinonStub;

  /** The viewer's own calendars, put in the store whenever a guard loads them. */
  function viewerHolds(...infos: CalendarInfo[]): void {
    loadStub().callsFake(async () => {
      useCalendarStore().setCalendarInfos(infos);
      return infos;
    });
  }

  /**
   * A first page load of `path` at md+ through the browser history, as
   * app.ts starts the router: where it lands, and whether it added an entry.
   */
  async function coldLoadAtMdUp(
    path: string,
    access = accessGuards,
    isAdmin = false,
  ): Promise<{ path: string; addressBar: string; addedEntry: boolean }> {
    const original = window.location.pathname;
    window.history.replaceState({}, '', path);
    try {
      media.setMatches(true);
      activeRouter = createRouter({ history: createWebHistory(), routes: buildRoutes(access, isAdmin) });
      const lengthBefore = window.history.length;

      await activeRouter.push(activeRouter.options.history.location);

      return {
        path: activeRouter.currentRoute.value.path,
        addressBar: window.location.pathname,
        addedEntry: window.history.length !== lengthBefore,
      };
    }
    finally {
      activeRouter?.options.history.destroy();
      window.history.replaceState({}, '', original);
    }
  }

  describe('root index', () => {
    it('renders the root list page below md', async () => {
      viewerHolds(owned('o1', 'riverside'));
      const router = routerAt(false);
      await router.push('/settings');

      expect(router.currentRoute.value.name).toBe('settings');
      expect(router.currentRoute.value.path).toBe('/settings');
      expect(router.currentRoute.value.matched.at(-1)?.components?.default).toBe(SettingsListPage);
    });

    it.each([
      ['an owner on General', [owned('o1', 'riverside')], '/settings/calendar/riverside/general'],
      ['an editor on Widget', [edited('e1', 'shared')], '/settings/calendar/shared/widget'],
      ['a viewer with no calendars on Profile', [], '/settings/account/profile'],
    ])('lands %s at md+', async (_who, infos, expected) => {
      viewerHolds(...infos);
      const router = routerAt(true);
      await router.push('/settings');
      expect(router.currentRoute.value.fullPath).toBe(expected);
    });

    it('forwards to the persisted current calendar while it is still the viewer\'s', async () => {
      viewerHolds(owned('o1', 'riverside'), owned('o2', 'harbour'));
      useCalendarStore().selectedCalendarId = 'o2';
      const router = routerAt(true);
      await router.push('/settings');
      expect(router.currentRoute.value.fullPath).toBe('/settings/calendar/harbour/general');
    });

    it('ignores a persisted calendar the viewer no longer holds', async () => {
      viewerHolds(owned('o1', 'riverside'));
      useCalendarStore().selectedCalendarId = 'gone';
      const router = routerAt(true);
      await router.push('/settings');
      expect(router.currentRoute.value.fullPath).toBe('/settings/calendar/riverside/general');
    });

    it('stays on the root list at md+ when the calendar load fails, never falling back to Profile', async () => {
      loadStub().rejects(new Error('offline'));
      const router = routerAt(true);
      await router.push('/settings');
      expect(router.currentRoute.value.fullPath).toBe('/settings');
    });

    it.each(['/calendar/riverside', '/inbox'])(
      'leaves settings for %s on Back after a forward at md+',
      async (from) => {
        viewerHolds(owned('o1', 'riverside'));
        const router = routerAt(true);
        await router.push(from);

        await router.push('/settings');
        expect(router.currentRoute.value.fullPath).toBe('/settings/calendar/riverside/general');

        await traverse(router, -1);
        expect(router.currentRoute.value.fullPath).toBe(from);
      },
    );

    it('does not trap Back on the root reached by history traversal at md+', async () => {
      viewerHolds(owned('o1', 'riverside'));
      const router = routerAt(false);
      await router.push('/inbox');
      await router.push('/settings');
      await router.push('/settings/calendar/riverside/general');
      media.setMatches(true);

      // Back onto the root forwards to its first leaf in place of the root entry...
      await traverse(router, -1);
      expect(router.currentRoute.value.fullPath).toBe('/settings/calendar/riverside/general');

      // ...so the next Back leaves settings instead of forwarding again.
      await traverse(router, -1);
      expect(router.currentRoute.value.fullPath).toBe('/inbox');
    });

    it('replaces a cold load of the root, adding no history entry', async () => {
      viewerHolds(owned('o1', 'riverside'));
      expect(await coldLoadAtMdUp('/settings')).toEqual({
        path: '/settings/calendar/riverside/general',
        addressBar: '/settings/calendar/riverside/general',
        addedEntry: false,
      });
    });
  });

  describe('calendar index', () => {
    it.each([
      ['owner', false, '/settings/calendar/riverside'],
      ['owner', true, '/settings/calendar/riverside/general'],
      ['editor', false, '/settings/calendar/riverside'],
      ['editor', true, '/settings/calendar/riverside/widget'],
    ] as const)('lands an %s at md+ = %s on %s', async (role, sidebar, expected) => {
      viewerHolds(role === 'owner' ? owned('c1', 'riverside') : edited('c1', 'riverside'));
      const router = routerAt(sidebar);
      await router.push('/settings/calendar/riverside');
      expect(router.currentRoute.value.fullPath).toBe(expected);
    });

    it.each([false, true])('stays at the index for a calendar the viewer does not hold (md+ = %s)', async (sidebar) => {
      viewerHolds(owned('c1', 'riverside'));
      const router = routerAt(sidebar);
      await router.push('/settings/calendar/elsewhere');
      expect(router.currentRoute.value.fullPath).toBe('/settings/calendar/elsewhere');
    });

    it.each([false, true])('stays at the index when the calendar load fails (md+ = %s)', async (sidebar) => {
      loadStub().rejects(new Error('offline'));
      const router = routerAt(sidebar);
      await router.push('/settings/calendar/riverside');
      expect(router.currentRoute.value.fullPath).toBe('/settings/calendar/riverside');
    });
  });

  describe('cold load at md+ before the stores have loaded', () => {
    it.each(['/settings', '/settings/calendar/shared'])('waits for the calendars, then forwards %s', async (path) => {
      const infos = [edited('e1', 'shared')];
      loadStub().callsFake(() => new Promise<CalendarInfo[]>((resolve) => {
        setTimeout(() => {
          useCalendarStore().setCalendarInfos(infos);
          resolve(infos);
        }, 5);
      }));
      const router = routerAt(true);
      expect(useCalendarStore().loaded).toBe(false);

      await router.push(path);

      expect(router.currentRoute.value.fullPath).toBe('/settings/calendar/shared/widget');
    });
  });

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

    it('keeps the page the viewer came from when it forwards at md+', async () => {
      const router = routerAt(true);
      await router.push('/settings/account/security');

      await router.push('/settings/account');
      expect(router.currentRoute.value.name).toBe('profile');

      await traverse(router, -1);
      expect(router.currentRoute.value.path).toBe('/settings/account/security');
    });

    it('keeps a page outside settings the viewer came from', async () => {
      const router = routerAt(true);
      await router.push('/inbox');

      await router.push('/settings/account');
      expect(router.currentRoute.value.name).toBe('profile');

      await traverse(router, -1);
      expect(router.currentRoute.value.path).toBe('/inbox');
    });

    it('does not trap Back on an index reached by history traversal at md+', async () => {
      const router = routerAt(false);
      await router.push('/settings/account/security');
      await router.push('/settings/account');
      await router.push('/settings/account/profile');
      media.setMatches(true);

      // Back onto the index forwards to its first leaf in place of the index entry...
      await traverse(router, -1);
      expect(router.currentRoute.value.path).toBe('/settings/account/profile');

      // ...so the next Back leaves the index behind instead of forwarding again.
      await traverse(router, -1);
      expect(router.currentRoute.value.path).toBe('/settings/account/security');
    });

    it('replaces a cold load of an index, adding no history entry', async () => {
      expect(await coldLoadAtMdUp('/settings/account')).toEqual({
        path: '/settings/account/profile',
        addressBar: '/settings/account/profile',
        addedEntry: false,
      });
    });
  });

  describe('admin index', () => {
    it('renders the instance list page below md', async () => {
      const router = routerAt(false, adminAccessGuards, true);
      await router.push('/settings/admin');

      expect(router.currentRoute.value.name).toBe('admin');
      expect(router.currentRoute.value.path).toBe('/settings/admin');
      expect(router.currentRoute.value.matched.at(-1)?.components?.default).toBe(SettingsListPage);
    });

    it('forwards to General at md+, keeping the page the viewer came from', async () => {
      const router = routerAt(true, adminAccessGuards, true);
      await router.push('/settings/account/profile');

      await router.push('/settings/admin');
      expect(router.currentRoute.value.name).toBe('admin_settings');
      expect(router.currentRoute.value.path).toBe('/settings/admin/settings');

      await traverse(router, -1);
      expect(router.currentRoute.value.path).toBe('/settings/account/profile');
    });

    it('replaces a cold load of the admin index, adding no history entry', async () => {
      expect(await coldLoadAtMdUp('/settings/admin', adminAccessGuards, true)).toEqual({
        path: '/settings/admin/settings',
        addressBar: '/settings/admin/settings',
        addedEntry: false,
      });
    });
  });

  // mustBeAdmin sends a non-admin to login (service/route-guards.ts); the
  // admin index forward must never run ahead of it.
  describe('admin routes for a non-admin', () => {
    it.each([
      ['/settings/admin', false],
      ['/settings/admin', true],
      ['/settings/admin/federation', false],
      ['/settings/admin/federation', true],
    ])('sends a cold load of %s to login (md+ = %s)', async (path, sidebar) => {
      const router = routerAt(sidebar);
      await router.push(path);

      expect(router.currentRoute.value.name).toBe('login');
      expect(router.currentRoute.value.path).toBe('/auth/login');
      expect(loadStub().called).toBe(false);
    });

    it('sends a cold load of the admin index at md+ through the browser history to login', async () => {
      expect(await coldLoadAtMdUp('/settings/admin')).toEqual({
        path: '/auth/login',
        addressBar: '/auth/login',
        addedEntry: false,
      });
      expect(loadStub().called).toBe(false);
    });

    it.each([
      ['/settings/admin', false],
      ['/settings/admin', true],
      ['/settings/admin/federation', false],
      ['/settings/admin/federation', true],
    ])('sends an in-app jump from the account group to %s to login (md+ = %s)', async (path, sidebar) => {
      const router = routerAt(sidebar);
      await router.push('/settings/account/profile');
      loadStub().resetHistory();
      getOptions.resetHistory();

      await router.push(path);

      expect(router.currentRoute.value.name).toBe('login');
      expect(router.currentRoute.value.path).toBe('/auth/login');
      // The index forward loads the viewer's calendars and funding flag first;
      // neither load means it never ran.
      expect(loadStub().called).toBe(false);
      expect(getOptions.called).toBe(false);
    });
  });

  describe('calendar leaf gate', () => {
    function viewerHas(role: 'owner' | 'editor') {
      viewerHolds(role === 'owner' ? owned('c1', 'shared') : edited('c1', 'shared'));
    }

    it.each([
      ['/settings/calendar/shared/general'],
      ['/settings/calendar/shared/editors'],
      ['/settings/calendar/shared/reports/9f8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d'],
    ])('replaces an editor entering %s with widget, query dropped', async (path) => {
      viewerHas('editor');
      const router = routerAt(false);
      await router.push(path);
      expect(router.currentRoute.value.fullPath).toBe('/settings/calendar/shared/widget');
    });

    it('keeps Profile when an editor is refused on entry from it', async () => {
      viewerHas('editor');
      const router = routerAt(false);
      await router.push('/settings/account/profile');

      await router.push('/settings/calendar/shared/general');
      expect(router.currentRoute.value.fullPath).toBe('/settings/calendar/shared/widget');

      await traverse(router, -1);
      expect(router.currentRoute.value.path).toBe('/settings/account/profile');
    });

    it('lets an owner onto an owner-only leaf', async () => {
      viewerHas('owner');
      const router = routerAt(false);
      await router.push('/settings/calendar/shared/general');
      expect(router.currentRoute.value.name).toBe('calendar_general');
    });

    it('lets an editor onto the index', async () => {
      viewerHas('editor');
      const router = routerAt(false);
      await router.push('/settings/calendar/shared');
      expect(router.currentRoute.value.name).toBe('calendar_management');
    });

    it('does not forward an unresolved calendar', async () => {
      const router = routerAt(false);
      await router.push('/settings/calendar/nope/general');
      expect(router.currentRoute.value.fullPath).toBe('/settings/calendar/nope/general');
    });

    it('does not forward when the calendar load fails', async () => {
      loadStub().rejects(new Error('offline'));
      const router = routerAt(false);
      await router.push('/settings/calendar/shared/general');
      expect(router.currentRoute.value.fullPath).toBe('/settings/calendar/shared/general');
    });
  });

  describe('signed out', () => {
    it.each([
      '/settings',
      '/settings/account',
      '/settings/account/security',
      '/settings/account/funding',
    ])('sends %s to login', async (path) => {
      const router = routerAt(true, accessGuardsFor(false));
      await router.push(path);
      expect(router.currentRoute.value.name).toBe('login');
    });

    it('checks sign-in before the root forward loads anything at md+', async () => {
      const router = routerAt(true, accessGuardsFor(false));
      await router.push('/settings');
      expect(router.currentRoute.value.name).toBe('login');
      expect(loadStub().called).toBe(false);
      expect(getOptions.called).toBe(false);
    });

    it('checks sign-in before loading the funding flag', async () => {
      const router = routerAt(false, accessGuardsFor(false));
      await router.push('/settings/account/funding');
      expect(router.currentRoute.value.name).toBe('login');
      expect(getOptions.called).toBe(false);
    });
  });

  describe('account leaves', () => {
    it.each([
      ['/settings/account/profile', 'profile'],
      ['/settings/account/security', 'security'],
      ['/settings/account/calendars', 'account_calendars'],
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
    // First, not merely present: a move between siblings skips the parent's
    // guard, so only the record's own order keeps a later guard (the admin
    // index forward among them) from running before access is checked.
    it('runs mustBeAdmin first on every admin record and mustBeLoggedIn first on every other settings record', () => {
      const records = flatten(settingsRecord(buildRoutes()));
      const isAdminRecord = (path: string) => path === GROUP_PATHS.admin || path.startsWith(`${GROUP_PATHS.admin}/`);
      const misguarded = records
        .filter(({ path, record }) => ownGuards(record)[0] !== (
          isAdminRecord(path) ? accessGuards.mustBeAdmin : accessGuards.mustBeLoggedIn
        ))
        .map(({ path, record }) => String(record.name ?? path));

      expect(records.filter(({ path }) => isAdminRecord(path)).length).toBeGreaterThan(1);
      expect(records.filter(({ path }) => !isAdminRecord(path)).length).toBeGreaterThan(1);
      expect(misguarded).toEqual([]);
    });

    it.each(Object.entries(GROUP_PATHS) as [SettingsLeafGroup, string][])(
      'names every %s record after its index or a leaf in the tree',
      (group, prefix) => {
        const records = flatten(settingsRecord(buildRoutes()))
          .filter(({ path }) => path === prefix || path.startsWith(`${prefix}/`))
          // A parent that only lays out its children names nothing; its index child does.
          .filter(({ record }) => !record.children?.some((child) => child.path === ''));
        for (const { path, record } of records) {
          expect(record.name, `unnamed record at /settings/${path}`).toBeDefined();
        }
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

    it.each(Object.entries(GROUP_PATHS) as [SettingsLeafGroup, string][])(
      'routes every %s leaf in the tree under its group',
      (group, prefix) => {
        const router = createRouter({ history: createMemoryHistory(), routes: buildRoutes() });
        const leaves = groupItems(group, { calendarUrlName: 'cal', isOwner: true, isAdmin: true, fundingEnabled: true });
        for (const leaf of leaves) {
          if ('routeName' in leaf && leaf.routeName) {
            expect(router.hasRoute(leaf.routeName), `leaf ${leaf.routeName}`).toBe(true);
            expect(router.resolve(leaf.to).path, `leaf ${leaf.routeName}`).toMatch(resolvedPrefix(prefix));
          }
        }
      },
    );

    // Enumerated from the router, not from the tree, so a record the tree
    // does not list (a sub-route missing from subRoutes) fails here.
    it('places every named settings record other than an index in the tree', () => {
      const router = createRouter({ history: createMemoryHistory(), routes: buildRoutes() });
      const named = router.getRoutes()
        .filter((record) => record.path.startsWith('/settings') && typeof record.name === 'string')
        .map((record) => String(record.name))
        .filter((name) => !INDEX_ROUTE_NAMES.has(name));

      expect(named).toEqual(expect.arrayContaining([
        'calendar_report_detail', 'moderation_report_detail', 'moderation_settings', 'blocked_instances', 'funding_plan',
      ]));
      const outsideTree = named.filter((name) => findLeafByRouteName(name) === null);
      expect(outsideTree).toEqual([]);
    });

    // A sub-route has no row of its own in the tree, so its h1 comes from its
    // record's meta; a sub-route without one would repeat its parent's title.
    it('gives every sub-route a title key of its own that resolves in the settings namespace', () => {
      const router = createRouter({ history: createMemoryHistory(), routes: buildRoutes() });
      const subRoutes = router.getRoutes().filter((record) => {
        const leaf = typeof record.name === 'string' ? findLeafByRouteName(record.name) : null;
        return leaf !== null && leaf.routeName !== record.name;
      });

      expect(subRoutes.map((record) => record.name)).toEqual(expect.arrayContaining([
        'calendar_report_detail', 'moderation_report_detail', 'moderation_settings', 'blocked_instances',
      ]));
      for (const record of subRoutes) {
        const key = record.meta.settingsTitleKey;
        expect(key, String(record.name)).toBeTypeOf('string');
        const title = key!.split('.').reduce<unknown>(
          (node, part) => (node as Record<string, unknown> | undefined)?.[part], enSettings,
        );
        expect(title, `${String(record.name)}: ${key}`).toBeTypeOf('string');
      }
    });

    // nav-list.vue marks the current row by path, the page header titles by
    // route name through subRoutes; they agree only while a sub-route nests
    // beneath its leaf.
    it('resolves every sub-route to a path beneath its leaf\'s path', () => {
      const router = createRouter({ history: createMemoryHistory(), routes: buildRoutes() });
      const everyLeaf = (['calendar', 'account', 'admin'] as const).flatMap((group) => groupItems(
        group, { calendarUrlName: 'cal', isOwner: true, isAdmin: true, fundingEnabled: true },
      ));
      const subRouted = everyLeaf.filter((leaf) => 'subRoutes' in leaf && leaf.subRoutes);

      expect(subRouted.length).toBeGreaterThan(0);
      for (const leaf of subRouted) {
        if (!('routeName' in leaf) || !leaf.subRoutes) {
          continue;
        }
        const leafPath = resolvedPathOf(router, leaf.routeName);
        for (const subRoute of leaf.subRoutes) {
          expect(resolvedPathOf(router, subRoute), `${subRoute} under ${leaf.routeName}`)
            .toMatch(new RegExp(`^${leafPath}/`));
        }
      }
    });

    // settings/root.vue keys its pane on these record paths.
    it('matches the group record paths the settings layout keys its pane on', () => {
      const router = createRouter({ history: createMemoryHistory(), routes: buildRoutes() });
      const matchedPaths = (path: string) => router.resolve(path).matched.map((record) => record.path);

      expect(matchedPaths('/settings/admin')).toContain('/settings/admin');
      expect(matchedPaths('/settings/admin/settings')).toContain('/settings/admin');
      expect(matchedPaths('/settings/account')).toContain('/settings/account');
      expect(matchedPaths('/settings/account/profile')).toContain('/settings/account/profile');
    });

    it('never names an index record after a leaf or Profile, so no forward can loop', () => {
      const indexes = flatten(settingsRecord(buildRoutes()))
        .map(({ record }) => record)
        .filter((record) => record.meta?.settingsGroup !== undefined);

      expect(indexes.map((record) => record.meta?.settingsGroup))
        .toEqual(expect.arrayContaining(['root', 'calendar', 'account', 'admin']));
      for (const record of indexes) {
        const group = record.meta!.settingsGroup!;
        const name = String(record.name);
        expect(name).toBe(isSettingsLeafGroup(group) ? SETTINGS_GROUP_INDEX_ROUTES[group] : 'settings');
        // Profile is a leaf, and the forward's empty-group fallback: an index
        // named after any leaf (Profile included) would forward to itself.
        expect(name).not.toBe('profile');
        expect(findLeafByRouteName(name), `index ${name}`).toBeNull();
      }
    });
  });

  // The page header reads the index level from the matched record's meta and
  // a leaf's title from its route name, so pin both against the real table.
  describe('calendar page header', () => {
    const HeaderOnly = { components: { PageHeader }, template: '<PageHeader />' };
    let wrapper: VueWrapper | null = null;

    afterEach(() => {
      wrapper?.unmount();
      wrapper = null;
    });

    async function headerAt(path: string): Promise<{ wrapper: VueWrapper; router: Router }> {
      const pinia = createPinia();
      setActivePinia(pinia);
      const calendar = new Calendar('o1', 'riverside');
      calendar.content('en').name = 'Riverside Arts';
      const infos = [new CalendarInfo(calendar, 'owner')];
      useCalendarStore().setCalendarInfos(infos);
      // The calendar gate loads the viewer's list on entry.
      (CalendarService.prototype.ensureCalendarsLoaded as sinon.SinonStub).callsFake(async () => {
        useCalendarStore().setCalendarInfos(infos);
        return infos;
      });
      const router = routerAt(false);
      await router.push(path);
      wrapper = mountComponent(HeaderOnly, router, { pinia });
      await flushPromises();
      return { wrapper, router };
    }

    it('titles the calendar index with the calendar name, which is the switcher', async () => {
      const { wrapper: w, router } = await headerAt('/settings/calendar/riverside');

      expect(router.currentRoute.value.name).toBe('calendar_management');
      expect(w.findAll('h1')).toHaveLength(1);
      expect(w.find('h1').text()).toBe('Riverside Arts');
      expect(w.find('h1 button.calendar-switcher').exists()).toBe(true);
      expect(w.find('.settings-page-header__eyebrow').exists()).toBe(false);
      expect(w.findComponent(CalendarSwitcher).props('routeName')).toBe('calendar_management');
    });

    it('titles a calendar leaf as the leaf, with the switcher in the eyebrow', async () => {
      const { wrapper: w, router } = await headerAt('/settings/calendar/riverside/editors');

      expect(router.currentRoute.value.name).toBe('calendar_editors');
      expect(w.findAll('h1')).toHaveLength(1);
      expect(w.find('h1').text()).toBe('Editors');
      expect(w.find('.settings-page-header__eyebrow button.calendar-switcher').exists()).toBe(true);
      expect(w.findComponent(CalendarSwitcher).props('routeName')).toBe('calendar_editors');
    });
  });

  describe('admin page header', () => {
    const HeaderOnly = { components: { PageHeader }, template: '<PageHeader />' };
    let wrapper: VueWrapper | null = null;

    afterEach(() => {
      wrapper?.unmount();
      wrapper = null;
    });

    async function headerAt(path: string): Promise<{ wrapper: VueWrapper; router: Router }> {
      const router = routerAt(false, adminAccessGuards, true);
      await router.push(path);
      wrapper = mountComponent(HeaderOnly, router, { pinia });
      await flushPromises();
      return { wrapper, router };
    }

    it('titles the admin index as the Instance section, back to Settings', async () => {
      const { wrapper: w, router } = await headerAt('/settings/admin');

      expect(router.currentRoute.value.name).toBe('admin');
      expect(w.findAll('h1')).toHaveLength(1);
      expect(w.find('h1').text()).toBe('Instance');
      expect(w.find('.settings-page-header__eyebrow').exists()).toBe(false);
      const back = w.find('a.settings-page-header__back');
      expect(back.attributes('href')).toBe('/settings');
      expect(back.text()).toBe('Back to Settings');
    });

    it('titles a leaf as its leaf under an Instance eyebrow, back to Instance', async () => {
      const { wrapper: w, router } = await headerAt('/settings/admin/federation');

      expect(router.currentRoute.value.name).toBe('federation');
      expect(w.findAll('h1')).toHaveLength(1);
      expect(w.find('h1').text()).toBe('Federation');
      expect(w.find('.settings-page-header__eyebrow').text()).toBe('Instance');
      const back = w.find('a.settings-page-header__back');
      expect(back.attributes('href')).toBe('/settings/admin');
      expect(back.text()).toBe('Back to Instance');
    });

    it.each([
      ['/settings/admin/moderation/settings', 'moderation_settings', 'Moderation Settings'],
      ['/settings/admin/moderation/blocked-instances', 'blocked_instances', 'Blocked Instances'],
    ])('titles the sub-page %s as itself, with Moderation in the eyebrow and the back link', async (path, name, title) => {
      const { wrapper: w, router } = await headerAt(path);

      expect(router.currentRoute.value.name).toBe(name);
      expect(w.findAll('h1')).toHaveLength(1);
      expect(w.find('h1').text()).toBe(title);
      const parent = w.find('.settings-page-header__eyebrow a');
      expect(parent.attributes('href')).toBe('/settings/admin/moderation');
      expect(parent.text()).toBe('Moderation');
      const back = w.find('a.settings-page-header__back');
      expect(back.attributes('href')).toBe('/settings/admin/moderation');
      expect(back.text()).toBe('Back to Moderation');
    });
  });

  // The real settings layout and calendar-management/root.vue, under the
  // stand-in app shell mocked at the top of this file.
  describe('in the real settings layout', () => {
    const session = { isLoggedIn: () => true, isAdmin: () => false, logout: () => {} };
    let wrapper: VueWrapper | null = null;
    let axiosGet: sinon.SinonStub;

    beforeEach(() => {
      // A tripwire: any per-calendar request the layout makes sees the two
      // unresolved cases differently.
      axiosGet = sandbox.stub(axios, 'get');
    });

    afterEach(() => {
      wrapper?.unmount();
      wrapper = null;
      document.body.innerHTML = '';
    });

    async function mountAt(path: string, sidebar: boolean): Promise<{ wrapper: VueWrapper; router: Router }> {
      const router = routerAt(sidebar);
      await router.push(path);
      await router.isReady();
      wrapper = mountComponent({ template: '<RouterView />' }, router, {
        pinia, attachTo: document.body, provide: { authn: session },
      });
      await flushPromises();
      return { wrapper, router };
    }

    it('offers Log out in the root list below md, as a button that signs the viewer out', async () => {
      viewerHolds(owned('o1', 'riverside'));
      const { wrapper: w, router } = await mountAt('/settings', false);

      expect(w.findAll('h1')).toHaveLength(1);
      const rows = w.findAll('.settings-list-page ul > li');
      expect(rows.length).toBeGreaterThan(1);
      const logOut = rows[rows.length - 1].find('button');
      expect(logOut.exists()).toBe(true);
      expect(logOut.text()).toBe('Log out');

      await logOut.trigger('click');
      await flushPromises();
      expect(router.currentRoute.value.name).toBe('logout');
    });

    describe('a calendar the viewer does not hold', () => {
      const notFound = Object.assign(new Error('Not Found'), { response: { status: 404 } });
      beforeEach(() => {
        // The empty state draws its heading id from Math.random; pin it so
        // the two renders can be compared whole.
        sandbox.stub(Math, 'random').returns(0.5);
      });

      /**
       * What the viewer sees at `path` when `harbour` is another account's
       * calendar (the instance serves it, and a stale selection on this
       * browser names it) or no calendar at all. The viewer holds only
       * riverside in both cases.
       */
      async function seenAt(path: string, sidebar: boolean, harbour: 'another account' | 'nonexistent') {
        wrapper?.unmount();
        document.body.innerHTML = '';
        pinia = createPinia();
        setActivePinia(pinia);
        viewerHolds(owned('o1', 'riverside'));
        if (harbour === 'another account') {
          useCalendarStore().selectedCalendarId = 'h1';
          axiosGet.callsFake(async (url: string) => {
            if (url.includes('harbour') || url.includes('h1')) {
              return { data: { id: 'h1', urlName: 'harbour', userRelationship: 'owner' } };
            }
            throw notFound;
          });
        }
        else {
          axiosGet.rejects(notFound);
        }

        const { wrapper: w, router } = await mountAt(path, sidebar);
        return {
          fullPath: router.currentRoute.value.fullPath,
          title: document.title,
          h1: w.find('h1').text(),
          html: document.body.innerHTML,
        };
      }

      it.each([
        ['/settings/calendar/harbour', false],
        ['/settings/calendar/harbour', true],
        ['/settings/calendar/harbour/general', false],
        ['/settings/calendar/harbour/general', true],
      ])('renders %s identically for either, at the unchanged URL (md+ = %s)', async (path, sidebar) => {
        const another = await seenAt(path, sidebar, 'another account');
        const nonexistent = await seenAt(path, sidebar, 'nonexistent');

        expect(another).toEqual(nonexistent);
        expect(another.fullPath).toBe(path);
        expect(another.html).toContain('calendar-management-root');
        expect(another.html).not.toContain('harbour');
        // No per-calendar request in either case, by url name or stored id.
        const requested = axiosGet.getCalls().map((call) => String(call.args[0]));
        expect(requested.filter((url) => url.includes('harbour') || url.includes('h1'))).toEqual([]);
      });
    });
  });
});
