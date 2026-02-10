import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import sinon from 'sinon';
import ModerationService from '@/client/service/moderation';
import type {
  AdminReportFilters,
  CreateAdminReportData,
  ModerationSettings,
} from '@/client/service/moderation';
import { Report, ReportCategory, ReportStatus } from '@/common/model/report';
import { UnknownError } from '@/common/exceptions/base';

describe('ModerationService', () => {
  let sandbox: sinon.SinonSandbox;
  let service: ModerationService;
  let axiosGetStub: sinon.SinonStub;
  let axiosPostStub: sinon.SinonStub;
  let axiosPutStub: sinon.SinonStub;

  const testCalendarId = 'test-calendar-id';
  const testReportId = 'test-report-id';

  /**
   * Creates a mock report data object for test responses.
   */
  function mockReportData(overrides?: Record<string, any>): Record<string, any> {
    return {
      id: testReportId,
      eventId: 'event-1',
      calendarId: testCalendarId,
      category: ReportCategory.SPAM,
      description: 'Test report',
      reporterType: 'anonymous',
      status: ReportStatus.SUBMITTED,
      createdAt: '2026-02-09T00:00:00.000Z',
      updatedAt: '2026-02-09T00:00:00.000Z',
      ...overrides,
    };
  }

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new ModerationService();

    axiosGetStub = sandbox.stub(axios, 'get');
    axiosPostStub = sandbox.stub(axios, 'post');
    axiosPutStub = sandbox.stub(axios, 'put');
  });

  afterEach(() => {
    sandbox.restore();
  });

  // ──────────────────────────────────────────────────────────────
  // Owner-level methods (existing functionality, basic coverage)
  // ──────────────────────────────────────────────────────────────

  describe('getReports', () => {
    it('should fetch reports for a calendar', async () => {
      const mockResponse = {
        reports: [mockReportData()],
        pagination: { currentPage: 1, totalPages: 1, totalCount: 1, limit: 20 },
      };
      axiosGetStub.resolves({ data: mockResponse });

      const result = await service.getReports(testCalendarId);

      expect(axiosGetStub.calledOnce).toBe(true);
      expect(axiosGetStub.firstCall.args[0]).toBe(`/api/v1/calendars/${testCalendarId}/reports`);
      expect(result.reports).toHaveLength(1);
      expect(result.reports[0]).toBeInstanceOf(Report);
      expect(result.pagination.totalCount).toBe(1);
    });

    it('should pass filters as query parameters', async () => {
      const mockResponse = {
        reports: [],
        pagination: { currentPage: 1, totalPages: 0, totalCount: 0, limit: 20 },
      };
      axiosGetStub.resolves({ data: mockResponse });

      await service.getReports(testCalendarId, {
        status: ReportStatus.SUBMITTED,
        category: ReportCategory.SPAM,
        page: 2,
        limit: 10,
      });

      const url = axiosGetStub.firstCall.args[0];
      expect(url).toContain('status=submitted');
      expect(url).toContain('category=spam');
      expect(url).toContain('page=2');
      expect(url).toContain('limit=10');
    });

    it('should throw UnknownError on network failure', async () => {
      axiosGetStub.rejects(new Error('Network error'));

      await expect(service.getReports(testCalendarId)).rejects.toThrow(UnknownError);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Admin report methods
  // ──────────────────────────────────────────────────────────────

  describe('getAdminReports', () => {
    it('should fetch admin reports without filters', async () => {
      const mockResponse = {
        reports: [mockReportData({ status: ReportStatus.ESCALATED })],
        pagination: { currentPage: 1, totalPages: 1, totalCount: 1, limit: 20 },
      };
      axiosGetStub.resolves({ data: mockResponse });

      const result = await service.getAdminReports();

      expect(axiosGetStub.calledOnce).toBe(true);
      expect(axiosGetStub.firstCall.args[0]).toBe('/api/v1/admin/reports');
      expect(result.reports).toHaveLength(1);
      expect(result.reports[0]).toBeInstanceOf(Report);
      expect(result.pagination.totalCount).toBe(1);
    });

    it('should pass admin filters as query parameters', async () => {
      const mockResponse = {
        reports: [],
        pagination: { currentPage: 1, totalPages: 0, totalCount: 0, limit: 20 },
      };
      axiosGetStub.resolves({ data: mockResponse });

      const filters: AdminReportFilters = {
        status: 'escalated',
        category: 'spam',
        calendarId: 'cal-123',
        source: 'anonymous',
        escalationType: 'automatic',
        sortBy: 'created_at',
        sortOrder: 'DESC',
        page: 2,
        limit: 10,
      };

      await service.getAdminReports(filters);

      const url = axiosGetStub.firstCall.args[0];
      expect(url).toContain('status=escalated');
      expect(url).toContain('category=spam');
      expect(url).toContain('calendarId=cal-123');
      expect(url).toContain('source=anonymous');
      expect(url).toContain('escalationType=automatic');
      expect(url).toContain('sortBy=created_at');
      expect(url).toContain('sortOrder=DESC');
      expect(url).toContain('page=2');
      expect(url).toContain('limit=10');
    });

    it('should omit undefined filter values from query', async () => {
      const mockResponse = {
        reports: [],
        pagination: { currentPage: 1, totalPages: 0, totalCount: 0, limit: 20 },
      };
      axiosGetStub.resolves({ data: mockResponse });

      await service.getAdminReports({ status: 'escalated' });

      const url = axiosGetStub.firstCall.args[0];
      expect(url).toContain('status=escalated');
      expect(url).not.toContain('calendarId');
      expect(url).not.toContain('source');
    });

    it('should throw UnknownError on network failure', async () => {
      axiosGetStub.rejects(new Error('Network error'));

      await expect(service.getAdminReports()).rejects.toThrow(UnknownError);
    });

    it('should throw mapped error on known error response', async () => {
      axiosGetStub.rejects({
        response: {
          data: { errorName: 'ForbiddenError' },
        },
      });

      await expect(service.getAdminReports()).rejects.toThrow('You do not have permission to perform this action');
    });
  });

  describe('getAdminReport', () => {
    it('should fetch a single admin report with escalation history', async () => {
      const mockResponse = {
        report: mockReportData({ status: ReportStatus.ESCALATED }),
        escalationHistory: [
          {
            id: 'esc-1',
            reportId: testReportId,
            fromStatus: 'submitted',
            toStatus: 'escalated',
            reviewerId: null,
            reviewerRole: 'system',
            decision: 'auto_escalated',
            notes: null,
            createdAt: '2026-02-09T01:00:00.000Z',
          },
        ],
      };
      axiosGetStub.resolves({ data: mockResponse });

      const result = await service.getAdminReport(testReportId);

      expect(axiosGetStub.calledOnce).toBe(true);
      expect(axiosGetStub.firstCall.args[0]).toBe(`/api/v1/admin/reports/${testReportId}`);
      expect(result.report).toBeInstanceOf(Report);
      expect(result.escalationHistory).toHaveLength(1);
      expect(result.escalationHistory[0].decision).toBe('auto_escalated');
    });

    it('should handle missing escalation history gracefully', async () => {
      const mockResponse = {
        report: mockReportData(),
      };
      axiosGetStub.resolves({ data: mockResponse });

      const result = await service.getAdminReport(testReportId);

      expect(result.escalationHistory).toEqual([]);
    });

    it('should throw UnknownError on empty report ID', async () => {
      await expect(service.getAdminReport('')).rejects.toThrow(UnknownError);
    });

    it('should throw mapped error for not found', async () => {
      axiosGetStub.rejects({
        response: {
          data: { errorName: 'ReportNotFoundError' },
        },
      });

      await expect(service.getAdminReport(testReportId)).rejects.toThrow('Report not found');
    });
  });

  describe('adminResolveReport', () => {
    it('should send resolve action to admin endpoint', async () => {
      const resolvedData = mockReportData({ status: ReportStatus.RESOLVED });
      axiosPutStub.resolves({ data: { report: resolvedData } });

      const result = await service.adminResolveReport(testReportId, 'Resolved by admin');

      expect(axiosPutStub.calledOnce).toBe(true);
      expect(axiosPutStub.firstCall.args[0]).toBe(`/api/v1/admin/reports/${testReportId}`);
      expect(axiosPutStub.firstCall.args[1]).toEqual({
        action: 'resolve',
        notes: 'Resolved by admin',
      });
      expect(result).toBeInstanceOf(Report);
      expect(result.status).toBe(ReportStatus.RESOLVED);
    });

    it('should throw UnknownError on empty report ID', async () => {
      await expect(service.adminResolveReport('', 'notes')).rejects.toThrow(UnknownError);
    });

    it('should throw mapped error for already resolved', async () => {
      axiosPutStub.rejects({
        response: {
          data: { errorName: 'ReportAlreadyResolvedError' },
        },
      });

      await expect(service.adminResolveReport(testReportId, 'notes'))
        .rejects.toThrow('Report has already been resolved');
    });
  });

  describe('adminDismissReport', () => {
    it('should send dismiss action to admin endpoint', async () => {
      const dismissedData = mockReportData({ status: ReportStatus.DISMISSED });
      axiosPutStub.resolves({ data: { report: dismissedData } });

      const result = await service.adminDismissReport(testReportId, 'Dismissed by admin');

      expect(axiosPutStub.calledOnce).toBe(true);
      expect(axiosPutStub.firstCall.args[0]).toBe(`/api/v1/admin/reports/${testReportId}`);
      expect(axiosPutStub.firstCall.args[1]).toEqual({
        action: 'dismiss',
        notes: 'Dismissed by admin',
      });
      expect(result).toBeInstanceOf(Report);
      expect(result.status).toBe(ReportStatus.DISMISSED);
    });

    it('should throw UnknownError on empty report ID', async () => {
      await expect(service.adminDismissReport('', 'notes')).rejects.toThrow(UnknownError);
    });
  });

  describe('adminOverrideReport', () => {
    it('should send override action to admin endpoint', async () => {
      const overriddenData = mockReportData({ status: ReportStatus.RESOLVED });
      axiosPutStub.resolves({ data: { report: overriddenData } });

      const result = await service.adminOverrideReport(testReportId, 'Overridden by admin');

      expect(axiosPutStub.calledOnce).toBe(true);
      expect(axiosPutStub.firstCall.args[0]).toBe(`/api/v1/admin/reports/${testReportId}`);
      expect(axiosPutStub.firstCall.args[1]).toEqual({
        action: 'override',
        notes: 'Overridden by admin',
      });
      expect(result).toBeInstanceOf(Report);
    });

    it('should throw UnknownError on empty report ID', async () => {
      await expect(service.adminOverrideReport('', 'notes')).rejects.toThrow(UnknownError);
    });

    it('should throw UnknownError on network failure', async () => {
      axiosPutStub.rejects(new Error('Network error'));

      await expect(service.adminOverrideReport(testReportId, 'notes'))
        .rejects.toThrow(UnknownError);
    });
  });

  describe('createAdminReport', () => {
    it('should create an admin report with all fields', async () => {
      const createdData = mockReportData({
        reporterType: 'administrator',
        adminPriority: 'high',
        adminDeadline: '2026-02-14T00:00:00.000Z',
        adminNotes: 'Admin notes',
      });
      axiosPostStub.resolves({ data: { report: createdData } });

      const data: CreateAdminReportData = {
        eventId: 'event-1',
        category: 'inappropriate',
        description: 'Admin concern',
        priority: 'high',
        deadline: '2026-02-14T00:00:00Z',
        adminNotes: 'Admin notes',
      };

      const result = await service.createAdminReport(data);

      expect(axiosPostStub.calledOnce).toBe(true);
      expect(axiosPostStub.firstCall.args[0]).toBe('/api/v1/admin/reports');
      expect(axiosPostStub.firstCall.args[1]).toEqual(data);
      expect(result).toBeInstanceOf(Report);
    });

    it('should create an admin report with minimal fields', async () => {
      const createdData = mockReportData({ reporterType: 'administrator' });
      axiosPostStub.resolves({ data: { report: createdData } });

      const data: CreateAdminReportData = {
        eventId: 'event-1',
        category: 'spam',
        description: 'Spam event',
        priority: 'low',
      };

      const result = await service.createAdminReport(data);

      expect(axiosPostStub.calledOnce).toBe(true);
      expect(result).toBeInstanceOf(Report);
    });

    it('should throw mapped error for validation failure', async () => {
      axiosPostStub.rejects({
        response: {
          data: { errorName: 'ValidationError' },
        },
      });

      const data: CreateAdminReportData = {
        eventId: '',
        category: 'spam',
        description: '',
        priority: 'low',
      };

      await expect(service.createAdminReport(data)).rejects.toThrow('Invalid input');
    });

    it('should throw mapped error for event not found', async () => {
      axiosPostStub.rejects({
        response: {
          data: { errorName: 'EventNotFoundError' },
        },
      });

      const data: CreateAdminReportData = {
        eventId: 'nonexistent',
        category: 'spam',
        description: 'Test',
        priority: 'low',
      };

      await expect(service.createAdminReport(data)).rejects.toThrow('Event not found');
    });

    it('should throw mapped error for duplicate report', async () => {
      axiosPostStub.rejects({
        response: {
          data: { errorName: 'DuplicateReportError' },
        },
      });

      const data: CreateAdminReportData = {
        eventId: 'event-1',
        category: 'spam',
        description: 'Test',
        priority: 'low',
      };

      await expect(service.createAdminReport(data))
        .rejects.toThrow('A report already exists for this event');
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Moderation settings methods
  // ──────────────────────────────────────────────────────────────

  describe('getModerationSettings', () => {
    it('should fetch moderation settings', async () => {
      const mockSettings: ModerationSettings = {
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
      };
      axiosGetStub.resolves({ data: mockSettings });

      const result = await service.getModerationSettings();

      expect(axiosGetStub.calledOnce).toBe(true);
      expect(axiosGetStub.firstCall.args[0]).toBe('/api/v1/admin/moderation/settings');
      expect(result.autoEscalationHours).toBe(72);
      expect(result.adminReportEscalationHours).toBe(24);
      expect(result.reminderBeforeEscalationHours).toBe(12);
    });

    it('should throw UnknownError on failure', async () => {
      axiosGetStub.rejects(new Error('Server error'));

      await expect(service.getModerationSettings()).rejects.toThrow(UnknownError);
    });

    it('should throw mapped error for forbidden access', async () => {
      axiosGetStub.rejects({
        response: {
          data: { errorName: 'ForbiddenError' },
        },
      });

      await expect(service.getModerationSettings())
        .rejects.toThrow('You do not have permission to perform this action');
    });
  });

  describe('updateModerationSettings', () => {
    it('should update moderation settings with full data', async () => {
      const updatedSettings: ModerationSettings = {
        autoEscalationHours: 48,
        adminReportEscalationHours: 12,
        reminderBeforeEscalationHours: 6,
      };
      axiosPutStub.resolves({ data: updatedSettings });

      const result = await service.updateModerationSettings(updatedSettings);

      expect(axiosPutStub.calledOnce).toBe(true);
      expect(axiosPutStub.firstCall.args[0]).toBe('/api/v1/admin/moderation/settings');
      expect(axiosPutStub.firstCall.args[1]).toEqual(updatedSettings);
      expect(result.autoEscalationHours).toBe(48);
    });

    it('should support partial updates', async () => {
      const partialUpdate = { autoEscalationHours: 96 };
      const updatedSettings: ModerationSettings = {
        autoEscalationHours: 96,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
      };
      axiosPutStub.resolves({ data: updatedSettings });

      const result = await service.updateModerationSettings(partialUpdate);

      expect(axiosPutStub.firstCall.args[1]).toEqual(partialUpdate);
      expect(result.autoEscalationHours).toBe(96);
    });

    it('should throw mapped error for validation failure', async () => {
      axiosPutStub.rejects({
        response: {
          data: { errorName: 'ValidationError' },
        },
      });

      await expect(service.updateModerationSettings({ autoEscalationHours: -1 }))
        .rejects.toThrow('Invalid input');
    });

    it('should throw UnknownError on network failure', async () => {
      axiosPutStub.rejects(new Error('Network error'));

      await expect(service.updateModerationSettings({ autoEscalationHours: 48 }))
        .rejects.toThrow(UnknownError);
    });
  });
});
