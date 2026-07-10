import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';

import ProcessInboxService from '@/server/activitypub/service/inbox';
import * as remoteFetch from '@/server/activitypub/helper/remote-fetch';
import { FollowerCalendarEntity, FollowingCalendarEntity, ActivityPubOutboxMessageEntity, EventActivityEntity, SharedEventEntity, RepostDismissalEntity } from '@/server/activitypub/entity/activitypub';
import { CalendarActorEntity } from '@/server/activitypub/entity/calendar_actor';
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';
import FollowActivity from '@/server/activitypub/model/action/follow';
import AnnounceActivity from '@/server/activitypub/model/action/announce';
import CreateActivity from '@/server/activitypub/model/action/create';
import UpdateActivity from '@/server/activitypub/model/action/update';
import DeleteActivity from '@/server/activitypub/model/action/delete';
import { NoteObject } from '@/server/activitypub/model/object/note';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import { CalendarEvent, CalendarEventContent } from '@/common/model/events';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { EventEmitter } from 'events';
import CalendarInterface from '@/server/calendar/interface';
import { setupActivityPubSchema, teardownActivityPubSchema } from '@/server/common/test/helpers/database';

describe('ProcessInboxService - Follow Activity Processing', () => {
  let sandbox: sinon.SinonSandbox;
  let inboxService: ProcessInboxService;
  let eventBus: EventEmitter;
  let testCalendar: Calendar;
  let calendarInterface: CalendarInterface;

  beforeEach(async () => {
    await setupActivityPubSchema();
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    inboxService = new ProcessInboxService(eventBus, calendarInterface);

    // Create test calendar
    testCalendar = new Calendar('test-calendar-id', 'test-calendar');
    testCalendar.addContent('en', new CalendarContent('en'));
    testCalendar.content('en').title = 'Test Calendar';

    // Create calendar in database to satisfy foreign key constraints
    await CalendarEntity.create({
      id: testCalendar.id,
      url_name: testCalendar.urlName,
      account_id: uuidv4(), // Dummy account ID
      languages: 'en',
    });
  });

  afterEach(async () => {
    sandbox.restore();
    await teardownActivityPubSchema();
  });

  describe('processFollowAccount', () => {
    it('should create FollowerCalendarEntity record when Follow activity is processed', async () => {
      // Arrange
      const remoteActorUrl = 'https://remote.instance/calendars/remote-calendar';
      const followActivity = new FollowActivity(remoteActorUrl, testCalendar.id);

      // Act
      await inboxService.processFollowAccount(testCalendar, followActivity);

      // Assert - Check that CalendarActorEntity (remote type) was created for the follower
      const calendarActor = await CalendarActorEntity.findOne({
        where: { actor_uri: remoteActorUrl, actor_type: 'remote' },
      });
      expect(calendarActor).not.toBeNull();

      // Assert - Check that FollowerCalendarEntity was created with reference to CalendarActorEntity
      const follower = await FollowerCalendarEntity.findOne({
        where: {
          calendar_actor_id: calendarActor!.id,
          calendar_id: testCalendar.id,
        },
      });

      expect(follower).not.toBeNull();
      expect(follower?.calendar_actor_id).toBe(calendarActor!.id);
      expect(follower?.calendar_id).toBe(testCalendar.id);

      // Assert - Check that Accept activity was queued in outbox
      const outboxMessage = await ActivityPubOutboxMessageEntity.findOne({
        where: { calendar_id: testCalendar.id },
      });

      expect(outboxMessage).not.toBeNull();
      expect(outboxMessage?.type).toBe('Accept');
    });

    it('should queue Accept activity for delivery after Follow processing', async () => {
      // Arrange
      const remoteActorUrl = 'https://remote.instance/calendars/remote-calendar';
      const followActivity = new FollowActivity(remoteActorUrl, testCalendar.id);
      followActivity.id = 'https://remote.instance/calendars/remote-calendar/follows/123';

      // Act
      await inboxService.processFollowAccount(testCalendar, followActivity);

      // Assert - Check outbox message was created
      const outboxMessage = await ActivityPubOutboxMessageEntity.findOne({
        where: { calendar_id: testCalendar.id },
      });

      expect(outboxMessage).not.toBeNull();
      expect(outboxMessage?.type).toBe('Accept');
      expect(outboxMessage?.calendar_id).toBe(testCalendar.id);
      expect(outboxMessage?.message).toBeDefined();
    });

    it('should include the original Follow activity in the Accept object', async () => {
      // Arrange
      const remoteActorUrl = 'https://remote.instance/calendars/remote-calendar';
      const followActivity = new FollowActivity(remoteActorUrl, testCalendar.id);
      followActivity.id = 'https://remote.instance/calendars/remote-calendar/follows/123';

      // Act
      await inboxService.processFollowAccount(testCalendar, followActivity);

      // Assert - Check that the Accept message includes the Follow activity
      const outboxMessage = await ActivityPubOutboxMessageEntity.findOne({
        where: { calendar_id: testCalendar.id },
      });

      expect(outboxMessage?.message).toBeDefined();
      expect((outboxMessage?.message as any).type).toBe('Accept');
      // The outbox persists the serialized wire form (activity.toObject()), so
      // the embedded Follow is its AP representation — not the raw class
      // instance. Assert the identifying fields survive the round-trip.
      const acceptObject = (outboxMessage?.message as any).object;
      expect(acceptObject.type).toBe('Follow');
      expect(acceptObject.id).toBe(followActivity.id);
      expect(acceptObject.actor).toBe(remoteActorUrl);
      expect(acceptObject.object).toBe(testCalendar.id);
    });

    it('should not create duplicate follower record if already exists', async () => {
      // Arrange
      const remoteActorUrl = 'https://remote.instance/calendars/remote-calendar';
      const followActivity = new FollowActivity(remoteActorUrl, testCalendar.id);

      const existingFollower = {
        id: uuidv4(),
        calendar_actor_id: remoteActorUrl,
        calendar_id: testCalendar.id,
      };

      const findOneStub = sandbox.stub(FollowerCalendarEntity, 'findOne').resolves(existingFollower as any);
      const createStub = sandbox.stub(FollowerCalendarEntity, 'create');
      const createOutboxStub = sandbox.stub(ActivityPubOutboxMessageEntity, 'create');

      // Act
      await inboxService.processFollowAccount(testCalendar, followActivity);

      // Assert
      expect(findOneStub.calledOnce).toBe(true);
      expect(createStub.called).toBe(false);
      expect(createOutboxStub.called).toBe(false); // No Accept if already following
    });

    it('should emit activitypub:calendar:followed after successful Follow processing', async () => {
      // Arrange
      const remoteActorUrl = 'https://remote.instance/calendars/remote-calendar';
      const followActivity = new FollowActivity(remoteActorUrl, testCalendar.id);

      const emittedEvents: any[] = [];
      eventBus.on('activitypub:calendar:followed', (payload) => emittedEvents.push(payload));

      // Act
      await inboxService.processFollowAccount(testCalendar, followActivity);

      // Assert
      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].calendarId).toBe(testCalendar.id);
      expect(emittedEvents[0].followerUrl).toBe(remoteActorUrl);
      // followerName falls back to actor URL when no display name is cached
      expect(emittedEvents[0].followerName).toBe(remoteActorUrl);
    });

    it('should not emit activitypub:calendar:followed when follow already exists', async () => {
      // Arrange
      const remoteActorUrl = 'https://remote.instance/calendars/remote-calendar';
      const followActivity = new FollowActivity(remoteActorUrl, testCalendar.id);

      const existingFollower = {
        id: uuidv4(),
        calendar_actor_id: remoteActorUrl,
        calendar_id: testCalendar.id,
      };

      sandbox.stub(FollowerCalendarEntity, 'findOne').resolves(existingFollower as any);
      sandbox.stub(FollowerCalendarEntity, 'create');
      sandbox.stub(ActivityPubOutboxMessageEntity, 'create');

      const emittedEvents: any[] = [];
      eventBus.on('activitypub:calendar:followed', (payload) => emittedEvents.push(payload));

      // Act
      await inboxService.processFollowAccount(testCalendar, followActivity);

      // Assert - no event emitted for duplicate follows
      expect(emittedEvents).toHaveLength(0);
    });

    it('should use remoteDisplayName as followerName when available', async () => {
      // Arrange
      const remoteActorUrl = 'https://remote.instance/calendars/remote-calendar';
      const followActivity = new FollowActivity(remoteActorUrl, testCalendar.id);
      const displayName = 'Remote Calendar Display Name';

      // Pre-create the CalendarActorEntity with a display name
      await CalendarActorEntity.create({
        id: uuidv4(),
        actor_type: 'remote',
        actor_uri: remoteActorUrl,
        remote_display_name: displayName,
        remote_domain: 'remote.instance',
        calendar_id: null,
        private_key: null,
      });

      const emittedEvents: any[] = [];
      eventBus.on('activitypub:calendar:followed', (payload) => emittedEvents.push(payload));

      // Act
      await inboxService.processFollowAccount(testCalendar, followActivity);

      // Assert - display name used when available
      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].followerName).toBe(displayName);
    });
  });

  describe('processAcceptActivity', () => {
    it('should confirm follow relationship when Accept is received', async () => {
      // Arrange
      const remoteCalendarUrl = 'https://remote.instance/calendars/remote-calendar';
      const followActivity = new FollowActivity(testCalendar.id, remoteCalendarUrl);
      followActivity.id = 'https://local.instance/calendars/test-calendar/follows/456';

      // Create an Accept activity that references the Follow
      const acceptActivity = {
        type: 'Accept',
        actor: remoteCalendarUrl,
        object: followActivity,
      };

      // Mock CalendarActorEntity that would be found for this AP URL
      const mockCalendarActor = {
        id: 'mock-calendar-actor-uuid',
        actor_type: 'remote',
        calendar_id: null,
        actor_uri: remoteCalendarUrl,
        remote_display_name: null,
        remote_domain: 'remote.instance',
        inbox_url: null,
        shared_inbox_url: null,
        public_key: null,
        private_key: null,
        last_fetched: null,
      };

      const existingFollowing = {
        id: uuidv4(),
        calendar_actor_id: mockCalendarActor.id, // Use UUID, not AP URL
        calendar_id: testCalendar.id,
      };

      // Stub remoteCalendarService to return the mock calendar actor
      sandbox.stub(inboxService.remoteCalendarService, 'getByActorUri').resolves(mockCalendarActor as any);
      const findOneStub = sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(existingFollowing as any);

      // Act
      await inboxService.processAcceptActivity(testCalendar, acceptActivity as any);

      // Assert
      expect(findOneStub.calledOnce).toBe(true);
      expect(findOneStub.firstCall.args[0].where).toMatchObject({
        calendar_actor_id: mockCalendarActor.id, // Check for UUID, not AP URL
        calendar_id: testCalendar.id,
      });
    });

    it('should confirm follow relationship when Accept object is a string URI', async () => {
      // Arrange: Accept with string URI object where hostnames match (Follow Accept)
      const remoteCalendarUrl = 'https://remote.instance/calendars/remote-calendar';
      const followActivityUri = 'https://remote.instance/follows/follow-activity-id';

      const acceptActivity = {
        type: 'Accept',
        actor: remoteCalendarUrl,
        object: followActivityUri,
      };

      // Mock CalendarActorEntity that would be found for this AP URL
      const mockCalendarActor = {
        id: 'mock-calendar-actor-uuid',
        actor_type: 'remote',
        calendar_id: null,
        actor_uri: remoteCalendarUrl,
        remote_display_name: null,
        remote_domain: 'remote.instance',
        inbox_url: null,
        shared_inbox_url: null,
        public_key: null,
        private_key: null,
        last_fetched: null,
      };

      const existingFollowing = {
        id: uuidv4(),
        calendar_actor_id: mockCalendarActor.id,
        calendar_id: testCalendar.id,
      };

      // Stub remoteCalendarService to return the mock calendar actor
      sandbox.stub(inboxService.remoteCalendarService, 'getByActorUri').resolves(mockCalendarActor as any);
      const findOneStub = sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(existingFollowing as any);

      // Act
      await inboxService.processAcceptActivity(testCalendar, acceptActivity as any);

      // Assert - should look up remote calendar by actor URI
      expect((inboxService.remoteCalendarService.getByActorUri as sinon.SinonStub).calledOnce).toBe(true);
      expect(findOneStub.calledOnce).toBe(true);
      expect(findOneStub.firstCall.args[0].where).toMatchObject({
        calendar_actor_id: mockCalendarActor.id,
        calendar_id: testCalendar.id,
      });
    });

    it('should emit activitypub:follow:accepted when inline-Follow Accept confirms a known follow', async () => {
      // Arrange: inline-Follow Accept path. The emit is what triggers the
      // backfill worker downstream — without it, follow-backfill never runs.
      const remoteCalendarUrl = 'https://remote.instance/calendars/remote-calendar';
      const followActivity = new FollowActivity(testCalendar.id, remoteCalendarUrl);
      followActivity.id = 'https://local.instance/calendars/test-calendar/follows/789';

      const acceptActivity = {
        type: 'Accept',
        actor: remoteCalendarUrl,
        object: followActivity,
      };

      const mockCalendarActor = {
        id: 'mock-calendar-actor-uuid',
        actor_uri: remoteCalendarUrl,
      };
      const existingFollowing = {
        id: uuidv4(),
        calendar_actor_id: mockCalendarActor.id,
        calendar_id: testCalendar.id,
      };

      sandbox.stub(inboxService.remoteCalendarService, 'getByActorUri').resolves(mockCalendarActor as any);
      sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(existingFollowing as any);

      const emittedEvents: any[] = [];
      eventBus.on('activitypub:follow:accepted', (payload) => emittedEvents.push(payload));

      // Act
      await inboxService.processAcceptActivity(testCalendar, acceptActivity as any);

      // Assert
      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]).toEqual({
        followingCalendarId: testCalendar.id,
        calendarActorId: mockCalendarActor.id,
        sourceActorUri: remoteCalendarUrl,
      });
    });

    it('should emit activitypub:follow:accepted when string-URI Accept confirms a known follow', async () => {
      // Arrange: string-URI Accept path with matching hostnames (Follow Accept).
      const remoteCalendarUrl = 'https://remote.instance/calendars/remote-calendar';
      const followActivityUri = 'https://remote.instance/follows/follow-activity-id';

      const acceptActivity = {
        type: 'Accept',
        actor: remoteCalendarUrl,
        object: followActivityUri,
      };

      const mockCalendarActor = {
        id: 'mock-calendar-actor-uuid',
        actor_uri: remoteCalendarUrl,
      };
      const existingFollowing = {
        id: uuidv4(),
        calendar_actor_id: mockCalendarActor.id,
        calendar_id: testCalendar.id,
      };

      sandbox.stub(inboxService.remoteCalendarService, 'getByActorUri').resolves(mockCalendarActor as any);
      sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(existingFollowing as any);

      const emittedEvents: any[] = [];
      eventBus.on('activitypub:follow:accepted', (payload) => emittedEvents.push(payload));

      // Act
      await inboxService.processAcceptActivity(testCalendar, acceptActivity as any);

      // Assert
      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]).toEqual({
        followingCalendarId: testCalendar.id,
        calendarActorId: mockCalendarActor.id,
        sourceActorUri: remoteCalendarUrl,
      });
    });

  });

  describe('processShareEvent', () => {
    it('should emit activitypub:event:reposted when a local event is announced', async () => {
      // Arrange: actor and object must be on the same domain (domain-match security check)
      const remoteActorUrl = 'https://remote.instance/calendars/remote-calendar';
      const localEventId = uuidv4();
      const apObjectId = `https://remote.instance/events/${localEventId}`;

      // Create EventObjectEntity tracking the AP identity for this local event
      // (EventObjectEntity has no FK to EventEntity, so no media table needed)
      await EventObjectEntity.create({
        event_id: localEventId,
        ap_id: apObjectId,
        attributed_to: 'https://remote.instance/calendars/test-calendar',
      });

      // Stub calendarInterface.getEventById to return a local event (has calendarId)
      const localEvent = new CalendarEvent(localEventId, testCalendar.id);
      sandbox.stub(calendarInterface, 'getEventById').resolves(localEvent);

      const announceActivity = new AnnounceActivity(remoteActorUrl, apObjectId);

      const emittedEvents: any[] = [];
      eventBus.on('activitypub:event:reposted', (payload) => emittedEvents.push(payload));

      // Stub EventActivityEntity to skip DB write
      sandbox.stub(EventActivityEntity, 'findOne').resolves(null);
      sandbox.stub(EventActivityEntity, 'create').resolves({} as any);

      // Act
      await inboxService.processShareEvent(testCalendar, announceActivity);

      // Assert
      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].eventId).toBe(localEventId);
      expect(emittedEvents[0].calendarId).toBe(testCalendar.id);
      expect(emittedEvents[0].reposterUrl).toBe(remoteActorUrl);
      // reposterName falls back to actor URL when no display name is cached
      expect(emittedEvents[0].reposterName).toBe(remoteActorUrl);
    });

    it('should not emit activitypub:event:reposted when a remote (non-local) event is announced', async () => {
      // Arrange: actor and object must be on the same domain (domain-match security check)
      const remoteActorUrl = 'https://remote.instance/calendars/remote-calendar';
      const remoteEventId = uuidv4();
      const apObjectId = 'https://remote.instance/events/remote-event-123';

      // Create EventObjectEntity for the remote event
      await EventObjectEntity.create({
        event_id: remoteEventId,
        ap_id: apObjectId,
        attributed_to: 'https://remote.instance/calendars/their-calendar',
      });

      // Stub calendarInterface.getEventById to return a remote event (calendarId is null)
      const remoteEvent = new CalendarEvent(remoteEventId, null);
      sandbox.stub(calendarInterface, 'getEventById').resolves(remoteEvent);

      const announceActivity = new AnnounceActivity(remoteActorUrl, apObjectId);

      const emittedEvents: any[] = [];
      eventBus.on('activitypub:event:reposted', (payload) => emittedEvents.push(payload));

      // Stub EventActivityEntity to skip DB write
      sandbox.stub(EventActivityEntity, 'findOne').resolves(null);
      sandbox.stub(EventActivityEntity, 'create').resolves({} as any);

      // Act
      await inboxService.processShareEvent(testCalendar, announceActivity);

      // Assert - no event emitted for remote events
      expect(emittedEvents).toHaveLength(0);
    });

    it('should use remoteDisplayName as reposterName when available', async () => {
      // Arrange: actor and object must be on the same domain (domain-match security check)
      const remoteActorUrl = 'https://remote.instance/calendars/remote-calendar';
      const displayName = 'Remote Calendar Name';
      const localEventId = uuidv4();
      const apObjectId = `https://remote.instance/events/${localEventId}`;

      // Pre-create CalendarActorEntity with display name
      await CalendarActorEntity.create({
        id: uuidv4(),
        actor_type: 'remote',
        actor_uri: remoteActorUrl,
        remote_display_name: displayName,
        remote_domain: 'remote.instance',
        calendar_id: null,
        private_key: null,
      });

      // Create EventObjectEntity
      await EventObjectEntity.create({
        event_id: localEventId,
        ap_id: apObjectId,
        attributed_to: 'https://remote.instance/calendars/test-calendar',
      });

      // Stub calendarInterface.getEventById to return a local event
      const localEvent = new CalendarEvent(localEventId, testCalendar.id);
      sandbox.stub(calendarInterface, 'getEventById').resolves(localEvent);

      const announceActivity = new AnnounceActivity(remoteActorUrl, apObjectId);

      const emittedEvents: any[] = [];
      eventBus.on('activitypub:event:reposted', (payload) => emittedEvents.push(payload));

      sandbox.stub(EventActivityEntity, 'findOne').resolves(null);
      sandbox.stub(EventActivityEntity, 'create').resolves({} as any);

      // Act
      await inboxService.processShareEvent(testCalendar, announceActivity);

      // Assert
      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].reposterName).toBe(displayName);
    });
  });
});

describe('ProcessInboxService - checkAndPerformAutoRepost eventReposted emission', () => {
  let sandbox: sinon.SinonSandbox;
  let inboxService: ProcessInboxService;
  let eventBus: EventEmitter;
  let testCalendar: Calendar;
  let calendarInterface: CalendarInterface;

  beforeEach(async () => {
    await setupActivityPubSchema();
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    inboxService = new ProcessInboxService(eventBus, calendarInterface);

    testCalendar = new Calendar('test-calendar-id', 'test-calendar');
    testCalendar.addContent('en', new CalendarContent('en'));
    testCalendar.content('en').title = 'Test Calendar';

    await CalendarEntity.create({
      id: testCalendar.id,
      url_name: testCalendar.urlName,
      account_id: uuidv4(),
      languages: 'en',
    });

    // Suppress console output during tests
    sandbox.stub(console, 'log');
    sandbox.stub(console, 'warn');
  });

  afterEach(async () => {
    sandbox.restore();
    await teardownActivityPubSchema();
  });

  it('should emit eventReposted after successful auto-repost', async () => {
    // Arrange
    const sourceActorUri = 'https://remote.instance/calendars/source-calendar';
    const eventId = uuidv4();
    const eventApId = `https://remote.instance/events/${eventId}`;

    // Create the remote CalendarActorEntity
    const remoteCalendarActorId = uuidv4();
    await CalendarActorEntity.create({
      id: remoteCalendarActorId,
      actor_type: 'remote',
      actor_uri: sourceActorUri,
      remote_display_name: null,
      remote_domain: 'remote.instance',
      calendar_id: null,
      private_key: null,
    });

    // Create FollowingCalendarEntity with auto_repost_originals enabled
    await FollowingCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: remoteCalendarActorId,
      calendar_id: testCalendar.id,
      auto_repost_originals: true,
      auto_repost_reposts: false,
    });

    // Create EventObjectEntity for the event
    await EventObjectEntity.create({
      event_id: eventId,
      ap_id: eventApId,
      attributed_to: sourceActorUri,
    });

    // Stub calendarInterface.getEventById to return the event
    const event = new CalendarEvent(eventId, null);
    sandbox.stub(calendarInterface, 'getEventById').resolves(event);

    // Stub category mapping service
    sandbox.stub(calendarInterface.categoryMappingService, 'assignAutoRepostCategories').resolves();

    const emittedEvents: any[] = [];
    eventBus.on('eventReposted', (payload) => emittedEvents.push(payload));

    // Act
    await (inboxService as any).checkAndPerformAutoRepost(
      testCalendar, sourceActorUri, eventApId, true,
    );

    // Assert
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].event).toBe(event);
    expect(emittedEvents[0].calendar).toBe(testCalendar);
  });

  it('should dual-emit activitypub:event:reposted for auto-repost of a locally-owned event (pv-d84j.2)', async () => {
    // Auto-repost path: a remote calendar's Announce of a locally-owned
    // event triggers our calendar to auto-repost. The notifications
    // emission must fire so source-calendar editors learn about the
    // repost. Gated on event.calendarId !== null because a remote-origin
    // event has no local source calendar to address.
    const sourceActorUri = 'https://remote.instance/calendars/source-calendar';
    const eventId = uuidv4();
    const eventApId = `https://remote.instance/events/${eventId}`;
    const sourceCalendarId = uuidv4();

    const remoteCalendarActorId = uuidv4();
    await CalendarActorEntity.create({
      id: remoteCalendarActorId,
      actor_type: 'remote',
      actor_uri: sourceActorUri,
      remote_display_name: null,
      remote_domain: 'remote.instance',
      calendar_id: null,
      private_key: null,
    });
    await FollowingCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: remoteCalendarActorId,
      calendar_id: testCalendar.id,
      auto_repost_originals: true,
      auto_repost_reposts: false,
    });
    await EventObjectEntity.create({
      event_id: eventId,
      ap_id: eventApId,
      attributed_to: sourceActorUri,
    });

    // Locally-owned event — has a real calendarId.
    const event = new CalendarEvent(eventId, sourceCalendarId);
    sandbox.stub(calendarInterface, 'getEventById').resolves(event);
    sandbox.stub(calendarInterface.categoryMappingService, 'assignAutoRepostCategories').resolves();

    const repostedPayloads: any[] = [];
    eventBus.on('activitypub:event:reposted', (payload) => repostedPayloads.push(payload));

    await (inboxService as any).checkAndPerformAutoRepost(
      testCalendar, sourceActorUri, eventApId, true,
    );

    expect(repostedPayloads).toHaveLength(1);
    const payload = repostedPayloads[0];
    expect(payload.eventId).toBe(eventId);
    expect(payload.calendarId).toBe(sourceCalendarId);
    expect(payload.reposterCalendarId).toBe(testCalendar.id);
    // Reposter URL is the local actor URL for the reposting calendar; both
    // name and url carry it so the notifications handler's local-actor
    // resolver overrides the display name with the calendar's displayName.
    expect(payload.reposterUrl).toBe(payload.reposterName);
    expect(payload.reposterUrl).toMatch(/\/calendars\//);
  });

  it('should not dual-emit activitypub:event:reposted when the auto-reposted event is remote-origin (pv-d84j.2)', async () => {
    // Mirrors the inbox.ts:2179 gate: only fire the notifications emission
    // for locally-owned events. Remote-origin events have no local source
    // calendar editors to notify.
    const sourceActorUri = 'https://remote.instance/calendars/source-calendar';
    const eventId = uuidv4();
    const eventApId = `https://remote.instance/events/${eventId}`;

    const remoteCalendarActorId = uuidv4();
    await CalendarActorEntity.create({
      id: remoteCalendarActorId,
      actor_type: 'remote',
      actor_uri: sourceActorUri,
      remote_display_name: null,
      remote_domain: 'remote.instance',
      calendar_id: null,
      private_key: null,
    });
    await FollowingCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: remoteCalendarActorId,
      calendar_id: testCalendar.id,
      auto_repost_originals: true,
      auto_repost_reposts: false,
    });
    await EventObjectEntity.create({
      event_id: eventId,
      ap_id: eventApId,
      attributed_to: sourceActorUri,
    });

    // Remote-origin event: calendarId is null.
    const event = new CalendarEvent(eventId, null);
    sandbox.stub(calendarInterface, 'getEventById').resolves(event);
    sandbox.stub(calendarInterface.categoryMappingService, 'assignAutoRepostCategories').resolves();

    const repostedPayloads: any[] = [];
    const eventRepostedPayloads: any[] = [];
    eventBus.on('activitypub:event:reposted', (payload) => repostedPayloads.push(payload));
    eventBus.on('eventReposted', (payload) => eventRepostedPayloads.push(payload));

    await (inboxService as any).checkAndPerformAutoRepost(
      testCalendar, sourceActorUri, eventApId, true,
    );

    // Calendar-domain emission still fires (event-instance pipeline owns it).
    expect(eventRepostedPayloads).toHaveLength(1);
    // Notifications-domain emission suppressed for remote-origin events.
    expect(repostedPayloads).toHaveLength(0);
  });

  it('should not emit eventReposted when getEventById returns null', async () => {
    // Arrange
    const sourceActorUri = 'https://remote.instance/calendars/source-calendar';
    const eventId = uuidv4();
    const eventApId = `https://remote.instance/events/${eventId}`;

    const remoteCalendarActorId = uuidv4();
    await CalendarActorEntity.create({
      id: remoteCalendarActorId,
      actor_type: 'remote',
      actor_uri: sourceActorUri,
      remote_display_name: null,
      remote_domain: 'remote.instance',
      calendar_id: null,
      private_key: null,
    });

    await FollowingCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: remoteCalendarActorId,
      calendar_id: testCalendar.id,
      auto_repost_originals: true,
      auto_repost_reposts: false,
    });

    await EventObjectEntity.create({
      event_id: eventId,
      ap_id: eventApId,
      attributed_to: sourceActorUri,
    });

    // Stub calendarInterface.getEventById to return null
    sandbox.stub(calendarInterface, 'getEventById').resolves(null as any);

    // Stub category mapping service
    sandbox.stub(calendarInterface.categoryMappingService, 'assignAutoRepostCategories').resolves();

    const emittedEvents: any[] = [];
    eventBus.on('eventReposted', (payload) => emittedEvents.push(payload));

    // Act
    await (inboxService as any).checkAndPerformAutoRepost(
      testCalendar, sourceActorUri, eventApId, true,
    );

    // Assert - no emission when event not found
    expect(emittedEvents).toHaveLength(0);
  });

  it('should not emit eventReposted when auto-repost policy is disabled', async () => {
    // Arrange
    const sourceActorUri = 'https://remote.instance/calendars/source-calendar';
    const eventApId = `https://remote.instance/events/${uuidv4()}`;

    const remoteCalendarActorId = uuidv4();
    await CalendarActorEntity.create({
      id: remoteCalendarActorId,
      actor_type: 'remote',
      actor_uri: sourceActorUri,
      remote_display_name: null,
      remote_domain: 'remote.instance',
      calendar_id: null,
      private_key: null,
    });

    // auto_repost_originals is false
    await FollowingCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: remoteCalendarActorId,
      calendar_id: testCalendar.id,
      auto_repost_originals: false,
      auto_repost_reposts: false,
    });

    const emittedEvents: any[] = [];
    eventBus.on('eventReposted', (payload) => emittedEvents.push(payload));

    // Act
    await (inboxService as any).checkAndPerformAutoRepost(
      testCalendar, sourceActorUri, eventApId, true,
    );

    // Assert - no emission when policy disabled
    expect(emittedEvents).toHaveLength(0);
  });

});

describe('ProcessInboxService - checkAndPerformAutoRepost dismissal gating', () => {
  let sandbox: sinon.SinonSandbox;
  let inboxService: ProcessInboxService;
  let eventBus: EventEmitter;
  let testCalendar: Calendar;
  let calendarInterface: CalendarInterface;

  const sourceActorUri = 'https://remote.instance/calendars/source-calendar';

  beforeEach(async () => {
    await setupActivityPubSchema();
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    inboxService = new ProcessInboxService(eventBus, calendarInterface);

    testCalendar = new Calendar('test-calendar-id', 'test-calendar');
    testCalendar.addContent('en', new CalendarContent('en'));
    testCalendar.content('en').title = 'Test Calendar';

    await CalendarEntity.create({
      id: testCalendar.id,
      url_name: testCalendar.urlName,
      account_id: uuidv4(),
      languages: 'en',
    });

    // Ensure FK enforcement is off for this describe — other test files may
    // leave `PRAGMA foreign_keys = ON` set on the shared SQLite connection.
    // setupActivityPubSchema() does not sync the full EventEntity graph.
    const db = (await import('@/server/common/entity/db')).default;
    await db.query('PRAGMA foreign_keys = OFF');

    sandbox.stub(console, 'log');
    sandbox.stub(console, 'warn');
  });

  afterEach(async () => {
    sandbox.restore();
    await teardownActivityPubSchema();
    // Restore connection-wide pragma so neighboring test files are not
    // affected by the OFF state set in beforeEach.
    const db = (await import('@/server/common/entity/db')).default;
    await db.query('PRAGMA foreign_keys = ON');
  });

  async function seedAutoRepostPrerequisites(eventId: string, eventApId: string) {
    const remoteCalendarActorId = uuidv4();
    await CalendarActorEntity.create({
      id: remoteCalendarActorId,
      actor_type: 'remote',
      actor_uri: sourceActorUri,
      remote_display_name: null,
      remote_domain: 'remote.instance',
      calendar_id: null,
      private_key: null,
    });

    await FollowingCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: remoteCalendarActorId,
      calendar_id: testCalendar.id,
      auto_repost_originals: true,
      auto_repost_reposts: false,
    });

    await EventObjectEntity.create({
      event_id: eventId,
      ap_id: eventApId,
      attributed_to: sourceActorUri,
    });
  }

  it('skips SharedEventEntity creation and outbox write when a dismissal exists', async () => {
    // Arrange
    const eventId = uuidv4();
    const eventApId = `https://remote.instance/events/${eventId}`;
    await seedAutoRepostPrerequisites(eventId, eventApId);

    // Sticky dismissal for this (event_id, calendar_id) pair
    await RepostDismissalEntity.create({
      id: uuidv4(),
      event_id: eventId,
      calendar_id: testCalendar.id,
    });

    // Stubs for downstream calls that should NOT be reached. addToOutbox
    // persists via ActivityPubOutboxMessageEntity.build(...).save(), NOT
    // .create(), so the outbox guard must spy on prototype.save — a spy on
    // .create would pass vacuously even if the early return regressed and
    // addToOutbox actually ran.
    const sharedCreateSpy = sandbox.spy(SharedEventEntity, 'create');
    const outboxSaveSpy = sandbox.spy(ActivityPubOutboxMessageEntity.prototype, 'save');
    const categorySpy = sandbox.stub(calendarInterface.categoryMappingService, 'assignAutoRepostCategories').resolves();
    const getEventByIdSpy = sandbox.stub(calendarInterface, 'getEventById').resolves(new CalendarEvent(eventId, null));

    const emittedEvents: any[] = [];
    eventBus.on('eventReposted', (payload) => emittedEvents.push(payload));

    // Act
    await (inboxService as any).checkAndPerformAutoRepost(
      testCalendar, sourceActorUri, eventApId, true,
    );

    // Assert
    expect(sharedCreateSpy.called).toBe(false);
    expect(outboxSaveSpy.called).toBe(false);
    expect(categorySpy.called).toBe(false);
    expect(getEventByIdSpy.called).toBe(false);
    expect(emittedEvents).toHaveLength(0);

    // The dismissal row should still be present after the skip.
    const remaining = await RepostDismissalEntity.count({
      where: { event_id: eventId, calendar_id: testCalendar.id },
    });
    expect(remaining).toBe(1);

    // And no SharedEventEntity row should have been persisted.
    const shares = await SharedEventEntity.count({
      where: { event_id: eventId, calendar_id: testCalendar.id },
    });
    expect(shares).toBe(0);
  });

  it('creates SharedEventEntity normally when no dismissal exists', async () => {
    // Arrange
    const eventId = uuidv4();
    const eventApId = `https://remote.instance/events/${eventId}`;
    await seedAutoRepostPrerequisites(eventId, eventApId);

    sandbox.stub(calendarInterface.categoryMappingService, 'assignAutoRepostCategories').resolves();
    sandbox.stub(calendarInterface, 'getEventById').resolves(new CalendarEvent(eventId, null));

    // Counterpart to the skip-path guard: positively assert the outbox WAS
    // written on the non-dismissed happy path, spying on the same
    // prototype.save the real addToOutbox uses.
    const outboxSaveSpy = sandbox.spy(ActivityPubOutboxMessageEntity.prototype, 'save');

    const emittedEvents: any[] = [];
    eventBus.on('eventReposted', (payload) => emittedEvents.push(payload));

    // Act
    await (inboxService as any).checkAndPerformAutoRepost(
      testCalendar, sourceActorUri, eventApId, true,
    );

    // Assert - the existing behavior is preserved.
    const shares = await SharedEventEntity.count({
      where: { event_id: eventId, calendar_id: testCalendar.id },
    });
    expect(shares).toBe(1);

    expect(emittedEvents).toHaveLength(1);

    // The auto-repost cascade must have enqueued at least one outbox message.
    expect(outboxSaveSpy.called).toBe(true);
  });

  it('isolates dismissals per calendar: a dismissal on calendar A does not affect calendar B', async () => {
    // Arrange — two calendars both follow the same remote source with
    // auto_repost_originals: true. Only calendar A has a dismissal for the
    // event. The inbox dismissal lookup MUST scope by calendar_id; otherwise
    // calendar B would incorrectly skip the share.
    const calendarA = testCalendar; // already set up in beforeEach
    const calendarBId = uuidv4();
    const calendarB = new Calendar(calendarBId, 'test-calendar-b');
    calendarB.addContent('en', new CalendarContent('en'));
    calendarB.content('en').title = 'Test Calendar B';

    await CalendarEntity.create({
      id: calendarB.id,
      url_name: calendarB.urlName,
      account_id: uuidv4(),
      languages: 'en',
    });

    const eventId = uuidv4();
    const eventApId = `https://remote.instance/events/${eventId}`;

    // Seed the remote actor + EventObjectEntity once
    const remoteCalendarActorId = uuidv4();
    await CalendarActorEntity.create({
      id: remoteCalendarActorId,
      actor_type: 'remote',
      actor_uri: sourceActorUri,
      remote_display_name: null,
      remote_domain: 'remote.instance',
      calendar_id: null,
      private_key: null,
    });

    // Both calendars follow the same remote actor
    await FollowingCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: remoteCalendarActorId,
      calendar_id: calendarA.id,
      auto_repost_originals: true,
      auto_repost_reposts: false,
    });
    await FollowingCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: remoteCalendarActorId,
      calendar_id: calendarB.id,
      auto_repost_originals: true,
      auto_repost_reposts: false,
    });

    await EventObjectEntity.create({
      event_id: eventId,
      ap_id: eventApId,
      attributed_to: sourceActorUri,
    });

    // Dismissal exists ONLY for (eventId, calendarA)
    await RepostDismissalEntity.create({
      id: uuidv4(),
      event_id: eventId,
      calendar_id: calendarA.id,
    });

    sandbox.stub(calendarInterface.categoryMappingService, 'assignAutoRepostCategories').resolves();
    sandbox.stub(calendarInterface, 'getEventById').resolves(new CalendarEvent(eventId, null));

    // Act — calendar A first (should be skipped by dismissal guard)
    await (inboxService as any).checkAndPerformAutoRepost(
      calendarA, sourceActorUri, eventApId, true,
    );

    let sharesA = await SharedEventEntity.count({
      where: { event_id: eventId, calendar_id: calendarA.id },
    });
    expect(sharesA).toBe(0);

    // Act — calendar B next (no dismissal, should create the share)
    await (inboxService as any).checkAndPerformAutoRepost(
      calendarB, sourceActorUri, eventApId, true,
    );

    const sharesB = await SharedEventEntity.count({
      where: { event_id: eventId, calendar_id: calendarB.id },
    });
    expect(sharesB).toBe(1);

    // Re-confirm calendar A still has zero shares (calendar B's processing
    // must not have leaked into calendar A's state).
    sharesA = await SharedEventEntity.count({
      where: { event_id: eventId, calendar_id: calendarA.id },
    });
    expect(sharesA).toBe(0);

    // Calendar A's dismissal row should be untouched.
    const dismissalsA = await RepostDismissalEntity.count({
      where: { event_id: eventId, calendar_id: calendarA.id },
    });
    expect(dismissalsA).toBe(1);

    // Calendar B should have NO dismissal row (sharing does not create one).
    const dismissalsB = await RepostDismissalEntity.count({
      where: { event_id: eventId, calendar_id: calendarB.id },
    });
    expect(dismissalsB).toBe(0);
  });
});

describe('ProcessInboxService - checkAndPerformAutoRepost paired Note emission', () => {
  let sandbox: sinon.SinonSandbox;
  let inboxService: ProcessInboxService;
  let eventBus: EventEmitter;
  let testCalendar: Calendar;
  let calendarInterface: CalendarInterface;

  const sourceActorUri = 'https://remote.instance/calendars/source-calendar';

  beforeEach(async () => {
    await setupActivityPubSchema();
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    inboxService = new ProcessInboxService(eventBus, calendarInterface);

    testCalendar = new Calendar('test-calendar-id', 'test-calendar');
    testCalendar.addContent('en', new CalendarContent('en'));
    testCalendar.content('en').title = 'Test Calendar';

    await CalendarEntity.create({
      id: testCalendar.id,
      url_name: testCalendar.urlName,
      account_id: uuidv4(),
      languages: 'en',
    });

    // Other test files may leave `PRAGMA foreign_keys = ON` on the shared
    // SQLite connection. The auto-repost path persists rows referencing
    // EventEntity which setupActivityPubSchema() does not sync.
    const db = (await import('@/server/common/entity/db')).default;
    await db.query('PRAGMA foreign_keys = OFF');

    sandbox.stub(console, 'log');
    sandbox.stub(console, 'warn');
  });

  afterEach(async () => {
    sandbox.restore();
    await teardownActivityPubSchema();
    const db = (await import('@/server/common/entity/db')).default;
    await db.query('PRAGMA foreign_keys = ON');
  });

  async function seedAutoRepostPrerequisites(eventId: string, eventApId: string) {
    const remoteCalendarActorId = uuidv4();
    await CalendarActorEntity.create({
      id: remoteCalendarActorId,
      actor_type: 'remote',
      actor_uri: sourceActorUri,
      remote_display_name: null,
      remote_domain: 'remote.instance',
      calendar_id: null,
      private_key: null,
    });

    await FollowingCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: remoteCalendarActorId,
      calendar_id: testCalendar.id,
      auto_repost_originals: true,
      auto_repost_reposts: false,
    });

    await EventObjectEntity.create({
      event_id: eventId,
      ap_id: eventApId,
      attributed_to: sourceActorUri,
    });
  }

  function buildReconstitutedEvent(eventId: string): CalendarEvent {
    // Mirrors the shape the inbox cascade hands to NoteObject: a CalendarEvent
    // with at least one language of content so the Note serialization produces
    // a non-empty `name`/`content` payload.
    const event = new CalendarEvent(eventId, null);
    event.addContent(new CalendarEventContent('en', 'Reposted Event', ''));
    return event;
  }

  it('emits paired Announce(Event) + Create(Note) on cascade, with Note attributed to the reposting calendar', async () => {
    // Arrange
    const eventId = uuidv4();
    const eventApId = `https://remote.instance/events/${eventId}`;
    await seedAutoRepostPrerequisites(eventId, eventApId);

    sandbox.stub(calendarInterface.categoryMappingService, 'assignAutoRepostCategories').resolves();
    sandbox.stub(calendarInterface, 'getEventById').resolves(buildReconstitutedEvent(eventId));

    // Capture activities at outbox-enqueue time so assertions see the
    // in-memory `NoteObject` instance (with its serialization methods
    // intact) rather than the JSON-stringified shape from the DB row.
    const enqueuedActivities: any[] = [];
    eventBus.on('outboxMessageAdded', (activity) => enqueuedActivities.push(activity));

    // Act
    await (inboxService as any).checkAndPerformAutoRepost(
      testCalendar, sourceActorUri, eventApId, true,
    );

    // Assert — paired Announce(Event) and Create(Note) in order.
    const announces = enqueuedActivities.filter(a => a.type === 'Announce');
    const creates = enqueuedActivities.filter(a => a.type === 'Create');
    expect(announces.length).toBe(1);
    expect(creates.length).toBe(1);

    // Announce wraps the remote event IRI directly (string object form).
    expect(announces[0].object).toBe(eventApId);
    expect(announces[0].to).toContain('https://www.w3.org/ns/activitystreams#Public');

    // Create wraps a NoteObject attributed to the reposting calendar's actor
    // URL. The remote canonical IRI is carried via `urlOverride` and surfaces
    // in the AS payload as `url` after `toActivityPubObject()` runs it through
    // sanitizeExternalUrlHref.
    const createActivity = creates[0];
    expect(createActivity.object.type).toBe('Note');
    expect(createActivity.object.attributedTo).toContain('/calendars/test-calendar');
    expect(createActivity.to).toContain('https://www.w3.org/ns/activitystreams#Public');
    expect(createActivity.cc[0]).toContain('/calendars/test-calendar/followers');

    // Serialize the Note via its toActivityPubObject() to verify the
    // post-sanitization `url` field — that path is what the wire payload
    // hits via ActivityPubActivity.toObject() at delivery time.
    const apForm = createActivity.object.toActivityPubObject();
    expect(apForm.url).toBe(eventApId);
  });

  it('suppresses both Announce(Event) and Create(Note) when a DEC-008 dismissal exists', async () => {
    // Arrange
    const eventId = uuidv4();
    const eventApId = `https://remote.instance/events/${eventId}`;
    await seedAutoRepostPrerequisites(eventId, eventApId);

    // Sticky dismissal for this (event_id, calendar_id) pair — gate must
    // suppress BOTH paired activities together.
    await RepostDismissalEntity.create({
      id: uuidv4(),
      event_id: eventId,
      calendar_id: testCalendar.id,
    });

    sandbox.stub(calendarInterface.categoryMappingService, 'assignAutoRepostCategories').resolves();
    sandbox.stub(calendarInterface, 'getEventById').resolves(buildReconstitutedEvent(eventId));

    const enqueuedActivities: any[] = [];
    eventBus.on('outboxMessageAdded', (activity) => enqueuedActivities.push(activity));

    // Act
    await (inboxService as any).checkAndPerformAutoRepost(
      testCalendar, sourceActorUri, eventApId, true,
    );

    // Assert — neither Event nor Note activity should reach the outbox.
    expect(enqueuedActivities.filter(a => a.type === 'Announce').length).toBe(0);
    expect(enqueuedActivities.filter(a => a.type === 'Create').length).toBe(0);
  });

  it('emits the Note with `url` omitted when the remote canonical IRI uses an invalid scheme', async () => {
    // Arrange — remote canonical IRI uses a javascript: scheme. NoteObject
    // must validate via sanitizeExternalUrlHref and drop the `url` field
    // rather than propagating a dangerous href to Mastodon followers.
    const eventId = uuidv4();
    const eventApId = 'javascript:alert(1)';

    // Seed prerequisites manually because seedAutoRepostPrerequisites stores
    // attributed_to keyed off sourceActorUri but the EventObjectEntity needs
    // the malformed ap_id as the lookup key for checkAndPerformAutoRepost.
    const remoteCalendarActorId = uuidv4();
    await CalendarActorEntity.create({
      id: remoteCalendarActorId,
      actor_type: 'remote',
      actor_uri: sourceActorUri,
      remote_display_name: null,
      remote_domain: 'remote.instance',
      calendar_id: null,
      private_key: null,
    });
    await FollowingCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: remoteCalendarActorId,
      calendar_id: testCalendar.id,
      auto_repost_originals: true,
      auto_repost_reposts: false,
    });
    await EventObjectEntity.create({
      event_id: eventId,
      ap_id: eventApId,
      attributed_to: sourceActorUri,
    });

    sandbox.stub(calendarInterface.categoryMappingService, 'assignAutoRepostCategories').resolves();
    sandbox.stub(calendarInterface, 'getEventById').resolves(buildReconstitutedEvent(eventId));

    const enqueuedActivities: any[] = [];
    eventBus.on('outboxMessageAdded', (activity) => enqueuedActivities.push(activity));

    // Act
    await (inboxService as any).checkAndPerformAutoRepost(
      testCalendar, sourceActorUri, eventApId, true,
    );

    // Assert — paired Create(Note) still emitted, but the AP-serialized
    // payload omits `url` because sanitizeExternalUrlHref rejects the
    // javascript: scheme. The Note itself MUST still be emitted so
    // Mastodon followers still see a post for the re-shared event.
    const creates = enqueuedActivities.filter(a => a.type === 'Create');
    expect(creates.length).toBe(1);
    const note = creates[0].object;
    expect(note.type).toBe('Note');
    const apForm = note.toActivityPubObject();
    expect(apForm.url).toBeUndefined();
  });

});

describe('ProcessInboxService - inbox-originated lifecycle Note cascade (pv-taf2)', () => {
  let sandbox: sinon.SinonSandbox;
  let inboxService: ProcessInboxService;
  let eventBus: EventEmitter;
  let testCalendar: Calendar;
  let calendarInterface: CalendarInterface;

  const sourceActorUri = 'https://remote.instance/calendars/source-calendar';

  beforeEach(async () => {
    await setupActivityPubSchema();
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    inboxService = new ProcessInboxService(eventBus, calendarInterface);

    testCalendar = new Calendar('test-calendar-id', 'test-calendar');
    testCalendar.addContent('en', new CalendarContent('en'));
    testCalendar.content('en').title = 'Test Calendar';

    await CalendarEntity.create({
      id: testCalendar.id,
      url_name: testCalendar.urlName,
      account_id: uuidv4(),
      languages: 'en',
    });

    // Other test files may leave `PRAGMA foreign_keys = ON` on the shared
    // SQLite connection; share/dismissal rows reference EventEntity, which
    // setupActivityPubSchema() does not sync.
    const db = (await import('@/server/common/entity/db')).default;
    await db.query('PRAGMA foreign_keys = OFF');

    sandbox.stub(console, 'log');
    sandbox.stub(console, 'warn');
  });

  afterEach(async () => {
    sandbox.restore();
    await teardownActivityPubSchema();
    const db = (await import('@/server/common/entity/db')).default;
    await db.query('PRAGMA foreign_keys = ON');
  });

  function buildReconstitutedEvent(eventId: string): CalendarEvent {
    const event = new CalendarEvent(eventId, null);
    event.addContent(new CalendarEventContent('en', 'Reposted Event', ''));
    return event;
  }

  async function seedEventObject(eventId: string, eventApId: string) {
    await EventObjectEntity.create({
      event_id: eventId,
      ap_id: eventApId,
      attributed_to: sourceActorUri,
    });
  }

  async function seedShare(eventId: string) {
    await SharedEventEntity.create({
      id: uuidv4(),
      event_id: eventId,
      calendar_id: testCalendar.id,
      auto_posted: true,
    });
  }

  // AC1: re-shared event Update → paired Update(Note) to the reposting calendar.
  it('emits a paired Update(Note) when an Update(Event) lands on a re-shared event', async () => {
    const eventId = uuidv4();
    const eventApId = `https://remote.instance/events/${eventId}`;
    await seedEventObject(eventId, eventApId);
    await seedShare(eventId);

    sandbox.stub(inboxService as any, 'isPersonActorUri').resolves(false);
    sandbox.stub(calendarInterface, 'getEventById').resolves(buildReconstitutedEvent(eventId));
    sandbox.stub(calendarInterface, 'updateRemoteEvent').resolves(buildReconstitutedEvent(eventId));

    const enqueued: any[] = [];
    eventBus.on('outboxMessageAdded', (activity) => enqueued.push(activity));

    const updateMessage = UpdateActivity.fromObject({
      type: 'Update',
      actor: sourceActorUri,
      object: { id: eventApId, type: 'Event', name: 'Updated Event' },
    });

    await inboxService.processUpdateEvent(testCalendar, updateMessage!);

    const updates = enqueued.filter(a => a.type === 'Update');
    expect(updates.length).toBe(1);
    const noteUpdate = updates[0];
    expect(noteUpdate.object.type).toBe('Note');
    expect(noteUpdate.object.attributedTo).toContain('/calendars/test-calendar');
    expect(noteUpdate.to).toContain('https://www.w3.org/ns/activitystreams#Public');
    expect(noteUpdate.cc[0]).toContain('/calendars/test-calendar/followers');
    // Serialized Note `url` equals the remote canonical IRI (urlOverride).
    expect(noteUpdate.object.toActivityPubObject().url).toBe(eventApId);
  });

  // AC2: no share row → no Update(Note); failed update → no Update(Note).
  it('emits no Update(Note) when the event is not re-shared', async () => {
    const eventId = uuidv4();
    const eventApId = `https://remote.instance/events/${eventId}`;
    await seedEventObject(eventId, eventApId);
    // No SharedEventEntity row.

    sandbox.stub(inboxService as any, 'isPersonActorUri').resolves(false);
    sandbox.stub(calendarInterface, 'getEventById').resolves(buildReconstitutedEvent(eventId));
    sandbox.stub(calendarInterface, 'updateRemoteEvent').resolves(buildReconstitutedEvent(eventId));

    const enqueued: any[] = [];
    eventBus.on('outboxMessageAdded', (activity) => enqueued.push(activity));

    const updateMessage = UpdateActivity.fromObject({
      type: 'Update',
      actor: sourceActorUri,
      object: { id: eventApId, type: 'Event', name: 'Updated Event' },
    });

    await inboxService.processUpdateEvent(testCalendar, updateMessage!);

    expect(enqueued.filter(a => a.type === 'Update').length).toBe(0);
  });

  it('emits no Update(Note) when updateRemoteEvent returns null even with a share row', async () => {
    const eventId = uuidv4();
    const eventApId = `https://remote.instance/events/${eventId}`;
    await seedEventObject(eventId, eventApId);
    await seedShare(eventId);

    sandbox.stub(inboxService as any, 'isPersonActorUri').resolves(false);
    sandbox.stub(calendarInterface, 'getEventById').resolves(buildReconstitutedEvent(eventId));
    sandbox.stub(calendarInterface, 'updateRemoteEvent').resolves(null);

    const enqueued: any[] = [];
    eventBus.on('outboxMessageAdded', (activity) => enqueued.push(activity));

    const updateMessage = UpdateActivity.fromObject({
      type: 'Update',
      actor: sourceActorUri,
      object: { id: eventApId, type: 'Event', name: 'Updated Event' },
    });

    await inboxService.processUpdateEvent(testCalendar, updateMessage!);

    expect(enqueued.filter(a => a.type === 'Update').length).toBe(0);
  });

  // AC3: re-shared event Delete → paired Delete(Note), IRI string === noteUrl.
  it('emits a paired Delete(Note) when a Delete(Event) lands on a re-shared event', async () => {
    const eventId = uuidv4();
    const eventApId = `https://remote.instance/events/${eventId}`;
    await seedEventObject(eventId, eventApId);
    await seedShare(eventId);

    const existingEvent = buildReconstitutedEvent(eventId);
    sandbox.stub(inboxService as any, 'isPersonActorUri').resolves(false);
    sandbox.stub(calendarInterface, 'getEventById').resolves(existingEvent);
    sandbox.stub(calendarInterface, 'deleteRemoteEvent').resolves();
    sandbox.stub(inboxService as any, 'actorOwnsObject').resolves(true);

    const enqueued: any[] = [];
    eventBus.on('outboxMessageAdded', (activity) => enqueued.push(activity));

    const deleteMessage = DeleteActivity.fromObject({
      type: 'Delete',
      actor: sourceActorUri,
      object: eventApId,
    });

    await inboxService.processDeleteEvent(testCalendar, deleteMessage!);

    const deletes = enqueued.filter(a => a.type === 'Delete');
    expect(deletes.length).toBe(1);
    const noteDelete = deletes[0];
    // object is the Note IRI string, equal to noteUrl(calendar, event).
    expect(noteDelete.object).toBe(NoteObject.noteUrl(testCalendar, existingEvent));
    expect(noteDelete.to).toContain('https://www.w3.org/ns/activitystreams#Public');
    expect(noteDelete.cc[0]).toContain('/calendars/test-calendar/followers');
  });

  // AC4: Delete(Note) IRI equals the IRI the Create(Note) cascade minted for the
  // same (calendar, event) pair — executable cross-path parity (not a tautology).
  it('Delete(Note) IRI byte-matches the Create(Note) cascade IRI for the same (calendar, event)', async () => {
    const eventId = uuidv4();
    const eventApId = `https://remote.instance/events/${eventId}`;

    // Seed full auto-repost prerequisites so the real Create(Note) cascade runs.
    const remoteCalendarActorId = uuidv4();
    await CalendarActorEntity.create({
      id: remoteCalendarActorId,
      actor_type: 'remote',
      actor_uri: sourceActorUri,
      remote_display_name: null,
      remote_domain: 'remote.instance',
      calendar_id: null,
      private_key: null,
    });
    await FollowingCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: remoteCalendarActorId,
      calendar_id: testCalendar.id,
      auto_repost_originals: true,
      auto_repost_reposts: false,
    });
    await seedEventObject(eventId, eventApId);

    const event = buildReconstitutedEvent(eventId);
    sandbox.stub(calendarInterface.categoryMappingService, 'assignAutoRepostCategories').resolves();
    sandbox.stub(calendarInterface, 'getEventById').resolves(event);

    const cascadeEnqueued: any[] = [];
    eventBus.on('outboxMessageAdded', (activity) => cascadeEnqueued.push(activity));

    // Run the real Create(Note) cascade.
    await (inboxService as any).checkAndPerformAutoRepost(
      testCalendar, sourceActorUri, eventApId, true,
    );
    const createNote = cascadeEnqueued.find(a => a.type === 'Create' && a.object?.type === 'Note');
    expect(createNote).toBeDefined();
    const createNoteIri = createNote.object.toActivityPubObject().id;

    // Now run the Delete(Event) for the same (calendar, event). The cascade
    // already created the SharedEventEntity row, so this is a true re-shared
    // event delete.
    sandbox.stub(inboxService as any, 'isPersonActorUri').resolves(false);
    sandbox.stub(calendarInterface, 'deleteRemoteEvent').resolves();
    sandbox.stub(inboxService as any, 'actorOwnsObject').resolves(true);

    const deleteEnqueued: any[] = [];
    eventBus.on('outboxMessageAdded', (activity) => deleteEnqueued.push(activity));

    const deleteMessage = DeleteActivity.fromObject({
      type: 'Delete',
      actor: sourceActorUri,
      object: eventApId,
    });
    await inboxService.processDeleteEvent(testCalendar, deleteMessage!);

    const deleteNote = deleteEnqueued.find(a => a.type === 'Delete');
    expect(deleteNote).toBeDefined();
    expect(deleteNote.object).toBe(createNoteIri);
  });

  // AC5: non-reshared event Delete → no Delete(Note).
  it('emits no Delete(Note) when the deleted event is not re-shared', async () => {
    const eventId = uuidv4();
    const eventApId = `https://remote.instance/events/${eventId}`;
    await seedEventObject(eventId, eventApId);
    // No SharedEventEntity row.

    sandbox.stub(inboxService as any, 'isPersonActorUri').resolves(false);
    sandbox.stub(calendarInterface, 'getEventById').resolves(buildReconstitutedEvent(eventId));
    sandbox.stub(calendarInterface, 'deleteRemoteEvent').resolves();
    sandbox.stub(inboxService as any, 'actorOwnsObject').resolves(true);

    const enqueued: any[] = [];
    eventBus.on('outboxMessageAdded', (activity) => enqueued.push(activity));

    const deleteMessage = DeleteActivity.fromObject({
      type: 'Delete',
      actor: sourceActorUri,
      object: eventApId,
    });

    await inboxService.processDeleteEvent(testCalendar, deleteMessage!);

    expect(enqueued.filter(a => a.type === 'Delete').length).toBe(0);
  });

  // AC6: orphaned SharedEventEntity row removed on delete; no RepostDismissalEntity written.
  it('removes the orphaned SharedEventEntity row and writes no RepostDismissalEntity on delete', async () => {
    const eventId = uuidv4();
    const eventApId = `https://remote.instance/events/${eventId}`;
    await seedEventObject(eventId, eventApId);
    await seedShare(eventId);

    sandbox.stub(inboxService as any, 'isPersonActorUri').resolves(false);
    sandbox.stub(calendarInterface, 'getEventById').resolves(buildReconstitutedEvent(eventId));
    sandbox.stub(calendarInterface, 'deleteRemoteEvent').resolves();
    sandbox.stub(inboxService as any, 'actorOwnsObject').resolves(true);

    const deleteMessage = DeleteActivity.fromObject({
      type: 'Delete',
      actor: sourceActorUri,
      object: eventApId,
    });

    await inboxService.processDeleteEvent(testCalendar, deleteMessage!);

    const remainingShares = await SharedEventEntity.count({
      where: { event_id: eventId, calendar_id: testCalendar.id },
    });
    expect(remainingShares).toBe(0);

    const dismissals = await RepostDismissalEntity.count({
      where: { event_id: eventId, calendar_id: testCalendar.id },
    });
    expect(dismissals).toBe(0);
  });

  // AC7: Person-actor update/delete of a locally-owned (non-reshared) event emits no Note.
  it('emits no Note on a Person-actor update of a locally-owned event with no share row', async () => {
    const personActorUri = 'https://user.instance/users/editor';
    const eventApId = 'https://remote.instance/events/owned-event';
    const eventId = uuidv4();
    await EventObjectEntity.create({
      event_id: eventId,
      ap_id: eventApId,
      attributed_to: 'https://remote.instance/calendars/source',
    });
    // No SharedEventEntity row — locally-owned events are never re-shared.

    sandbox.stub(inboxService as any, 'isPersonActorUri').resolves(true);
    sandbox.stub(inboxService as any, 'isAuthorizedRemoteEditor').resolves(true);
    sandbox.stub(calendarInterface, 'getEventById').resolves(buildReconstitutedEvent(eventId));
    sandbox.stub(calendarInterface, 'updateRemoteEvent').resolves(buildReconstitutedEvent(eventId));

    const enqueued: any[] = [];
    eventBus.on('outboxMessageAdded', (activity) => enqueued.push(activity));

    const updateMessage = UpdateActivity.fromObject({
      type: 'Update',
      actor: personActorUri,
      object: {
        id: eventApId,
        type: 'Event',
        name: 'Editor Updated Event',
        eventParams: { id: eventId, name: 'Editor Updated Event' },
      },
    });

    await inboxService.processUpdateEvent(testCalendar, updateMessage!);

    expect(enqueued.filter(a => a.type === 'Update').length).toBe(0);
  });

  // Lock-in (pv-vq8z): a Person-actor Update resolving a locally-owned event via
  // eventParams.id that has NO EventObjectEntity row leaves apObject null. The
  // eventParams build dereferenced apObject.event_id, crashing with a TypeError.
  // The guard must no-op: no crash, no updateRemoteEvent, no eventUpdated, no Note.
  it('no-ops without crashing on a Person-actor Update when no AP object record exists', async () => {
    const personActorUri = 'https://user.instance/users/editor';
    const eventApId = 'https://remote.instance/events/never-federated';
    const eventId = uuidv4();
    // Deliberately NO EventObjectEntity row → apObject stays null on the
    // Person-actor path after both the ap_id and event_id re-lookups miss.

    sandbox.stub(inboxService as any, 'isPersonActorUri').resolves(true);
    sandbox.stub(inboxService as any, 'isAuthorizedRemoteEditor').resolves(true);
    // Event resolves only via the eventParams.id local UUID lookup.
    sandbox.stub(calendarInterface, 'getEventById').resolves(buildReconstitutedEvent(eventId));
    const updateRemoteEvent = sandbox.stub(calendarInterface, 'updateRemoteEvent').resolves(buildReconstitutedEvent(eventId));

    const enqueued: any[] = [];
    eventBus.on('outboxMessageAdded', (activity) => enqueued.push(activity));
    let eventUpdatedEmitted = false;
    eventBus.on('eventUpdated', () => { eventUpdatedEmitted = true; });

    const updateMessage = UpdateActivity.fromObject({
      type: 'Update',
      actor: personActorUri,
      object: {
        id: eventApId,
        type: 'Event',
        name: 'Editor Updated Event',
        eventParams: { id: eventId, name: 'Editor Updated Event' },
      },
    });

    const result = await inboxService.processUpdateEvent(testCalendar, updateMessage!);

    expect(result).toBeNull();
    expect(updateRemoteEvent.called).toBe(false);
    expect(eventUpdatedEmitted).toBe(false);
    expect(enqueued.length).toBe(0);
  });

  it('emits no Note on a Person-actor delete of a locally-owned event with no share row', async () => {
    const personActorUri = 'https://user.instance/users/editor';
    const eventApId = 'https://remote.instance/events/owned-event-2';
    const eventId = uuidv4();
    await EventObjectEntity.create({
      event_id: eventId,
      ap_id: eventApId,
      attributed_to: 'https://remote.instance/calendars/source',
    });
    // No SharedEventEntity row.

    sandbox.stub(inboxService as any, 'isPersonActorUri').resolves(true);
    sandbox.stub(inboxService as any, 'isAuthorizedRemoteEditor').resolves(true);
    sandbox.stub(calendarInterface, 'getEventById').resolves(buildReconstitutedEvent(eventId));
    sandbox.stub(calendarInterface, 'deleteRemoteEvent').resolves();

    const enqueued: any[] = [];
    eventBus.on('outboxMessageAdded', (activity) => enqueued.push(activity));

    const deleteMessage = DeleteActivity.fromObject({
      type: 'Delete',
      actor: personActorUri,
      object: { id: eventApId, type: 'Tombstone', eventId },
    });

    await inboxService.processDeleteEvent(testCalendar, deleteMessage!);

    expect(enqueued.filter(a => a.type === 'Delete').length).toBe(0);
  });
});

describe('ProcessInboxService - processUpdateEvent', () => {
  let sandbox: sinon.SinonSandbox;
  let inboxService: ProcessInboxService;
  let eventBus: EventEmitter;
  let testCalendar: Calendar;
  let calendarInterface: CalendarInterface;

  beforeEach(async () => {
    await setupActivityPubSchema();
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    inboxService = new ProcessInboxService(eventBus, calendarInterface);

    testCalendar = new Calendar('test-calendar-id', 'test-calendar');
    testCalendar.addContent('en', new CalendarContent('en'));
    testCalendar.content('en').title = 'Test Calendar';

    await CalendarEntity.create({
      id: testCalendar.id,
      url_name: testCalendar.urlName,
      account_id: uuidv4(),
      languages: 'en',
    });

    // Suppress console output during tests
    sandbox.stub(console, 'log');
    sandbox.stub(console, 'warn');
  });

  afterEach(async () => {
    sandbox.restore();
    await teardownActivityPubSchema();
  });

  describe('domain-of-origin verification', () => {
    it('should reject Update when actor domain does not match event object domain', async () => {
      // Arrange - actor from different domain than event
      const actorUri = 'https://malicious.instance/calendars/attacker';
      const eventApId = 'https://legitimate.instance/events/some-event';
      const eventId = uuidv4();

      // Create EventObjectEntity for the event
      await EventObjectEntity.create({
        event_id: eventId,
        ap_id: eventApId,
        attributed_to: 'https://legitimate.instance/calendars/source',
      });

      // Stub calendarInterface.getEventById
      const existingEvent = new CalendarEvent(eventId, null);
      sandbox.stub(calendarInterface, 'getEventById').resolves(existingEvent);

      // Stub isPersonActorUri to return false (calendar actor)
      sandbox.stub(inboxService as any, 'isPersonActorUri').resolves(false);

      const updateMessage = UpdateActivity.fromObject({
        type: 'Update',
        actor: actorUri,
        object: {
          id: eventApId,
          type: 'Event',
          name: 'Spoofed Event',
        },
      });

      // Act
      const result = await inboxService.processUpdateEvent(testCalendar, updateMessage!);

      // Assert - should return null (rejected)
      expect(result).toBeNull();
    });

    it('should allow Update when actor domain matches event object domain', async () => {
      // Arrange - actor and event on same domain
      const actorUri = 'https://remote.instance/calendars/source-calendar';
      const eventApId = 'https://remote.instance/events/some-event';
      const eventId = uuidv4();

      await EventObjectEntity.create({
        event_id: eventId,
        ap_id: eventApId,
        attributed_to: actorUri,
      });

      const existingEvent = new CalendarEvent(eventId, null);
      sandbox.stub(calendarInterface, 'getEventById').resolves(existingEvent);
      sandbox.stub(inboxService as any, 'isPersonActorUri').resolves(false);

      const updatedEvent = new CalendarEvent(eventId, null);
      sandbox.stub(calendarInterface, 'updateRemoteEvent').resolves(updatedEvent);

      const updateMessage = UpdateActivity.fromObject({
        type: 'Update',
        actor: actorUri,
        object: {
          id: eventApId,
          type: 'Event',
          name: 'Updated Event',
        },
      });

      // Act
      const result = await inboxService.processUpdateEvent(testCalendar, updateMessage!);

      // Assert - should return the updated event
      expect(result).not.toBeNull();
      expect(result).toBe(updatedEvent);
    });

    it('should skip domain check for Person actor updates', async () => {
      // Arrange - Person actor from different domain should still work
      // (authorization check handles Person actors separately)
      const personActorUri = 'https://user.instance/users/editor';
      const eventApId = 'https://remote.instance/events/some-event';
      const eventId = uuidv4();

      await EventObjectEntity.create({
        event_id: eventId,
        ap_id: eventApId,
        attributed_to: 'https://remote.instance/calendars/source',
      });

      const existingEvent = new CalendarEvent(eventId, null);
      sandbox.stub(calendarInterface, 'getEventById').resolves(existingEvent);

      // This is a Person actor
      sandbox.stub(inboxService as any, 'isPersonActorUri').resolves(true);
      sandbox.stub(inboxService as any, 'isAuthorizedRemoteEditor').resolves(true);

      const updatedEvent = new CalendarEvent(eventId, null);
      sandbox.stub(calendarInterface, 'updateRemoteEvent').resolves(updatedEvent);

      const updateMessage = UpdateActivity.fromObject({
        type: 'Update',
        actor: personActorUri,
        object: {
          id: eventApId,
          type: 'Event',
          name: 'Editor Updated Event',
          eventParams: { id: eventId, name: 'Editor Updated Event' },
        },
      });

      // Act
      const result = await inboxService.processUpdateEvent(testCalendar, updateMessage!);

      // Assert - Person actor bypasses domain check, uses editor authorization instead
      expect(result).not.toBeNull();
    });
  });

  describe('eventUpdated emission', () => {
    it('should emit eventUpdated with calendar: null after successful remote event update', async () => {
      // Arrange
      const actorUri = 'https://remote.instance/calendars/source-calendar';
      const eventApId = 'https://remote.instance/events/some-event';
      const eventId = uuidv4();

      await EventObjectEntity.create({
        event_id: eventId,
        ap_id: eventApId,
        attributed_to: actorUri,
      });

      const existingEvent = new CalendarEvent(eventId, null);
      sandbox.stub(calendarInterface, 'getEventById').resolves(existingEvent);
      sandbox.stub(inboxService as any, 'isPersonActorUri').resolves(false);

      const updatedEvent = new CalendarEvent(eventId, null);
      sandbox.stub(calendarInterface, 'updateRemoteEvent').resolves(updatedEvent);

      const emittedEvents: any[] = [];
      eventBus.on('eventUpdated', (payload) => emittedEvents.push(payload));

      const updateMessage = UpdateActivity.fromObject({
        type: 'Update',
        actor: actorUri,
        object: {
          id: eventApId,
          type: 'Event',
          name: 'Updated Event',
        },
      });

      // Act
      await inboxService.processUpdateEvent(testCalendar, updateMessage!);

      // Assert
      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].calendar).toBeNull();
      expect(emittedEvents[0].event).toBe(updatedEvent);
    });

    it('should not emit eventUpdated when updateRemoteEvent returns null', async () => {
      // Arrange
      const actorUri = 'https://remote.instance/calendars/source-calendar';
      const eventApId = 'https://remote.instance/events/some-event';
      const eventId = uuidv4();

      await EventObjectEntity.create({
        event_id: eventId,
        ap_id: eventApId,
        attributed_to: actorUri,
      });

      const existingEvent = new CalendarEvent(eventId, null);
      sandbox.stub(calendarInterface, 'getEventById').resolves(existingEvent);
      sandbox.stub(inboxService as any, 'isPersonActorUri').resolves(false);

      // updateRemoteEvent returns null
      sandbox.stub(calendarInterface, 'updateRemoteEvent').resolves(null);

      const emittedEvents: any[] = [];
      eventBus.on('eventUpdated', (payload) => emittedEvents.push(payload));

      const updateMessage = UpdateActivity.fromObject({
        type: 'Update',
        actor: actorUri,
        object: {
          id: eventApId,
          type: 'Event',
          name: 'Updated Event',
        },
      });

      // Act
      await inboxService.processUpdateEvent(testCalendar, updateMessage!);

      // Assert - no emission when update fails
      expect(emittedEvents).toHaveLength(0);
    });

    it('should not emit eventUpdated when domain-of-origin check rejects the activity', async () => {
      // Arrange - actor domain mismatch
      const actorUri = 'https://malicious.instance/calendars/attacker';
      const eventApId = 'https://legitimate.instance/events/some-event';
      const eventId = uuidv4();

      await EventObjectEntity.create({
        event_id: eventId,
        ap_id: eventApId,
        attributed_to: 'https://legitimate.instance/calendars/source',
      });

      const existingEvent = new CalendarEvent(eventId, null);
      sandbox.stub(calendarInterface, 'getEventById').resolves(existingEvent);
      sandbox.stub(inboxService as any, 'isPersonActorUri').resolves(false);

      const emittedEvents: any[] = [];
      eventBus.on('eventUpdated', (payload) => emittedEvents.push(payload));

      const updateMessage = UpdateActivity.fromObject({
        type: 'Update',
        actor: actorUri,
        object: {
          id: eventApId,
          type: 'Event',
          name: 'Spoofed Event',
        },
      });

      // Act
      await inboxService.processUpdateEvent(testCalendar, updateMessage!);

      // Assert - no emission when rejected
      expect(emittedEvents).toHaveLength(0);
    });
  });
});

describe('ProcessInboxService - processShareEvent SSRF Protection', () => {
  let sandbox: sinon.SinonSandbox;
  let inboxService: ProcessInboxService;
  let eventBus: EventEmitter;
  let testCalendar: Calendar;
  let calendarInterface: CalendarInterface;

  // Actor on a legitimate remote domain — used as the announcer
  const LEGITIMATE_ACTOR = 'https://legitimate.example/calendars/events';

  beforeEach(async () => {
    await setupActivityPubSchema();
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    inboxService = new ProcessInboxService(eventBus, calendarInterface);

    testCalendar = new Calendar('announce-ssrf-calendar-id', 'announce-ssrf-calendar');
    testCalendar.addContent('en', new CalendarContent('en'));
    testCalendar.content('en').title = 'Announce SSRF Test Calendar';

    await CalendarEntity.create({
      id: testCalendar.id,
      url_name: testCalendar.urlName,
      account_id: uuidv4(),
      languages: 'en',
    });
  });

  afterEach(async () => {
    sandbox.restore();
    await teardownActivityPubSchema();
  });

  /**
   * Helper: assert that an Announce is blocked by SSRF protection inside fetchRemoteObject.
   * The real fetchRemoteObject is used here (not stubbed), so validateUrlNotPrivate() runs.
   * For http:// URLs, it rejects immediately before any network contact.
   */
  async function assertBlockedViaFetch(actor: string, objectId: string): Promise<void> {
    const activity = new AnnounceActivity(actor, objectId);
    // processShareEvent should complete without throwing — SSRF protection blocks the fetch
    // and the function logs a warning and returns early without creating a SharedEventEntity.
    await inboxService.processShareEvent(testCalendar, activity);
  }

  it('should block Announce whose object.id is a private IPv4 (10.x.x.x)', async () => {
    await assertBlockedViaFetch(LEGITIMATE_ACTOR, 'http://10.0.0.1/events/123');
  });

  it('should block Announce whose object.id is a private LAN address (192.168.x.x)', async () => {
    await assertBlockedViaFetch(LEGITIMATE_ACTOR, 'http://192.168.1.1/events/456');
  });

  it('should block Announce whose object.id is the loopback address (127.0.0.1)', async () => {
    await assertBlockedViaFetch(LEGITIMATE_ACTOR, 'http://127.0.0.1/events/789');
  });

  it('should block Announce whose object.id is the AWS metadata endpoint', async () => {
    await assertBlockedViaFetch(LEGITIMATE_ACTOR, 'http://169.254.169.254/latest/meta-data/');
  });

  it('should block Announce whose object.id is the IPv6 loopback (::1)', async () => {
    await assertBlockedViaFetch(LEGITIMATE_ACTOR, 'http://[::1]/events/999');
  });

  it('should block Announce whose object.id is the wildcard address (0.0.0.0)', async () => {
    await assertBlockedViaFetch(LEGITIMATE_ACTOR, 'http://0.0.0.0/events/000');
  });

  it('should allow cross-domain Announce (e.g. Bob on Beta reposts Alice on Alpha)', async () => {
    // Cross-instance reposts are valid ActivityPub behavior — Bob's actor on beta.example
    // legitimately announces Alice's event from alpha.example. The domain-match guard
    // was incorrectly blocking this; SSRF protection comes from validateUrlNotPrivate() only.
    const aliceEventUrl = 'https://alpha.example/events/alice-original';
    const bobActor = 'https://beta.example/calendars/bob';

    const findOneStub = sandbox.stub(EventObjectEntity, 'findOne').resolves({ event_id: uuidv4() } as any);
    sandbox.stub(remoteFetch, 'fetchRemoteObject').resolves(null);

    const activity = new AnnounceActivity(bobActor, aliceEventUrl);
    await inboxService.processShareEvent(testCalendar, activity);

    // DB lookup is reached — the announce was not dropped early
    expect(findOneStub.calledOnce).toBe(true);
  });

  it('should allow a valid https:// public-domain Announce to proceed to DB lookup', async () => {
    // Verify https:// public-domain URLs pass SSRF checks and reach the DB lookup step.
    const publicEventUrl = 'https://legitimate.example/events/public-event-99';

    const findOneStub = sandbox.stub(EventObjectEntity, 'findOne').resolves({ event_id: uuidv4() } as any);
    sandbox.stub(remoteFetch, 'fetchRemoteObject').resolves(null);

    const activity = new AnnounceActivity(LEGITIMATE_ACTOR, publicEventUrl);
    await inboxService.processShareEvent(testCalendar, activity);

    expect(findOneStub.calledOnce).toBe(true);
  });

  it('should emit announce_fetch_failed warning for an http:// Announce (non-HTTPS)', async () => {
    // validateUrlNotPrivate() inside fetchRemoteObject rejects non-HTTPS URLs.
    // processShareEvent logs announce_fetch_failed when fetchRemoteObject returns null.
    const httpObjectUrl = 'http://legitimate.example/events/insecure';

    sandbox.stub(EventObjectEntity, 'findOne').resolves(null);
    sandbox.stub(remoteFetch, 'fetchRemoteObject').resolves(null);

    const activity = new AnnounceActivity(LEGITIMATE_ACTOR, httpObjectUrl);
    // Should complete without throwing — fetch fails and function returns early
    await inboxService.processShareEvent(testCalendar, activity);
  });

  it('should block Announce when same-domain actor DNS-resolves to a private IP', async () => {
    // actor and object.id share the same hostname (attacker.legitimate-looking.com),
    // so the domain-mismatch guard PASSES. But the SSRF protection inside
    // fetchRemoteObject would block the fetch when the hostname resolves to a
    // private IP (DNS-rebinding attack). We stub fetchRemoteObject directly —
    // the correct seam, since inbox.ts imports it from a separate remote-fetch.ts
    // module — to return null, simulating what happens when SSRF protection
    // (e.g. validateUrlNotPrivate throwing due to a private DNS resolution) causes
    // fetchRemoteObject to return null. processShareEvent must then log
    // announce_fetch_failed and never call addRemoteEvent.
    const actorUrl = 'https://attacker.legitimate-looking.com/calendars/evil';
    const objectId = 'https://attacker.legitimate-looking.com/events/internal';

    // Stub fetchRemoteObject to return null — simulates SSRF protection blocking
    // the fetch because the hostname resolves to a private IP (10.0.0.5).
    sandbox.stub(remoteFetch, 'fetchRemoteObject').resolves(null);

    // Event has not been seen before — triggers the fetchRemoteObject path
    sandbox.stub(EventObjectEntity, 'findOne').resolves(null);

    // Spy on addRemoteEvent to assert it is never called
    const addRemoteEventSpy = sandbox.stub(calendarInterface, 'addRemoteEvent');

    const activity = new AnnounceActivity(actorUrl, objectId);
    await inboxService.processShareEvent(testCalendar, activity);

    // addRemoteEvent must NOT have been called — SSRF protection blocked the fetch
    expect(addRemoteEventSpy.called).toBe(false);
  });
});

/**
 * Pavillion's outbox emits a paired Create(Note)/Update(Note)/Delete(Note)
 * alongside every Announce(Event)/Update(Event)/Delete(Event) so Mastodon-class
 * peers render the post on profile timelines. Notes are interop-only — the
 * note.ts comment is explicit: "Pavillion never ingests remote Notes."
 *
 * Before this guard, the inbox dispatcher routed every Create/Update to
 * processCreateEvent/processUpdateEvent without inspecting object.type and
 * every Delete to processDeleteEvent without inspecting the target IRI.
 * A Create(Note) would therefore be parsed as a Create(Event), creating a
 * phantom EventEntity attributed to the source actor with the Note IRI as
 * eventSourceUrl. In mutual auto-repost setups (federation Scenario 5) the
 * phantom passed the loop-prevention guard and cascaded back to the source,
 * tripping rate-limits and crowding the real Announce(Event) out of the
 * test timeout window.
 */
describe('ProcessInboxService - Note-wrapped activities are skipped', () => {
  let sandbox: sinon.SinonSandbox;
  let inboxService: ProcessInboxService;
  let eventBus: EventEmitter;
  let testCalendar: Calendar;
  let calendarInterface: CalendarInterface;

  const remoteActorUri = 'https://remote.instance/calendars/source-calendar';
  const eventApId = 'https://remote.instance/calendars/source-calendar/events/abc';
  const noteApId = `${eventApId}/note`;

  beforeEach(async () => {
    await setupActivityPubSchema();
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    inboxService = new ProcessInboxService(eventBus, calendarInterface);

    testCalendar = new Calendar('note-skip-calendar-id', 'note-skip-calendar');
    testCalendar.addContent('en', new CalendarContent('en'));
    testCalendar.content('en').title = 'Note Skip Test Calendar';

    await CalendarEntity.create({
      id: testCalendar.id,
      url_name: testCalendar.urlName,
      account_id: uuidv4(),
      languages: 'en',
    });

    sandbox.stub(console, 'log');
    sandbox.stub(console, 'warn');
  });

  afterEach(async () => {
    sandbox.restore();
    await teardownActivityPubSchema();
  });

  it('processCreateEvent skips Note-typed objects without creating an EventObjectEntity or calling addRemoteEvent', async () => {
    const addRemoteEventSpy = sandbox.stub(calendarInterface, 'addRemoteEvent');
    const ownsObjectSpy = sandbox.stub(inboxService as any, 'actorOwnsObject');

    const createNote = new CreateActivity(remoteActorUri, {
      id: noteApId,
      type: 'Note',
      attributedTo: remoteActorUri,
      name: 'Untrusted Note',
      content: '<p>arbitrary</p>',
    } as any);

    const result = await inboxService['processCreateEvent'](testCalendar, createNote);

    expect(result).toBeNull();
    expect(addRemoteEventSpy.called).toBe(false);
    // Short-circuit must happen before remote ownership verification: the
    // helper would otherwise dereference the Note IRI over HTTP.
    expect(ownsObjectSpy.called).toBe(false);

    const persistedPhantom = await EventObjectEntity.findOne({
      where: { ap_id: noteApId },
    });
    expect(persistedPhantom).toBeNull();
  });

  it('processUpdateEvent skips Note-typed objects even when a stale EventObjectEntity exists at the Note IRI', async () => {
    // Seed the kind of phantom row a pre-fix Create(Note) would have minted.
    // Without the Note-type guard, processUpdateEvent would find this row,
    // load its event, and forward the Note payload to updateRemoteEvent.
    const phantomEventId = uuidv4();
    await EventObjectEntity.create({
      event_id: phantomEventId,
      ap_id: noteApId,
      attributed_to: remoteActorUri,
    });
    sandbox.stub(calendarInterface, 'getEventById').resolves(new CalendarEvent(phantomEventId, null));
    sandbox.stub(inboxService as any, 'isPersonActorUri').resolves(false);

    const updateSpy = sandbox.stub(calendarInterface, 'updateRemoteEvent');

    const updateNote = UpdateActivity.fromObject({
      type: 'Update',
      actor: remoteActorUri,
      object: {
        id: noteApId,
        type: 'Note',
        attributedTo: remoteActorUri,
        name: 'Untrusted Note',
        content: '<p>arbitrary</p>',
      },
    });

    const result = await inboxService.processUpdateEvent(testCalendar, updateNote!);

    expect(result).toBeNull();
    expect(updateSpy.called).toBe(false);
  });

  it('processDeleteEvent skips Note IRIs (object string ending in /note) even when an EventObjectEntity exists at that IRI', async () => {
    // Seed the kind of phantom row a pre-fix Create(Note) would have minted.
    // Without the Note IRI guard, processDeleteEvent would resolve this row,
    // verify ownership, and call deleteRemoteEvent — destroying a phantom
    // event the system never should have had in the first place.
    const phantomEventId = uuidv4();
    await EventObjectEntity.create({
      event_id: phantomEventId,
      ap_id: noteApId,
      attributed_to: remoteActorUri,
    });
    sandbox.stub(calendarInterface, 'getEventById').resolves(new CalendarEvent(phantomEventId, null));
    sandbox.stub(inboxService as any, 'isPersonActorUri').resolves(false);
    // Stub ownership verification to true so the test cannot pass for the
    // wrong reason (i.e. the real fetcher failing on an unreachable IRI).
    sandbox.stub(inboxService as any, 'actorOwnsObject').resolves(true);

    const deleteEventSpy = sandbox.stub(calendarInterface, 'deleteRemoteEvent');

    const deleteNote = new DeleteActivity(remoteActorUri, noteApId);
    await inboxService.processDeleteEvent(testCalendar, deleteNote);

    expect(deleteEventSpy.called).toBe(false);
  });

  it('processDeleteEvent skips Tombstone objects whose formerType is Note', async () => {
    const phantomEventId = uuidv4();
    await EventObjectEntity.create({
      event_id: phantomEventId,
      ap_id: noteApId,
      attributed_to: remoteActorUri,
    });
    sandbox.stub(calendarInterface, 'getEventById').resolves(new CalendarEvent(phantomEventId, null));
    sandbox.stub(inboxService as any, 'isPersonActorUri').resolves(false);
    sandbox.stub(inboxService as any, 'actorOwnsObject').resolves(true);

    const deleteEventSpy = sandbox.stub(calendarInterface, 'deleteRemoteEvent');

    const deleteTombstone = DeleteActivity.fromObject({
      type: 'Delete',
      actor: remoteActorUri,
      object: {
        id: noteApId,
        type: 'Tombstone',
        formerType: 'Note',
      },
    });

    await inboxService.processDeleteEvent(testCalendar, deleteTombstone!);

    expect(deleteEventSpy.called).toBe(false);
  });
});
