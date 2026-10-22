import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { mountComponent } from '@/client/test/lib/vue';
import ReportsDashboard from '@/client/components/moderation/reports-dashboard.vue';
import { useModerationStore } from '@/client/stores/moderation-store';

describe('ReportsDashboard.vue', () => {
  let pinia: Pinia;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    const store = useModerationStore();
    vi.spyOn(store, 'setFilters').mockResolvedValue(undefined as never);
    vi.spyOn(store, 'setPage').mockResolvedValue(undefined as never);
  });

  it('renders no heading repeating the settings layout title', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: {} }] });
    const wrapper = mountComponent(ReportsDashboard, router, {
      pinia,
      props: { calendarId: 'cal-1' },
    });
    await flushPromises();

    // The settings layout h1 already reads "Reports"; the leaf must not repeat it.
    const headingTexts = wrapper.findAll('h1, h2').map((h) => h.text());
    expect(headingTexts).not.toContain('Reports');
    // The filters keep their accessible name.
    expect(wrapper.find('[role="search"]').attributes('aria-label')).toBe('Reports');
  });

  describe('report rows', () => {
    const REPORT_ID = 'report-1';

    async function mountWithReports(reports: object[]) {
      const store = useModerationStore();
      const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: {} }] });
      const wrapper = mountComponent(ReportsDashboard, router, {
        pinia,
        props: { calendarId: 'cal-1' },
      });
      await flushPromises();
      // onMounted resets the store, so the rows are seeded after mount.
      store.reports = reports as never;
      await flushPromises();
      return wrapper;
    }

    function mountWithReport() {
      return mountWithReports([{
        id: REPORT_ID,
        eventId: 'aaaaaaaa-0000-0000-0000-000000000000',
        category: 'spam',
        reporterType: 'anonymous',
        status: 'submitted',
        createdAt: new Date('2026-10-01T12:00:00Z'),
      }]);
    }

    it('is a plain table whose rows are not tab stops', async () => {
      const wrapper = await mountWithReport();
      expect(wrapper.find('table').attributes('role')).toBeUndefined();
      const row = wrapper.find('tbody tr');
      expect(row.attributes('role')).toBeUndefined();
      expect(row.attributes('tabindex')).toBeUndefined();
    });

    it('opens the report from a real button in the event cell', async () => {
      const wrapper = await mountWithReport();
      const buttons = wrapper.find('tbody tr').findAll('button');
      expect(buttons).toHaveLength(1);
      expect(buttons[0].attributes('type')).toBe('button');

      await buttons[0].trigger('click');
      expect(wrapper.emitted('view-report')).toEqual([[REPORT_ID]]);
    });

    it('names each event button after its own report, keeping the visible text in the name', async () => {
      const wrapper = await mountWithReports([
        {
          id: 'report-1',
          eventId: 'aaaaaaaa-0000-0000-0000-000000000000',
          category: 'spam',
          reporterType: 'anonymous',
          status: 'submitted',
          createdAt: new Date('2026-10-01T12:00:00Z'),
        },
        {
          id: 'report-2',
          eventId: 'aaaaaaaa-0000-0000-0000-000000000000',
          category: 'harassment',
          reporterType: 'anonymous',
          status: 'submitted',
          createdAt: new Date('2026-10-02T12:00:00Z'),
        },
      ]);

      const buttons = wrapper.findAll('tbody tr button');
      expect(buttons).toHaveLength(2);
      const names = buttons.map((button) => button.attributes('aria-label'));

      expect(names[0]).toMatch(/^View Spam report for event aaaaaaaa\.\.\./);
      expect(names[0]).toContain(buttons[0].text());
      expect(names[1]).toMatch(/^View Harassment report for event aaaaaaaa\.\.\./);
      expect(names[1]).toContain(buttons[1].text());
      expect(new Set(names).size).toBe(names.length);
    });

    it('still opens the report once when a pointer user clicks elsewhere on the row', async () => {
      const wrapper = await mountWithReport();
      await wrapper.findAll('tbody td')[1].trigger('click');
      expect(wrapper.emitted('view-report')).toEqual([[REPORT_ID]]);
    });
  });
});
