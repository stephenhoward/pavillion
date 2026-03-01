import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';

import ProcessInboxService from '@/server/activitypub/service/inbox';
import { FollowerCalendarEntity, FollowingCalendarEntity, ActivityPubOutboxMessageEntity, EventActivityEntity } from '@/server/activitypub/entity/activitypub';
import { CalendarActorEntity } from '@/server/activitypub/entity/calendar_actor';
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';
import FollowActivity from '@/server/activitypub/model/action/follow';
import AnnounceActivity from '@/server/activitypub/model/action/announce';
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
  });

  describe('processShareEvent', () => {
    it('should emit activitypub:event:reposted when a local event is announced', async () => {
      // Arrange
      const remoteActorUrl = 'https://remote.instance/calendars/remote-calendar';
      const localEventId = uuidv4();
      const apObjectId = `https://this.instance/events/${localEventId}`;

      // Create EventObjectEntity tracking the AP identity for this local event
      // (EventObjectEntity has no FK to EventEntity, so no media table needed)
      await EventObjectEntity.create({
        event_id: localEventId,
        ap_id: apObjectId,
        attributed_to: 'https://this.instance/calendars/test-calendar',
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
      // Arrange
      const remoteActorUrl = 'https://remote.instance/calendars/remote-calendar';
      const remoteEventId = uuidv4();
      const apObjectId = 'https://other.instance/events/remote-event-123';

      // Create EventObjectEntity for the remote event
      await EventObjectEntity.create({
        event_id: remoteEventId,
        ap_id: apObjectId,
        attributed_to: 'https://other.instance/calendars/their-calendar',
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
      // Arrange
      const remoteActorUrl = 'https://remote.instance/calendars/remote-calendar';
      const displayName = 'Remote Calendar Name';
      const localEventId = uuidv4();
      const apObjectId = `https://this.instance/events/${localEventId}`;

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
        attributed_to: 'https://this.instance/calendars/test-calendar',
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
