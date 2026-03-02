import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import ProcessInboxService from '@/server/activitypub/service/inbox';
import ModerationInterface from '@/server/moderation/interface';
import ActivityPubInterface from '@/server/activitypub/interface';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import EmailInterface from '@/server/email/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import RemoteCalendarService from '@/server/activitypub/service/remote_calendar';
import { ActivityPubInboxMessageEntity, FollowerCalendarEntity, FollowingCalendarEntity } from '@/server/activitypub/entity/activitypub';
import { ActivityPubActor } from '@/server/activitypub/model/base';
import CreateActivity from '@/server/activitypub/model/action/create';
import { Calendar } from '@/common/model/calendar';

describe('ProcessInboxService - Relationship-Based Inbox Filtering', () => {
  let sandbox: sinon.SinonSandbox;
  let inboxService: ProcessInboxService;
  let moderationInterface: ModerationInterface;
  let calendarInterface: CalendarInterface;
  let eventBus: EventEmitter;
  let calendar: Calendar;
  let localActorUri: string;

  const remoteActorUri = 'https://remote.example.com/calendars/testcal';
  const remoteCalendarId = 'remote-cal-actor-id';

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();

    // Create stub interfaces
    calendarInterface = sandbox.createStubInstance(CalendarInterface) as unknown as CalendarInterface;
    const accountsInterface = sandbox.createStubInstance(AccountsInterface) as unknown as AccountsInterface;
    const emailInterface = sandbox.createStubInstance(EmailInterface) as unknown as EmailInterface;
    const configurationInterface = sandbox.createStubInstance(ConfigurationInterface) as unknown as ConfigurationInterface;
    const activityPubInterface = sandbox.createStubInstance(ActivityPubInterface) as unknown as ActivityPubInterface;

    // Create real ModerationInterface with stubs
    moderationInterface = new ModerationInterface(
      eventBus,
      calendarInterface,
      accountsInterface,
      emailInterface,
      configurationInterface,
      activityPubInterface,
    );

    // Create ProcessInboxService with ModerationInterface
    inboxService = new ProcessInboxService(eventBus, calendarInterface, moderationInterface);

    // Stub the blocked-instance check so it doesn't interfere with relationship filter tests
    const moderationService = moderationInterface.getModerationService();
    sandbox.stub(moderationService, 'isInstanceBlocked').resolves(false);

    // Stub RemoteCalendarService.findOrCreateByActorUri (used by Create processing path)
    const remoteCalendarService = (inboxService as any).remoteCalendarService as RemoteCalendarService;
    sandbox.stub(remoteCalendarService, 'findOrCreateByActorUri').resolves({
      id: remoteCalendarId,
      actor_uri: remoteActorUri,
    } as any);

    // Create test calendar and stub calendar lookup
    calendar = new Calendar('test-cal-id', 'test-calendar');
    (calendarInterface.getCalendar as sinon.SinonStub).resolves(calendar);

    // Compute local actor URI so tests can reference it
    localActorUri = ActivityPubActor.actorUrl(calendar);
  });

  afterEach(() => {
    sandbox.restore();
    vi.restoreAllMocks();
  });

  /**
   * Build a properly formed Create activity message using CreateActivity helpers.
   * This ensures CreateActivity.fromObject() succeeds when the message passes filtering.
   */
  function buildCreateMessage(
    actorUri: string,
    extra: Record<string, any> = {},
  ): ActivityPubInboxMessageEntity {
    const objectData = {
      id: `${actorUri}/events/test`,
      type: 'Event',
      name: 'Test Event',
    };
    const activity = new CreateActivity(actorUri, objectData);
    const messageBody = {
      ...activity.toObject(),
      ...extra,
    };
    return {
      id: 'msg-123',
      calendar_id: 'test-cal-id',
      type: 'Create',
      message: messageBody,
      messageTime: new Date(),
      update: sandbox.stub().resolves(),
    } as unknown as ActivityPubInboxMessageEntity;
  }

  /**
   * Build a minimal mock inbox message for non-Create activity types.
   * These types don't go through activity-specific parsing before the relationship filter.
   */
  function buildMessage(
    type: string,
    actorUri: string,
    extra: Record<string, any> = {},
  ): ActivityPubInboxMessageEntity {
    return {
      id: 'msg-123',
      calendar_id: 'test-cal-id',
      type,
      message: {
        actor: actorUri,
        to: [],
        cc: [],
        ...extra,
      },
      messageTime: new Date(),
      update: sandbox.stub().resolves(),
    } as unknown as ActivityPubInboxMessageEntity;
  }

  // ---------------------------------------------------------------------------
  // Case 1: Create from calendar we follow → accepted
  // ---------------------------------------------------------------------------
  it('should accept Create from a calendar we follow', async () => {
    const remoteCalendarService = (inboxService as any).remoteCalendarService as RemoteCalendarService;
    sandbox.stub(remoteCalendarService, 'getByActorUri').resolves({ id: remoteCalendarId, actor_uri: remoteActorUri } as any);

    sandbox.stub(FollowingCalendarEntity, 'findOne').resolves({ id: 'follow-record' } as any);
    sandbox.stub(FollowerCalendarEntity, 'findOne').resolves(null);

    // Stub processCreateEvent so we don't need full DB setup
    sandbox.stub(inboxService, 'processCreateEvent').resolves({ id: 'new-event-id' } as any);

    const message = buildCreateMessage(remoteActorUri);
    await inboxService.processInboxMessage(message);

    // Should be accepted (processed_status: 'ok') — not rejected
    expect((message.update as sinon.SinonStub).calledOnce).toBe(true);
    const updateArgs = (message.update as sinon.SinonStub).getCall(0).args[0];
    expect(updateArgs.processed_status).toBe('ok');
  });

  // ---------------------------------------------------------------------------
  // Case 2: Create from a calendar that follows us → accepted
  // ---------------------------------------------------------------------------
  it('should accept Create from a calendar that follows us', async () => {
    const remoteCalendarService = (inboxService as any).remoteCalendarService as RemoteCalendarService;
    sandbox.stub(remoteCalendarService, 'getByActorUri').resolves({ id: remoteCalendarId, actor_uri: remoteActorUri } as any);

    sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(null);
    sandbox.stub(FollowerCalendarEntity, 'findOne').resolves({ id: 'follower-record' } as any);

    sandbox.stub(inboxService, 'processCreateEvent').resolves({ id: 'new-event-id' } as any);

    const message = buildCreateMessage(remoteActorUri);
    await inboxService.processInboxMessage(message);

    expect((message.update as sinon.SinonStub).calledOnce).toBe(true);
    const updateArgs = (message.update as sinon.SinonStub).getCall(0).args[0];
    expect(updateArgs.processed_status).toBe('ok');
  });

  // ---------------------------------------------------------------------------
  // Case 3: Create from unrelated calendar → rejected
  // ---------------------------------------------------------------------------
  it('should reject Create from a calendar with no follow relationship', async () => {
    const remoteCalendarService = (inboxService as any).remoteCalendarService as RemoteCalendarService;
    sandbox.stub(remoteCalendarService, 'getByActorUri').resolves({ id: remoteCalendarId, actor_uri: remoteActorUri } as any);

    sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(null);
    sandbox.stub(FollowerCalendarEntity, 'findOne').resolves(null);

    // No processCreateEvent stub — relationship filter should reject before reaching it
    const message = buildCreateMessage(remoteActorUri);
    await inboxService.processInboxMessage(message);

    expect((message.update as sinon.SinonStub).calledOnce).toBe(true);
    const updateArgs = (message.update as sinon.SinonStub).getCall(0).args[0];
    expect(updateArgs.processed_status).toBe('rejected');
  });

  // ---------------------------------------------------------------------------
  // Case 4: Create with explicit addressing (to field = local actor URI) → accepted
  // ---------------------------------------------------------------------------
  it('should accept Create that explicitly addresses the local calendar actor', async () => {
    const remoteCalendarService = (inboxService as any).remoteCalendarService as RemoteCalendarService;
    sandbox.stub(remoteCalendarService, 'getByActorUri').resolves(null);

    sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(null);
    sandbox.stub(FollowerCalendarEntity, 'findOne').resolves(null);

    sandbox.stub(inboxService, 'processCreateEvent').resolves({ id: 'new-event-id' } as any);

    // Explicitly address the local actor — should bypass relationship check
    const message = buildCreateMessage(remoteActorUri, { to: [localActorUri] });
    await inboxService.processInboxMessage(message);

    expect((message.update as sinon.SinonStub).calledOnce).toBe(true);
    const updateArgs = (message.update as sinon.SinonStub).getCall(0).args[0];
    expect(updateArgs.processed_status).toBe('ok');
  });

  // ---------------------------------------------------------------------------
  // Case 5: Announce from unrelated calendar → rejected
  // ---------------------------------------------------------------------------
  it('should reject Announce from a calendar with no follow relationship', async () => {
    const remoteCalendarService = (inboxService as any).remoteCalendarService as RemoteCalendarService;
    sandbox.stub(remoteCalendarService, 'getByActorUri').resolves({ id: remoteCalendarId, actor_uri: remoteActorUri } as any);

    sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(null);
    sandbox.stub(FollowerCalendarEntity, 'findOne').resolves(null);

    const message = buildMessage('Announce', remoteActorUri);
    await inboxService.processInboxMessage(message);

    expect((message.update as sinon.SinonStub).calledOnce).toBe(true);
    const updateArgs = (message.update as sinon.SinonStub).getCall(0).args[0];
    expect(updateArgs.processed_status).toBe('rejected');
  });

  // ---------------------------------------------------------------------------
  // Case 6: Follow from unrelated calendar → NOT filtered (exempt type)
  // ---------------------------------------------------------------------------
  it('should NOT reject Follow from an unrelated calendar (Follow is exempt)', async () => {
    const remoteCalendarService = (inboxService as any).remoteCalendarService as RemoteCalendarService;
    sandbox.stub(remoteCalendarService, 'getByActorUri').resolves(null);

    sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(null);
    sandbox.stub(FollowerCalendarEntity, 'findOne').resolves(null);

    const message = buildMessage('Follow', remoteActorUri);
    await inboxService.processInboxMessage(message);

    // Relationship filter must NOT have set processed_status to 'rejected'
    const updateCalls = (message.update as sinon.SinonStub).getCalls();
    for (const call of updateCalls) {
      expect(call.args[0]?.processed_status).not.toBe('rejected');
    }
  });

  // ---------------------------------------------------------------------------
  // Case 7: Accept from unrelated calendar → NOT filtered (exempt type)
  // ---------------------------------------------------------------------------
  it('should NOT reject Accept from an unrelated calendar (Accept is exempt)', async () => {
    const remoteCalendarService = (inboxService as any).remoteCalendarService as RemoteCalendarService;
    sandbox.stub(remoteCalendarService, 'getByActorUri').resolves(null);

    sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(null);
    sandbox.stub(FollowerCalendarEntity, 'findOne').resolves(null);

    const message = buildMessage('Accept', remoteActorUri);
    await inboxService.processInboxMessage(message);

    const updateCalls = (message.update as sinon.SinonStub).getCalls();
    for (const call of updateCalls) {
      expect(call.args[0]?.processed_status).not.toBe('rejected');
    }
  });

  // ---------------------------------------------------------------------------
  // Case 8: Undo from unrelated calendar → NOT filtered (exempt type)
  // ---------------------------------------------------------------------------
  it('should NOT reject Undo from an unrelated calendar (Undo is exempt)', async () => {
    const remoteCalendarService = (inboxService as any).remoteCalendarService as RemoteCalendarService;
    sandbox.stub(remoteCalendarService, 'getByActorUri').resolves(null);

    sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(null);
    sandbox.stub(FollowerCalendarEntity, 'findOne').resolves(null);

    const message = buildMessage('Undo', remoteActorUri);
    await inboxService.processInboxMessage(message);

    const updateCalls = (message.update as sinon.SinonStub).getCalls();
    for (const call of updateCalls) {
      expect(call.args[0]?.processed_status).not.toBe('rejected');
    }
  });

  // ---------------------------------------------------------------------------
  // Case 9: Flag from unrelated calendar → NOT filtered (exempt type)
  // ---------------------------------------------------------------------------
  it('should NOT reject Flag from an unrelated calendar (Flag is exempt)', async () => {
    const remoteCalendarService = (inboxService as any).remoteCalendarService as RemoteCalendarService;
    sandbox.stub(remoteCalendarService, 'getByActorUri').resolves(null);

    sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(null);
    sandbox.stub(FollowerCalendarEntity, 'findOne').resolves(null);

    const message = buildMessage('Flag', remoteActorUri);
    await inboxService.processInboxMessage(message);

    const updateCalls = (message.update as sinon.SinonStub).getCalls();
    for (const call of updateCalls) {
      expect(call.args[0]?.processed_status).not.toBe('rejected');
    }
  });

  // ---------------------------------------------------------------------------
  // Case 10: Create from Person actor (URI contains /users/) → NOT filtered
  // ---------------------------------------------------------------------------
  it('should NOT reject Create from a Person actor even without a follow relationship', async () => {
    const personActorUri = 'https://remote.example.com/users/alice';

    const remoteCalendarService = (inboxService as any).remoteCalendarService as RemoteCalendarService;
    sandbox.stub(remoteCalendarService, 'getByActorUri').resolves(null);

    sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(null);
    sandbox.stub(FollowerCalendarEntity, 'findOne').resolves(null);

    const message = buildCreateMessage(personActorUri);
    await inboxService.processInboxMessage(message);

    // Relationship filter should NOT have rejected this message (Person actors are exempt)
    const updateCalls = (message.update as sinon.SinonStub).getCalls();
    for (const call of updateCalls) {
      expect(call.args[0]?.processed_status).not.toBe('rejected');
    }
  });
});
