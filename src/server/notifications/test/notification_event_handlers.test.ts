import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import NotificationEventHandlers from '@/server/notifications/events';
import NotificationService from '@/server/notifications/service/notification';
import CalendarInterface from '@/server/calendar/interface';
import { Account } from '@/common/model/account';
import { Notification } from '@/common/model/notification';
import { Report, ReportStatus } from '@/common/model/report';
import type { ReporterType } from '@/common/model/report';

describe('NotificationEventHandlers', () => {
  let sandbox: sinon.SinonSandbox;
  let eventBus: EventEmitter;
  let service: NotificationService;
  let calendarInterface: CalendarInterface;
  let createNotificationStub: sinon.SinonStub;
  let getEditorsStub: sinon.SinonStub;
  let getReportReviewersStub: sinon.SinonStub;
  let handlers: NotificationEventHandlers;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();

    // Stub the service and calendarInterface with minimal fakes
    service = { createNotification: async () => null } as unknown as NotificationService;
    calendarInterface = {
      getEditorsForCalendar: async () => [],
      getReportReviewersForCalendar: async () => [],
    } as unknown as CalendarInterface;

    createNotificationStub = sandbox.stub(service, 'createNotification');
    getEditorsStub = sandbox.stub(calendarInterface, 'getEditorsForCalendar');
    // Report-related fan-outs (report_received / report_verified /
    // report_escalated) use the report-reviewers source, not the editors
    // source — only admins / owner / editors with can_review_reports
    // receive the deep-link they can actually act on (pv-2ppm).
    getReportReviewersStub = sandbox.stub(calendarInterface, 'getReportReviewersForCalendar');

    handlers = new NotificationEventHandlers(service, calendarInterface);
    handlers.install(eventBus);
  });

  afterEach(() => {
    sandbox.restore();
    eventBus.removeAllListeners();
  });

  // ---------------------------------------------------------------------------
  // install
  // ---------------------------------------------------------------------------

  describe('install', () => {
    it('should register listener for activitypub:calendar:followed', () => {
      expect(eventBus.listenerCount('activitypub:calendar:followed')).toBe(1);
    });

    it('should register listener for activitypub:event:reposted', () => {
      expect(eventBus.listenerCount('activitypub:event:reposted')).toBe(1);
    });

    it('should register listener for activitypub:event:unreposted', () => {
      expect(eventBus.listenerCount('activitypub:event:unreposted')).toBe(1);
    });

    it('should register listener for reportCreated', () => {
      expect(eventBus.listenerCount('reportCreated')).toBe(1);
    });

    it('should register listener for reportReceived', () => {
      expect(eventBus.listenerCount('reportReceived')).toBe(1);
    });

    it('should register listener for reportVerified', () => {
      expect(eventBus.listenerCount('reportVerified')).toBe(1);
    });

    it('should register listener for reportEscalated', () => {
      expect(eventBus.listenerCount('reportEscalated')).toBe(1);
    });

    it('should register listener for reportAutoEscalated', () => {
      expect(eventBus.listenerCount('reportAutoEscalated')).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Helpers for report-related handler tests
  // ---------------------------------------------------------------------------

  const makeReport = (overrides: {
    calendarId?: string | null;
    eventId?: string;
    status?: ReportStatus;
    reporterType?: ReporterType;
  } = {}): Report => {
    const report = new Report(uuidv4());
    report.calendarId = overrides.calendarId !== undefined ? overrides.calendarId : uuidv4();
    report.eventId = overrides.eventId ?? uuidv4();
    report.status = overrides.status ?? ReportStatus.SUBMITTED;
    report.reporterType = overrides.reporterType ?? 'authenticated';
    return report;
  };

  // ---------------------------------------------------------------------------
  // activitypub:calendar:followed
  // ---------------------------------------------------------------------------

  describe('activitypub:calendar:followed', () => {
    it('should call createNotification once per editor', async () => {
      const calendarId = uuidv4();
      const accountA = new Account(uuidv4(), 'alice', 'alice@example.com');
      const accountB = new Account(uuidv4(), 'bob', 'bob@example.com');

      getEditorsStub.resolves([accountA, accountB]);
      createNotificationStub.resolves(null);

      eventBus.emit('activitypub:calendar:followed', {
        calendarId,
        followerName: 'Follower',
        followerUrl: 'https://remote.example.com/actor',
      });

      // Allow async handlers to settle
      await new Promise(resolve => setImmediate(resolve));

      expect(getEditorsStub.calledOnceWith(calendarId)).toBe(true);
      expect(createNotificationStub.callCount).toBe(2);
    });

    it('should create follow notifications with correct arguments', async () => {
      const calendarId = uuidv4();
      const accountId = uuidv4();
      const account = new Account(accountId, 'alice', 'alice@example.com');
      const followerUrl = 'https://remote.example.com/actor';

      getEditorsStub.resolves([account]);
      createNotificationStub.resolves(null);

      eventBus.emit('activitypub:calendar:followed', {
        calendarId,
        followerName: 'Follower Name',
        followerUrl,
      });

      await new Promise(resolve => setImmediate(resolve));

      const [type, calId, eventId, actorName, actorUrl, acctId] = createNotificationStub.firstCall.args;
      expect(type).toBe('follow');
      expect(calId).toBe(calendarId);
      expect(eventId).toBeNull();
      expect(actorName).toBe('Follower Name');
      expect(actorUrl).toBe(followerUrl);
      expect(acctId).toBe(accountId);
    });

    it('should not call createNotification when calendar has no editors', async () => {
      getEditorsStub.resolves([]);
      createNotificationStub.resolves(null);

      eventBus.emit('activitypub:calendar:followed', {
        calendarId: uuidv4(),
        followerName: 'Follower',
        followerUrl: null,
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(createNotificationStub.called).toBe(false);
    });

    it('should handle null followerUrl', async () => {
      const calendarId = uuidv4();
      const account = new Account(uuidv4(), 'alice', 'alice@example.com');

      getEditorsStub.resolves([account]);
      createNotificationStub.resolves(null);

      eventBus.emit('activitypub:calendar:followed', {
        calendarId,
        followerName: 'Follower',
        followerUrl: null,
      });

      await new Promise(resolve => setImmediate(resolve));

      const [, , , , actorUrl] = createNotificationStub.firstCall.args;
      expect(actorUrl).toBeNull();
    });

    it('should not rethrow errors from getEditorsForCalendar', async () => {
      getEditorsStub.rejects(new Error('DB error'));

      // Should not throw
      eventBus.emit('activitypub:calendar:followed', {
        calendarId: uuidv4(),
        followerName: 'Follower',
        followerUrl: null,
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(createNotificationStub.called).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // activitypub:event:reposted
  // ---------------------------------------------------------------------------

  describe('activitypub:event:reposted', () => {
    it('should call createNotification once per editor', async () => {
      const calendarId = uuidv4();
      const eventId = uuidv4();
      const accountA = new Account(uuidv4(), 'alice', 'alice@example.com');
      const accountB = new Account(uuidv4(), 'bob', 'bob@example.com');

      getEditorsStub.resolves([accountA, accountB]);
      createNotificationStub.resolves(null);

      eventBus.emit('activitypub:event:reposted', {
        eventId,
        calendarId,
        reposterName: 'Reposter',
        reposterUrl: 'https://remote.example.com/actor',
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(getEditorsStub.calledOnceWith(calendarId)).toBe(true);
      expect(createNotificationStub.callCount).toBe(2);
    });

    it('should create repost notifications with correct arguments', async () => {
      const calendarId = uuidv4();
      const eventId = uuidv4();
      const accountId = uuidv4();
      const account = new Account(accountId, 'alice', 'alice@example.com');
      const reposterUrl = 'https://remote.example.com/actor';

      getEditorsStub.resolves([account]);
      createNotificationStub.resolves(null);

      eventBus.emit('activitypub:event:reposted', {
        eventId,
        calendarId,
        reposterName: 'Reposter Name',
        reposterUrl,
      });

      await new Promise(resolve => setImmediate(resolve));

      const [type, calId, evtId, actorName, actorUrl, acctId] = createNotificationStub.firstCall.args;
      expect(type).toBe('repost');
      expect(calId).toBe(calendarId);
      expect(evtId).toBe(eventId);
      expect(actorName).toBe('Reposter Name');
      expect(actorUrl).toBe(reposterUrl);
      expect(acctId).toBe(accountId);
    });

    it('should not call createNotification when calendar has no editors', async () => {
      getEditorsStub.resolves([]);
      createNotificationStub.resolves(null);

      eventBus.emit('activitypub:event:reposted', {
        eventId: uuidv4(),
        calendarId: uuidv4(),
        reposterName: 'Reposter',
        reposterUrl: null,
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(createNotificationStub.called).toBe(false);
    });

    it('should handle null reposterUrl', async () => {
      const calendarId = uuidv4();
      const eventId = uuidv4();
      const account = new Account(uuidv4(), 'alice', 'alice@example.com');

      getEditorsStub.resolves([account]);
      createNotificationStub.resolves(null);

      eventBus.emit('activitypub:event:reposted', {
        eventId,
        calendarId,
        reposterName: 'Reposter',
        reposterUrl: null,
      });

      await new Promise(resolve => setImmediate(resolve));

      const [, , , , actorUrl] = createNotificationStub.firstCall.args;
      expect(actorUrl).toBeNull();
    });

    it('should not rethrow errors from getEditorsForCalendar', async () => {
      getEditorsStub.rejects(new Error('DB error'));

      eventBus.emit('activitypub:event:reposted', {
        eventId: uuidv4(),
        calendarId: uuidv4(),
        reposterName: 'Reposter',
        reposterUrl: null,
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(createNotificationStub.called).toBe(false);
    });

    it('should not rethrow errors from createNotification', async () => {
      const account = new Account(uuidv4(), 'alice', 'alice@example.com');
      getEditorsStub.resolves([account]);
      createNotificationStub.rejects(new Error('insert error'));

      // Should not throw
      eventBus.emit('activitypub:event:reposted', {
        eventId: uuidv4(),
        calendarId: uuidv4(),
        reposterName: 'Reposter',
        reposterUrl: null,
      });

      await new Promise(resolve => setImmediate(resolve));
    });
  });

  // ---------------------------------------------------------------------------
  // report_received (reportCreated + reportReceived)
  // ---------------------------------------------------------------------------

  describe('report_received', () => {
    it('should source recipients from getReportReviewersForCalendar, not getEditorsForCalendar', async () => {
      // pv-2ppm: report fan-out must only notify accounts that can act on the
      // report (admins / owner / editors with can_review_reports). Sourcing
      // from getEditorsForCalendar would deep-link editors who 403 on mount.
      const report = makeReport();
      const account = new Account(uuidv4(), 'reviewer', 'reviewer@example.com');

      getReportReviewersStub.resolves([account]);
      getEditorsStub.resolves([new Account(uuidv4(), 'plain-editor', 'editor@example.com')]);
      createNotificationStub.resolves(null);

      eventBus.emit('reportCreated', { report });

      await new Promise(resolve => setImmediate(resolve));

      expect(getReportReviewersStub.calledOnceWith(report.calendarId!)).toBe(true);
      expect(getEditorsStub.called).toBe(false);
      expect(createNotificationStub.callCount).toBe(1);
      expect(createNotificationStub.firstCall.args[5]).toBe(account.id);
    });

    it('should create report_received notifications for each reviewer on reportCreated', async () => {
      const report = makeReport();
      const accountA = new Account(uuidv4(), 'alice', 'alice@example.com');
      const accountB = new Account(uuidv4(), 'bob', 'bob@example.com');

      getReportReviewersStub.resolves([accountA, accountB]);
      createNotificationStub.resolves(null);

      eventBus.emit('reportCreated', { report });

      await new Promise(resolve => setImmediate(resolve));

      expect(getReportReviewersStub.calledOnceWith(report.calendarId!)).toBe(true);
      expect(createNotificationStub.callCount).toBe(2);
    });

    it('should create report_received notifications with empty actor fields for authenticated reporter', async () => {
      const report = makeReport({ reporterType: 'authenticated' });
      const accountId = uuidv4();
      const account = new Account(accountId, 'alice', 'alice@example.com');

      getReportReviewersStub.resolves([account]);
      createNotificationStub.resolves(null);

      eventBus.emit('reportCreated', { report });

      await new Promise(resolve => setImmediate(resolve));

      const [type, calId, evtId, actorName, actorUrl, acctId, reportId] = createNotificationStub.firstCall.args;
      expect(type).toBe('report_received');
      expect(calId).toBe(report.calendarId);
      expect(evtId).toBe(report.eventId);
      expect(actorName).toBe('');
      expect(actorUrl).toBeNull();
      expect(acctId).toBe(accountId);
      expect(reportId).toBe(report.id);
    });

    it('should create report_received notifications with empty actor fields for administrator reporter', async () => {
      const report = makeReport({ reporterType: 'administrator' });
      const account = new Account(uuidv4(), 'alice', 'alice@example.com');

      getReportReviewersStub.resolves([account]);
      createNotificationStub.resolves(null);

      eventBus.emit('reportCreated', { report });

      await new Promise(resolve => setImmediate(resolve));

      const [type, , , actorName, actorUrl] = createNotificationStub.firstCall.args;
      expect(type).toBe('report_received');
      expect(actorName).toBe('');
      expect(actorUrl).toBeNull();
    });

    it('should NOT create notifications for pending_verification reports', async () => {
      const report = makeReport({
        status: ReportStatus.PENDING_VERIFICATION,
        reporterType: 'anonymous',
      });
      const account = new Account(uuidv4(), 'alice', 'alice@example.com');

      getReportReviewersStub.resolves([account]);
      createNotificationStub.resolves(null);

      eventBus.emit('reportCreated', { report });

      await new Promise(resolve => setImmediate(resolve));

      expect(getReportReviewersStub.called).toBe(false);
      expect(createNotificationStub.called).toBe(false);
    });

    it('should create report_received notifications on federated reportReceived event with empty actor fields', async () => {
      const report = makeReport({ reporterType: 'federation' });
      const account = new Account(uuidv4(), 'alice', 'alice@example.com');

      getReportReviewersStub.resolves([account]);
      createNotificationStub.resolves(null);

      eventBus.emit('reportReceived', { report });

      await new Promise(resolve => setImmediate(resolve));

      const [type, , , actorName, actorUrl] = createNotificationStub.firstCall.args;
      expect(type).toBe('report_received');
      expect(actorName).toBe('');
      expect(actorUrl).toBeNull();
    });

    it('should not call createNotification when calendar has no reviewers (reportCreated)', async () => {
      getReportReviewersStub.resolves([]);
      createNotificationStub.resolves(null);

      eventBus.emit('reportCreated', { report: makeReport() });

      await new Promise(resolve => setImmediate(resolve));

      expect(createNotificationStub.called).toBe(false);
    });

    it('should not call createNotification when calendar has no reviewers (reportReceived)', async () => {
      getReportReviewersStub.resolves([]);
      createNotificationStub.resolves(null);

      eventBus.emit('reportReceived', { report: makeReport({ reporterType: 'federation' }) });

      await new Promise(resolve => setImmediate(resolve));

      expect(createNotificationStub.called).toBe(false);
    });

    it('should rely on service dedup when receiving the same report twice', async () => {
      const report = makeReport();
      const account = new Account(uuidv4(), 'alice', 'alice@example.com');
      getReportReviewersStub.resolves([account]);
      // Dedup is the service's responsibility: it returns null on a duplicate.
      // The handler does not need to second-guess; it simply forwards.
      createNotificationStub.onFirstCall().resolves(new Notification(uuidv4()));
      createNotificationStub.onSecondCall().resolves(null);

      eventBus.emit('reportCreated', { report });
      await new Promise(resolve => setImmediate(resolve));
      eventBus.emit('reportCreated', { report });
      await new Promise(resolve => setImmediate(resolve));

      expect(createNotificationStub.callCount).toBe(2);
      // Both calls forward identical privacy-preserving args.
      const firstArgs = createNotificationStub.firstCall.args;
      const secondArgs = createNotificationStub.secondCall.args;
      expect(firstArgs[0]).toBe('report_received');
      expect(secondArgs[0]).toBe('report_received');
      expect(firstArgs[3]).toBe('');
      expect(secondArgs[3]).toBe('');
      expect(firstArgs[4]).toBeNull();
      expect(secondArgs[4]).toBeNull();
    });

    it('should not rethrow errors from getReportReviewersForCalendar', async () => {
      getReportReviewersStub.rejects(new Error('DB error'));

      eventBus.emit('reportCreated', { report: makeReport() });

      await new Promise(resolve => setImmediate(resolve));

      expect(createNotificationStub.called).toBe(false);
    });

    it('should not rethrow errors from createNotification', async () => {
      const account = new Account(uuidv4(), 'alice', 'alice@example.com');
      getReportReviewersStub.resolves([account]);
      createNotificationStub.rejects(new Error('insert error'));

      eventBus.emit('reportCreated', { report: makeReport() });

      await new Promise(resolve => setImmediate(resolve));
      // No throw expected — error suppression
    });

    it('should skip when calendarId is null', async () => {
      const report = makeReport({ calendarId: null });

      eventBus.emit('reportCreated', { report });

      await new Promise(resolve => setImmediate(resolve));

      expect(getReportReviewersStub.called).toBe(false);
      expect(createNotificationStub.called).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // report_verified
  // ---------------------------------------------------------------------------

  describe('report_verified', () => {
    it('should source recipients from getReportReviewersForCalendar', async () => {
      // pv-2ppm: same scoping rule as report_received.
      const report = makeReport({ reporterType: 'anonymous', status: ReportStatus.SUBMITTED });
      const account = new Account(uuidv4(), 'reviewer', 'reviewer@example.com');

      getReportReviewersStub.resolves([account]);
      getEditorsStub.resolves([new Account(uuidv4(), 'plain-editor', 'editor@example.com')]);
      createNotificationStub.resolves(null);

      eventBus.emit('reportVerified', { report });

      await new Promise(resolve => setImmediate(resolve));

      expect(getReportReviewersStub.calledOnceWith(report.calendarId!)).toBe(true);
      expect(getEditorsStub.called).toBe(false);
      expect(createNotificationStub.callCount).toBe(1);
    });

    it('should create report_verified notifications for each reviewer', async () => {
      const report = makeReport({ reporterType: 'anonymous', status: ReportStatus.SUBMITTED });
      const accountA = new Account(uuidv4(), 'alice', 'alice@example.com');
      const accountB = new Account(uuidv4(), 'bob', 'bob@example.com');

      getReportReviewersStub.resolves([accountA, accountB]);
      createNotificationStub.resolves(null);

      eventBus.emit('reportVerified', { report });

      await new Promise(resolve => setImmediate(resolve));

      expect(getReportReviewersStub.calledOnceWith(report.calendarId!)).toBe(true);
      expect(createNotificationStub.callCount).toBe(2);
    });

    it('should create report_verified notifications with empty actor fields', async () => {
      const report = makeReport({ reporterType: 'anonymous' });
      const accountId = uuidv4();
      const account = new Account(accountId, 'alice', 'alice@example.com');

      getReportReviewersStub.resolves([account]);
      createNotificationStub.resolves(null);

      eventBus.emit('reportVerified', { report });

      await new Promise(resolve => setImmediate(resolve));

      const [type, calId, evtId, actorName, actorUrl, acctId, reportId] = createNotificationStub.firstCall.args;
      expect(type).toBe('report_verified');
      expect(calId).toBe(report.calendarId);
      expect(evtId).toBe(report.eventId);
      expect(actorName).toBe('');
      expect(actorUrl).toBeNull();
      expect(acctId).toBe(accountId);
      expect(reportId).toBe(report.id);
    });

    it('should not call createNotification when calendar has no reviewers', async () => {
      getReportReviewersStub.resolves([]);
      createNotificationStub.resolves(null);

      eventBus.emit('reportVerified', { report: makeReport() });

      await new Promise(resolve => setImmediate(resolve));

      expect(createNotificationStub.called).toBe(false);
    });

    it('should rely on service dedup when receiving the same verification twice', async () => {
      const report = makeReport({ reporterType: 'anonymous' });
      const account = new Account(uuidv4(), 'alice', 'alice@example.com');
      getReportReviewersStub.resolves([account]);
      createNotificationStub.onFirstCall().resolves(new Notification(uuidv4()));
      createNotificationStub.onSecondCall().resolves(null);

      eventBus.emit('reportVerified', { report });
      await new Promise(resolve => setImmediate(resolve));
      eventBus.emit('reportVerified', { report });
      await new Promise(resolve => setImmediate(resolve));

      expect(createNotificationStub.callCount).toBe(2);
      expect(createNotificationStub.firstCall.args[0]).toBe('report_verified');
      expect(createNotificationStub.firstCall.args[3]).toBe('');
      expect(createNotificationStub.firstCall.args[4]).toBeNull();
    });

    it('should not rethrow errors from getReportReviewersForCalendar', async () => {
      getReportReviewersStub.rejects(new Error('DB error'));

      eventBus.emit('reportVerified', { report: makeReport() });

      await new Promise(resolve => setImmediate(resolve));

      expect(createNotificationStub.called).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // report_escalated (reportEscalated + reportAutoEscalated)
  // ---------------------------------------------------------------------------

  describe('report_escalated', () => {
    it('should source recipients from getReportReviewersForCalendar', async () => {
      // pv-2ppm: escalation notifications must skip editors who lack
      // can_review_reports — otherwise they get a deep-link that 403s.
      const report = makeReport({ status: ReportStatus.ESCALATED });
      const account = new Account(uuidv4(), 'reviewer', 'reviewer@example.com');

      getReportReviewersStub.resolves([account]);
      getEditorsStub.resolves([new Account(uuidv4(), 'plain-editor', 'editor@example.com')]);
      createNotificationStub.resolves(null);

      eventBus.emit('reportEscalated', { report, reason: '' });

      await new Promise(resolve => setImmediate(resolve));

      expect(getReportReviewersStub.calledOnceWith(report.calendarId!)).toBe(true);
      expect(getEditorsStub.called).toBe(false);
      expect(createNotificationStub.callCount).toBe(1);
    });

    it('should create report_escalated notifications for each reviewer on manual escalation', async () => {
      const report = makeReport({ status: ReportStatus.ESCALATED });
      const accountA = new Account(uuidv4(), 'alice', 'alice@example.com');
      const accountB = new Account(uuidv4(), 'bob', 'bob@example.com');

      getReportReviewersStub.resolves([accountA, accountB]);
      createNotificationStub.resolves(null);

      eventBus.emit('reportEscalated', { report, reason: 'admin-authored note that must not leak' });

      await new Promise(resolve => setImmediate(resolve));

      expect(getReportReviewersStub.calledOnceWith(report.calendarId!)).toBe(true);
      expect(createNotificationStub.callCount).toBe(2);
    });

    it('should create report_escalated notifications with empty actor fields on manual escalation', async () => {
      const report = makeReport({ status: ReportStatus.ESCALATED });
      const accountId = uuidv4();
      const account = new Account(accountId, 'alice', 'alice@example.com');

      getReportReviewersStub.resolves([account]);
      createNotificationStub.resolves(null);

      eventBus.emit('reportEscalated', { report, reason: 'sensitive admin note' });

      await new Promise(resolve => setImmediate(resolve));

      const [type, calId, evtId, actorName, actorUrl, acctId, reportId] = createNotificationStub.firstCall.args;
      expect(type).toBe('report_escalated');
      expect(calId).toBe(report.calendarId);
      expect(evtId).toBe(report.eventId);
      expect(actorName).toBe('');
      expect(actorUrl).toBeNull();
      expect(acctId).toBe(accountId);
      expect(reportId).toBe(report.id);
    });

    it('should create report_escalated notifications on auto-escalation event', async () => {
      const report = makeReport({ status: ReportStatus.ESCALATED });
      const account = new Account(uuidv4(), 'alice', 'alice@example.com');

      getReportReviewersStub.resolves([account]);
      createNotificationStub.resolves(null);

      eventBus.emit('reportAutoEscalated', {
        report,
        reason: 'Auto-escalated: event exceeded report threshold of 3',
      });

      await new Promise(resolve => setImmediate(resolve));

      const [type, , , actorName, actorUrl] = createNotificationStub.firstCall.args;
      expect(type).toBe('report_escalated');
      expect(actorName).toBe('');
      expect(actorUrl).toBeNull();
    });

    it('should never write the escalation reason into the notification args', async () => {
      const report = makeReport({ status: ReportStatus.ESCALATED });
      const account = new Account(uuidv4(), 'alice', 'alice@example.com');
      const sensitiveReason = 'CONFIDENTIAL: admin note about reporter';

      getReportReviewersStub.resolves([account]);
      createNotificationStub.resolves(null);

      eventBus.emit('reportEscalated', { report, reason: sensitiveReason });

      await new Promise(resolve => setImmediate(resolve));

      const args = createNotificationStub.firstCall.args;
      for (const arg of args) {
        expect(arg).not.toBe(sensitiveReason);
        if (typeof arg === 'string') {
          expect(arg).not.toContain('CONFIDENTIAL');
        }
      }
    });

    it('should not call createNotification when calendar has no reviewers', async () => {
      getReportReviewersStub.resolves([]);
      createNotificationStub.resolves(null);

      eventBus.emit('reportEscalated', { report: makeReport(), reason: '' });

      await new Promise(resolve => setImmediate(resolve));

      expect(createNotificationStub.called).toBe(false);
    });

    it('should rely on service dedup when receiving the same escalation twice', async () => {
      const report = makeReport({ status: ReportStatus.ESCALATED });
      const account = new Account(uuidv4(), 'alice', 'alice@example.com');
      getReportReviewersStub.resolves([account]);
      createNotificationStub.onFirstCall().resolves(new Notification(uuidv4()));
      createNotificationStub.onSecondCall().resolves(null);

      eventBus.emit('reportEscalated', { report, reason: 'first' });
      await new Promise(resolve => setImmediate(resolve));
      eventBus.emit('reportEscalated', { report, reason: 'second' });
      await new Promise(resolve => setImmediate(resolve));

      expect(createNotificationStub.callCount).toBe(2);
      expect(createNotificationStub.firstCall.args[0]).toBe('report_escalated');
      expect(createNotificationStub.firstCall.args[3]).toBe('');
      expect(createNotificationStub.firstCall.args[4]).toBeNull();
    });

    it('should not rethrow errors from getReportReviewersForCalendar', async () => {
      getReportReviewersStub.rejects(new Error('DB error'));

      eventBus.emit('reportEscalated', { report: makeReport(), reason: 'reason' });

      await new Promise(resolve => setImmediate(resolve));

      expect(createNotificationStub.called).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Fan-out: single editor
  // ---------------------------------------------------------------------------

  describe('fan-out with single editor', () => {
    it('should create exactly one notification for a single editor on follow', async () => {
      const calendarId = uuidv4();
      const account = new Account(uuidv4(), 'solo', 'solo@example.com');

      getEditorsStub.resolves([account]);

      const notification = new Notification(uuidv4());
      notification.type = 'follow';
      createNotificationStub.resolves(notification);

      eventBus.emit('activitypub:calendar:followed', {
        calendarId,
        followerName: 'Follower',
        followerUrl: 'https://remote.example.com/actor',
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(createNotificationStub.callCount).toBe(1);
    });

    it('should create exactly one notification for a single editor on repost', async () => {
      const calendarId = uuidv4();
      const account = new Account(uuidv4(), 'solo', 'solo@example.com');

      getEditorsStub.resolves([account]);

      const notification = new Notification(uuidv4());
      notification.type = 'repost';
      createNotificationStub.resolves(notification);

      eventBus.emit('activitypub:event:reposted', {
        eventId: uuidv4(),
        calendarId,
        reposterName: 'Reposter',
        reposterUrl: null,
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(createNotificationStub.callCount).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // activitypub:event:unreposted
  //
  // Two-flow contract (pv-cou0):
  //   - The bus event name is unified across both flows.
  //   - The handler branches on actorAccountId presence:
  //       * Local flow (actorAccountId set, actorUrl null): a local editor
  //         unposted a reposted event. The initiating editor is excluded
  //         from the fan-out — "owner-initiated actions exclude initiator".
  //       * Inbound flow (actorAccountId null, actorUrl set): a remote
  //         calendar undid a share of a local event. No local initiator
  //         exists; ALL editors of the source calendar are notified, and
  //         actorUrl carries the remote actor's https:// profile URL.
  //   - createNotification is always called with type 'unshare' (single
  //     type for both flows). The 5th positional argument (actorUrl) is
  //     null on the local flow and the remote URL on the inbound flow.
  // ---------------------------------------------------------------------------

  describe('activitypub:event:unreposted', () => {
    it('should call createNotification for each editor excluding the actor', async () => {
      const calendarId = uuidv4();
      const eventId = uuidv4();
      const actorId = uuidv4();
      const accountA = new Account(actorId, 'alice', 'alice@example.com');
      const accountB = new Account(uuidv4(), 'bob', 'bob@example.com');
      const accountC = new Account(uuidv4(), 'carol', 'carol@example.com');

      getEditorsStub.resolves([accountA, accountB, accountC]);
      createNotificationStub.resolves(null);

      eventBus.emit('activitypub:event:unreposted', {
        eventId,
        calendarId,
        actorAccountId: actorId,
        actorName: 'Alice',
        actorUrl: null,
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(getEditorsStub.calledOnceWith(calendarId)).toBe(true);
      // Two co-editors should receive notifications; the actor must not.
      expect(createNotificationStub.callCount).toBe(2);
      const recipientIds = createNotificationStub.getCalls().map(call => call.args[5]);
      expect(recipientIds).not.toContain(actorId);
      expect(recipientIds).toContain(accountB.id);
      expect(recipientIds).toContain(accountC.id);
    });

    it('should create unshare notifications with correct arguments', async () => {
      const calendarId = uuidv4();
      const eventId = uuidv4();
      const actorId = uuidv4();
      const coEditorId = uuidv4();
      const actor = new Account(actorId, 'alice', 'alice@example.com');
      const coEditor = new Account(coEditorId, 'bob', 'bob@example.com');

      getEditorsStub.resolves([actor, coEditor]);
      createNotificationStub.resolves(null);

      eventBus.emit('activitypub:event:unreposted', {
        eventId,
        calendarId,
        actorAccountId: actorId,
        actorName: 'Alice Display',
        actorUrl: null,
      });

      await new Promise(resolve => setImmediate(resolve));

      const [type, calId, evtId, actorName, actorUrl, acctId] = createNotificationStub.firstCall.args;
      expect(type).toBe('unshare');
      expect(calId).toBe(calendarId);
      expect(evtId).toBe(eventId);
      expect(actorName).toBe('Alice Display');
      expect(actorUrl).toBeNull();
      expect(acctId).toBe(coEditorId);
    });

    it('should not call createNotification when actor is the sole editor', async () => {
      const actorId = uuidv4();
      const actor = new Account(actorId, 'solo', 'solo@example.com');

      getEditorsStub.resolves([actor]);
      createNotificationStub.resolves(null);

      eventBus.emit('activitypub:event:unreposted', {
        eventId: uuidv4(),
        calendarId: uuidv4(),
        actorAccountId: actorId,
        actorName: 'Solo',
        actorUrl: null,
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(createNotificationStub.called).toBe(false);
    });

    it('should not call createNotification when calendar has no editors', async () => {
      getEditorsStub.resolves([]);
      createNotificationStub.resolves(null);

      eventBus.emit('activitypub:event:unreposted', {
        eventId: uuidv4(),
        calendarId: uuidv4(),
        actorAccountId: uuidv4(),
        actorName: 'Alice',
        actorUrl: null,
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(createNotificationStub.called).toBe(false);
    });

    it('should pass actorUrl as null for local actors', async () => {
      const calendarId = uuidv4();
      const actorId = uuidv4();
      const coEditor = new Account(uuidv4(), 'bob', 'bob@example.com');

      getEditorsStub.resolves([coEditor]);
      createNotificationStub.resolves(null);

      eventBus.emit('activitypub:event:unreposted', {
        eventId: uuidv4(),
        calendarId,
        actorAccountId: actorId,
        actorName: 'Alice',
        actorUrl: null,
      });

      await new Promise(resolve => setImmediate(resolve));

      const [, , , , actorUrl] = createNotificationStub.firstCall.args;
      expect(actorUrl).toBeNull();
    });

    it('should not rethrow errors from getEditorsForCalendar', async () => {
      getEditorsStub.rejects(new Error('DB error'));

      eventBus.emit('activitypub:event:unreposted', {
        eventId: uuidv4(),
        calendarId: uuidv4(),
        actorAccountId: uuidv4(),
        actorName: 'Alice',
        actorUrl: null,
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(createNotificationStub.called).toBe(false);
    });

    it('should not rethrow errors from createNotification', async () => {
      const actorId = uuidv4();
      const coEditor = new Account(uuidv4(), 'bob', 'bob@example.com');
      getEditorsStub.resolves([coEditor]);
      createNotificationStub.rejects(new Error('insert error'));

      // Should not throw
      eventBus.emit('activitypub:event:unreposted', {
        eventId: uuidv4(),
        calendarId: uuidv4(),
        actorAccountId: actorId,
        actorName: 'Alice',
        actorUrl: null,
      });

      await new Promise(resolve => setImmediate(resolve));
    });

    // -------------------------------------------------------------------------
    // Inbound flow (pv-cou0.2 emit site): actorAccountId is null, actorUrl is
    // the remote calendar's https:// profile URL. The handler must notify ALL
    // editors (no exclusion) because there is no local initiator.
    // -------------------------------------------------------------------------

    it('should call createNotification for ALL editors on the inbound flow (no exclusion)', async () => {
      const calendarId = uuidv4();
      const eventId = uuidv4();
      const accountA = new Account(uuidv4(), 'alice', 'alice@example.com');
      const accountB = new Account(uuidv4(), 'bob', 'bob@example.com');
      const accountC = new Account(uuidv4(), 'carol', 'carol@example.com');

      getEditorsStub.resolves([accountA, accountB, accountC]);
      createNotificationStub.resolves(null);

      eventBus.emit('activitypub:event:unreposted', {
        eventId,
        calendarId,
        actorAccountId: null,
        actorName: 'Brewery Tour Collective',
        actorUrl: 'https://remote.instance/calendars/brewery-tour',
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(getEditorsStub.calledOnceWith(calendarId)).toBe(true);
      // No initiator to exclude — every editor of the source calendar is notified.
      expect(createNotificationStub.callCount).toBe(3);
      const recipientIds = createNotificationStub.getCalls().map(call => call.args[5]);
      expect(recipientIds).toContain(accountA.id);
      expect(recipientIds).toContain(accountB.id);
      expect(recipientIds).toContain(accountC.id);
    });

    it('should create inbound unshare notifications with the remote actorUrl and actorName', async () => {
      const calendarId = uuidv4();
      const eventId = uuidv4();
      const editorId = uuidv4();
      const editor = new Account(editorId, 'alice', 'alice@example.com');
      const remoteActorUrl = 'https://remote.instance/calendars/brewery-tour';

      getEditorsStub.resolves([editor]);
      createNotificationStub.resolves(null);

      eventBus.emit('activitypub:event:unreposted', {
        eventId,
        calendarId,
        actorAccountId: null,
        actorName: 'Brewery Tour Collective',
        actorUrl: remoteActorUrl,
      });

      await new Promise(resolve => setImmediate(resolve));

      const [type, calId, evtId, actorName, actorUrl, acctId] = createNotificationStub.firstCall.args;
      expect(type).toBe('unshare');
      expect(calId).toBe(calendarId);
      expect(evtId).toBe(eventId);
      expect(actorName).toBe('Brewery Tour Collective');
      // Inbound flow: actorUrl is the https profile URL, not null.
      expect(actorUrl).toBe(remoteActorUrl);
      expect(acctId).toBe(editorId);
    });

    it('should not rethrow errors from getEditorsForCalendar on the inbound flow', async () => {
      getEditorsStub.rejects(new Error('DB error'));

      eventBus.emit('activitypub:event:unreposted', {
        eventId: uuidv4(),
        calendarId: uuidv4(),
        actorAccountId: null,
        actorName: 'Brewery Tour Collective',
        actorUrl: 'https://remote.instance/calendars/brewery-tour',
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(createNotificationStub.called).toBe(false);
    });

    it('should not rethrow errors from createNotification on the inbound flow', async () => {
      const editor = new Account(uuidv4(), 'editor', 'editor@example.com');
      getEditorsStub.resolves([editor]);
      createNotificationStub.rejects(new Error('insert error'));

      // Should not throw
      eventBus.emit('activitypub:event:unreposted', {
        eventId: uuidv4(),
        calendarId: uuidv4(),
        actorAccountId: null,
        actorName: 'Brewery Tour Collective',
        actorUrl: 'https://remote.instance/calendars/brewery-tour',
      });

      await new Promise(resolve => setImmediate(resolve));
    });
  });
});
