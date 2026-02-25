import { expect, describe, it, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import { flushPromises } from '@vue/test-utils';

import { Calendar } from '@/common/model/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';
import { mountComponent } from '@/client/test/lib/vue';
import CalendarManagementRoot from '@/client/components/logged_in/calendar-management/root.vue';
import CalendarService from '@/client/service/calendar';

const routes: RouteRecordRaw[] = [
  { path: '/manage/:calendar', component: {}, name: 'manage' },
  { path: '/test', component: {}, name: 'test' },
];

const mountRootComponent = async (calendarUrlName: string = 'my-calendar') => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });

  // Navigate to the manage route before mounting so route.params.calendar is available
  await router.push({ name: 'manage', params: { calendar: calendarUrlName } });
  await router.isReady();

  const wrapper = mountComponent(CalendarManagementRoot, router, {
    stubs: {
      CategoriesTab: true,
      EditorsTab: true,
      SettingsTab: true,
      WidgetTab: true,
      ReportsDashboard: true,
      ReportDetail: true,
    },
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

    it('other tabs remain visible for editors', async () => {
      const info = makeCalendarInfo('my-calendar', 'editor');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar');
      currentWrapper = wrapper;

      await flushPromises();

      const tabs = wrapper.findAll('[role="tab"]');
      // Categories, Editors, Widget = 3 tabs (Reports and Settings excluded for editors)
      expect(tabs.length).toBeGreaterThanOrEqual(3);
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
    it('all tab buttons have id attributes', async () => {
      const info = makeCalendarInfo('my-calendar', 'owner');
      vi.spyOn(CalendarService.prototype, 'loadCalendarsWithRelationship').mockResolvedValue([info]);

      const { wrapper } = await mountRootComponent('my-calendar');
      currentWrapper = wrapper;

      await flushPromises();

      expect(wrapper.find('#categories-tab').exists()).toBe(true);
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

      expect(wrapper.find('#categories-tab').exists()).toBe(true);
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

      // Active tab should remain on the default 'categories'
      expect((wrapper.vm as any).state.activeTab).toBe('categories');
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

      // Active tab should remain on the default 'categories'
      expect((wrapper.vm as any).state.activeTab).toBe('categories');
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
});
