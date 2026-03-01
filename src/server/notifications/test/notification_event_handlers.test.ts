import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import NotificationEventHandlers from '@/server/notifications/events';
import NotificationService from '@/server/notifications/service/notification';
import CalendarInterface from '@/server/calendar/interface';
import { Account } from '@/common/model/account';
import { Notification } from '@/common/model/notification';

describe('NotificationEventHandlers', () => {
  let sandbox: sinon.SinonSandbox;
  let eventBus: EventEmitter;
  let service: NotificationService;
  let calendarInterface: CalendarInterface;
  let createNotificationStub: sinon.SinonStub;
  let getEditorsStub: sinon.SinonStub;
  let handlers: NotificationEventHandlers;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();

    // Stub the service and calendarInterface with minimal fakes
    service = { createNotification: async () => null } as unknown as NotificationService;
    calendarInterface = { getEditorsForCalendar: async () => [] } as unknown as CalendarInterface;

    createNotificationStub = sandbox.stub(service, 'createNotification');
    getEditorsStub = sandbox.stub(calendarInterface, 'getEditorsForCalendar');

    handlers = new NotificationEventHandlers(service, calendarInterface);
    handlers.install(eventBus);
  });

  afterEach(() => {
    sandbox.restore();
    eventBus.removeAllListeners();
  });

  // ---------------------------------------------------------------------------
  // install
  // ---------------------------------------------------------------------------

  describe('install', () => {
    it('should register listener for activitypub:calendar:followed', () => {
      expect(eventBus.listenerCount('activitypub:calendar:followed')).toBe(1);
    });

    it('should register listener for activitypub:event:reposted', () => {
      expect(eventBus.listenerCount('activitypub:event:reposted')).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // activitypub:calendar:followed
  // ---------------------------------------------------------------------------

  describe('activitypub:calendar:followed', () => {
    it('should call createNotification once per editor', async () => {
      const calendarId = uuidv4();
      const accountA = new Account(uuidv4(), 'alice', 'alice@example.com');
      const accountB = new Account(uuidv4(), 'bob', 'bob@example.com');

      getEditorsStub.resolves([accountA, accountB]);
      createNotificationStub.resolves(null);

      eventBus.emit('activitypub:calendar:followed', {
        calendarId,
        followerName: 'Follower',
        followerUrl: 'https://remote.example.com/actor',
      });

      // Allow async handlers to settle
      await new Promise(resolve => setImmediate(resolve));

      expect(getEditorsStub.calledOnceWith(calendarId)).toBe(true);
      expect(createNotificationStub.callCount).toBe(2);
    });

    it('should create follow notifications with correct arguments', async () => {
      const calendarId = uuidv4();
      const accountId = uuidv4();
      const account = new Account(accountId, 'alice', 'alice@example.com');
      const followerUrl = 'https://remote.example.com/actor';

      getEditorsStub.resolves([account]);
      createNotificationStub.resolves(null);

      eventBus.emit('activitypub:calendar:followed', {
        calendarId,
        followerName: 'Follower Name',
        followerUrl,
      });

      await new Promise(resolve => setImmediate(resolve));

      const [type, calId, eventId, actorName, actorUrl, acctId] = createNotificationStub.firstCall.args;
      expect(type).toBe('follow');
      expect(calId).toBe(calendarId);
      expect(eventId).toBeNull();
      expect(actorName).toBe('Follower Name');
      expect(actorUrl).toBe(followerUrl);
      expect(acctId).toBe(accountId);
    });

    it('should not call createNotification when calendar has no editors', async () => {
      getEditorsStub.resolves([]);
      createNotificationStub.resolves(null);

      eventBus.emit('activitypub:calendar:followed', {
        calendarId: uuidv4(),
        followerName: 'Follower',
        followerUrl: null,
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(createNotificationStub.called).toBe(false);
    });

    it('should handle null followerUrl', async () => {
      const calendarId = uuidv4();
      const account = new Account(uuidv4(), 'alice', 'alice@example.com');

      getEditorsStub.resolves([account]);
      createNotificationStub.resolves(null);

      eventBus.emit('activitypub:calendar:followed', {
        calendarId,
        followerName: 'Follower',
        followerUrl: null,
      });

      await new Promise(resolve => setImmediate(resolve));

      const [, , , , actorUrl] = createNotificationStub.firstCall.args;
      expect(actorUrl).toBeNull();
    });

    it('should not rethrow errors from getEditorsForCalendar', async () => {
      getEditorsStub.rejects(new Error('DB error'));

      // Should not throw
      eventBus.emit('activitypub:calendar:followed', {
        calendarId: uuidv4(),
        followerName: 'Follower',
        followerUrl: null,
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(createNotificationStub.called).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // activitypub:event:reposted
  // ---------------------------------------------------------------------------

  describe('activitypub:event:reposted', () => {
    it('should call createNotification once per editor', async () => {
      const calendarId = uuidv4();
      const eventId = uuidv4();
      const accountA = new Account(uuidv4(), 'alice', 'alice@example.com');
      const accountB = new Account(uuidv4(), 'bob', 'bob@example.com');

      getEditorsStub.resolves([accountA, accountB]);
      createNotificationStub.resolves(null);

      eventBus.emit('activitypub:event:reposted', {
        eventId,
        calendarId,
        reposterName: 'Reposter',
        reposterUrl: 'https://remote.example.com/actor',
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(getEditorsStub.calledOnceWith(calendarId)).toBe(true);
      expect(createNotificationStub.callCount).toBe(2);
    });

    it('should create repost notifications with correct arguments', async () => {
      const calendarId = uuidv4();
      const eventId = uuidv4();
      const accountId = uuidv4();
      const account = new Account(accountId, 'alice', 'alice@example.com');
      const reposterUrl = 'https://remote.example.com/actor';

      getEditorsStub.resolves([account]);
      createNotificationStub.resolves(null);

      eventBus.emit('activitypub:event:reposted', {
        eventId,
        calendarId,
        reposterName: 'Reposter Name',
        reposterUrl,
      });

      await new Promise(resolve => setImmediate(resolve));

      const [type, calId, evtId, actorName, actorUrl, acctId] = createNotificationStub.firstCall.args;
      expect(type).toBe('repost');
      expect(calId).toBe(calendarId);
      expect(evtId).toBe(eventId);
      expect(actorName).toBe('Reposter Name');
      expect(actorUrl).toBe(reposterUrl);
      expect(acctId).toBe(accountId);
    });

    it('should not call createNotification when calendar has no editors', async () => {
      getEditorsStub.resolves([]);
      createNotificationStub.resolves(null);

      eventBus.emit('activitypub:event:reposted', {
        eventId: uuidv4(),
        calendarId: uuidv4(),
        reposterName: 'Reposter',
        reposterUrl: null,
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(createNotificationStub.called).toBe(false);
    });

    it('should handle null reposterUrl', async () => {
      const calendarId = uuidv4();
      const eventId = uuidv4();
      const account = new Account(uuidv4(), 'alice', 'alice@example.com');

      getEditorsStub.resolves([account]);
      createNotificationStub.resolves(null);

      eventBus.emit('activitypub:event:reposted', {
        eventId,
        calendarId,
        reposterName: 'Reposter',
        reposterUrl: null,
      });

      await new Promise(resolve => setImmediate(resolve));

      const [, , , , actorUrl] = createNotificationStub.firstCall.args;
      expect(actorUrl).toBeNull();
    });

    it('should not rethrow errors from getEditorsForCalendar', async () => {
      getEditorsStub.rejects(new Error('DB error'));

      eventBus.emit('activitypub:event:reposted', {
        eventId: uuidv4(),
        calendarId: uuidv4(),
        reposterName: 'Reposter',
        reposterUrl: null,
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(createNotificationStub.called).toBe(false);
    });

    it('should not rethrow errors from createNotification', async () => {
      const account = new Account(uuidv4(), 'alice', 'alice@example.com');
      getEditorsStub.resolves([account]);
      createNotificationStub.rejects(new Error('insert error'));

      // Should not throw
      eventBus.emit('activitypub:event:reposted', {
        eventId: uuidv4(),
        calendarId: uuidv4(),
        reposterName: 'Reposter',
        reposterUrl: null,
      });

      await new Promise(resolve => setImmediate(resolve));
    });
  });

  // ---------------------------------------------------------------------------
  // Fan-out: single editor
  // ---------------------------------------------------------------------------

  describe('fan-out with single editor', () => {
    it('should create exactly one notification for a single editor on follow', async () => {
      const calendarId = uuidv4();
      const account = new Account(uuidv4(), 'solo', 'solo@example.com');

      getEditorsStub.resolves([account]);

      const notification = new Notification(uuidv4());
      notification.type = 'follow';
      createNotificationStub.resolves(notification);

      eventBus.emit('activitypub:calendar:followed', {
        calendarId,
        followerName: 'Follower',
        followerUrl: 'https://remote.example.com/actor',
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(createNotificationStub.callCount).toBe(1);
    });

    it('should create exactly one notification for a single editor on repost', async () => {
      const calendarId = uuidv4();
      const account = new Account(uuidv4(), 'solo', 'solo@example.com');

      getEditorsStub.resolves([account]);

      const notification = new Notification(uuidv4());
      notification.type = 'repost';
      createNotificationStub.resolves(notification);

      eventBus.emit('activitypub:event:reposted', {
        eventId: uuidv4(),
        calendarId,
        reposterName: 'Reposter',
        reposterUrl: null,
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(createNotificationStub.callCount).toBe(1);
    });
  });
});
