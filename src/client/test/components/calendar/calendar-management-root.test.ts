import { expect, describe, it, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, useRoute, type Router, type RouteRecordRaw } from 'vue-router';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia, type Pinia } from 'pinia';

import { Calendar } from '@/common/model/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';
import { mountComponent } from '@/client/test/lib/vue';
import { installMatchMedia, type FakeMatchMedia } from '@/client/test/lib/match-media';
import CalendarManagementRoot from '@/client/components/logged_in/calendar-management/root.vue';
import CalendarService from '@/client/service/calendar';
import FundingService from '@/client/service/funding';
import ModerationService from '@/client/service/moderation';
import { createSettingsGuards } from '@/client/service/settings-guards';
import { useShellLayout, resetShellLayoutForTesting } from '@/client/composables/useShellLayout';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { currentAccountId } from '@/client/service/authn';

// A well-formed v4 report id, as a notification deep link carries.
const REPORT_ID = '9f8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';

/** Names of the calendar route stubs mounted so far, in mount order. */
let mounts: string[] = [];

/** A stand-in for a calendar route component: records its mount and declares the props root.vue passes. */
function routeStub(name: string, props: string[], onSetup?: () => void) {
  return defineComponent({
    name,
    props,
    setup() {
      mounts.push(name);
      onSetup?.();
      return () => h('div', { 'data-route-stub': name });
    },
  });
}

const IndexStub = routeStub('IndexStub', []);
const GeneralStub = routeStub('GeneralStub', ['calendarId']);
const EditorsStub = routeStub('EditorsStub', ['calendarId', 'isOwner']);
// Stands in for the reports leaf, fetching a deep-linked report on mount the
// way the detail gate does, so a mount that should not happen shows up as a
// request.
const ReportsStub = routeStub('ReportsStub', ['calendarId'], () => {
  const reportId = useRoute().params.reportId;
  if (typeof reportId === 'string') {
    void new ModerationService().getReport('cal-uuid-1', reportId);
  }
});
const ImportStub = routeStub('ImportStub', ['calendarId', 'instanceHost']);
const WidgetStub = routeStub('WidgetStub', ['calendarId', 'calendarUrlName']);

/** The calendar subtree with the real route names and the real index guards. */
function buildRouter(): Router {
  const guards = createSettingsGuards({
    loadCalendars: () => new CalendarService().ensureCalendarsLoaded(),
    isAdmin: () => false,
    loadInstanceFunding: () => new FundingService().ensureInstanceFundingLoaded(),
    treeIsSidebar: () => useShellLayout().mainNavIsSidebar.value,
  });
  const routes: RouteRecordRaw[] = [
    { path: '/settings/calendar/:calendar', component: CalendarManagementRoot, children: [
      { path: '', name: 'calendar_management', component: IndexStub, meta: { settingsGroup: 'calendar' },
        beforeEnter: [guards.legacyTabReportsRedirect, guards.settingsIndexRedirect('calendar')] },
      { path: 'general', name: 'calendar_general', component: GeneralStub },
      { path: 'editors', name: 'calendar_editors', component: EditorsStub },
      { path: 'reports', name: 'calendar_reports', component: ReportsStub },
      { path: 'reports/:reportId', name: 'calendar_report_detail', component: ReportsStub },
      { path: 'import', name: 'calendar_import', component: ImportStub },
      { path: 'widget', name: 'calendar_widget', component: WidgetStub },
    ] },
    { path: '/settings/account/profile', name: 'profile', component: { render: () => null } },
  ];
  return createRouter({ history: createMemoryHistory(), routes });
}

const App = { template: '<RouterView />' };

/**
 * Stub the load as the real service behaves: it fills the calendar store,
 * which the component reads, tagged with the signed-in account (marking it
 * loaded for that account), and returns the list.
 */
const stubLoadedCalendars = (infos: CalendarInfo[]) =>
  vi.spyOn(CalendarService.prototype, 'ensureCalendarsLoaded').mockImplementation(async () => {
    useCalendarStore().setCalendarInfos(infos, currentAccountId());
    return infos;
  });

const makeCalendarInfo = (urlName: string, role: 'owner' | 'editor'): CalendarInfo => {
  const calendar = new Calendar('cal-uuid-1', urlName);
  return new CalendarInfo(calendar, role);
};

// The empty state draws a random id for its heading; it says nothing about
// the calendar, so markup comparisons ignore it.
const normalizeIds = (html: string) => html.replace(/empty-title-[a-z0-9]+/g, 'empty-title-ID');

describe('CalendarManagementRoot', () => {
  let pinia: Pinia;
  let media: FakeMatchMedia;
  let wrapper: VueWrapper | null;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    mounts = [];
    wrapper = null;
    resetShellLayoutForTesting();
    media = installMatchMedia(false);
    stubLoadedCalendars([]);
    vi.spyOn(FundingService.prototype, 'ensureInstanceFundingLoaded').mockResolvedValue(false);
  });

  afterEach(() => {
    wrapper?.unmount();
    resetShellLayoutForTesting();
    media.restore();
    vi.restoreAllMocks();
  });

  async function mountAt(path: string): Promise<{ wrapper: VueWrapper; router: Router }> {
    const router = buildRouter();
    await router.push(path);
    await router.isReady();
    wrapper = mountComponent(App, router, { pinia });
    await flushPromises();
    return { wrapper, router };
  }

  const status = (w: VueWrapper) => w.find('[role="status"]');

  describe('loading', () => {
    it('mounts no child and announces loading while the calendars load', async () => {
      stubLoadedCalendars([makeCalendarInfo('my-calendar', 'owner')]).mockReturnValue(new Promise(() => {}));

      const { wrapper } = await mountAt('/settings/calendar/my-calendar/editors');

      expect(mounts).toEqual([]);
      expect(status(wrapper).exists()).toBe(true);
      expect(status(wrapper).text()).toBe('Loading calendar…');
      expect(status(wrapper).classes()).toContain('sr-only');
    });

    it('keeps the status region mounted and empties it once resolved', async () => {
      stubLoadedCalendars([makeCalendarInfo('my-calendar', 'owner')]);

      const { wrapper } = await mountAt('/settings/calendar/my-calendar/editors');

      expect(status(wrapper).exists()).toBe(true);
      expect(status(wrapper).text()).toBe('');
      expect(mounts).toEqual(['EditorsStub']);
    });

    it('shows an error and mounts no child when the calendars fail to load', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(CalendarService.prototype, 'ensureCalendarsLoaded').mockRejectedValue(new Error('Network error'));

      const { wrapper } = await mountAt('/settings/calendar/my-calendar/editors');

      expect(wrapper.text()).toContain('Unable to load calendar. Please try again later.');
      expect(mounts).toEqual([]);
    });

    it('shows a not-available message when no calendar matches the route param', async () => {
      stubLoadedCalendars([makeCalendarInfo('other-calendar', 'owner')]);

      const { wrapper } = await mountAt('/settings/calendar/unknown-calendar/editors');

      const emptyState = wrapper.find('.empty-state');
      expect(emptyState.exists()).toBe(true);
      expect(emptyState.text()).toContain('Calendar not available');
      expect(mounts).toEqual([]);
    });
  });

  describe('props', () => {
    it.each([
      ['owner', true],
      ['editor', false],
    ] as const)('passes isOwner to the editors leaf for an %s', async (role, isOwner) => {
      stubLoadedCalendars([makeCalendarInfo('my-calendar', role)]);

      const { wrapper } = await mountAt('/settings/calendar/my-calendar/editors');

      const editors = wrapper.findComponent(EditorsStub);
      expect(editors.exists()).toBe(true);
      expect(editors.props('calendarId')).toBe('cal-uuid-1');
      expect(editors.props('isOwner')).toBe(isOwner);
    });

    it('passes the calendar url name to the widget leaf', async () => {
      stubLoadedCalendars([makeCalendarInfo('my-calendar', 'owner')]);

      const { wrapper } = await mountAt('/settings/calendar/my-calendar/widget');

      expect(wrapper.findComponent(WidgetStub).props('calendarUrlName')).toBe('my-calendar');
    });

    it('renders the index list page for a resolved calendar', async () => {
      stubLoadedCalendars([makeCalendarInfo('my-calendar', 'editor')]);

      const { router } = await mountAt('/settings/calendar/my-calendar');

      expect(router.currentRoute.value.name).toBe('calendar_management');
      expect(mounts).toEqual(['IndexStub']);
    });
  });

  describe('owner-only leaves', () => {
    it.each([
      ['general', 'GeneralStub'],
      ['reports', 'ReportsStub'],
      [`reports/${REPORT_ID}`, 'ReportsStub'],
      ['import', 'ImportStub'],
    ])('replaces an editor at %s with editors, dropping the query', async (leaf, stub) => {
      stubLoadedCalendars([makeCalendarInfo('my-calendar', 'editor')]);

      const router = buildRouter();
      await router.push(`/settings/calendar/my-calendar/${leaf}?foo=bar`);
      await router.isReady();
      const push = vi.spyOn(router.options.history, 'push');
      const replace = vi.spyOn(router.options.history, 'replace');
      wrapper = mountComponent(App, router, { pinia });
      await flushPromises();

      expect(router.currentRoute.value.name).toBe('calendar_editors');
      expect(router.currentRoute.value.fullPath).toBe('/settings/calendar/my-calendar/editors');
      expect(push).not.toHaveBeenCalled();
      expect(replace).toHaveBeenCalledTimes(1);
      expect(mounts).not.toContain(stub);
      expect(mounts).toEqual(['EditorsStub']);
    });

    it('requests no report for an editor at a report detail url', async () => {
      stubLoadedCalendars([makeCalendarInfo('my-calendar', 'editor')]);
      const getReport = vi.spyOn(ModerationService.prototype, 'getReport').mockResolvedValue({
        report: {} as never,
        escalationHistory: [],
      });

      await mountAt(`/settings/calendar/my-calendar/reports/${REPORT_ID}`);

      expect(getReport).not.toHaveBeenCalled();
      expect(mounts).not.toContain('ReportsStub');
    });

    it.each([
      ['editors', 'calendar_editors', 'EditorsStub'],
      ['widget', 'calendar_widget', 'WidgetStub'],
    ])('keeps an editor on %s', async (leaf, name, stub) => {
      stubLoadedCalendars([makeCalendarInfo('my-calendar', 'editor')]);

      const { router } = await mountAt(`/settings/calendar/my-calendar/${leaf}?foo=bar`);

      expect(router.currentRoute.value.name).toBe(name);
      expect(router.currentRoute.value.fullPath).toBe(`/settings/calendar/my-calendar/${leaf}?foo=bar`);
      expect(mounts).toEqual([stub]);
    });

    it.each([
      ['general', 'calendar_general', 'GeneralStub'],
      ['editors', 'calendar_editors', 'EditorsStub'],
      ['reports', 'calendar_reports', 'ReportsStub'],
      [`reports/${REPORT_ID}`, 'calendar_report_detail', 'ReportsStub'],
      ['import', 'calendar_import', 'ImportStub'],
      ['widget', 'calendar_widget', 'WidgetStub'],
    ])('keeps an owner on %s', async (leaf, name, stub) => {
      stubLoadedCalendars([makeCalendarInfo('my-calendar', 'owner')]);
      vi.spyOn(ModerationService.prototype, 'getReport').mockResolvedValue({
        report: {} as never,
        escalationHistory: [],
      });

      const { router } = await mountAt(`/settings/calendar/my-calendar/${leaf}`);

      expect(router.currentRoute.value.name).toBe(name);
      expect(mounts).toEqual([stub]);
    });
  });

  describe('non-member and nonexistent calendars', () => {
    const PARAM = 'secret-calendar';

    /** Mounts at `path` with the given calendar list and captures what the viewer gets. */
    async function outcome(path: string, calendars: CalendarInfo[], sidebar: boolean) {
      pinia = createPinia();
      setActivePinia(pinia);
      mounts = [];
      stubLoadedCalendars(calendars);
      media.setMatches(sidebar);
      const { wrapper: w, router } = await mountAt(path);
      const result = {
        html: normalizeIds(w.html()),
        fullPath: router.currentRoute.value.fullPath,
        mounts: [...mounts],
      };
      w.unmount();
      wrapper = null;
      return result;
    }

    const paths = [
      `/settings/calendar/${PARAM}`,
      `/settings/calendar/${PARAM}/general`,
      `/settings/calendar/${PARAM}/editors`,
      `/settings/calendar/${PARAM}/reports`,
      `/settings/calendar/${PARAM}/reports/${REPORT_ID}`,
      `/settings/calendar/${PARAM}/import`,
      `/settings/calendar/${PARAM}/widget`,
    ];

    describe.each([
      ['below md', false],
      ['at md+', true],
    ])('%s', (_mode, sidebar) => {
      it.each(paths)('renders identical markup at the unchanged url %s', async (path) => {
        const nonMember = await outcome(path, [makeCalendarInfo('other-calendar', 'owner')], sidebar);
        const nonexistent = await outcome(path, [], sidebar);

        expect(nonMember.html).toBe(nonexistent.html);
        expect(nonMember.fullPath).toBe(path);
        expect(nonexistent.fullPath).toBe(path);
        expect(nonMember.html).not.toContain(PARAM);
        expect(nonMember.mounts).toEqual([]);
        expect(nonexistent.mounts).toEqual([]);
      });

      it('treats the legacy ?tab=reports deep link identically', async () => {
        const path = `/settings/calendar/${PARAM}?tab=reports&report=${REPORT_ID}`;
        const getReport = vi.spyOn(ModerationService.prototype, 'getReport');

        const nonMember = await outcome(path, [makeCalendarInfo('other-calendar', 'owner')], sidebar);
        const nonexistent = await outcome(path, [], sidebar);

        expect(nonMember.html).toBe(nonexistent.html);
        expect(nonMember.fullPath).toBe(nonexistent.fullPath);
        expect(nonMember.html).not.toContain(PARAM);
        expect(nonMember.mounts).toEqual([]);
        expect(getReport).not.toHaveBeenCalled();
      });
    });
  });
});
