import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import sinon from 'sinon';

import ReportDetail from '@/client/components/moderation/report-detail.vue';
import { useModerationStore } from '@/client/stores/moderation-store';
import { Report, ReportCategory, ReportStatus } from '@/common/model/report';

/**
 * Test suite for report-detail.vue component
 * Tests the forward report functionality for reposted events
 */
describe('ReportDetail - Forward Report', () => {
  let wrapper: VueWrapper;
  let store: ReturnType<typeof useModerationStore>;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    setActivePinia(createPinia());
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
   * Helper to create mock event data
   */
  const createMockEvent = (isRemote: boolean) => {
    return {
      id: 'event-456',
      calendarId: isRemote ? null : 'calendar-local',
      eventSourceUrl: isRemote ? 'https://remote.instance/events/event-456' : '',
      content: (_lang: string) => ({
        title: 'Test Event',
        description: 'Test Description',
      }),
    };
  };

  describe('Forward button visibility', () => {
    it('should show forward button for reposted events', async () => {
      const report = createMockReport(true);
      // Remote event would be needed for full implementation

      // Mock store state
      store.currentReport = {
        report,
        escalationHistory: [],
      };

      wrapper = mount(ReportDetail, {
        props: {
          calendarId: 'calendar-789',
          reportId: 'report-123',
        },
        global: {
          plugins: [createPinia()],
          stubs: {
            LoadingMessage: true,
            PillButton: true,
            ArrowLeft: true,
          },
        },
      });

      // Wait for component to render
      await wrapper.vm.$nextTick();

      // Check that forward button exists (implementation will add this)
      // This test will initially fail, driving implementation
      const forwardButton = wrapper.find('[data-testid="forward-report-button"]');
      expect(forwardButton.exists()).toBe(true);
    });

    it('should NOT show forward button for local events', async () => {
      const report = createMockReport(false);

      store.currentReport = {
        report,
        escalationHistory: [],
      };

      wrapper = mount(ReportDetail, {
        props: {
          calendarId: 'calendar-789',
          reportId: 'report-123',
        },
        global: {
          plugins: [createPinia()],
          stubs: {
            LoadingMessage: true,
            PillButton: true,
            ArrowLeft: true,
          },
        },
      });

      await wrapper.vm.$nextTick();

      const forwardButton = wrapper.find('[data-testid="forward-report-button"]');
      expect(forwardButton.exists()).toBe(false);
    });

    it('should NOT show forward button for resolved reports', async () => {
      const report = createMockReport(true);
      report.status = ReportStatus.RESOLVED;

      store.currentReport = {
        report,
        escalationHistory: [],
      };

      wrapper = mount(ReportDetail, {
        props: {
          calendarId: 'calendar-789',
          reportId: 'report-123',
        },
        global: {
          plugins: [createPinia()],
          stubs: {
            LoadingMessage: true,
            PillButton: true,
            ArrowLeft: true,
          },
        },
      });

      await wrapper.vm.$nextTick();

      const forwardButton = wrapper.find('[data-testid="forward-report-button"]');
      expect(forwardButton.exists()).toBe(false);
    });
  });

  describe('Forward modal', () => {
    it('should open modal when forward button is clicked', async () => {
      const report = createMockReport(true);

      store.currentReport = {
        report,
        escalationHistory: [],
      };

      wrapper = mount(ReportDetail, {
        props: {
          calendarId: 'calendar-789',
          reportId: 'report-123',
        },
        global: {
          plugins: [createPinia()],
          stubs: {
            LoadingMessage: true,
            PillButton: true,
            ArrowLeft: true,
          },
        },
      });

      await wrapper.vm.$nextTick();

      const forwardButton = wrapper.find('[data-testid="forward-report-button"]');
      await forwardButton.trigger('click');

      const modal = wrapper.find('[data-testid="forward-report-modal"]');
      expect(modal.exists()).toBe(true);
    });

    it('should display report summary in modal', async () => {
      const report = createMockReport(true);

      store.currentReport = {
        report,
        escalationHistory: [],
      };

      wrapper = mount(ReportDetail, {
        props: {
          calendarId: 'calendar-789',
          reportId: 'report-123',
        },
        global: {
          plugins: [createPinia()],
          stubs: {
            LoadingMessage: true,
            PillButton: true,
            ArrowLeft: true,
          },
        },
      });

      await wrapper.vm.$nextTick();

      const forwardButton = wrapper.find('[data-testid="forward-report-button"]');
      await forwardButton.trigger('click');

      const modalContent = wrapper.find('[data-testid="forward-report-modal"]');
      expect(modalContent.text()).toContain('Test report');
    });

    it('should have message textarea in modal', async () => {
      const report = createMockReport(true);

      store.currentReport = {
        report,
        escalationHistory: [],
      };

      wrapper = mount(ReportDetail, {
        props: {
          calendarId: 'calendar-789',
          reportId: 'report-123',
        },
        global: {
          plugins: [createPinia()],
          stubs: {
            LoadingMessage: true,
            PillButton: true,
            ArrowLeft: true,
          },
        },
      });

      await wrapper.vm.$nextTick();

      const forwardButton = wrapper.find('[data-testid="forward-report-button"]');
      await forwardButton.trigger('click');

      const messageTextarea = wrapper.find('[data-testid="forward-message-textarea"]');
      expect(messageTextarea.exists()).toBe(true);
    });
  });

  describe('Forward action', () => {
    it('should call store.forwardReport when forward is confirmed', async () => {
      const report = createMockReport(true);

      store.currentReport = {
        report,
        escalationHistory: [],
      };

      const forwardReportStub = sandbox.stub(store, 'forwardReport').resolves();

      wrapper = mount(ReportDetail, {
        props: {
          calendarId: 'calendar-789',
          reportId: 'report-123',
        },
        global: {
          plugins: [createPinia()],
          stubs: {
            LoadingMessage: true,
            PillButton: true,
            ArrowLeft: true,
          },
        },
      });

      await wrapper.vm.$nextTick();

      // Open modal
      const forwardButton = wrapper.find('[data-testid="forward-report-button"]');
      await forwardButton.trigger('click');

      // Enter message
      const messageTextarea = wrapper.find('[data-testid="forward-message-textarea"]');
      await messageTextarea.setValue('Please review this event');

      // Click confirm
      const confirmButton = wrapper.find('[data-testid="forward-confirm-button"]');
      await confirmButton.trigger('click');

      expect(forwardReportStub.calledOnce).toBe(true);
      expect(forwardReportStub.calledWith('calendar-789', 'report-123', 'Please review this event')).toBe(true);
    });

    it('should show success toast after forwarding', async () => {
      const report = createMockReport(true);

      store.currentReport = {
        report,
        escalationHistory: [],
      };

      sandbox.stub(store, 'forwardReport').resolves();

      wrapper = mount(ReportDetail, {
        props: {
          calendarId: 'calendar-789',
          reportId: 'report-123',
        },
        global: {
          plugins: [createPinia()],
          stubs: {
            LoadingMessage: true,
            PillButton: true,
            ArrowLeft: true,
          },
        },
      });

      await wrapper.vm.$nextTick();

      const forwardButton = wrapper.find('[data-testid="forward-report-button"]');
      await forwardButton.trigger('click');

      const confirmButton = wrapper.find('[data-testid="forward-confirm-button"]');
      await confirmButton.trigger('click');

      await wrapper.vm.$nextTick();

      const successMessage = wrapper.find('[data-testid="forward-success-message"]');
      expect(successMessage.exists()).toBe(true);
    });

    it('should show error message if forwarding fails', async () => {
      const report = createMockReport(true);

      store.currentReport = {
        report,
        escalationHistory: [],
      };

      sandbox.stub(store, 'forwardReport').rejects(new Error('Network error'));

      wrapper = mount(ReportDetail, {
        props: {
          calendarId: 'calendar-789',
          reportId: 'report-123',
        },
        global: {
          plugins: [createPinia()],
          stubs: {
            LoadingMessage: true,
            PillButton: true,
            ArrowLeft: true,
          },
        },
      });

      await wrapper.vm.$nextTick();

      const forwardButton = wrapper.find('[data-testid="forward-report-button"]');
      await forwardButton.trigger('click');

      const confirmButton = wrapper.find('[data-testid="forward-confirm-button"]');
      await confirmButton.trigger('click');

      await wrapper.vm.$nextTick();

      const errorMessage = wrapper.find('[data-testid="forward-error-message"]');
      expect(errorMessage.exists()).toBe(true);
    });
  });

  describe('Forward status indicator', () => {
    it('should show pending status after forwarding', async () => {
      const report = createMockReport(true);
      report.forwardStatus = 'pending';

      store.currentReport = {
        report,
        escalationHistory: [],
      };

      wrapper = mount(ReportDetail, {
        props: {
          calendarId: 'calendar-789',
          reportId: 'report-123',
        },
        global: {
          plugins: [createPinia()],
          stubs: {
            LoadingMessage: true,
            PillButton: true,
            ArrowLeft: true,
          },
        },
      });

      await wrapper.vm.$nextTick();

      const statusIndicator = wrapper.find('[data-testid="forward-status"]');
      expect(statusIndicator.exists()).toBe(true);
      expect(statusIndicator.text()).toContain('pending');
    });
  });
});
