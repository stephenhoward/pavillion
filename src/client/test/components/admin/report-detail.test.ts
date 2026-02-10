import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import ReportDetail from '@/client/components/admin/report-detail.vue';
import { useModerationStore } from '@/client/stores/moderation-store';
import { Report, ReportCategory, ReportStatus } from '@/common/model/report';

// Mock vue-router
vi.mock('vue-router', () => ({
  useRoute: () => ({
    params: { reportId: 'test-report-id' },
  }),
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

// Mock i18next-vue
vi.mock('i18next-vue', () => ({
  useTranslation: () => ({
    t: (key: string, params?: any) => {
      if (params) {
        let result = key;
        Object.keys(params).forEach((paramKey) => {
          result = result.replace(`{{${paramKey}}}`, params[paramKey]);
        });
        return result;
      }
      return key;
    },
  }),
}));

describe('ReportDetail - Forward to Admin Button', () => {
  let pinia: ReturnType<typeof createPinia>;
  let moderationStore: ReturnType<typeof useModerationStore>;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    moderationStore = useModerationStore();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Button Visibility', () => {
    it('should show forward button for remote events', async () => {
      // Create a remote event report (calendarId is null for remote events)
      const remoteReport = Report.fromObject({
        id: 'report-1',
        eventId: 'event-1',
        calendarId: null, // Remote event
        category: ReportCategory.SPAM,
        description: 'Test report',
        status: ReportStatus.ESCALATED,
        reporterType: 'anonymous',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      moderationStore.currentAdminReport = {
        report: remoteReport,
        escalationHistory: [],
      };

      const wrapper = mount(ReportDetail, {
        global: {
          plugins: [pinia],
          stubs: {
            LoadingMessage: true,
          },
        },
      });

      await nextTick();

      // Should find the forward button
      const forwardButton = wrapper.find('[data-testid="forward-to-admin-button"]');
      expect(forwardButton.exists()).toBe(true);
    });

    it('should hide forward button for local events', async () => {
      // Create a local event report (has calendarId)
      const localReport = Report.fromObject({
        id: 'report-1',
        eventId: 'event-1',
        calendarId: 'calendar-123', // Local event
        category: ReportCategory.SPAM,
        description: 'Test report',
        status: ReportStatus.ESCALATED,
        reporterType: 'anonymous',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      moderationStore.currentAdminReport = {
        report: localReport,
        escalationHistory: [],
      };

      const wrapper = mount(ReportDetail, {
        global: {
          plugins: [pinia],
          stubs: {
            LoadingMessage: true,
          },
        },
      });

      await nextTick();

      // Should not find the forward button
      const forwardButton = wrapper.find('[data-testid="forward-to-admin-button"]');
      expect(forwardButton.exists()).toBe(false);
    });

    it('should hide forward button for resolved reports', async () => {
      const resolvedRemoteReport = Report.fromObject({
        id: 'report-1',
        eventId: 'event-1',
        calendarId: null, // Remote event
        category: ReportCategory.SPAM,
        description: 'Test report',
        status: ReportStatus.RESOLVED, // Already resolved
        reporterType: 'anonymous',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      moderationStore.currentAdminReport = {
        report: resolvedRemoteReport,
        escalationHistory: [],
      };

      const wrapper = mount(ReportDetail, {
        global: {
          plugins: [pinia],
          stubs: {
            LoadingMessage: true,
          },
        },
      });

      await nextTick();

      // Should not find the forward button (report is resolved)
      const forwardButton = wrapper.find('[data-testid="forward-to-admin-button"]');
      expect(forwardButton.exists()).toBe(false);
    });
  });

  describe('Forward Confirmation Dialog', () => {
    it('should show confirmation dialog when forward button is clicked', async () => {
      const remoteReport = Report.fromObject({
        id: 'report-1',
        eventId: 'event-1',
        calendarId: null,
        category: ReportCategory.SPAM,
        description: 'Test spam report',
        status: ReportStatus.ESCALATED,
        reporterType: 'anonymous',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      moderationStore.currentAdminReport = {
        report: remoteReport,
        escalationHistory: [],
      };

      const wrapper = mount(ReportDetail, {
        global: {
          plugins: [pinia],
          stubs: {
            LoadingMessage: true,
          },
        },
      });

      await nextTick();

      // Click the forward button
      const forwardButton = wrapper.find('[data-testid="forward-to-admin-button"]');
      await forwardButton.trigger('click');
      await nextTick();

      // Should show confirmation modal
      const confirmModal = wrapper.find('[data-testid="forward-confirmation-modal"]');
      expect(confirmModal.exists()).toBe(true);
    });

    it('should display report details in confirmation dialog', async () => {
      const remoteReport = Report.fromObject({
        id: 'report-1',
        eventId: 'event-1',
        calendarId: null,
        category: ReportCategory.HARASSMENT,
        description: 'This is harassment content',
        status: ReportStatus.ESCALATED,
        reporterType: 'authenticated',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      moderationStore.currentAdminReport = {
        report: remoteReport,
        escalationHistory: [],
      };

      const wrapper = mount(ReportDetail, {
        global: {
          plugins: [pinia],
          stubs: {
            LoadingMessage: true,
          },
        },
      });

      await nextTick();

      // Open confirmation dialog
      const forwardButton = wrapper.find('[data-testid="forward-to-admin-button"]');
      await forwardButton.trigger('click');
      await nextTick();

      // Check that report details are shown
      const modalContent = wrapper.find('[data-testid="forward-confirmation-modal"]');
      expect(modalContent.text()).toContain('harassment');
      expect(modalContent.text()).toContain('This is harassment content');
    });

    it('should close confirmation dialog when cancelled', async () => {
      const remoteReport = Report.fromObject({
        id: 'report-1',
        eventId: 'event-1',
        calendarId: null,
        category: ReportCategory.SPAM,
        description: 'Test report',
        status: ReportStatus.ESCALATED,
        reporterType: 'anonymous',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      moderationStore.currentAdminReport = {
        report: remoteReport,
        escalationHistory: [],
      };

      const wrapper = mount(ReportDetail, {
        global: {
          plugins: [pinia],
          stubs: {
            LoadingMessage: true,
          },
        },
      });

      await nextTick();

      // Open confirmation dialog
      const forwardButton = wrapper.find('[data-testid="forward-to-admin-button"]');
      await forwardButton.trigger('click');
      await nextTick();

      // Click cancel button
      const cancelButton = wrapper.find('[data-testid="forward-cancel-button"]');
      await cancelButton.trigger('click');
      await nextTick();

      // Modal should be closed
      const confirmModal = wrapper.find('[data-testid="forward-confirmation-modal"]');
      expect(confirmModal.exists()).toBe(false);
    });
  });

  describe('Forward Action', () => {
    it('should call store action when confirmed', async () => {
      const remoteReport = Report.fromObject({
        id: 'report-1',
        eventId: 'event-1',
        calendarId: null,
        category: ReportCategory.SPAM,
        description: 'Test report',
        status: ReportStatus.ESCALATED,
        reporterType: 'anonymous',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      moderationStore.currentAdminReport = {
        report: remoteReport,
        escalationHistory: [],
      };

      // Spy on the store action
      const forwardSpy = vi.spyOn(moderationStore, 'adminForwardToRemoteAdmin').mockResolvedValue();

      const wrapper = mount(ReportDetail, {
        global: {
          plugins: [pinia],
          stubs: {
            LoadingMessage: true,
          },
        },
      });

      await nextTick();

      // Open confirmation dialog
      const forwardButton = wrapper.find('[data-testid="forward-to-admin-button"]');
      await forwardButton.trigger('click');
      await nextTick();

      // Click confirm button
      const confirmButton = wrapper.find('[data-testid="forward-confirm-button"]');
      await confirmButton.trigger('click');
      await nextTick();

      // Should have called the store action
      expect(forwardSpy).toHaveBeenCalledWith('report-1');
    });

    it('should show success message after forwarding', async () => {
      const remoteReport = Report.fromObject({
        id: 'report-1',
        eventId: 'event-1',
        calendarId: null,
        category: ReportCategory.SPAM,
        description: 'Test report',
        status: ReportStatus.ESCALATED,
        reporterType: 'anonymous',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      moderationStore.currentAdminReport = {
        report: remoteReport,
        escalationHistory: [],
      };

      vi.spyOn(moderationStore, 'adminForwardToRemoteAdmin').mockResolvedValue();

      const wrapper = mount(ReportDetail, {
        global: {
          plugins: [pinia],
          stubs: {
            LoadingMessage: true,
          },
        },
      });

      await nextTick();

      // Forward the report
      const forwardButton = wrapper.find('[data-testid="forward-to-admin-button"]');
      await forwardButton.trigger('click');
      await nextTick();

      const confirmButton = wrapper.find('[data-testid="forward-confirm-button"]');
      await confirmButton.trigger('click');
      await nextTick();

      // Wait for async operations
      await vi.waitFor(() => {
        const successToast = wrapper.find('[data-testid="forward-success-toast"]');
        expect(successToast.exists()).toBe(true);
      });
    });

    it('should show error message on forward failure', async () => {
      const remoteReport = Report.fromObject({
        id: 'report-1',
        eventId: 'event-1',
        calendarId: null,
        category: ReportCategory.SPAM,
        description: 'Test report',
        status: ReportStatus.ESCALATED,
        reporterType: 'anonymous',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      moderationStore.currentAdminReport = {
        report: remoteReport,
        escalationHistory: [],
      };

      vi.spyOn(moderationStore, 'adminForwardToRemoteAdmin').mockRejectedValue(new Error('Network error'));

      const wrapper = mount(ReportDetail, {
        global: {
          plugins: [pinia],
          stubs: {
            LoadingMessage: true,
          },
        },
      });

      await nextTick();

      // Forward the report
      const forwardButton = wrapper.find('[data-testid="forward-to-admin-button"]');
      await forwardButton.trigger('click');
      await nextTick();

      const confirmButton = wrapper.find('[data-testid="forward-confirm-button"]');
      await confirmButton.trigger('click');
      await nextTick();

      // Wait for async operations
      await vi.waitFor(() => {
        const errorToast = wrapper.find('[data-testid="forward-error-toast"]');
        expect(errorToast.exists()).toBe(true);
      });
    });
  });
});
