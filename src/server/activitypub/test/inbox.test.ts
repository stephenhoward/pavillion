import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';

import ProcessInboxService from '@/server/activitypub/service/inbox';
import { FollowerCalendarEntity, FollowingCalendarEntity, ActivityPubOutboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import FollowActivity from '@/server/activitypub/model/action/follow';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import { EventEmitter } from 'events';
import CalendarInterface from '@/server/calendar/interface';

describe('ProcessInboxService - Follow Activity Processing', () => {
  let sandbox: sinon.SinonSandbox;
  let inboxService: ProcessInboxService;
  let eventBus: EventEmitter;
  let testCalendar: Calendar;
  let calendarInterface: CalendarInterface;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    inboxService = new ProcessInboxService(eventBus, calendarInterface);

    // Create test calendar
    testCalendar = new Calendar('test-calendar-id', 'test-calendar');
    testCalendar.addContent('en', new CalendarContent('en'));
    testCalendar.content('en').title = 'Test Calendar';
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('processFollowAccount', () => {
    it('should create FollowerCalendarEntity record when Follow activity is processed', async () => {
      // Arrange
      const remoteActorUrl = 'https://remote.instance/o/remote-calendar';
      const followActivity = new FollowActivity(remoteActorUrl, testCalendar.id);

      const createFollowerStub = sandbox.stub(FollowerCalendarEntity, 'create').resolves({
        id: uuidv4(),
        remote_calendar_id: remoteActorUrl,
        calendar_id: testCalendar.id,
      } as any);

      const createOutboxStub = sandbox.stub(ActivityPubOutboxMessageEntity, 'create').resolves({} as any);

      const findOneStub = sandbox.stub(FollowerCalendarEntity, 'findOne').resolves(null);

      // Act
      await inboxService.processFollowAccount(testCalendar, followActivity);

      // Assert
      expect(findOneStub.calledOnce).toBe(true);
      expect(createFollowerStub.calledOnce).toBe(true);
      expect(createFollowerStub.firstCall.args[0]).toMatchObject({
        remote_calendar_id: remoteActorUrl,
        calendar_id: testCalendar.id,
      });
      expect(createOutboxStub.calledOnce).toBe(true); // Also verify Accept was queued
    });

    it('should queue Accept activity for delivery after Follow processing', async () => {
      // Arrange
      const remoteActorUrl = 'https://remote.instance/o/remote-calendar';
      const followActivity = new FollowActivity(remoteActorUrl, testCalendar.id);
      followActivity.id = 'https://remote.instance/o/remote-calendar/follows/123';

      sandbox.stub(FollowerCalendarEntity, 'findOne').resolves(null);
      sandbox.stub(FollowerCalendarEntity, 'create').resolves({
        id: uuidv4(),
        remote_calendar_id: remoteActorUrl,
        calendar_id: testCalendar.id,
      } as any);

      const createOutboxStub = sandbox.stub(ActivityPubOutboxMessageEntity, 'create').resolves({} as any);

      // Act
      await inboxService.processFollowAccount(testCalendar, followActivity);

      // Assert
      expect(createOutboxStub.calledOnce).toBe(true);

      const outboxMessage = createOutboxStub.firstCall.args[0];
      expect(outboxMessage.type).toBe('Accept');
      expect(outboxMessage.calendar_id).toBe(testCalendar.id);
      expect(outboxMessage.message).toBeDefined();
    });

    it('should include the original Follow activity in the Accept object', async () => {
      // Arrange
      const remoteActorUrl = 'https://remote.instance/o/remote-calendar';
      const followActivity = new FollowActivity(remoteActorUrl, testCalendar.id);
      followActivity.id = 'https://remote.instance/o/remote-calendar/follows/123';

      sandbox.stub(FollowerCalendarEntity, 'findOne').resolves(null);
      sandbox.stub(FollowerCalendarEntity, 'create').resolves({
        id: uuidv4(),
        remote_calendar_id: remoteActorUrl,
        calendar_id: testCalendar.id,
      } as any);

      const createOutboxStub = sandbox.stub(ActivityPubOutboxMessageEntity, 'create').resolves({} as any);

      // Act
      await inboxService.processFollowAccount(testCalendar, followActivity);

      // Assert
      const outboxMessage = createOutboxStub.firstCall.args[0];
      expect(outboxMessage.message.type).toBe('Accept');
      expect(outboxMessage.message.object).toEqual(followActivity);
    });

    it('should not create duplicate follower record if already exists', async () => {
      // Arrange
      const remoteActorUrl = 'https://remote.instance/o/remote-calendar';
      const followActivity = new FollowActivity(remoteActorUrl, testCalendar.id);

      const existingFollower = {
        id: uuidv4(),
        remote_calendar_id: remoteActorUrl,
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
      const remoteCalendarUrl = 'https://remote.instance/o/remote-calendar';
      const followActivity = new FollowActivity(testCalendar.id, remoteCalendarUrl);
      followActivity.id = 'https://local.instance/o/test-calendar/follows/456';

      // Create an Accept activity that references the Follow
      const acceptActivity = {
        type: 'Accept',
        actor: remoteCalendarUrl,
        object: followActivity,
      };

      const existingFollowing = {
        id: uuidv4(),
        remote_calendar_id: remoteCalendarUrl,
        calendar_id: testCalendar.id,
      };

      const findOneStub = sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(existingFollowing as any);
      const consoleLogStub = sandbox.stub(console, 'log');

      // Act
      await inboxService.processAcceptActivity(testCalendar, acceptActivity as any);

      // Assert
      expect(findOneStub.calledOnce).toBe(true);
      expect(findOneStub.firstCall.args[0].where).toMatchObject({
        remote_calendar_id: remoteCalendarUrl,
        calendar_id: testCalendar.id,
      });
      expect(consoleLogStub.called).toBe(true);
    });
  });
});
