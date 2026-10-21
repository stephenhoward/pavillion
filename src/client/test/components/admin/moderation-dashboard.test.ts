import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { mountComponent } from '@/client/test/lib/vue';
import ModerationDashboard from '@/client/components/admin/moderation-dashboard.vue';
import { useModerationStore } from '@/client/stores/moderation-store';

const ADMIN_REPORT_ID = 'admin-report-1';
const ESCALATED_REPORT_ID = 'escalated-report-1';

const reports = [
  {
    id: ADMIN_REPORT_ID,
    eventId: 'aaaaaaaa-0000-0000-0000-000000000000',
    calendarId: 'cccccccc-0000-0000-0000-000000000000',
    category: 'spam',
    status: 'submitted',
    reporterType: 'administrator',
    adminPriority: 'medium',
    adminDeadline: null,
    escalationType: null,
  },
  {
    id: ESCALATED_REPORT_ID,
    eventId: 'bbbbbbbb-0000-0000-0000-000000000000',
    calendarId: 'dddddddd-0000-0000-0000-000000000000',
    category: 'harassment',
    status: 'escalated',
    reporterType: 'anonymous',
    adminPriority: null,
    adminDeadline: null,
    escalationType: 'manual',
  },
];

function detailPath(reportId: string): string {
  return `/settings/admin/moderation/reports/${reportId}`;
}

describe('Admin ModerationDashboard report rows', () => {
  let pinia: Pinia;
  let router: Router;
  let wrapper: VueWrapper | null = null;

  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);
    const store = useModerationStore();
    vi.spyOn(store, 'fetchAdminReports').mockImplementation(async () => {
      store.adminReports = reports as never;
    });

    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/settings/admin/moderation', name: 'moderation', component: {} },
        { path: '/settings/admin/moderation/reports/:reportId', name: 'moderation_report_detail', component: {} },
        { path: '/settings/admin/moderation/settings', name: 'moderation_settings', component: {} },
      ],
    });
    await router.push('/settings/admin/moderation');
    await router.isReady();

    wrapper = mountComponent(ModerationDashboard, router, {
      pinia,
      stubs: { HelpButton: true, CreateReportModal: true },
    });
    await flushPromises();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.restoreAllMocks();
  });

  it('keeps table rows as rows: no button role and no tab stop', () => {
    const rows = wrapper!.findAll('tbody tr');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.attributes('role')).toBeUndefined();
      expect(row.attributes('tabindex')).toBeUndefined();
    }
  });

  it('gives no report row or card the button role', () => {
    expect(wrapper!.findAll('.reports-content [role="button"]')).toHaveLength(0);
  });

  it('opens each report through a real link to its detail route', () => {
    for (const [id, row] of [
      [ADMIN_REPORT_ID, wrapper!.findAll('tbody tr')[0]],
      [ESCALATED_REPORT_ID, wrapper!.findAll('tbody tr')[1]],
    ] as const) {
      const links = row.findAll('a');
      expect(links).toHaveLength(1);
      expect(links[0].attributes('href')).toBe(detailPath(id));
      expect(links[0].text()).toBe('View Details');
    }
  });

  it('opens the mobile cards through the same links', () => {
    const cards = wrapper!.findAll('.report-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].attributes('tabindex')).toBeUndefined();
    expect(cards[0].find('a').attributes('href')).toBe(detailPath(ADMIN_REPORT_ID));
    expect(cards[1].find('a').attributes('href')).toBe(detailPath(ESCALATED_REPORT_ID));
  });

  it('still opens the report when a pointer user clicks elsewhere on the row', async () => {
    await wrapper!.findAll('tbody tr')[1].find('.cell-category').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe(detailPath(ESCALATED_REPORT_ID));
  });
});
