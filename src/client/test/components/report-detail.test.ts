import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, VueWrapper, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import sinon from 'sinon';

import ReportDetail from '@/client/components/moderation/report-detail.vue';
import { useModerationStore } from '@/client/stores/moderation-store';
import { Report, ReportCategory, ReportStatus } from '@/common/model/report';

/**
 * Test suite for report-detail.vue component
 * Tests the forward report functionality and pattern warning badges
 */
describe('ReportDetail', () => {
  let wrapper: VueWrapper;
  let store: ReturnType<typeof useModerationStore>;
  let sandbox: sinon.SinonSandbox;
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    pinia = createPinia();
    setActivePinia(pinia);
    store = useModerationStore();

    // Mock translation function
    vi.mock('i18next-vue', () => {
      return {
        useTranslation: () => ({
          t: (key: string) => key,
        }),
      };
    });
  });

  afterEach(() => {
    sandbox.restore();
    vi.clearAllMocks();
    if (wrapper) {
      wrapper.unmount();
    }
  });

  /**
   * Helper to create a mock report with event data
   */
  const createMockReport = (isRemoteEvent: boolean): Report => {
    const report = new Report('report-123');
    report.eventId = 'event-456';
    report.calendarId = 'calendar-789';
    report.category = ReportCategory.INAPPROPRIATE;
    report.description = 'Test report';
    report.status = ReportStatus.SUBMITTED;
    report.reporterType = 'anonymous';
    return report;
  };

  /**
   * Helper to mount component with mocked store state
   */
  const mountWithReport = async (report: Report) => {
    // Set store state before mounting
    store.currentReport = {
      report,
      escalationHistory: [],
    };

    // Stub fetchReport to prevent API call and maintain store state
    sandbox.stub(store, 'fetchReport').resolves();

    const wrapper = mount(ReportDetail, {
      props: {
        calendarId: 'calendar-789',
        reportId: 'report-123',
      },
      global: {
        plugins: [pinia],
        stubs: {
          LoadingMessage: true,
          PillButton: true,
          ArrowLeft: true,
        },
      },
    });

    // Wait for async operations to complete
    await flushPromises();
    await wrapper.vm.$nextTick();

    return wrapper;
  };

  describe('Pattern warning badges', () => {
    it('should display source flooding pattern badge when hasSourceFloodingPattern is true', async () => {
      const report = createMockReport(false);
      report.hasSourceFloodingPattern = true;

      wrapper = await mountWithReport(report);

      const badge = wrapper.find('[data-testid="pattern-badge-source-flooding"]');
      expect(badge.exists()).toBe(true);
      expect(badge.classes()).toContain('report-detail__pattern-badge');
      expect(badge.classes()).toContain('report-detail__pattern-badge--warning');
    });

    it('should display event targeting pattern badge when hasEventTargetingPattern is true', async () => {
      const report = createMockReport(false);
      report.hasEventTargetingPattern = true;

      wrapper = await mountWithReport(report);

      const badge = wrapper.find('[data-testid="pattern-badge-event-targeting"]');
      expect(badge.exists()).toBe(true);
      expect(badge.classes()).toContain('report-detail__pattern-badge');
      expect(badge.classes()).toContain('report-detail__pattern-badge--warning');
    });

    it('should display instance pattern badge when hasInstancePattern is true', async () => {
      const report = createMockReport(false);
      report.hasInstancePattern = true;

      wrapper = await mountWithReport(report);

      const badge = wrapper.find('[data-testid="pattern-badge-instance"]');
      expect(badge.exists()).toBe(true);
      expect(badge.classes()).toContain('report-detail__pattern-badge');
      expect(badge.classes()).toContain('report-detail__pattern-badge--warning');
    });

    it('should display multiple badges when multiple patterns are detected', async () => {
      const report = createMockReport(false);
      report.hasSourceFloodingPattern = true;
      report.hasEventTargetingPattern = true;
      report.hasInstancePattern = true;

      wrapper = await mountWithReport(report);

      const sourceBadge = wrapper.find('[data-testid="pattern-badge-source-flooding"]');
      const eventBadge = wrapper.find('[data-testid="pattern-badge-event-targeting"]');
      const instanceBadge = wrapper.find('[data-testid="pattern-badge-instance"]');

      expect(sourceBadge.exists()).toBe(true);
      expect(eventBadge.exists()).toBe(true);
      expect(instanceBadge.exists()).toBe(true);
    });

    it('should NOT display badges when no patterns are detected', async () => {
      const report = createMockReport(false);
      report.hasSourceFloodingPattern = false;
      report.hasEventTargetingPattern = false;
      report.hasInstancePattern = false;

      wrapper = await mountWithReport(report);

      const sourceBadge = wrapper.find('[data-testid="pattern-badge-source-flooding"]');
      const eventBadge = wrapper.find('[data-testid="pattern-badge-event-targeting"]');
      const instanceBadge = wrapper.find('[data-testid="pattern-badge-instance"]');

      expect(sourceBadge.exists()).toBe(false);
      expect(eventBadge.exists()).toBe(false);
      expect(instanceBadge.exists()).toBe(false);
    });

    it('should have accessible aria-label on pattern badges', async () => {
      const report = createMockReport(false);
      report.hasSourceFloodingPattern = true;

      wrapper = await mountWithReport(report);

      const badge = wrapper.find('[data-testid="pattern-badge-source-flooding"]');
      expect(badge.attributes('role')).toBe('status');
      expect(badge.attributes('aria-label')).toBeTruthy();
    });

    it('should display pattern warning section only when patterns exist', async () => {
      const report = createMockReport(false);
      report.hasSourceFloodingPattern = true;

      wrapper = await mountWithReport(report);

      const warningsSection = wrapper.find('.report-detail__pattern-warnings');
      expect(warningsSection.exists()).toBe(true);
      expect(warningsSection.attributes('role')).toBe('status');
    });

    it('should NOT display pattern warning section when no patterns exist', async () => {
      const report = createMockReport(false);
      report.hasSourceFloodingPattern = false;
      report.hasEventTargetingPattern = false;
      report.hasInstancePattern = false;

      wrapper = await mountWithReport(report);

      const warningsSection = wrapper.find('.report-detail__pattern-warnings');
      expect(warningsSection.exists()).toBe(false);
    });
  });
});
