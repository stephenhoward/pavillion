import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, type NavigationGuard, type RouteRecordRaw, type Router } from 'vue-router';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { Calendar } from '@/common/model/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';
import { mountComponent } from '@/client/test/lib/vue';
import PageHeader from '@/client/components/logged_in/settings/page-header.vue';
import CalendarSwitcher from '@/client/components/logged_in/calendar-switcher/CalendarSwitcher.vue';
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

/** The real access guards for a session; kept by callers for identity checks. */
function accessGuardsFor(loggedIn: boolean) {
  return createRouteGuards({ isLoggedIn: () => loggedIn, isAdmin: () => false }, () => false);
}

/** The access guards of a signed-in, non-admin session. */
const accessGuards = accessGuardsFor(true);

/** The real client route table behind the real access and settings guards. */
function buildRoutes(access = accessGuards): RouteRecordRaw[] {
  return buildClientRoutes({
    ...access,
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
  calendar: 'calendar/:calendar',
  account: 'account',
};

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
  function routerAt(sidebar: boolean, access = accessGuards): Router {
    media.setMatches(sidebar);
    return createRouter({ history: createMemoryHistory(), routes: buildRoutes(access) });
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

    it('replaces the history entry when it forwards at md+', async () => {
      const router = routerAt(true);
      await router.push('/settings/account/security');
      const push = sandbox.spy(router.options.history, 'push');
      const replace = sandbox.spy(router.options.history, 'replace');

      await router.push('/settings/account');

      expect(router.currentRoute.value.name).toBe('profile');
      expect(push.called).toBe(false);
      expect(replace.calledOnceWith('/settings/account/profile')).toBe(true);
    });
  });

  describe('calendar leaf gate', () => {
    const loadStub = () => CalendarService.prototype.ensureCalendarsLoaded as sinon.SinonStub;

    function viewerHas(role: 'owner' | 'editor') {
      const infos = [new CalendarInfo(new Calendar('c1', 'shared'), role)];
      loadStub().callsFake(async () => {
        useCalendarStore().setCalendarInfos(infos);
        return infos;
      });
    }

    it.each([
      ['/settings/calendar/shared/general'],
      ['/settings/calendar/shared/reports/9f8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d'],
      ['/settings/calendar/shared?tab=reports&report=9f8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d'],
    ])('replaces an editor entering %s with editors, query dropped', async (path) => {
      viewerHas('editor');
      const router = routerAt(false);
      await router.push(path);
      expect(router.currentRoute.value.fullPath).toBe('/settings/calendar/shared/editors');
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
      '/settings/account',
      '/settings/account/security',
      '/settings/account/funding',
    ])('sends %s to login', async (path) => {
      const router = routerAt(true, accessGuardsFor(false));
      await router.push(path);
      expect(router.currentRoute.value.name).toBe('login');
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

    it.each(Object.entries(CONVERTED_GROUP_PATHS) as [SettingsLeafGroup, string][])(
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

    // settings/root.vue keys its pane on these record paths.
    it('matches the group record paths the settings layout keys its pane on', () => {
      const router = createRouter({ history: createMemoryHistory(), routes: buildRoutes() });
      const matchedPaths = (path: string) => router.resolve(path).matched.map((record) => record.path);

      expect(matchedPaths('/settings/admin/settings')).toContain('/settings/admin');
      expect(matchedPaths('/settings/account')).toContain('/settings/account');
      expect(matchedPaths('/settings/account/profile')).toContain('/settings/account/profile');
    });

    it('never names an index record after a leaf or Profile, so no forward can loop', () => {
      const indexes = flatten(settingsRecord(buildRoutes()))
        .map(({ record }) => record)
        .filter((record) => record.meta?.settingsGroup !== undefined);

      expect(indexes.map((record) => record.meta?.settingsGroup)).toEqual(expect.arrayContaining(['calendar', 'account']));
      for (const record of indexes) {
        const group = record.meta!.settingsGroup!;
        const name = String(record.name);
        if (isSettingsLeafGroup(group)) {
          expect(name).toBe(SETTINGS_GROUP_INDEX_ROUTES[group]);
        }
        // Profile is a leaf, and the forward's empty-group fallback: an index
        // named after any leaf (Profile included) would forward to itself.
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

    it('titles the calendar index as its section, with the switcher beside the h1', async () => {
      const { wrapper: w, router } = await headerAt('/settings/calendar/riverside');

      expect(router.currentRoute.value.name).toBe('calendar_management');
      expect(w.findAll('h1')).toHaveLength(1);
      expect(w.find('h1').text()).toBe('Riverside Arts');
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
});
