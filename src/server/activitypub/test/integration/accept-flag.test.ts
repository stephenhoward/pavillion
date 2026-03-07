import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import sinon from 'sinon';

import ProcessInboxService from '@/server/activitypub/service/inbox';
import CalendarInterface from '@/server/calendar/interface';
import ModerationInterface from '@/server/moderation/interface';
import { Calendar } from '@/common/model/calendar';
import { Report, ReportCategory, ReportStatus } from '@/common/model/report';
import AcceptActivity from '@/server/activitypub/model/action/accept';

describe('ProcessInboxService - Accept Flag Activity', () => {
  let inboxService: ProcessInboxService;
  let calendarInterface: CalendarInterface;
  let moderationInterface: ModerationInterface;
  let eventBus: EventEmitter;
  let testCalendar: Calendar;
  let testReport: Report;
  let sandbox: sinon.SinonSandbox;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();

    // Create test calendar
    testCalendar = new Calendar(uuidv4(), 'test-calendar');

    // Create test report with forwarded details
    testReport = new Report(uuidv4());
    testReport.eventId = uuidv4();
    testReport.calendarId = testCalendar.id;
    testReport.category = ReportCategory.SPAM;
    testReport.description = 'Test forwarded report';
    testReport.reporterType = 'authenticated';
    testReport.status = ReportStatus.SUBMITTED;
    testReport.forwardedReportId = 'https://local.instance/flags/original-flag-id';
    testReport.forwardStatus = 'pending';

    // Mock CalendarInterface
    calendarInterface = {} as any;

    // Mock ModerationInterface with acknowledgeForwardedReport
    moderationInterface = {
      acknowledgeForwardedReport: sandbox.stub(),
    } as any;

    inboxService = new ProcessInboxService(eventBus, calendarInterface, moderationInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('processAcceptActivity for Flag', () => {
    it('should update forward_status to acknowledged when Accept received for Flag', async () => {
      // Create Flag activity that was sent
      const originalFlagActivity = {
        type: 'Flag',
        id: 'https://local.instance/flags/original-flag-id',
        actor: 'https://local.instance/calendars/test-calendar',
        object: 'https://remote.instance/events/event-id',
        content: 'Test report',
      };

      // Create Accept activity responding to the Flag
      const acceptActivity = AcceptActivity.fromObject({
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Accept',
        id: 'https://remote.instance/accepts/accept-flag-id',
        actor: 'https://remote.instance/calendars/remote-calendar',
        object: originalFlagActivity,
      });

      // Stub acknowledgeForwardedReport to return true (report found and updated)
      (moderationInterface.acknowledgeForwardedReport as sinon.SinonStub).resolves(true);

      await inboxService.processAcceptActivity(testCalendar, acceptActivity);

      // Verify acknowledgeForwardedReport was called with the Flag ID
      expect((moderationInterface.acknowledgeForwardedReport as sinon.SinonStub).calledOnce).toBe(true);
      expect((moderationInterface.acknowledgeForwardedReport as sinon.SinonStub).calledWith('https://local.instance/flags/original-flag-id')).toBe(true);
    });

    it('should handle Accept activity when Flag object is a string ID', async () => {
      // Accept activity with Flag ID as string
      const acceptActivity = AcceptActivity.fromObject({
        type: 'Accept',
        id: 'https://remote.instance/accepts/accept-id',
        actor: 'https://remote.instance/calendars/remote',
        object: {
          type: 'Flag',
          id: 'https://local.instance/flags/flag-id',
        },
      });

      // Stub acknowledgeForwardedReport to return true
      (moderationInterface.acknowledgeForwardedReport as sinon.SinonStub).resolves(true);

      await inboxService.processAcceptActivity(testCalendar, acceptActivity);

      // Verify acknowledgeForwardedReport was called
      expect((moderationInterface.acknowledgeForwardedReport as sinon.SinonStub).calledOnce).toBe(true);
      expect((moderationInterface.acknowledgeForwardedReport as sinon.SinonStub).calledWith('https://local.instance/flags/flag-id')).toBe(true);
    });

    it('should log warning when Accept received for unknown Flag', async () => {
      const acceptActivity = AcceptActivity.fromObject({
        type: 'Accept',
        id: 'https://remote.instance/accepts/accept-id',
        actor: 'https://remote.instance/calendars/remote',
        object: {
          type: 'Flag',
          id: 'https://local.instance/flags/unknown-flag-id',
        },
      });

      // Stub acknowledgeForwardedReport to return false (not found)
      (moderationInterface.acknowledgeForwardedReport as sinon.SinonStub).resolves(false);

      // Should not throw, just log warning
      await inboxService.processAcceptActivity(testCalendar, acceptActivity);

      // Verify acknowledgeForwardedReport was called
      expect((moderationInterface.acknowledgeForwardedReport as sinon.SinonStub).calledOnce).toBe(true);
    });

    it('should handle Accept for Follow activities without affecting reports', async () => {
      // Accept activity for Follow (existing behavior)
      const followActivity = {
        type: 'Follow',
        id: 'https://local.instance/follows/follow-id',
        actor: 'https://local.instance/calendars/test',
        object: 'https://remote.instance/calendars/remote',
      };

      const acceptActivity = AcceptActivity.fromObject({
        type: 'Accept',
        id: 'https://remote.instance/accepts/accept-follow',
        actor: 'https://remote.instance/calendars/remote',
        object: followActivity,
      });

      // The Follow logic will call RemoteCalendarService.getByActorUri
      // which we need to mock to prevent database access
      const remoteCalendarService = (inboxService as any).remoteCalendarService;
      sandbox.stub(remoteCalendarService, 'getByActorUri').resolves(null);

      await inboxService.processAcceptActivity(testCalendar, acceptActivity);

      // Verify acknowledgeForwardedReport was not called for Follow accepts
      expect((moderationInterface.acknowledgeForwardedReport as sinon.SinonStub).called).toBe(false);
    });
  });
});
