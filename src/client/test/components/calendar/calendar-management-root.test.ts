import { expect, describe, it, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import { flushPromises } from '@vue/test-utils';

import { Calendar } from '@/common/model/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';
import { mountComponent } from '@/client/test/lib/vue';
import CalendarManagementRoot from '@/client/components/logged_in/calendar-management/root.vue';
import CalendarService from '@/client/service/calendar';
import ModerationService from '@/client/service/moderation';

const routes: RouteRecordRaw[] = [
  { path: '/manage/:calendar', component: {}, name: 'manage' },
  { path: '/test', component: {}, name: 'test' },
];

const mountRootComponent = async (
  calendarUrlName: string = 'my-calendar',
  query: Record<string, string> = {},
  options: { attachTo?: Element | string } = {},
) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });

  // Navigate to the manage route before mounting so route.params.calendar is available
  await router.push({ name: 'manage', params: { calendar: calendarUrlName }, query });
  await router.isReady();

  const wrapper = mountComponent(CalendarManagementRoot, router, {
    stubs: {
      EditorsTab: true,
      SettingsTab: true,
      WidgetTab: true,
      ReportsDashboard: true,
      ReportDetail: true,
      ImportSourcesSection: true,
    },
    ...(options.attachTo ? { attachTo: options.attachTo } : {}),
  });

  return { wrapper, router };
};

const makeCalendarInfo = (urlName: string, role: 'owner' | 'editor'): CalendarInfo => {
  const calendar = new Calendar('cal-uuid-1', urlName);
  return new CalendarInfo(calendar, role);
};

describe('CalendarManagementRoot', () => {
  let currentWrapper: any = null;

  beforeEach(() => {
    // Default: no calendars loaded
    vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([]);
  });

  afterEach(() => {
    if (currentWrapper) {
      currentWrapper.unmount();
      currentWrapper = null;
    }
    vi.restoreAllMocks();
  });

  describe('Default tab', () => {
    it('defaults to editors tab', async () => {
      const info = makeCalendarInfo('my-calendar', 'owner');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar');
      currentWrapper = wrapper;

      await flushPromises();

      expect((wrapper.vm as any).state.activeTab).toBe('editors');
    });
  });

  describe('Tab restoration from query param', () => {
    it('restores settings tab from ?tab=settings for owners', async () => {
      const info = makeCalendarInfo('my-calendar', 'owner');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar', { tab: 'settings' });
      currentWrapper = wrapper;

      await flushPromises();

      expect((wrapper.vm as any).state.activeTab).toBe('settings');
    });

    it('restores widget tab from ?tab=widget for owners', async () => {
      const info = makeCalendarInfo('my-calendar', 'owner');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar', { tab: 'widget' });
      currentWrapper = wrapper;

      await flushPromises();

      expect((wrapper.vm as any).state.activeTab).toBe('widget');
    });

    it('restores reports tab from ?tab=reports for owners', async () => {
      const info = makeCalendarInfo('my-calendar', 'owner');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar', { tab: 'reports' });
      currentWrapper = wrapper;

      await flushPromises();

      expect((wrapper.vm as any).state.activeTab).toBe('reports');
    });

    it('ignores settings tab query param for non-owners', async () => {
      const info = makeCalendarInfo('my-calendar', 'editor');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar', { tab: 'settings' });
      currentWrapper = wrapper;

      await flushPromises();

      expect((wrapper.vm as any).state.activeTab).toBe('editors');
    });

    it('ignores reports tab query param for non-owners', async () => {
      const info = makeCalendarInfo('my-calendar', 'editor');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar', { tab: 'reports' });
      currentWrapper = wrapper;

      await flushPromises();

      expect((wrapper.vm as any).state.activeTab).toBe('editors');
    });

    it('ignores invalid tab query param values', async () => {
      const info = makeCalendarInfo('my-calendar', 'owner');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar', { tab: 'nonexistent' });
      currentWrapper = wrapper;

      await flushPromises();

      expect((wrapper.vm as any).state.activeTab).toBe('editors');
    });

    it('defaults to editors when no tab query param is present', async () => {
      const info = makeCalendarInfo('my-calendar', 'owner');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar');
      currentWrapper = wrapper;

      await flushPromises();

      expect((wrapper.vm as any).state.activeTab).toBe('editors');
    });

    it('allows widget tab for non-owners via query param', async () => {
      const info = makeCalendarInfo('my-calendar', 'editor');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar', { tab: 'widget' });
      currentWrapper = wrapper;

      await flushPromises();

      expect((wrapper.vm as any).state.activeTab).toBe('widget');
    });
  });

  describe('Tab structure', () => {
    it('does not include categories or series tabs', async () => {
      const info = makeCalendarInfo('my-calendar', 'owner');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar');
      currentWrapper = wrapper;

      await flushPromises();

      expect(wrapper.find('#categories-tab').exists()).toBe(false);
      expect(wrapper.find('#series-tab').exists()).toBe(false);
      expect(wrapper.find('#categories-panel').exists()).toBe(false);
      expect(wrapper.find('#series-panel').exists()).toBe(false);
    });

    it('shows Editors, Reports, Settings, Import, Widget tabs for owners', async () => {
      const info = makeCalendarInfo('my-calendar', 'owner');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar');
      currentWrapper = wrapper;

      await flushPromises();

      const tabs = wrapper.findAll('[role="tab"]');
      expect(tabs.length).toBe(5);
      expect(wrapper.find('#editors-tab').exists()).toBe(true);
      expect(wrapper.find('#import-tab').exists()).toBe(true);
      expect(wrapper.find('#reports-tab').exists()).toBe(true);
      expect(wrapper.find('#settings-tab').exists()).toBe(true);
      expect(wrapper.find('#widget-tab').exists()).toBe(true);
    });

    it('shows Editors and Widget tabs for editors', async () => {
      const info = makeCalendarInfo('my-calendar', 'editor');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar');
      currentWrapper = wrapper;

      await flushPromises();

      const tabs = wrapper.findAll('[role="tab"]');
      expect(tabs.length).toBe(2);
      expect(wrapper.find('#editors-tab').exists()).toBe(true);
      expect(wrapper.find('#widget-tab').exists()).toBe(true);
      expect(wrapper.find('#reports-tab').exists()).toBe(false);
      expect(wrapper.find('#settings-tab').exists()).toBe(false);
    });
  });

  describe('Reports tab visibility', () => {
    it('shows the Reports tab button for calendar owners', async () => {
      const info = makeCalendarInfo('my-calendar', 'owner');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar');
      currentWrapper = wrapper;

      await flushPromises();

      const tabs = wrapper.findAll('[role="tab"]');
      const tabLabels = tabs.map((t: any) => t.text());
      expect(tabLabels.some((label: string) => label.toLowerCase().includes('report'))).toBe(true);
    });

    it('hides the Reports tab button for editors', async () => {
      const info = makeCalendarInfo('my-calendar', 'editor');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar');
      currentWrapper = wrapper;

      await flushPromises();

      const tabs = wrapper.findAll('[role="tab"]');
      const tabLabels = tabs.map((t: any) => t.text());
      expect(tabLabels.some((label: string) => label.toLowerCase().includes('report'))).toBe(false);
    });

    it('renders the reports panel for calendar owners', async () => {
      const info = makeCalendarInfo('my-calendar', 'owner');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar');
      currentWrapper = wrapper;

      await flushPromises();

      expect(wrapper.find('#reports-panel').exists()).toBe(true);
    });

    it('renders the reports panel wrapper in DOM for editors (inner content hidden)', async () => {
      const info = makeCalendarInfo('my-calendar', 'editor');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar');
      currentWrapper = wrapper;

      await flushPromises();

      // Panel wrapper stays in DOM for ARIA consistency; content is gated inside
      expect(wrapper.find('#reports-panel').exists()).toBe(true);
      // Inner content components should not be rendered for non-owners
      expect(wrapper.findComponent({ name: 'ReportsDashboard' }).exists()).toBe(false);
      expect(wrapper.findComponent({ name: 'ReportDetail' }).exists()).toBe(false);
    });
  });

  describe('Settings tab visibility', () => {
    it('shows the Settings tab button for calendar owners', async () => {
      const info = makeCalendarInfo('my-calendar', 'owner');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar');
      currentWrapper = wrapper;

      await flushPromises();

      const tabs = wrapper.findAll('[role="tab"]');
      const tabLabels = tabs.map((t: any) => t.text());
      expect(tabLabels.some((label: string) => label.toLowerCase().includes('setting'))).toBe(true);
    });

    it('hides the Settings tab button for editors', async () => {
      const info = makeCalendarInfo('my-calendar', 'editor');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar');
      currentWrapper = wrapper;

      await flushPromises();

      const tabs = wrapper.findAll('[role="tab"]');
      const tabLabels = tabs.map((t: any) => t.text());
      expect(tabLabels.some((label: string) => label.toLowerCase().includes('setting'))).toBe(false);
    });

    it('renders the settings panel for calendar owners', async () => {
      const info = makeCalendarInfo('my-calendar', 'owner');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar');
      currentWrapper = wrapper;

      await flushPromises();

      expect(wrapper.find('#settings-panel').exists()).toBe(true);
    });

    it('renders the settings panel wrapper in DOM for editors (inner content hidden)', async () => {
      const info = makeCalendarInfo('my-calendar', 'editor');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar');
      currentWrapper = wrapper;

      await flushPromises();

      // Panel wrapper stays in DOM for ARIA consistency; SettingsTab content is gated inside
      expect(wrapper.find('#settings-panel').exists()).toBe(true);
      // Inner SettingsTab component should not be rendered for non-owners
      expect(wrapper.findComponent({ name: 'SettingsTab' }).exists()).toBe(false);
    });
  });

  describe('Tab id attributes', () => {
    it('all tab buttons have id attributes for owners', async () => {
      const info = makeCalendarInfo('my-calendar', 'owner');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar');
      currentWrapper = wrapper;

      await flushPromises();

      expect(wrapper.find('#editors-tab').exists()).toBe(true);
      expect(wrapper.find('#reports-tab').exists()).toBe(true);
      expect(wrapper.find('#settings-tab').exists()).toBe(true);
      expect(wrapper.find('#widget-tab').exists()).toBe(true);
    });

    it('non-owner tabs have id attributes for the visible tabs', async () => {
      const info = makeCalendarInfo('my-calendar', 'editor');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar');
      currentWrapper = wrapper;

      await flushPromises();

      expect(wrapper.find('#editors-tab').exists()).toBe(true);
      expect(wrapper.find('#widget-tab').exists()).toBe(true);
      // Owner-only tab buttons are not rendered for editors
      expect(wrapper.find('#reports-tab').exists()).toBe(false);
      expect(wrapper.find('#settings-tab').exists()).toBe(false);
    });
  });

  describe('activateTab guard for non-owners', () => {
    it('does not switch to settings tab when user is not an owner', async () => {
      const info = makeCalendarInfo('my-calendar', 'editor');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar');
      currentWrapper = wrapper;

      await flushPromises();

      // Attempt to activate settings tab programmatically
      await (wrapper.vm as any).activateTab('settings');
      await wrapper.vm.$nextTick();

      // Active tab should remain on the default 'editors'
      expect((wrapper.vm as any).state.activeTab).toBe('editors');
    });

    it('does not switch to reports tab when user is not an owner', async () => {
      const info = makeCalendarInfo('my-calendar', 'editor');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar');
      currentWrapper = wrapper;

      await flushPromises();

      // Attempt to activate reports tab programmatically
      await (wrapper.vm as any).activateTab('reports');
      await wrapper.vm.$nextTick();

      // Active tab should remain on the default 'editors'
      expect((wrapper.vm as any).state.activeTab).toBe('editors');
    });

  });

  describe('EditorsTab isOwner prop forwarding', () => {
    it('passes isOwner=true to EditorsTab for calendar owners', async () => {
      const info = makeCalendarInfo('my-calendar', 'owner');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar');
      currentWrapper = wrapper;

      await flushPromises();

      const editorsTab = wrapper.findComponent({ name: 'EditorsTab' });
      expect(editorsTab.exists()).toBe(true);
      expect(editorsTab.attributes('isowner') === 'true' || editorsTab.props('isOwner') === true).toBe(true);
    });

    it('passes isOwner=false to EditorsTab for editor-role users', async () => {
      const info = makeCalendarInfo('my-calendar', 'editor');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar');
      currentWrapper = wrapper;

      await flushPromises();

      const editorsTab = wrapper.findComponent({ name: 'EditorsTab' });
      expect(editorsTab.exists()).toBe(true);
      // isOwner should be false (falsy) for editor-role users
      const isOwnerAttr = editorsTab.attributes('isowner');
      const isOwnerProp = editorsTab.props('isOwner');
      expect(isOwnerAttr === 'false' || isOwnerProp === false || isOwnerAttr === undefined || isOwnerProp === undefined).toBe(true);
    });
  });

  describe('Loading and error states', () => {
    it('shows loading message while fetching calendars', async () => {
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockReturnValue(
        new Promise(() => {}),
      );

      const { wrapper } = await mountRootComponent();
      currentWrapper = wrapper;

      await wrapper.vm.$nextTick();

      expect(wrapper.find('.loading-message').exists()).toBe(true);
    });

    it('shows error message when calendar load fails', async () => {
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockRejectedValue(
        new Error('Network error'),
      );

      const { wrapper } = await mountRootComponent();
      currentWrapper = wrapper;

      await flushPromises();

      expect(wrapper.find('.error-message').exists()).toBe(true);
    });
  });

  describe('Breadcrumb accessibility', () => {
    it('breadcrumb nav has an aria-label attribute', async () => {
      const info = makeCalendarInfo('my-calendar', 'owner');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar');
      currentWrapper = wrapper;

      await flushPromises();

      const breadcrumbNav = wrapper.find('.calendar-management-root__breadcrumb');
      expect(breadcrumbNav.exists()).toBe(true);
      expect(breadcrumbNav.attributes('aria-label')).toBeTruthy();
    });

    it('breadcrumb nav and tablist nav have distinct aria-labels', async () => {
      const info = makeCalendarInfo('my-calendar', 'owner');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar');
      currentWrapper = wrapper;

      await flushPromises();

      const breadcrumbNav = wrapper.find('.calendar-management-root__breadcrumb');
      const tablistNav = wrapper.find('[role="tablist"]');

      const breadcrumbLabel = breadcrumbNav.attributes('aria-label');
      const tablistLabel = tablistNav.attributes('aria-label');

      expect(breadcrumbLabel).toBeTruthy();
      expect(tablistLabel).toBeTruthy();
      expect(breadcrumbLabel).not.toBe(tablistLabel);
    });
  });

  describe('Report deep link from ?report=', () => {
    // Strict v4 shape, matching the server's path-parameter validation.
    const VALID_REPORT_ID = '9f8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';
    // Same shape but version 1: the server rejects it, so the client must too.
    const NON_V4_REPORT_ID = '9f8b7c6d-5e4f-1a3b-9c2d-1e0f9a8b7c6d';

    const mockCalendarRole = (role: 'owner' | 'editor') => {
      const info = makeCalendarInfo('my-calendar', role);
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);
    };

    const mockReportFound = () =>
      vi.spyOn(ModerationService.prototype, 'getReport').mockResolvedValue({
        report: {} as any,
        escalationHistory: [],
      });

    const mockReportMissing = () =>
      vi.spyOn(ModerationService.prototype, 'getReport').mockRejectedValue(new Error('Report not found'));

    /**
     * Mounts without any ?report= param and captures what the plain management
     * view looks like, so failure modes can be asserted equal to it.
     */
    const captureBaseline = async (role: 'owner' | 'editor', query: Record<string, string> = {}) => {
      mockCalendarRole(role);
      const { wrapper } = await mountRootComponent('my-calendar', query);
      await flushPromises();
      const snapshot = {
        html: wrapper.html(),
        activeTab: (wrapper.vm as any).state.activeTab,
      };
      wrapper.unmount();
      return snapshot;
    };

    it('activates the reports tab and selects the report for a valid owner deep link', async () => {
      mockCalendarRole('owner');
      const getReport = mockReportFound();

      const { wrapper } = await mountRootComponent('my-calendar', { report: VALID_REPORT_ID });
      currentWrapper = wrapper;

      await flushPromises();

      expect(getReport).toHaveBeenCalledWith('cal-uuid-1', VALID_REPORT_ID);
      expect((wrapper.vm as any).state.activeTab).toBe('reports');
      expect((wrapper.vm as any).selectedReportId).toBe(VALID_REPORT_ID);
      expect(wrapper.findComponent({ name: 'ReportDetail' }).exists()).toBe(true);
    });

    it('moves focus to the reports tabpanel on success', async () => {
      mockCalendarRole('owner');
      mockReportFound();

      const { wrapper } = await mountRootComponent(
        'my-calendar',
        { report: VALID_REPORT_ID },
        { attachTo: document.body },
      );
      currentWrapper = wrapper;

      await flushPromises();

      const panel = wrapper.find('#reports-panel');
      expect(panel.attributes('tabindex')).toBe('-1');
      expect(document.activeElement).toBe(panel.element);
    });

    it('issues no request and moves no focus for a malformed report id', async () => {
      mockCalendarRole('owner');
      const getReport = mockReportFound();

      const { wrapper } = await mountRootComponent(
        'my-calendar',
        { report: 'not-a-uuid' },
        { attachTo: document.body },
      );
      currentWrapper = wrapper;

      await flushPromises();

      expect(getReport).not.toHaveBeenCalled();
      expect((wrapper.vm as any).selectedReportId).toBeNull();
      expect(document.activeElement).not.toBe(wrapper.find('#reports-panel').element);
    });

    it('issues no request for a well-formed but non-v4 report id', async () => {
      mockCalendarRole('owner');
      const getReport = mockReportFound();

      const { wrapper } = await mountRootComponent('my-calendar', { report: NON_V4_REPORT_ID });
      currentWrapper = wrapper;

      await flushPromises();

      expect(getReport).not.toHaveBeenCalled();
      expect((wrapper.vm as any).selectedReportId).toBeNull();
    });

    it('issues no request and moves no focus for a non-owner', async () => {
      mockCalendarRole('editor');
      const getReport = mockReportFound();

      const { wrapper } = await mountRootComponent(
        'my-calendar',
        { report: VALID_REPORT_ID },
        { attachTo: document.body },
      );
      currentWrapper = wrapper;

      await flushPromises();

      expect(getReport).not.toHaveBeenCalled();
      expect((wrapper.vm as any).selectedReportId).toBeNull();
      expect((wrapper.vm as any).state.activeTab).toBe('editors');
      expect(document.activeElement).not.toBe(wrapper.find('#reports-panel').element);
    });

    it('falls through without selecting or focusing when the report does not exist', async () => {
      mockCalendarRole('owner');
      const getReport = mockReportMissing();

      const { wrapper } = await mountRootComponent(
        'my-calendar',
        { report: VALID_REPORT_ID },
        { attachTo: document.body },
      );
      currentWrapper = wrapper;

      await flushPromises();

      expect(getReport).toHaveBeenCalledWith('cal-uuid-1', VALID_REPORT_ID);
      expect((wrapper.vm as any).selectedReportId).toBeNull();
      expect((wrapper.vm as any).state.activeTab).toBe('editors');
      expect(wrapper.find('.error-message').exists()).toBe(false);
      expect(document.activeElement).not.toBe(wrapper.find('#reports-panel').element);
    });

    it('issues no request when no report query param is present', async () => {
      mockCalendarRole('owner');
      const getReport = mockReportFound();

      const { wrapper } = await mountRootComponent('my-calendar');
      currentWrapper = wrapper;

      await flushPromises();

      expect(getReport).not.toHaveBeenCalled();
      expect((wrapper.vm as any).selectedReportId).toBeNull();
    });

    it('leaves the ?tab= restore untouched when the report id is malformed', async () => {
      mockCalendarRole('owner');
      mockReportFound();

      const { wrapper } = await mountRootComponent('my-calendar', { tab: 'settings', report: 'not-a-uuid' });
      currentWrapper = wrapper;

      await flushPromises();

      expect((wrapper.vm as any).state.activeTab).toBe('settings');
      expect((wrapper.vm as any).selectedReportId).toBeNull();
    });

    it('renders a view identical to the no-report baseline for a malformed report id', async () => {
      const baseline = await captureBaseline('owner');

      mockCalendarRole('owner');
      mockReportFound();
      const { wrapper } = await mountRootComponent('my-calendar', { report: 'not-a-uuid' });
      currentWrapper = wrapper;
      await flushPromises();

      expect((wrapper.vm as any).state.activeTab).toBe(baseline.activeTab);
      expect(wrapper.html()).toBe(baseline.html);
    });

    it('renders a view identical to the no-report baseline for a non-owner', async () => {
      const baseline = await captureBaseline('editor');

      mockCalendarRole('editor');
      mockReportFound();
      const { wrapper } = await mountRootComponent('my-calendar', { report: VALID_REPORT_ID });
      currentWrapper = wrapper;
      await flushPromises();

      expect((wrapper.vm as any).state.activeTab).toBe(baseline.activeTab);
      expect(wrapper.html()).toBe(baseline.html);
    });

    it('renders a view identical to the no-report baseline for a non-existent report', async () => {
      const baseline = await captureBaseline('owner');

      mockCalendarRole('owner');
      mockReportMissing();
      const { wrapper } = await mountRootComponent('my-calendar', { report: VALID_REPORT_ID });
      currentWrapper = wrapper;
      await flushPromises();

      expect((wrapper.vm as any).state.activeTab).toBe(baseline.activeTab);
      expect(wrapper.html()).toBe(baseline.html);
    });
  });
});
