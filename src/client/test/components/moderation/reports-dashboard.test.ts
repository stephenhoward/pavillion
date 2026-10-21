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
});
