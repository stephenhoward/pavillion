import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import ProcessInboxService from '@/server/activitypub/service/inbox';
import ModerationService from '@/server/moderation/service/moderation';
import ModerationInterface from '@/server/moderation/interface';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import EmailInterface from '@/server/email/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import RemoteCalendarService from '@/server/activitypub/service/remote_calendar';
import { ActivityPubInboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import { Calendar } from '@/common/model/calendar';
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';
import CreateActivity from '@/server/activitypub/model/action/create';

describe('ProcessInboxService - Blocked Instance Filtering', () => {
  let sandbox: sinon.SinonSandbox;
  let inboxService: ProcessInboxService;
  let moderationInterface: ModerationInterface;
  let calendarInterface: CalendarInterface;
  let eventBus: EventEmitter;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();

    // Create stub interfaces
    calendarInterface = sandbox.createStubInstance(CalendarInterface) as unknown as CalendarInterface;
    const accountsInterface = sandbox.createStubInstance(AccountsInterface) as unknown as AccountsInterface;
    const emailInterface = sandbox.createStubInstance(EmailInterface) as unknown as EmailInterface;
    const configurationInterface = sandbox.createStubInstance(ConfigurationInterface) as unknown as ConfigurationInterface;

    // Create real ModerationInterface with stubs
    moderationInterface = new ModerationInterface(
      eventBus,
      calendarInterface,
      accountsInterface,
      emailInterface,
      configurationInterface,
    );

    // Create ProcessInboxService with ModerationInterface
    inboxService = new ProcessInboxService(eventBus, calendarInterface, moderationInterface);

    // Stub RemoteCalendarService methods that need database access
    const remoteCalendarService = (inboxService as any).remoteCalendarService as RemoteCalendarService;
    sandbox.stub(remoteCalendarService, 'findOrCreateByActorUri').resolves({
      id: 'remote-calendar-id',
      actor_uri: 'https://remote.example.com/calendars/testcal',
    } as any);
  });

  afterEach(() => {
    sandbox.restore();
    vi.restoreAllMocks();
  });

  describe('Blocked instance filtering', () => {
    it('should reject activities from blocked instances before processing', async () => {
      const blockedDomain = 'blocked.example.com';
      const actorUri = `https://${blockedDomain}/users/testuser`;

      // Stub ModerationService to report instance as blocked
      const moderationService = moderationInterface.getModerationService();
      sandbox.stub(moderationService, 'isInstanceBlocked').resolves(true);

      // Create a test calendar
      const calendar = new Calendar('test-cal-id', 'test-calendar');

      // Stub calendar lookup
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(calendar);

      // Create a mock inbox message with Create activity from blocked instance
      const objectData = {
        id: 'https://blocked.example.com/events/123',
        type: 'Event',
        name: 'Test Event',
      };

      const createActivity = new CreateActivity(actorUri, objectData);

      const mockMessage = {
        id: 'msg-123',
        calendar_id: 'test-cal-id',
        type: 'Create',
        message: createActivity.toObject(),
        messageTime: new Date(),
        processedAt: null,
        update: sandbox.stub().resolves(),
      } as unknown as ActivityPubInboxMessageEntity;

      // Spy on processCreateEvent to ensure it's NOT called
      const processCreateEventSpy = sandbox.spy(inboxService, 'processCreateEvent');

      // Process the message
      await inboxService.processInboxMessage(mockMessage);

      // Verify the activity was NOT processed
      expect(processCreateEventSpy.called).toBe(false);

      // Verify the message was marked as processed with blocked status
      expect(mockMessage.update.calledOnce).toBe(true);
      const updateCall = mockMessage.update.getCall(0);
      expect(updateCall.args[0].processed_status).toBe('blocked');
      expect(updateCall.args[0].processed_time).toBeInstanceOf(Date);
    });

    it('should process activities from non-blocked instances normally', async () => {
      const allowedDomain = 'allowed.example.com';
      const actorUri = `https://${allowedDomain}/calendars/testcal`;

      // Stub ModerationService to report instance as NOT blocked
      const moderationService = moderationInterface.getModerationService();
      sandbox.stub(moderationService, 'isInstanceBlocked').resolves(false);

      // Create a test calendar
      const calendar = new Calendar('test-cal-id', 'test-calendar');

      // Stub calendar lookup
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(calendar);

      // Stub actorOwnsObject to return true (for ownership verification)
      sandbox.stub(inboxService as any, 'actorOwnsObject').resolves(true);

      // Stub EventObjectEntity database operations
      vi.spyOn(EventObjectEntity, 'findOne').mockResolvedValue(null);
      vi.spyOn(EventObjectEntity, 'create').mockResolvedValue({} as any);

      // Stub addRemoteEvent to prevent actual database operations
      (calendarInterface.addRemoteEvent as sinon.SinonStub).resolves({
        id: 'new-event-id',
      } as any);

      // Stub checkAndPerformAutoRepost to avoid database complexity
      sandbox.stub(inboxService as any, 'checkAndPerformAutoRepost').resolves();

      // Create a mock inbox message
      const objectData = {
        id: 'https://allowed.example.com/events/456',
        type: 'Event',
        name: 'Allowed Event',
      };

      const createActivity = new CreateActivity(actorUri, objectData);

      const mockMessage = {
        id: 'msg-456',
        calendar_id: 'test-cal-id',
        type: 'Create',
        message: createActivity.toObject(),
        messageTime: new Date(),
        processedAt: null,
        update: sandbox.stub().resolves(),
      } as unknown as ActivityPubInboxMessageEntity;

      // Process the message
      await inboxService.processInboxMessage(mockMessage);

      // Verify the message was marked as processed successfully
      expect(mockMessage.update.calledOnce).toBe(true);
      const updateCall = mockMessage.update.getCall(0);
      expect(updateCall.args[0].processed_status).toBe('ok');
    });

    it('should extract domain from various actor URI formats', async () => {
      const testCases = [
        { actorUri: 'https://example.com/users/alice', expectedDomain: 'example.com' },
        { actorUri: 'https://social.example.org/calendars/events', expectedDomain: 'social.example.org' },
        { actorUri: 'https://mastodon.social/@user', expectedDomain: 'mastodon.social' },
        { actorUri: 'https://sub.domain.example.com/actor/123', expectedDomain: 'sub.domain.example.com' },
      ];

      const moderationService = moderationInterface.getModerationService();
      const isBlockedStub = sandbox.stub(moderationService, 'isInstanceBlocked');

      for (const testCase of testCases) {
        // Clear the calendar interface stub before each iteration
        sandbox.restore();
        vi.restoreAllMocks();
        sandbox = sinon.createSandbox();

        // Recreate the interface stubs
        calendarInterface = sandbox.createStubInstance(CalendarInterface) as unknown as CalendarInterface;
        const accountsInterface = sandbox.createStubInstance(AccountsInterface) as unknown as AccountsInterface;
        const emailInterface = sandbox.createStubInstance(EmailInterface) as unknown as EmailInterface;
        const configurationInterface = sandbox.createStubInstance(ConfigurationInterface) as unknown as ConfigurationInterface;

        // Recreate ModerationInterface
        moderationInterface = new ModerationInterface(
          eventBus,
          calendarInterface,
          accountsInterface,
          emailInterface,
          configurationInterface,
        );

        // Stub isInstanceBlocked for this iteration
        const moderationService = moderationInterface.getModerationService();
        sandbox.stub(moderationService, 'isInstanceBlocked').resolves(false);

        // Recreate inboxService with new interfaces
        inboxService = new ProcessInboxService(eventBus, calendarInterface, moderationInterface);

        // Stub RemoteCalendarService for this iteration
        const remoteCalendarService = (inboxService as any).remoteCalendarService as RemoteCalendarService;
        sandbox.stub(remoteCalendarService, 'findOrCreateByActorUri').resolves({
          id: 'remote-calendar-id',
          actor_uri: testCase.actorUri,
        } as any);

        const calendar = new Calendar('test-cal-id', 'test-calendar');
        (calendarInterface.getCalendar as sinon.SinonStub).resolves(calendar);

        const objectData = {
          id: `${testCase.actorUri}/events/test`,
          type: 'Event',
          name: 'Test Event',
        };

        const createActivity = new CreateActivity(testCase.actorUri, objectData);

        const mockMessage = {
          id: 'msg-test',
          calendar_id: 'test-cal-id',
          type: 'Create',
          message: createActivity.toObject(),
          messageTime: new Date(),
          processedAt: null,
          update: sandbox.stub().resolves(),
        } as unknown as ActivityPubInboxMessageEntity;

        await inboxService.processInboxMessage(mockMessage);

        // Verify isInstanceBlocked was called with the correct domain
        const isBlockedCalls = (moderationService.isInstanceBlocked as sinon.SinonStub).getCalls();
        expect(isBlockedCalls.length).toBeGreaterThan(0);
        expect(isBlockedCalls[0].args[0]).toBe(testCase.expectedDomain);
      }
    });

    it('should log blocked activity attempts for audit', async () => {
      const blockedDomain = 'malicious.example.com';
      const actorUri = `https://${blockedDomain}/users/spammer`;

      const moderationService = moderationInterface.getModerationService();
      sandbox.stub(moderationService, 'isInstanceBlocked').resolves(true);

      const calendar = new Calendar('test-cal-id', 'test-calendar');
      calendar.urlName = 'test-calendar';
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(calendar);

      // Spy on console.warn to verify structured audit logging
      const consoleWarnSpy = sandbox.spy(console, 'warn');

      const objectData = {
        id: 'https://malicious.example.com/events/spam',
        type: 'Event',
        name: 'Spam Event',
      };

      const createActivity = new CreateActivity(actorUri, objectData);

      const mockMessage = {
        id: 'msg-spam',
        calendar_id: 'test-cal-id',
        type: 'Create',
        message: createActivity.toObject(),
        messageTime: new Date(),
        processedAt: null,
        update: sandbox.stub().resolves(),
      } as unknown as ActivityPubInboxMessageEntity;

      await inboxService.processInboxMessage(mockMessage);

      // Verify structured audit log was written
      expect(consoleWarnSpy.calledOnce).toBe(true);
      const logCall = consoleWarnSpy.getCall(0);
      const logOutput = logCall.args[0];

      // Parse the JSON log output
      const logEntry = JSON.parse(logOutput);

      // Verify structured log contains expected fields
      expect(logEntry.context).toBe('activitypub.inbox.rejection');
      expect(logEntry.rejection_type).toBe('blocked_instance');
      expect(logEntry.activity_type).toBe('Create');
      expect(logEntry.actor_uri).toBe(actorUri);
      expect(logEntry.actor_domain).toBe(blockedDomain);
      expect(logEntry.calendar_id).toBe('test-cal-id');
      expect(logEntry.calendar_url_name).toBe('test-calendar');
      expect(logEntry.message_id).toBe('msg-spam');
      expect(logEntry.reason).toContain(blockedDomain);
    });
  });
});
