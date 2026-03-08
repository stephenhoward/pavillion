import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';

import ProcessInboxService from '@/server/activitypub/service/inbox';
import * as remoteFetch from '@/server/activitypub/helper/remote-fetch';
import { FollowerCalendarEntity, FollowingCalendarEntity, ActivityPubOutboxMessageEntity, EventActivityEntity, SharedEventEntity } from '@/server/activitypub/entity/activitypub';
import { CalendarActorEntity } from '@/server/activitypub/entity/calendar_actor';
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';
import FollowActivity from '@/server/activitypub/model/action/follow';
import AnnounceActivity from '@/server/activitypub/model/action/announce';
import UpdateActivity from '@/server/activitypub/model/action/update';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { EventEmitter } from 'events';
import CalendarInterface from '@/server/calendar/interface';
import { setupActivityPubSchema, teardownActivityPubSchema } from '@/server/test/helpers/database';

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
      expect((outboxMessage?.message as any).object).toEqual(followActivity);
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
      const consoleLogStub = sandbox.stub(console, 'log');

      // Act
      await inboxService.processAcceptActivity(testCalendar, acceptActivity as any);

      // Assert
      expect(findOneStub.calledOnce).toBe(true);
      expect(findOneStub.firstCall.args[0].where).toMatchObject({
        calendar_actor_id: mockCalendarActor.id, // Check for UUID, not AP URL
        calendar_id: testCalendar.id,
      });
      expect(consoleLogStub.called).toBe(true);
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
      const consoleLogStub = sandbox.stub(console, 'log');

      // Act
      await inboxService.processAcceptActivity(testCalendar, acceptActivity as any);

      // Assert - should look up remote calendar by actor URI
      expect((inboxService.remoteCalendarService.getByActorUri as sinon.SinonStub).calledOnce).toBe(true);
      expect(findOneStub.calledOnce).toBe(true);
      expect(findOneStub.firstCall.args[0].where).toMatchObject({
        calendar_actor_id: mockCalendarActor.id,
        calendar_id: testCalendar.id,
      });

      // Verify confirmation log was written
      const confirmationLogged = consoleLogStub.getCalls().some(
        call => call.args[0]?.includes('Follow relationship confirmed') && call.args[0]?.includes('string URI'),
      );
      expect(confirmationLogged).toBe(true);
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
    const warnSpy = sandbox.stub(console, 'warn');

    const activity = new AnnounceActivity(actor, objectId);
    await inboxService.processShareEvent(testCalendar, activity);

    // SSRF protection runs inside fetchRemoteObject via validateUrlNotPrivate().
    // fetchRemoteObject returns null (blocked), and processShareEvent emits announce_fetch_failed.
    expect(warnSpy.calledWithMatch(
      sinon.match.string,
      sinon.match({ event: 'announce_fetch_failed' }),
    )).toBe(true);
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
    const warnSpy = sandbox.stub(console, 'warn');

    const activity = new AnnounceActivity(LEGITIMATE_ACTOR, httpObjectUrl);
    await inboxService.processShareEvent(testCalendar, activity);

    expect(warnSpy.calledWithMatch(
      sinon.match.string,
      sinon.match({ event: 'announce_fetch_failed' }),
    )).toBe(true);
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

    const warnSpy = sandbox.stub(console, 'warn');

    const activity = new AnnounceActivity(actorUrl, objectId);
    await inboxService.processShareEvent(testCalendar, activity);

    // SSRF protection blocked the fetch — announce_fetch_failed must be logged
    expect(warnSpy.calledWithMatch(
      sinon.match.string,
      sinon.match({ event: 'announce_fetch_failed' }),
    )).toBe(true);

    // addRemoteEvent must NOT have been called
    expect(addRemoteEventSpy.called).toBe(false);
  });
});
