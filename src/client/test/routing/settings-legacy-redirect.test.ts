import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, type NavigationGuard, type Router } from 'vue-router';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { Calendar } from '@/common/model/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';
import { mountComponent } from '@/client/test/lib/vue';
import { installMatchMedia, type FakeMatchMedia } from '@/client/test/lib/match-media';
import { buildClientRoutes } from '@/client/routes';
import { createRouteGuards } from '@/client/service/route-guards';
import { createSettingsGuards, historyPath } from '@/client/service/settings-guards';
import CalendarService from '@/client/service/calendar';
import FundingService from '@/client/service/funding';
import ModerationService from '@/client/service/moderation';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { useShellLayout, resetShellLayoutForTesting } from '@/client/composables/useShellLayout';

/*
 * The temporary `?tab=reports[&report=<uuid>]` redirect on the real route
 * table with the real settings guards, at both viewports. Every outcome must
 * be a fixed internal route: no query value is echoed into a target, and the
 * index record's own guards still run.
 */

/** A stand-in that renders its own name and nothing else. */
function stub(name: string) {
  return { default: defineComponent({ name, render: () => h('div', { 'data-stub': name }) }) };
}

vi.mock('@/client/components/logged_in/root.vue', () => ({
  default: defineComponent({ name: 'AppShell', template: '<RouterView />' }),
}));
vi.mock('@/client/components/logged_in/settings/profile.vue', () => stub('ProfileLeaf'));
vi.mock('@/client/components/logged_in/calendar-management/settings.vue', () => stub('GeneralLeaf'));
vi.mock('@/client/components/logged_in/calendar-management/editors.vue', () => stub('EditorsLeaf'));
vi.mock('@/client/components/logged_in/calendar-management/import-sources/ImportSourcesSection.vue', () => stub('ImportLeaf'));
vi.mock('@/client/components/logged_in/calendar-management/widget-tab.vue', () => stub('WidgetLeaf'));
// The reports leaf itself is real, so a mount shows up as a getReport call.
vi.mock('@/client/components/moderation/reports-dashboard.vue', () => stub('ReportsDashboard'));
vi.mock('@/client/components/moderation/report-detail.vue', () => stub('ReportDetail'));

const REPORT_ID = '9f8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';
const NON_V4_REPORT_ID = '9f8b7c6d-5e4f-1a3b-9c2d-1e0f9a8b7c6d';

const INDEX = '/settings/calendar/cal';
const REPORTS = `${INDEX}/reports`;

describe.each([
  ['page mode', false],
  ['md+', true],
])('legacy ?tab=reports redirect (%s)', (_label, sidebar) => {
  let pinia: Pinia;
  let media: FakeMatchMedia;
  let router: Router;
  let loggedIn: boolean;
  /** The route name each mustBeLoggedIn call was asked about, in call order. */
  let loginChecks: unknown[];

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    const infos = [
      new CalendarInfo(new Calendar('c1', 'cal'), 'owner'),
      new CalendarInfo(new Calendar('c2', 'shared'), 'editor'),
    ];
    vi.spyOn(CalendarService.prototype, 'ensureCalendarsLoaded').mockImplementation(async () => {
      useCalendarStore().setCalendarInfos(infos);
      return infos;
    });
    vi.spyOn(FundingService.prototype, 'ensureInstanceFundingLoaded').mockResolvedValue(false);

    resetShellLayoutForTesting();
    media = installMatchMedia(sidebar);

    loggedIn = true;
    loginChecks = [];
    const mustBeLoggedIn: NavigationGuard = (to) => {
      loginChecks.push(to.name);
      return loggedIn ? true : { name: 'login' };
    };

    router = createRouter({
      history: createMemoryHistory(),
      routes: buildClientRoutes({
        ...createRouteGuards({ isLoggedIn: () => loggedIn, isAdmin: () => false }, () => false),
        mustBeLoggedIn,
        currentCalendarRedirect: () => () => true,
        ...createSettingsGuards({
          loadCalendars: () => new CalendarService().ensureCalendarsLoaded(),
          isAdmin: () => false,
          loadInstanceFunding: () => new FundingService().ensureInstanceFundingLoaded(),
          treeIsSidebar: () => useShellLayout().mainNavIsSidebar.value,
          historyLocation: () => historyPath(router),
        }),
      }),
    });
  });

  afterEach(() => {
    resetShellLayoutForTesting();
    media.restore();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const current = () => router.currentRoute.value;

  it('maps tab=reports onto the reports leaf, with no query', async () => {
    await router.push(`${INDEX}?tab=reports`);

    expect(current().name).toBe('calendar_reports');
    expect(current().fullPath).toBe(REPORTS);
  });

  it('maps tab=reports&report=<uuid> onto that report', async () => {
    await router.push(`${INDEX}?tab=reports&report=${REPORT_ID}`);

    expect(current().name).toBe('calendar_report_detail');
    expect(current().params.reportId).toBe(REPORT_ID);
    expect(current().fullPath).toBe(`${REPORTS}/${REPORT_ID}`);
  });

  it('never carries another query key', async () => {
    await router.push(`${INDEX}?tab=reports&report=${REPORT_ID}&foo=bar`);

    expect(current().fullPath).toBe(`${REPORTS}/${REPORT_ID}`);
  });

  it.each([
    ['a malformed report', 'report=not-a-uuid'],
    ['a non-v4 report', `report=${NON_V4_REPORT_ID}`],
    ['an array report', `report=${REPORT_ID}&report=${REPORT_ID}`],
    ['an empty report', 'report='],
  ])('lands on the reports list for %s', async (_case, reportQuery) => {
    await router.push(`${INDEX}?tab=reports&${reportQuery}`);

    expect(current().name).toBe('calendar_reports');
    expect(current().fullPath).toBe(REPORTS);
  });

  it.each([
    ['an array tab', 'tab=reports&tab=x'],
    ['__proto__', 'tab=__proto__'],
    ['a path-like tab', `tab=${encodeURIComponent('../../admin')}`],
    ['a protocol-relative tab', `tab=${encodeURIComponent('//evil.example')}`],
    ['another retired tab', 'tab=settings'],
    ['a differently cased tab', 'tab=Reports'],
  ])('does not map %s: the index behaves as it would without it', async (_case, query) => {
    await router.push(`${INDEX}?${query}&report=${REPORT_ID}`);

    if (sidebar) {
      // The index forward targets a fixed named leaf and drops the query.
      expect(current().name).toBe('calendar_general');
      expect(current().fullPath).toBe(`${INDEX}/general`);
    }
    else {
      expect(current().name).toBe('calendar_management');
      expect(current().path).toBe(INDEX);
    }
  });

  it('still runs mustBeLoggedIn on the index record before redirecting', async () => {
    await router.push(`${INDEX}/editors`);
    loginChecks = [];

    await router.push(`${INDEX}?tab=reports`);

    // The index record's own check, then the reports record's after the redirect.
    expect(loginChecks).toEqual(['calendar_management', 'calendar_reports']);
    expect(current().fullPath).toBe(REPORTS);
  });

  it('sends a logged-out viewer to login, never to the reports leaf', async () => {
    await router.push(`${INDEX}/editors`);
    loggedIn = false;
    loginChecks = [];

    await router.push(`${INDEX}?tab=reports&report=${REPORT_ID}`);

    expect(current().name).toBe('login');
    expect(loginChecks).toEqual(['calendar_management']);
  });

  describe('for an editor', () => {
    let wrapper: VueWrapper | null = null;

    afterEach(() => {
      wrapper?.unmount();
      wrapper = null;
    });

    it('goes legacy redirect, then the owner gate, to editors without mounting reports', async () => {
      const getReport = vi.spyOn(ModerationService.prototype, 'getReport');
      const committed: string[] = [];
      router.afterEach((to, _from, failure) => {
        if (!failure) {
          committed.push(to.fullPath);
        }
      });

      await router.push(`/settings/calendar/shared?tab=reports&report=${REPORT_ID}`);
      await router.isReady();
      wrapper = mountComponent({ template: '<RouterView />' }, router, { pinia, attachTo: document.body });
      await flushPromises();

      expect(committed).toEqual(['/settings/calendar/shared/editors']);
      expect(current().fullPath).toBe('/settings/calendar/shared/editors');
      expect(wrapper.find('[data-stub="EditorsLeaf"]').exists()).toBe(true);
      expect(wrapper.find('[data-stub="ReportsDashboard"]').exists()).toBe(false);
      expect(wrapper.find('[data-stub="ReportDetail"]').exists()).toBe(false);
      expect(getReport).not.toHaveBeenCalled();
    });
  });
});
