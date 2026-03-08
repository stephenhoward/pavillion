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
    testReport.forwardedToActorUri = 'https://remote.instance/calendars/remote-calendar';
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
    it('should call acknowledgeForwardedReport with Flag ID and sender actor URI', async () => {
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

      // Verify acknowledgeForwardedReport was called with the Flag ID and sender actor
      expect((moderationInterface.acknowledgeForwardedReport as sinon.SinonStub).calledOnce).toBe(true);
      expect((moderationInterface.acknowledgeForwardedReport as sinon.SinonStub).calledWith(
        'https://local.instance/flags/original-flag-id',
        'https://remote.instance/calendars/remote-calendar',
      )).toBe(true);
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

      // Verify acknowledgeForwardedReport was called with Flag ID and sender
      expect((moderationInterface.acknowledgeForwardedReport as sinon.SinonStub).calledOnce).toBe(true);
      expect((moderationInterface.acknowledgeForwardedReport as sinon.SinonStub).calledWith(
        'https://local.instance/flags/flag-id',
        'https://remote.instance/calendars/remote',
      )).toBe(true);
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

      // Verify acknowledgeForwardedReport was called with both args
      expect((moderationInterface.acknowledgeForwardedReport as sinon.SinonStub).calledOnce).toBe(true);
      expect((moderationInterface.acknowledgeForwardedReport as sinon.SinonStub).calledWith(
        'https://local.instance/flags/unknown-flag-id',
        'https://remote.instance/calendars/remote',
      )).toBe(true);
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

    it('should acknowledge forwarded report when Accept object is a string URI with domain mismatch', async () => {
      // When object is a string URI from a different domain than the actor,
      // it is treated as a Flag URI (our local Flag ID sent to the remote instance)
      const flagUri = 'https://local.instance/flags/forwarded-flag-id';
      const acceptActivity = AcceptActivity.fromObject({
        type: 'Accept',
        id: 'https://remote.instance/accepts/accept-string-flag',
        actor: 'https://remote.instance/calendars/remote-calendar',
        object: flagUri,
      });

      // Stub acknowledgeForwardedReport to return true (report found and updated)
      (moderationInterface.acknowledgeForwardedReport as sinon.SinonStub).resolves(true);

      await inboxService.processAcceptActivity(testCalendar, acceptActivity);

      // Verify acknowledgeForwardedReport was called with the string URI and sender actor
      expect((moderationInterface.acknowledgeForwardedReport as sinon.SinonStub).calledOnce).toBe(true);
      expect((moderationInterface.acknowledgeForwardedReport as sinon.SinonStub).calledWith(
        flagUri,
        'https://remote.instance/calendars/remote-calendar',
      )).toBe(true);
    });

    it('should reject Accept with string URI object when hostname mismatch and no matching report', async () => {
      // When the object URI hostname differs from the actor hostname and
      // no matching forwarded report exists, the Accept should be rejected
      const unknownUri = 'https://third-party.instance/flags/unknown-flag';
      const acceptActivity = AcceptActivity.fromObject({
        type: 'Accept',
        id: 'https://remote.instance/accepts/accept-suspicious',
        actor: 'https://remote.instance/calendars/remote-calendar',
        object: unknownUri,
      });

      // Stub acknowledgeForwardedReport to return false (no matching report)
      (moderationInterface.acknowledgeForwardedReport as sinon.SinonStub).resolves(false);

      const consoleWarnStub = sandbox.stub(console, 'warn');

      await inboxService.processAcceptActivity(testCalendar, acceptActivity);

      // Verify acknowledgeForwardedReport was attempted
      expect((moderationInterface.acknowledgeForwardedReport as sinon.SinonStub).calledOnce).toBe(true);

      // Verify a warning was logged about the mismatch
      const warningLogged = consoleWarnStub.getCalls().some(
        call => call.args[0]?.includes('hostname mismatch'),
      );
      expect(warningLogged).toBe(true);
    });

    it('should reject Accept with string URI object using non-https scheme', async () => {
      const maliciousUri = 'ftp://remote.instance/flags/some-flag';
      const acceptActivity = AcceptActivity.fromObject({
        type: 'Accept',
        id: 'https://remote.instance/accepts/accept-ftp',
        actor: 'https://remote.instance/calendars/remote-calendar',
        object: maliciousUri,
      });

      const consoleWarnStub = sandbox.stub(console, 'warn');

      await inboxService.processAcceptActivity(testCalendar, acceptActivity);

      // Verify acknowledgeForwardedReport was NOT called
      expect((moderationInterface.acknowledgeForwardedReport as sinon.SinonStub).called).toBe(false);

      // Verify a warning was logged about invalid scheme
      const warningLogged = consoleWarnStub.getCalls().some(
        call => call.args[0]?.includes('invalid scheme'),
      );
      expect(warningLogged).toBe(true);
    });
  });
});
