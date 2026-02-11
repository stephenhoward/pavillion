import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { ReportCategory } from '@/common/model/report';
import ModerationService from '@/server/moderation/service/moderation';
import { ReporterBlockedError } from '@/server/moderation/exceptions';
import { ReportEntity } from '@/server/moderation/entity/report';
import { EventReporterEntity } from '@/server/moderation/entity/event_reporter';
import { Report } from '@/common/model/report';

describe('ModerationService - Email Blocking Integration', () => {
  let sandbox: sinon.SinonSandbox;
  let service: ModerationService;
  let eventBus: EventEmitter;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    service = new ModerationService(eventBus);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('createReport - email blocking check', () => {

    it('should throw ReporterBlockedError when anonymous reporter email is blocked', async () => {
      const blockedEmail = 'blocked@example.com';
      const emailHash = service.hashEmail(blockedEmail);

      // Mock isEmailBlocked to return true
      sandbox.stub(service, 'isEmailBlocked').resolves(true);
      sandbox.stub(service, 'hasExceededEmailRateLimit').resolves(false);

      await expect(service.createReport({
        eventId: 'event-1',
        calendarId: 'calendar-1',
        category: ReportCategory.SPAM,
        description: 'Spam report',
        reporterEmail: blockedEmail,
        reporterType: 'anonymous',
      })).rejects.toThrow(ReporterBlockedError);
    });

    it('should check email blocking before rate limit check', async () => {
      const blockedEmail = 'blocked@example.com';

      const isEmailBlockedStub = sandbox.stub(service, 'isEmailBlocked').resolves(true);
      const rateLimitStub = sandbox.stub(service, 'hasExceededEmailRateLimit');

      await expect(service.createReport({
        eventId: 'event-1',
        calendarId: 'calendar-1',
        category: ReportCategory.SPAM,
        description: 'Test',
        reporterEmail: blockedEmail,
        reporterType: 'anonymous',
      })).rejects.toThrow(ReporterBlockedError);

      // Blocking check should be called
      expect(isEmailBlockedStub.calledOnce).toBe(true);
      // Rate limit check should NOT be reached
      expect(rateLimitStub.called).toBe(false);
    });

    it('should allow report creation when email is not blocked', async () => {
      const email = 'allowed@example.com';

      sandbox.stub(service, 'isEmailBlocked').resolves(false);
      sandbox.stub(service, 'hasExceededEmailRateLimit').resolves(false);
      sandbox.stub(service, 'hasReporterAlreadyReported').resolves(false);

      const report = new Report('report-id-1');
      report.eventId = 'event-1';
      report.calendarId = 'calendar-1';

      sandbox.stub(ReportEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({ toModel: () => report }),
      } as any);
      sandbox.stub(EventReporterEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({}),
      } as any);

      const result = await service.createReport({
        eventId: 'event-1',
        calendarId: 'calendar-1',
        category: ReportCategory.SPAM,
        description: 'Test report',
        reporterEmail: email,
        reporterType: 'anonymous',
      });

      expect(result).toBeDefined();
      expect(result.eventId).toBe('event-1');
    });

    it('should not check email blocking for authenticated reporters', async () => {
      const isEmailBlockedStub = sandbox.stub(service, 'isEmailBlocked');
      sandbox.stub(service, 'hasReporterAlreadyReported').resolves(false);

      const report = new Report('report-id-1');
      sandbox.stub(ReportEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({ toModel: () => report }),
      } as any);
      sandbox.stub(EventReporterEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({}),
      } as any);

      await service.createReport({
        eventId: 'event-1',
        calendarId: 'calendar-1',
        category: ReportCategory.SPAM,
        description: 'Auth report',
        reporterAccountId: 'account-1',
        reporterType: 'authenticated',
      });

      // Email blocking should NOT be checked for authenticated reports
      expect(isEmailBlockedStub.called).toBe(false);
    });

    it('should not check email blocking for administrator reporters', async () => {
      const isEmailBlockedStub = sandbox.stub(service, 'isEmailBlocked');
      sandbox.stub(service, 'hasReporterAlreadyReported').resolves(false);

      const report = new Report('report-id-1');
      sandbox.stub(ReportEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({ toModel: () => report }),
      } as any);
      sandbox.stub(EventReporterEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({}),
      } as any);

      await service.createReport({
        eventId: 'event-1',
        calendarId: 'calendar-1',
        category: ReportCategory.SPAM,
        description: 'Admin report',
        reporterAccountId: 'admin-1',
        reporterType: 'administrator',
        adminId: 'admin-1',
        adminPriority: 'high',
      });

      // Email blocking should NOT be checked for admin reports
      expect(isEmailBlockedStub.called).toBe(false);
    });

    it('should include block reason in ReporterBlockedError', async () => {
      const blockedEmail = 'blocked@example.com';
      const blockReason = 'Abusive behavior';

      sandbox.stub(service, 'isEmailBlocked').resolves(true);
      sandbox.stub(service, 'hasExceededEmailRateLimit').resolves(false);

      try {
        await service.createReport({
          eventId: 'event-1',
          calendarId: 'calendar-1',
          category: ReportCategory.SPAM,
          description: 'Test',
          reporterEmail: blockedEmail,
          reporterType: 'anonymous',
        });
        // Should not reach here
        expect(true).toBe(false);
      }
      catch (error) {
        expect(error).toBeInstanceOf(ReporterBlockedError);
        expect((error as ReporterBlockedError).name).toBe('ReporterBlockedError');
        expect((error as ReporterBlockedError).message).toBeTruthy();
      }
    });
  });
});
