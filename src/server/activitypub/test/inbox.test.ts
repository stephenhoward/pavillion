import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';

import ProcessInboxService from '@/server/activitypub/service/inbox';
import { FollowerCalendarEntity, FollowingCalendarEntity, ActivityPubOutboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import { CalendarActorEntity } from '@/server/activitypub/entity/calendar_actor';
import FollowActivity from '@/server/activitypub/model/action/follow';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { EventEmitter } from 'events';
import CalendarInterface from '@/server/calendar/interface';
import { setupActivityPubSchema, teardownActivityPubSchema } from './helpers/database';

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
});
