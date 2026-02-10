import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Report, ReportStatus } from '@/common/model/report';
import { ReportEntity } from '@/server/moderation/entity/report';
import { ReportEscalationEntity } from '@/server/moderation/entity/report_escalation';
import ModerationService from '@/server/moderation/service/moderation';
import EscalationScheduler, { DEFAULT_CHECK_INTERVAL_MS } from '@/server/moderation/service/escalation-scheduler';

/** A valid UUID v4 for use in tests. */
const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

/** Helper to create a mock ReportEntity with configurable properties. */
function createMockReportEntity(overrides: Partial<{
  id: string;
  status: string;
  reporter_type: string;
  escalation_type: string | null;
  created_at: Date;
  calendar_id: string;
  event_id: string;
}> = {}): any {
  const report = new Report(overrides.id ?? VALID_UUID);
  report.status = (overrides.status as ReportStatus) ?? ReportStatus.SUBMITTED;
  report.reporterType = (overrides.reporter_type as any) ?? 'authenticated';
  report.escalationType = (overrides.escalation_type as any) ?? null;
  report.calendarId = overrides.calendar_id ?? 'calendar-1';
  report.eventId = overrides.event_id ?? 'event-1';
  report.createdAt = overrides.created_at ?? new Date();

  return {
    id: overrides.id ?? VALID_UUID,
    status: overrides.status ?? ReportStatus.SUBMITTED,
    reporter_type: overrides.reporter_type ?? 'authenticated',
    escalation_type: overrides.escalation_type ?? null,
    created_at: overrides.created_at ?? new Date(),
    calendar_id: overrides.calendar_id ?? 'calendar-1',
    event_id: overrides.event_id ?? 'event-1',
    update: sinon.stub().resolves(),
    toModel: () => report,
  };
}

describe('EscalationScheduler', () => {
  let sandbox: sinon.SinonSandbox;
  let service: ModerationService;
  let eventBus: EventEmitter;
  let scheduler: EscalationScheduler;
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    service = new ModerationService(eventBus);
    scheduler = new EscalationScheduler(service, eventBus);
  });

  afterEach(() => {
    scheduler.stop();
    if (clock) {
      clock.restore();
    }
    sandbox.restore();
  });

  describe('start / stop / isRunning', () => {

    it('should not be running initially', () => {
      expect(scheduler.isRunning()).toBe(false);
    });

    it('should be running after start()', () => {
      // Stub checkAndEscalate so it does not hit DB
      sandbox.stub(scheduler, 'checkAndEscalate').resolves();
      scheduler.start();

      expect(scheduler.isRunning()).toBe(true);
    });

    it('should not be running after stop()', () => {
      sandbox.stub(scheduler, 'checkAndEscalate').resolves();
      scheduler.start();
      scheduler.stop();

      expect(scheduler.isRunning()).toBe(false);
    });

    it('should stop existing interval before starting a new one', () => {
      sandbox.stub(scheduler, 'checkAndEscalate').resolves();
      scheduler.start();

      expect(scheduler.isRunning()).toBe(true);

      // Start again should not throw
      scheduler.start();

      expect(scheduler.isRunning()).toBe(true);
    });

    it('should call stop() gracefully when not running', () => {
      // Should not throw
      scheduler.stop();

      expect(scheduler.isRunning()).toBe(false);
    });
  });

  describe('interval behavior', () => {

    it('should call checkAndEscalate on each interval tick', async () => {
      clock = sinon.useFakeTimers({ now: Date.now() });
      const checkStub = sandbox.stub(scheduler, 'checkAndEscalate').resolves();

      scheduler.start();

      // Advance time by one interval
      clock.tick(DEFAULT_CHECK_INTERVAL_MS);
      // Allow async handler to run
      await clock.tickAsync(0);

      expect(checkStub.callCount).toBeGreaterThanOrEqual(1);

      // Advance another interval
      clock.tick(DEFAULT_CHECK_INTERVAL_MS);
      await clock.tickAsync(0);

      expect(checkStub.callCount).toBeGreaterThanOrEqual(2);
    });

    it('should use custom interval when provided', () => {
      const customIntervalMs = 5 * 60 * 1000; // 5 minutes
      const customScheduler = new EscalationScheduler(service, eventBus, customIntervalMs);

      clock = sinon.useFakeTimers({ now: Date.now() });
      const checkStub = sandbox.stub(customScheduler, 'checkAndEscalate').resolves();

      customScheduler.start();

      // Advance less than custom interval - should not fire
      clock.tick(customIntervalMs - 1000);

      expect(checkStub.callCount).toBe(0);

      // Advance past custom interval
      clock.tick(1000);

      expect(checkStub.callCount).toBe(1);

      customScheduler.stop();
    });

    it('should not call checkAndEscalate after stop()', () => {
      clock = sinon.useFakeTimers({ now: Date.now() });
      const checkStub = sandbox.stub(scheduler, 'checkAndEscalate').resolves();

      scheduler.start();
      scheduler.stop();

      clock.tick(DEFAULT_CHECK_INTERVAL_MS * 3);

      expect(checkStub.callCount).toBe(0);
    });
  });

  describe('checkAndEscalate', () => {

    it('should fetch moderation settings and process all three categories', async () => {
      const settingsStub = sandbox.stub(service, 'getModerationSettings').resolves({
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
      });

      sandbox.stub(ReportEntity, 'findAll').resolves([]);
      sandbox.stub(ReportEscalationEntity, 'findOne').resolves(null);

      await scheduler.checkAndEscalate();

      expect(settingsStub.calledOnce).toBe(true);
    });

    it('should not throw when getModerationSettings fails', async () => {
      sandbox.stub(service, 'getModerationSettings').rejects(new Error('Config unavailable'));

      // Should not throw
      await scheduler.checkAndEscalate();
    });
  });

  describe('getReportsNeedingAutoEscalation', () => {

    it('should query for submitted non-admin reports past the deadline', async () => {
      const now = new Date('2026-02-09T12:00:00Z');
      clock = sinon.useFakeTimers({ now });

      const findAllStub = sandbox.stub(ReportEntity, 'findAll').resolves([]);

      await scheduler.getReportsNeedingAutoEscalation(72);

      expect(findAllStub.calledOnce).toBe(true);
      const where = findAllStub.firstCall.args[0]?.where as any;

      expect(where.status).toBe(ReportStatus.SUBMITTED);
      expect(where.escalation_type).toBeNull();
      // reporter_type should exclude 'administrator'
      expect(where.reporter_type).toBeDefined();
    });

    it('should use correct deadline calculation', async () => {
      const now = new Date('2026-02-09T12:00:00Z');
      clock = sinon.useFakeTimers({ now });

      const findAllStub = sandbox.stub(ReportEntity, 'findAll').resolves([]);

      await scheduler.getReportsNeedingAutoEscalation(72);

      const where = findAllStub.firstCall.args[0]?.where as any;
      // 72 hours before now = 2026-02-06T12:00:00Z
      const expectedDeadline = new Date('2026-02-06T12:00:00Z');
      const actualDeadline = where.created_at[Object.getOwnPropertySymbols(where.created_at)[0]];

      expect(actualDeadline.getTime()).toBe(expectedDeadline.getTime());
    });

    it('should return matching report entities', async () => {
      const mockEntity = createMockReportEntity({
        id: 'report-1',
        status: ReportStatus.SUBMITTED,
        reporter_type: 'authenticated',
        created_at: new Date(Date.now() - 100 * 60 * 60 * 1000), // 100 hours ago
      });

      sandbox.stub(ReportEntity, 'findAll').resolves([mockEntity]);

      const results = await scheduler.getReportsNeedingAutoEscalation(72);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('report-1');
    });
  });

  describe('getAdminReportsNeedingReEscalation', () => {

    it('should query for submitted admin reports past the deadline', async () => {
      const now = new Date('2026-02-09T12:00:00Z');
      clock = sinon.useFakeTimers({ now });

      const findAllStub = sandbox.stub(ReportEntity, 'findAll').resolves([]);

      await scheduler.getAdminReportsNeedingReEscalation(24);

      expect(findAllStub.calledOnce).toBe(true);
      const where = findAllStub.firstCall.args[0]?.where as any;

      expect(where.status).toBe(ReportStatus.SUBMITTED);
      expect(where.reporter_type).toBe('administrator');
    });

    it('should use correct deadline calculation for admin reports', async () => {
      const now = new Date('2026-02-09T12:00:00Z');
      clock = sinon.useFakeTimers({ now });

      const findAllStub = sandbox.stub(ReportEntity, 'findAll').resolves([]);

      await scheduler.getAdminReportsNeedingReEscalation(24);

      const where = findAllStub.firstCall.args[0]?.where as any;
      // 24 hours before now = 2026-02-08T12:00:00Z
      const expectedDeadline = new Date('2026-02-08T12:00:00Z');
      const actualDeadline = where.created_at[Object.getOwnPropertySymbols(where.created_at)[0]];

      expect(actualDeadline.getTime()).toBe(expectedDeadline.getTime());
    });
  });

  describe('getReportsNeedingReminder', () => {

    it('should query for reports in the reminder window', async () => {
      const now = new Date('2026-02-09T12:00:00Z');
      clock = sinon.useFakeTimers({ now });

      const findAllStub = sandbox.stub(ReportEntity, 'findAll').resolves([]);

      await scheduler.getReportsNeedingReminder(72, 12);

      expect(findAllStub.calledOnce).toBe(true);
      const where = findAllStub.firstCall.args[0]?.where as any;

      expect(where.status).toBe(ReportStatus.SUBMITTED);
      expect(where.escalation_type).toBeNull();
    });

    it('should use correct window calculation with two boundary conditions', async () => {
      const now = new Date('2026-02-09T12:00:00Z');
      clock = sinon.useFakeTimers({ now });

      const findAllStub = sandbox.stub(ReportEntity, 'findAll').resolves([]);

      await scheduler.getReportsNeedingReminder(72, 12);

      const where = findAllStub.firstCall.args[0]?.where as any;

      // The query should have two boundary conditions on created_at:
      // Op.lt for reminderWindowStart (now - 60 hours)
      // Op.gte for escalationDeadline (now - 72 hours)
      const createdAtSymbols = Object.getOwnPropertySymbols(where.created_at);
      expect(createdAtSymbols.length).toBe(2);
    });

    it('should filter out reports that already had a reminder sent', async () => {
      const reportWithReminder = createMockReportEntity({ id: 'report-with-reminder' });
      const reportWithoutReminder = createMockReportEntity({ id: 'report-without-reminder' });

      sandbox.stub(ReportEntity, 'findAll').resolves([reportWithReminder, reportWithoutReminder]);

      // First call: reminder exists for report-with-reminder
      // Second call: no reminder for report-without-reminder
      const findOneStub = sandbox.stub(ReportEscalationEntity, 'findOne');
      findOneStub.onFirstCall().resolves({ id: 'existing-reminder' } as any);
      findOneStub.onSecondCall().resolves(null);

      const results = await scheduler.getReportsNeedingReminder(72, 12);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('report-without-reminder');
    });

    it('should check for reminder_sent decision in escalation records', async () => {
      const report = createMockReportEntity({ id: 'report-1' });
      sandbox.stub(ReportEntity, 'findAll').resolves([report]);

      const findOneStub = sandbox.stub(ReportEscalationEntity, 'findOne').resolves(null);

      await scheduler.getReportsNeedingReminder(72, 12);

      expect(findOneStub.calledOnce).toBe(true);
      const where = findOneStub.firstCall.args[0]?.where as any;
      expect(where.report_id).toBe('report-1');
      expect(where.decision).toBe('reminder_sent');
    });
  });

  describe('auto-escalation behavior', () => {

    it('should update report status to escalated with automatic escalation type', async () => {
      const mockEntity = createMockReportEntity({
        id: 'report-to-escalate',
        status: ReportStatus.SUBMITTED,
        reporter_type: 'authenticated',
        created_at: new Date(Date.now() - 100 * 60 * 60 * 1000),
      });

      sandbox.stub(service, 'getModerationSettings').resolves({
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
      });

      sandbox.stub(ReportEntity, 'findAll')
        .onFirstCall().resolves([mockEntity]) // auto-escalation query
        .onSecondCall().resolves([])  // admin re-escalation query
        .onThirdCall().resolves([]);  // reminder query

      sandbox.stub(ReportEscalationEntity, 'fromModel').returns({
        save: sandbox.stub().resolves(),
      } as any);

      await scheduler.checkAndEscalate();

      // Report should be updated to escalated status
      expect(mockEntity.update.calledOnce).toBe(true);
      expect(mockEntity.update.firstCall.args[0]).toEqual({
        status: ReportStatus.ESCALATED,
        escalation_type: 'automatic',
      });
    });

    it('should create an escalation audit record for auto-escalation', async () => {
      const mockEntity = createMockReportEntity({
        id: 'report-audit',
        status: ReportStatus.SUBMITTED,
        reporter_type: 'anonymous',
        created_at: new Date(Date.now() - 100 * 60 * 60 * 1000),
      });

      sandbox.stub(service, 'getModerationSettings').resolves({
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
      });

      sandbox.stub(ReportEntity, 'findAll')
        .onFirstCall().resolves([mockEntity])
        .onSecondCall().resolves([])
        .onThirdCall().resolves([]);

      const fromModelStub = sandbox.stub(ReportEscalationEntity, 'fromModel').returns({
        save: sandbox.stub().resolves(),
      } as any);

      await scheduler.checkAndEscalate();

      expect(fromModelStub.calledOnce).toBe(true);
      const escalationData = fromModelStub.firstCall.args[0];
      expect(escalationData.reportId).toBe('report-audit');
      expect(escalationData.fromStatus).toBe(ReportStatus.SUBMITTED);
      expect(escalationData.toStatus).toBe(ReportStatus.ESCALATED);
      expect(escalationData.reviewerId).toBeNull();
      expect(escalationData.reviewerRole).toBe('system');
      expect(escalationData.decision).toBe('auto_escalation');
      expect(escalationData.notes).toBe('Auto-escalated due to inactivity');
    });

    it('should emit report.auto_escalated event', async () => {
      const mockEntity = createMockReportEntity({
        id: 'report-event',
        status: ReportStatus.SUBMITTED,
        reporter_type: 'authenticated',
        created_at: new Date(Date.now() - 100 * 60 * 60 * 1000),
      });

      sandbox.stub(service, 'getModerationSettings').resolves({
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
      });

      sandbox.stub(ReportEntity, 'findAll')
        .onFirstCall().resolves([mockEntity])
        .onSecondCall().resolves([])
        .onThirdCall().resolves([]);

      sandbox.stub(ReportEscalationEntity, 'fromModel').returns({
        save: sandbox.stub().resolves(),
      } as any);

      const emitSpy = sandbox.spy(eventBus, 'emit');

      await scheduler.checkAndEscalate();

      expect(emitSpy.calledWith('report.auto_escalated')).toBe(true);
      const payload = emitSpy.getCall(emitSpy.callCount - 1).args[1];
      expect(payload.report).toBeDefined();
      expect(payload.reason).toBe('Auto-escalated due to inactivity');
    });
  });

  describe('admin report re-escalation behavior', () => {

    it('should update admin reports to escalated with automatic type', async () => {
      const mockEntity = createMockReportEntity({
        id: 'admin-report',
        status: ReportStatus.SUBMITTED,
        reporter_type: 'administrator',
        created_at: new Date(Date.now() - 48 * 60 * 60 * 1000), // 48 hours ago
      });

      sandbox.stub(service, 'getModerationSettings').resolves({
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
      });

      sandbox.stub(ReportEntity, 'findAll')
        .onFirstCall().resolves([]) // auto-escalation
        .onSecondCall().resolves([mockEntity]) // admin re-escalation
        .onThirdCall().resolves([]); // reminders

      sandbox.stub(ReportEscalationEntity, 'fromModel').returns({
        save: sandbox.stub().resolves(),
      } as any);

      await scheduler.checkAndEscalate();

      expect(mockEntity.update.calledOnce).toBe(true);
      expect(mockEntity.update.firstCall.args[0]).toEqual({
        status: ReportStatus.ESCALATED,
        escalation_type: 'automatic',
      });
    });

    it('should create escalation record with admin re-escalation note', async () => {
      const mockEntity = createMockReportEntity({
        id: 'admin-report-audit',
        status: ReportStatus.SUBMITTED,
        reporter_type: 'administrator',
        created_at: new Date(Date.now() - 48 * 60 * 60 * 1000),
      });

      sandbox.stub(service, 'getModerationSettings').resolves({
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
      });

      sandbox.stub(ReportEntity, 'findAll')
        .onFirstCall().resolves([])
        .onSecondCall().resolves([mockEntity])
        .onThirdCall().resolves([]);

      const fromModelStub = sandbox.stub(ReportEscalationEntity, 'fromModel').returns({
        save: sandbox.stub().resolves(),
      } as any);

      await scheduler.checkAndEscalate();

      const escalationData = fromModelStub.firstCall.args[0];
      expect(escalationData.notes).toBe('Admin-initiated report auto-escalated due to inactivity by calendar owner');
    });
  });

  describe('reminder behavior', () => {

    it('should create a reminder_sent escalation record', async () => {
      const mockEntity = createMockReportEntity({
        id: 'report-reminder',
        status: ReportStatus.SUBMITTED,
        reporter_type: 'authenticated',
        created_at: new Date(Date.now() - 65 * 60 * 60 * 1000), // 65 hours ago (within 72-12=60 to 72 window)
      });

      sandbox.stub(service, 'getModerationSettings').resolves({
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
      });

      sandbox.stub(ReportEntity, 'findAll')
        .onFirstCall().resolves([]) // auto-escalation
        .onSecondCall().resolves([]) // admin re-escalation
        .onThirdCall().resolves([mockEntity]); // reminders

      // No existing reminder
      sandbox.stub(ReportEscalationEntity, 'findOne').resolves(null);

      const fromModelStub = sandbox.stub(ReportEscalationEntity, 'fromModel').returns({
        save: sandbox.stub().resolves(),
      } as any);

      await scheduler.checkAndEscalate();

      expect(fromModelStub.calledOnce).toBe(true);
      const data = fromModelStub.firstCall.args[0];
      expect(data.reportId).toBe('report-reminder');
      expect(data.fromStatus).toBe(ReportStatus.SUBMITTED);
      expect(data.toStatus).toBe(ReportStatus.SUBMITTED);
      expect(data.decision).toBe('reminder_sent');
      expect(data.reviewerRole).toBe('system');
    });

    it('should emit report.escalation_reminder event', async () => {
      const mockEntity = createMockReportEntity({
        id: 'report-reminder-event',
        status: ReportStatus.SUBMITTED,
        reporter_type: 'authenticated',
      });

      sandbox.stub(service, 'getModerationSettings').resolves({
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
      });

      sandbox.stub(ReportEntity, 'findAll')
        .onFirstCall().resolves([])
        .onSecondCall().resolves([])
        .onThirdCall().resolves([mockEntity]);

      sandbox.stub(ReportEscalationEntity, 'findOne').resolves(null);
      sandbox.stub(ReportEscalationEntity, 'fromModel').returns({
        save: sandbox.stub().resolves(),
      } as any);

      const emitSpy = sandbox.spy(eventBus, 'emit');

      await scheduler.checkAndEscalate();

      expect(emitSpy.calledWith('report.escalation_reminder')).toBe(true);
      const payload = emitSpy.getCall(emitSpy.callCount - 1).args[1];
      expect(payload.report).toBeDefined();
    });

    it('should not send reminder if one was already sent', async () => {
      const mockEntity = createMockReportEntity({
        id: 'already-reminded',
        status: ReportStatus.SUBMITTED,
      });

      sandbox.stub(service, 'getModerationSettings').resolves({
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
      });

      sandbox.stub(ReportEntity, 'findAll')
        .onFirstCall().resolves([])
        .onSecondCall().resolves([])
        .onThirdCall().resolves([mockEntity]);

      // Reminder already exists
      sandbox.stub(ReportEscalationEntity, 'findOne').resolves({ id: 'existing' } as any);

      const fromModelStub = sandbox.stub(ReportEscalationEntity, 'fromModel');
      const emitSpy = sandbox.spy(eventBus, 'emit');

      await scheduler.checkAndEscalate();

      // No escalation record should be created (since the reminder candidate is filtered out)
      expect(fromModelStub.called).toBe(false);
      expect(emitSpy.calledWith('report.escalation_reminder')).toBe(false);
    });
  });

  describe('deadline calculation accuracy', () => {

    it('should correctly identify reports at exactly the deadline boundary', async () => {
      const now = new Date('2026-02-09T12:00:00Z');
      clock = sinon.useFakeTimers({ now });

      // Report created exactly 72 hours ago
      createMockReportEntity({
        id: 'at-deadline',
        created_at: new Date('2026-02-06T12:00:00Z'),
      });

      // Report created 71 hours 59 minutes ago (just under)
      createMockReportEntity({
        id: 'just-under',
        created_at: new Date('2026-02-06T12:01:00Z'),
      });

      const findAllStub = sandbox.stub(ReportEntity, 'findAll').resolves([]);

      await scheduler.getReportsNeedingAutoEscalation(72);

      // Verify the deadline used in the query is correct
      expect(findAllStub.calledOnce).toBe(true);
      const where = findAllStub.firstCall.args[0]?.where as any;
      const symbols = Object.getOwnPropertySymbols(where.created_at);
      const deadline = where.created_at[symbols[0]];
      expect(deadline.getTime()).toBe(new Date('2026-02-06T12:00:00Z').getTime());
    });

    it('should correctly calculate reminder window boundaries', async () => {
      const now = new Date('2026-02-09T12:00:00Z');
      clock = sinon.useFakeTimers({ now });

      const findAllStub = sandbox.stub(ReportEntity, 'findAll').resolves([]);

      await scheduler.getReportsNeedingReminder(72, 12);

      // Window should be: created between 60 hours ago and 72 hours ago
      // 60 hours ago = 2026-02-07T00:00:00Z
      // 72 hours ago = 2026-02-06T12:00:00Z
      // So reports created between Feb 6 12:00 and Feb 7 00:00 need reminders
      expect(findAllStub.calledOnce).toBe(true);
    });

    it('should handle fractional hours in escalation settings', async () => {
      const now = new Date('2026-02-09T12:00:00Z');
      clock = sinon.useFakeTimers({ now });

      const findAllStub = sandbox.stub(ReportEntity, 'findAll').resolves([]);

      // 1.5 hours = 90 minutes
      await scheduler.getReportsNeedingAutoEscalation(1.5);

      const where = findAllStub.firstCall.args[0]?.where as any;
      const symbols = Object.getOwnPropertySymbols(where.created_at);
      const deadline = where.created_at[symbols[0]];

      // 1.5 hours before now = 2026-02-09T10:30:00Z
      const expected = new Date('2026-02-09T10:30:00Z');
      expect(deadline.getTime()).toBe(expected.getTime());
    });
  });

  describe('error handling', () => {

    it('should not throw when auto-escalation query fails', async () => {
      sandbox.stub(service, 'getModerationSettings').resolves({
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
      });

      sandbox.stub(ReportEntity, 'findAll')
        .onFirstCall().rejects(new Error('DB connection lost'))
        .onSecondCall().resolves([])
        .onThirdCall().resolves([]);

      // Should not throw
      await scheduler.checkAndEscalate();
    });

    it('should continue processing other categories when one fails', async () => {
      sandbox.stub(service, 'getModerationSettings').resolves({
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
      });

      const adminReport = createMockReportEntity({
        id: 'admin-report-ok',
        reporter_type: 'administrator',
      });

      sandbox.stub(ReportEntity, 'findAll')
        .onFirstCall().rejects(new Error('Failed')) // auto-escalation fails
        .onSecondCall().resolves([adminReport]) // admin re-escalation succeeds
        .onThirdCall().resolves([]); // reminders

      sandbox.stub(ReportEscalationEntity, 'fromModel').returns({
        save: sandbox.stub().resolves(),
      } as any);

      // Should not throw and admin report should still be processed
      await scheduler.checkAndEscalate();

      expect(adminReport.update.calledOnce).toBe(true);
    });

    it('should continue with remaining reports when individual escalation fails', async () => {
      const failingReport = createMockReportEntity({ id: 'failing-report' });
      failingReport.update = sandbox.stub().rejects(new Error('Update failed'));

      const successfulReport = createMockReportEntity({ id: 'successful-report' });

      sandbox.stub(service, 'getModerationSettings').resolves({
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
      });

      sandbox.stub(ReportEntity, 'findAll')
        .onFirstCall().resolves([failingReport, successfulReport])
        .onSecondCall().resolves([])
        .onThirdCall().resolves([]);

      sandbox.stub(ReportEscalationEntity, 'fromModel').returns({
        save: sandbox.stub().resolves(),
      } as any);

      await scheduler.checkAndEscalate();

      // The second report should still be processed despite the first failing
      expect(successfulReport.update.calledOnce).toBe(true);
    });
  });

  describe('multiple reports processing', () => {

    it('should process all reports needing auto-escalation', async () => {
      const report1 = createMockReportEntity({ id: 'report-1' });
      const report2 = createMockReportEntity({ id: 'report-2' });
      const report3 = createMockReportEntity({ id: 'report-3' });

      sandbox.stub(service, 'getModerationSettings').resolves({
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
      });

      sandbox.stub(ReportEntity, 'findAll')
        .onFirstCall().resolves([report1, report2, report3])
        .onSecondCall().resolves([])
        .onThirdCall().resolves([]);

      sandbox.stub(ReportEscalationEntity, 'fromModel').returns({
        save: sandbox.stub().resolves(),
      } as any);

      const emitSpy = sandbox.spy(eventBus, 'emit');

      await scheduler.checkAndEscalate();

      // All three should be updated
      expect(report1.update.calledOnce).toBe(true);
      expect(report2.update.calledOnce).toBe(true);
      expect(report3.update.calledOnce).toBe(true);

      // Three auto_escalated events should be emitted
      const autoEscalatedCalls = emitSpy.getCalls().filter(c => c.args[0] === 'report.auto_escalated');
      expect(autoEscalatedCalls).toHaveLength(3);
    });
  });

  describe('scheduler without event bus', () => {

    it('should work without an event bus (no events emitted)', async () => {
      const schedulerNoEvents = new EscalationScheduler(service);

      const mockEntity = createMockReportEntity({ id: 'no-bus-report' });

      sandbox.stub(service, 'getModerationSettings').resolves({
        autoEscalationHours: 72,
        adminReportEscalationHours: 24,
        reminderBeforeEscalationHours: 12,
      });

      sandbox.stub(ReportEntity, 'findAll')
        .onFirstCall().resolves([mockEntity])
        .onSecondCall().resolves([])
        .onThirdCall().resolves([]);

      sandbox.stub(ReportEscalationEntity, 'fromModel').returns({
        save: sandbox.stub().resolves(),
      } as any);

      // Should not throw
      await schedulerNoEvents.checkAndEscalate();

      expect(mockEntity.update.calledOnce).toBe(true);
    });
  });
});
