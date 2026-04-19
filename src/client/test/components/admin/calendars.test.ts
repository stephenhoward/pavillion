import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPinia, setActivePinia, Pinia } from 'pinia';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';
import { flushPromises } from '@vue/test-utils';
import sinon from 'sinon';

import { mountComponent } from '@/client/test/lib/vue';
import CalendarsDashboard from '@/client/components/admin/calendars-dashboard.vue';
import AdminCalendarService from '@/client/service/admin-calendar';
import type {
  AdminCalendarListResponse,
  AdminCalendarRow,
} from '@/client/service/admin-calendar';
import { useCalendarAdminStore } from '@/client/stores/calendarAdminStore';

const routes: RouteRecordRaw[] = [
  { path: '/test', component: {}, name: 'test' },
  { path: '/admin/moderation', component: {}, name: 'moderation' },
];

/**
 * Builds a mock admin calendar row for the test fixtures.
 */
function mockRow(overrides: Partial<AdminCalendarRow> = {}): AdminCalendarRow {
  return {
    id: 'calendar-1',
    urlName: 'test-calendar',
    title: 'Test Calendar',
    owner: {
      accountId: 'account-1',
      displayName: 'Test Owner',
    },
    upcomingEventCount: 3,
    lastActivityAt: '2026-01-15T10:00:00Z',
    fundingStatus: 'none',
    openReportCount: 0,
    ...overrides,
  };
}

/**
 * Wraps a row list into the service response shape.
 */
function mockResponse(rows: AdminCalendarRow[]): AdminCalendarListResponse {
  return {
    items: rows,
    pagination: {
      currentPage: 1,
      totalPages: 1,
      totalCount: rows.length,
      limit: 20,
    },
  };
}

const mountDashboard = (pinia: Pinia) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });

  return mountComponent(CalendarsDashboard, router, { pinia });
};

describe('CalendarsDashboard', () => {
  let sandbox: sinon.SinonSandbox;
  let listStub: sinon.SinonStub;
  let pinia: Pinia;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    sandbox = sinon.createSandbox();
    listStub = sandbox.stub(AdminCalendarService.prototype, 'listCalendars');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('renders calendar rows from store data', async () => {
    const rows = [
      mockRow({ id: 'cal-a', title: 'Alpha Calendar', urlName: 'alpha' }),
      mockRow({ id: 'cal-b', title: 'Beta Calendar', urlName: 'beta' }),
    ];
    listStub.resolves(mockResponse(rows));

    const wrapper = mountDashboard(pinia);
    await flushPromises();
    await wrapper.vm.$nextTick();

    const renderedRows = wrapper.findAll('[data-testid="calendar-row"]');
    expect(renderedRows).toHaveLength(2);
    expect(wrapper.text()).toContain('Alpha Calendar');
    expect(wrapper.text()).toContain('Beta Calendar');
  });

  it('shows the open-report badge only when openReportCount > 0', async () => {
    const rows = [
      mockRow({ id: 'cal-a', openReportCount: 0 }),
      mockRow({ id: 'cal-b', openReportCount: 4 }),
    ];
    listStub.resolves(mockResponse(rows));

    const wrapper = mountDashboard(pinia);
    await flushPromises();
    await wrapper.vm.$nextTick();

    const badges = wrapper.findAll('[data-testid="open-reports-badge"]');
    expect(badges).toHaveLength(1);
    expect(badges[0].text()).toContain('4');
  });

  it('updates store filter state when the search input changes', async () => {
    listStub.resolves(mockResponse([mockRow()]));

    const wrapper = mountDashboard(pinia);
    await flushPromises();
    await wrapper.vm.$nextTick();

    const store = useCalendarAdminStore();
    expect(store.filters.search).toBe('');

    const searchInput = wrapper.find('#search-filter');
    expect(searchInput.exists()).toBe(true);

    await searchInput.setValue('music');
    await searchInput.trigger('input');

    // Wait for the 300ms debounce to fire.
    await new Promise((resolve) => setTimeout(resolve, 350));
    await flushPromises();

    expect(store.filters.search).toBe('music');
  });
});
