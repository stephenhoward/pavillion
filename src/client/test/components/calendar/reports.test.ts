import { expect, describe, it, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, h, type Component } from 'vue';
import { createMemoryHistory, createRouter, type Router, type RouteRecordRaw } from 'vue-router';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia, type Pinia } from 'pinia';

import { Calendar } from '@/common/model/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';
import { mountComponent } from '@/client/test/lib/vue';
import CalendarManagementRoot from '@/client/components/logged_in/calendar-management/root.vue';
import CalendarReports from '@/client/components/logged_in/calendar-management/reports.vue';
import CalendarService from '@/client/service/calendar';
import FundingService from '@/client/service/funding';
import ModerationService from '@/client/service/moderation';
import { useModerationStore } from '@/client/stores/moderation-store';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { Report, ReportCategory, ReportStatus } from '@/common/model/report';

/*
 * The calendar Reports leaf under the real calendar-management/root.vue gate:
 * how a reports/:reportId path resolves, falls back and takes focus. The
 * dashboard and (unless a test asks for the real one) the detail view are
 * stand-ins, so what is under test is the leaf's gate, its route handling and
 * its report region. The app renders a settings-style page heading so focus
 * moves to it can be observed.
 */

// Strict v4 shape, matching the server's path-parameter validation.
const REPORT_ID = '9f8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';
const OTHER_REPORT_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
// Same shape but version 1: the server rejects it, so the client must too.
const NON_V4_REPORT_ID = '9f8b7c6d-5e4f-1a3b-9c2d-1e0f9a8b7c6d';

const LIST_PATH = '/settings/calendar/my-calendar/reports';
const detailPath = (reportId: string) => `${LIST_PATH}/${reportId}`;

vi.mock('@/client/components/moderation/reports-dashboard.vue', () => ({
  default: defineComponent({
    name: 'ReportsDashboard',
    props: ['calendarId'],
    emits: ['view-report'],
    setup(_props, { emit }) {
      return () => h('div', { 'data-dashboard': '' }, [
        h('button', { class: 'open-report', onClick: () => emit('view-report', REPORT_ID) }, 'Open'),
      ]);
    },
  }),
}));

/** Whether the detail slot renders the real ReportDetail instead of the stand-in. */
const detail = vi.hoisted(() => ({ real: false }));

vi.mock('@/client/components/moderation/report-detail.vue', async (importOriginal) => {
  const actual = await importOriginal<{ default: Component }>();
  const StandIn = defineComponent({
    name: 'ReportDetailStandIn',
    props: ['calendarId', 'reportId'],
    setup(props) {
      return () => h('div', { 'data-report-detail': props.reportId });
    },
  });
  return {
    default: defineComponent({
      name: 'ReportDetail',
      props: ['calendarId', 'reportId', 'fetchedReport'],
      setup(props) {
        return () => h(detail.real ? actual.default : StandIn, props);
      },
    }),
  };
});

const Leaf = defineComponent({ props: ['calendarId', 'isOwner', 'instanceHost', 'calendarUrlName'], render: () => h('div') });
const EditorsLeaf = defineComponent({ props: ['calendarId', 'isOwner'], render: () => h('div', { 'data-editors': '' }) });
const WidgetLeaf = defineComponent({ props: ['calendarId', 'isOwner', 'calendarUrlName'], render: () => h('div', { 'data-widget': '' }) });

function buildRouter(): Router {
  const routes: RouteRecordRaw[] = [
    { path: '/settings/calendar/:calendar', component: CalendarManagementRoot, children: [
      { path: '', name: 'calendar_management', component: Leaf },
      { path: 'general', name: 'calendar_general', component: Leaf },
      { path: 'editors', name: 'calendar_editors', component: EditorsLeaf },
      { path: 'reports', name: 'calendar_reports', component: CalendarReports },
      { path: 'reports/:reportId', name: 'calendar_report_detail', component: CalendarReports },
      { path: 'import', name: 'calendar_import', component: Leaf },
      { path: 'widget', name: 'calendar_widget', component: WidgetLeaf },
    ] },
    { path: '/admin/moderation/reports/:reportId', name: 'moderation_report_detail', component: Leaf },
  ];
  return createRouter({ history: createMemoryHistory(), routes });
}

const App = {
  template: '<div><h1 class="settings-page-header__title" tabindex="-1">Report Details</h1><RouterView /></div>',
};

const calendarInfo = (id: string, urlName: string, role: 'owner' | 'editor') =>
  new CalendarInfo(new Calendar(id, urlName), role);

const viewerHas = (...infos: CalendarInfo[]) =>
  vi.spyOn(CalendarService.prototype, 'ensureCalendarsLoaded').mockImplementation(async () => {
    useCalendarStore().setCalendarInfos(infos);
    return infos;
  });

const mockReportFound = () =>
  vi.spyOn(ModerationService.prototype, 'getReport').mockResolvedValue({
    report: {} as any,
    escalationHistory: [],
  });

const mockReportMissing = () =>
  vi.spyOn(ModerationService.prototype, 'getReport').mockRejectedValue(new Error('Report not found'));

/**
 * Rejects the way the service does for a 403: `handleApiError` maps the
 * response's `errorName` to a `ForbiddenError` instance and throws it.
 */
const mockReportForbidden = () => {
  const forbidden = new Error('You do not have permission to perform this action');
  forbidden.name = 'ForbiddenError';
  return vi.spyOn(ModerationService.prototype, 'getReport').mockRejectedValue(forbidden);
};

/** The report exists, but on another calendar: the server answers 404 for this one. */
const mockReportOnOtherCalendar = () =>
  vi.spyOn(ModerationService.prototype, 'getReport').mockImplementation(async (calendarId) => {
    if (calendarId !== 'cal-uuid-2') {
      throw new Error('Report not found');
    }
    return { report: {} as any, escalationHistory: [] };
  });

describe('Calendar reports leaf', () => {
  let pinia: Pinia;
  let router: Router;
  let wrapper: VueWrapper | null;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    wrapper = null;
    detail.real = false;
    viewerHas(calendarInfo('cal-uuid-1', 'my-calendar', 'owner'), calendarInfo('cal-uuid-2', 'other', 'owner'));
    vi.spyOn(FundingService.prototype, 'ensureInstanceFundingLoaded').mockResolvedValue(false);
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  /** Navigates to `path` before mounting (a cold load), then mounts the app there. */
  async function mountAt(path: string): Promise<VueWrapper> {
    router = buildRouter();
    await router.push(path);
    await router.isReady();
    wrapper = mountComponent(App, router, { pinia, attachTo: document.body });
    await flushPromises();
    return wrapper;
  }

  async function navigate(path: string): Promise<void> {
    await router.push(path);
    await flushPromises();
  }

  /** The markup of a plain list mount, which every failed resolve must equal. */
  async function listBaseline(): Promise<string> {
    const w = await mountAt(LIST_PATH);
    const html = w.html();
    w.unmount();
    wrapper = null;
    document.body.innerHTML = '';
    return html;
  }

  const region = (w: VueWrapper) => w.find('[role="region"]');
  const pageHeading = () => document.querySelector('h1.settings-page-header__title');
  const fullPath = () => router.currentRoute.value.fullPath;

  describe('opening a report', () => {
    it('opens the report on a cold load as owner, resolved on this calendar', async () => {
      const getReport = mockReportFound();

      const w = await mountAt(detailPath(REPORT_ID));

      expect(getReport).toHaveBeenCalledWith('cal-uuid-1', REPORT_ID);
      expect(w.find(`[data-report-detail="${REPORT_ID}"]`).exists()).toBe(true);
      expect(w.find('[data-dashboard]').exists()).toBe(false);
      expect(fullPath()).toBe(detailPath(REPORT_ID));
    });

    it('moves focus to a report region named like the page title', async () => {
      mockReportFound();

      const w = await mountAt(detailPath(REPORT_ID));

      const el = region(w);
      expect(el.attributes('tabindex')).toBe('-1');
      expect(el.attributes('aria-labelledby')).toBeUndefined();
      expect(el.attributes('aria-label')).toBe('Report Details');
      expect(document.activeElement).toBe(el.element);
    });

    it('opens a report picked from the list', async () => {
      const getReport = mockReportFound();
      const w = await mountAt(LIST_PATH);

      await w.find('.open-report').trigger('click');
      await flushPromises();

      expect(fullPath()).toBe(detailPath(REPORT_ID));
      expect(getReport).toHaveBeenCalledWith('cal-uuid-1', REPORT_ID);
      expect(w.find(`[data-report-detail="${REPORT_ID}"]`).exists()).toBe(true);
    });

    it('opens the new report when the reportId changes on the mounted leaf', async () => {
      const getReport = mockReportFound();
      const w = await mountAt(detailPath(REPORT_ID));

      await navigate(detailPath(OTHER_REPORT_ID));

      expect(getReport).toHaveBeenLastCalledWith('cal-uuid-1', OTHER_REPORT_ID);
      expect(w.find(`[data-report-detail="${OTHER_REPORT_ID}"]`).exists()).toBe(true);
      expect(w.find(`[data-report-detail="${REPORT_ID}"]`).exists()).toBe(false);
      expect(document.activeElement).toBe(region(w).element);
    });

    it('ignores a resolve that lands after the viewer has moved on', async () => {
      let resolveFirst!: () => void;
      vi.spyOn(ModerationService.prototype, 'getReport').mockImplementation(() =>
        new Promise((resolve) => {
          resolveFirst = () => resolve({ report: {} as any, escalationHistory: [] });
        }));
      const w = await mountAt(detailPath(REPORT_ID));

      await navigate(LIST_PATH);
      resolveFirst();
      await flushPromises();

      expect(fullPath()).toBe(LIST_PATH);
      expect(w.find('[data-report-detail]').exists()).toBe(false);
      expect(w.find('[data-dashboard]').exists()).toBe(true);
    });

    // The page header's back and eyebrow links are the way back; they move
    // focus to the h1 themselves (page-header.test.ts, settings/root.test.ts).
    it('closes the report when the route returns to the list', async () => {
      const getReport = mockReportFound();
      const w = await mountAt(detailPath(REPORT_ID));

      await navigate(LIST_PATH);

      expect(getReport).toHaveBeenCalledTimes(1);
      expect(w.find('[data-dashboard]').exists()).toBe(true);
      expect(region(w).exists()).toBe(false);
    });

    it('fetches the report once: the leaf\'s scoped check supplies the detail view', async () => {
      detail.real = true;
      const report = new Report(REPORT_ID);
      report.calendarId = 'cal-uuid-1';
      report.category = ReportCategory.INAPPROPRIATE;
      report.status = ReportStatus.SUBMITTED;
      report.reporterType = 'anonymous';
      report.description = 'Misleading listing';
      // The store's fetchReport goes through the same service method, so this
      // spy counts every GET for the report, whichever layer sends it.
      const getReport = vi.spyOn(ModerationService.prototype, 'getReport')
        .mockResolvedValue({ report, escalationHistory: [] });

      const w = await mountAt(detailPath(REPORT_ID));

      expect(getReport).toHaveBeenCalledTimes(1);
      expect(getReport).toHaveBeenCalledWith('cal-uuid-1', REPORT_ID);
      expect(w.text()).toContain('Misleading listing');

      // Named like the page h1 from the moment it opens; the page h1 titles
      // the report, and the detail adds no heading of its own.
      expect(region(w).attributes('aria-label')).toBe('Report Details');
      expect(region(w).find('.report-detail__title').exists()).toBe(false);
      expect(document.activeElement).toBe(region(w).element);
      // The region is the one landmark carrying that name.
      expect(w.findAll('[aria-label="Report Details"]').map((el) => el.element)).toEqual([region(w).element]);
    });

    it('issues no request on the list route', async () => {
      const getReport = mockReportFound();

      const w = await mountAt(LIST_PATH);

      expect(getReport).not.toHaveBeenCalled();
      expect(w.find('[data-dashboard]').exists()).toBe(true);
    });
  });

  describe('falling back to the list', () => {
    it.each([
      ['malformed', 'not-a-uuid'],
      ['well-formed but non-v4', NON_V4_REPORT_ID],
    ])('issues no request and replaces to the list for a %s id', async (_label, reportId) => {
      const baseline = await listBaseline();
      const getReport = mockReportFound();

      const w = await mountAt(detailPath(reportId));

      expect(getReport).not.toHaveBeenCalled();
      expect(fullPath()).toBe(LIST_PATH);
      expect(w.html()).toBe(baseline);
      expect(document.activeElement).toBe(document.body);
    });

    it.each([
      ['does not exist', mockReportMissing],
      ['is forbidden', mockReportForbidden],
      ['belongs to another calendar', mockReportOnOtherCalendar],
    ])('replaces to a view identical to the list when the report %s', async (_label, mockFailure) => {
      const baseline = await listBaseline();
      const getReport = mockFailure();

      const w = await mountAt(detailPath(REPORT_ID));

      // Scoped to this calendar: the id is never tried against another one.
      expect(getReport).toHaveBeenCalledTimes(1);
      expect(getReport).toHaveBeenCalledWith('cal-uuid-1', REPORT_ID);
      expect(fullPath()).toBe(LIST_PATH);
      expect(w.html()).toBe(baseline);
      expect(document.activeElement).toBe(document.body);
    });

    it('replaces to the list, focusing the page heading, when a report opened in-app gives way to a failing one', async () => {
      const getReport = mockReportFound();
      const w = await mountAt(LIST_PATH);
      await w.find('.open-report').trigger('click');
      await flushPromises();
      expect(w.find(`[data-report-detail="${REPORT_ID}"]`).exists()).toBe(true);
      getReport.mockRejectedValue(new Error('Report not found'));

      await navigate(detailPath(OTHER_REPORT_ID));

      expect(fullPath()).toBe(LIST_PATH);
      expect(w.find('[data-report-detail]').exists()).toBe(false);
      expect(w.find('[data-dashboard]').exists()).toBe(true);
      expect(document.activeElement).toBe(pageHeading());
    });

    it.each([
      ['another calendar\'s report path', '/settings/calendar/other/reports/' + REPORT_ID],
      ['the admin report detail', '/admin/moderation/reports/' + REPORT_ID],
    ])('drops a failure that settles after the viewer moved to %s', async (_label, destination) => {
      let rejectFirst!: (error: Error) => void;
      const getReport = vi.spyOn(ModerationService.prototype, 'getReport').mockImplementationOnce(() =>
        new Promise((_resolve, reject) => {
          rejectFirst = reject;
        }));
      getReport.mockResolvedValue({ report: {} as any, escalationHistory: [] });
      await mountAt(detailPath(REPORT_ID));
      await navigate(destination);
      const replace = vi.spyOn(router, 'replace');

      rejectFirst(new Error('Report not found'));
      await flushPromises();

      expect(replace).not.toHaveBeenCalled();
      expect(fullPath()).toBe(destination);
    });

    it('never mounts the leaf or requests the report for a non-owner', async () => {
      vi.restoreAllMocks();
      viewerHas(calendarInfo('cal-uuid-1', 'my-calendar', 'editor'));
      vi.spyOn(FundingService.prototype, 'ensureInstanceFundingLoaded').mockResolvedValue(false);
      const getReport = mockReportFound();

      const w = await mountAt(detailPath(REPORT_ID));

      expect(getReport).not.toHaveBeenCalled();
      expect(fullPath()).toBe('/settings/calendar/my-calendar/widget');
      expect(w.find('[data-widget]').exists()).toBe(true);
      expect(w.find('[data-dashboard]').exists()).toBe(false);
      expect(region(w).exists()).toBe(false);
    });

    /**
     * The leaf resolves through `ModerationService` directly rather than
     * `useModerationStore().fetchReport`, which sets `store.error` and rethrows.
     * Routing it through the store would leave a stale error behind for the
     * next time the list is opened, so pin that the store stays untouched.
     */
    it.each([
      ['does not exist', mockReportMissing],
      ['is forbidden', mockReportForbidden],
    ])('leaves the moderation store untouched when the report %s', async (_label, mockFailure) => {
      mockFailure();

      await mountAt(detailPath(REPORT_ID));

      const store = useModerationStore(pinia);
      expect(store.error).toBeNull();
      expect(store.currentReport).toBeNull();
    });
  });
});
