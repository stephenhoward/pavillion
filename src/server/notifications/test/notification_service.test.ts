import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';

import { Notification } from '@/common/model/notification';
import { NotificationEntity } from '@/server/notifications/entity/notification';
import NotificationService from '@/server/notifications/service/notification';

describe('NotificationService', () => {
  let sandbox: sinon.SinonSandbox;
  let service: NotificationService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new NotificationService();
  });

  afterEach(() => {
    sandbox.restore();
  });

  // ---------------------------------------------------------------------------
  // sanitizeActorName
  // ---------------------------------------------------------------------------

  describe('sanitizeActorName', () => {
    it('should return a plain string unchanged', () => {
      expect(service.sanitizeActorName('Alice Bob')).toBe('Alice Bob');
    });

    it('should strip HTML tags', () => {
      expect(service.sanitizeActorName('<b>Alice</b>')).toBe('Alice');
    });

    it('should decode HTML entities before stripping tags', () => {
      // &lt;script&gt; decodes to <script>, which should then be stripped
      expect(service.sanitizeActorName('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('alert(1)');
    });

    it('should decode benign HTML entities correctly', () => {
      expect(service.sanitizeActorName('Alice &amp; Bob')).toBe('Alice & Bob');
    });

    it('should remove Unicode bidi control characters (U+200F)', () => {
      const withBidi = 'Alice\u200FBob';
      expect(service.sanitizeActorName(withBidi)).toBe('AliceBob');
    });

    it('should remove Unicode bidi control characters (U+202E)', () => {
      const withBidi = 'Alice\u202EBob';
      expect(service.sanitizeActorName(withBidi)).toBe('AliceBob');
    });

    it('should remove Unicode bidi control characters in range U+2066-U+2069', () => {
      const withBidi = 'Alice\u2066\u2067\u2068\u2069Bob';
      expect(service.sanitizeActorName(withBidi)).toBe('AliceBob');
    });

    it('should truncate to 256 characters after sanitization', () => {
      const longName = 'a'.repeat(300);
      const result = service.sanitizeActorName(longName);
      expect(result.length).toBe(256);
    });

    it('should truncate after stripping tags (result may be shorter than 256)', () => {
      // 300-char string wrapped in tags — stripped result is 300 chars, truncated to 256
      const longName = '<b>' + 'a'.repeat(300) + '</b>';
      const result = service.sanitizeActorName(longName);
      expect(result.length).toBe(256);
    });

    it('should handle an empty string', () => {
      expect(service.sanitizeActorName('')).toBe('');
    });

    it('should strip nested tags', () => {
      expect(service.sanitizeActorName('<div><span>Name</span></div>')).toBe('Name');
    });
  });

  // ---------------------------------------------------------------------------
  // createNotification
  // ---------------------------------------------------------------------------

  describe('createNotification', () => {
    let findOneStub: sinon.SinonStub;
    let saveStub: sinon.SinonStub;

    beforeEach(() => {
      findOneStub = sandbox.stub(NotificationEntity, 'findOne');
      saveStub = sandbox.stub(NotificationEntity.prototype, 'save');
    });

    it('should create a notification when no duplicate exists', async () => {
      const accountId = uuidv4();
      const calendarId = uuidv4();
      const actorUrl = 'https://example.com/actor';

      findOneStub.resolves(null);
      saveStub.resolves();

      const result = await service.createNotification(
        'follow', calendarId, null, 'Alice', actorUrl, accountId,
      );

      expect(findOneStub.calledOnce).toBe(true);
      expect(saveStub.calledOnce).toBe(true);
      expect(result).toBeInstanceOf(Notification);
      expect(result!.type).toBe('follow');
      expect(result!.calendarId).toBe(calendarId);
      expect(result!.actorName).toBe('Alice');
      expect(result!.actorUrl).toBe(actorUrl);
      expect(result!.seen).toBe(false);
    });

    it('should sanitize actor_name before saving', async () => {
      const accountId = uuidv4();
      const calendarId = uuidv4();

      findOneStub.resolves(null);
      saveStub.resolves();

      const result = await service.createNotification(
        'follow', calendarId, null, '<b>Attacker</b>', null, accountId,
      );

      expect(result).not.toBeNull();
      expect(result!.actorName).toBe('Attacker');
    });

    it('should return null and skip save when a duplicate exists within 10 minutes', async () => {
      const accountId = uuidv4();
      const calendarId = uuidv4();
      const actorUrl = 'https://example.com/actor';

      // Simulate a pre-existing duplicate entity
      const existingEntity = NotificationEntity.build({
        id: uuidv4(),
        account_id: accountId,
        type: 'follow',
        calendar_id: calendarId,
        actor_name: 'Alice',
        actor_url: actorUrl,
        seen: false,
      });
      findOneStub.resolves(existingEntity);

      const result = await service.createNotification(
        'follow', calendarId, null, 'Alice', actorUrl, accountId,
      );

      expect(result).toBeNull();
      expect(saveStub.called).toBe(false);
    });

    it('should pass dedup query with correct fields (type, actor_url, calendar_id)', async () => {
      const accountId = uuidv4();
      const calendarId = uuidv4();
      const actorUrl = 'https://example.com/actor';

      findOneStub.resolves(null);
      saveStub.resolves();

      await service.createNotification('repost', calendarId, uuidv4(), 'Bob', actorUrl, accountId);

      const callArgs = findOneStub.firstCall.args[0];
      expect(callArgs.where.type).toBe('repost');
      expect(callArgs.where.actor_url).toBe(actorUrl);
      expect(callArgs.where.calendar_id).toBe(calendarId);
      // created_at must have an Op.gte filter (dedup window)
      expect(callArgs.where.created_at).toBeDefined();
    });

    it('should store eventId for repost notifications', async () => {
      const accountId = uuidv4();
      const calendarId = uuidv4();
      const eventId = uuidv4();

      findOneStub.resolves(null);
      saveStub.resolves();

      const result = await service.createNotification(
        'repost', calendarId, eventId, 'Bob', null, accountId,
      );

      expect(result).not.toBeNull();
      expect(result!.eventId).toBe(eventId);
    });

    it('should allow a duplicate after the 10-minute window has elapsed', async () => {
      const accountId = uuidv4();
      const calendarId = uuidv4();
      const actorUrl = 'https://example.com/actor';

      // No duplicate found (the old one is outside the window)
      findOneStub.resolves(null);
      saveStub.resolves();

      const result = await service.createNotification(
        'follow', calendarId, null, 'Alice', actorUrl, accountId,
      );

      expect(result).not.toBeNull();
      expect(saveStub.calledOnce).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // getNotificationsForAccount
  // ---------------------------------------------------------------------------

  describe('getNotificationsForAccount', () => {
    let findAllStub: sinon.SinonStub;

    beforeEach(() => {
      findAllStub = sandbox.stub(NotificationEntity, 'findAll');
    });

    it('should return notifications ordered by created_at DESC', async () => {
      const accountId = uuidv4();
      const calendarId = uuidv4();

      const older = new Notification(uuidv4());
      older.type = 'follow';
      older.calendarId = calendarId;
      older.actorName = 'Alice';
      older.createdAt = new Date('2026-01-01T00:00:00Z');

      const newer = new Notification(uuidv4());
      newer.type = 'repost';
      newer.calendarId = calendarId;
      newer.actorName = 'Bob';
      newer.createdAt = new Date('2026-01-02T00:00:00Z');

      const olderEntity = NotificationEntity.fromModel(older, accountId);
      const newerEntity = NotificationEntity.fromModel(newer, accountId);
      (olderEntity as any).created_at = older.createdAt;
      (newerEntity as any).created_at = newer.createdAt;

      // findAll returns them in order (service trusts DB ordering)
      findAllStub.resolves([newerEntity, olderEntity]);

      const results = await service.getNotificationsForAccount(accountId);

      expect(results).toHaveLength(2);
      expect(results[0].actorName).toBe('Bob');
      expect(results[1].actorName).toBe('Alice');
    });

    it('should use default limit of 50 when not specified', async () => {
      const accountId = uuidv4();
      findAllStub.resolves([]);

      await service.getNotificationsForAccount(accountId);

      const callArgs = findAllStub.firstCall.args[0];
      expect(callArgs.limit).toBe(50);
    });

    it('should use the provided limit when within bounds', async () => {
      const accountId = uuidv4();
      findAllStub.resolves([]);

      await service.getNotificationsForAccount(accountId, 10);

      const callArgs = findAllStub.firstCall.args[0];
      expect(callArgs.limit).toBe(10);
    });

    it('should cap limit at 100', async () => {
      const accountId = uuidv4();
      findAllStub.resolves([]);

      await service.getNotificationsForAccount(accountId, 200);

      const callArgs = findAllStub.firstCall.args[0];
      expect(callArgs.limit).toBe(100);
    });

    it('should filter by account_id', async () => {
      const accountId = uuidv4();
      findAllStub.resolves([]);

      await service.getNotificationsForAccount(accountId);

      const callArgs = findAllStub.firstCall.args[0];
      expect(callArgs.where.account_id).toBe(accountId);
    });

    it('should return empty array when no notifications exist', async () => {
      findAllStub.resolves([]);

      const results = await service.getNotificationsForAccount(uuidv4());

      expect(results).toEqual([]);
    });

    it('should return Notification domain model instances', async () => {
      const accountId = uuidv4();
      const notification = new Notification(uuidv4());
      notification.type = 'follow';
      notification.calendarId = uuidv4();
      notification.actorName = 'Alice';
      const entity = NotificationEntity.fromModel(notification, accountId);

      findAllStub.resolves([entity]);

      const results = await service.getNotificationsForAccount(accountId);

      expect(results[0]).toBeInstanceOf(Notification);
    });

    it('should default offset to 0 when not specified', async () => {
      const accountId = uuidv4();
      findAllStub.resolves([]);

      await service.getNotificationsForAccount(accountId);

      const callArgs = findAllStub.firstCall.args[0];
      expect(callArgs.offset).toBe(0);
    });

    it('should pass offset to findAll when provided', async () => {
      const accountId = uuidv4();
      findAllStub.resolves([]);

      await service.getNotificationsForAccount(accountId, 50, 100);

      const callArgs = findAllStub.firstCall.args[0];
      expect(callArgs.offset).toBe(100);
    });

    it('should clamp negative offset to 0', async () => {
      const accountId = uuidv4();
      findAllStub.resolves([]);

      await service.getNotificationsForAccount(accountId, 50, -10);

      const callArgs = findAllStub.firstCall.args[0];
      expect(callArgs.offset).toBe(0);
    });

    it('should cap offset at 10000', async () => {
      const accountId = uuidv4();
      findAllStub.resolves([]);

      await service.getNotificationsForAccount(accountId, 50, 99999);

      const callArgs = findAllStub.firstCall.args[0];
      expect(callArgs.offset).toBe(10000);
    });
  });

  // ---------------------------------------------------------------------------
  // markAllSeenForAccount
  // ---------------------------------------------------------------------------

  describe('markAllSeenForAccount', () => {
    let updateStub: sinon.SinonStub;

    beforeEach(() => {
      updateStub = sandbox.stub(NotificationEntity, 'update');
    });

    it('should mark all unseen notifications as seen for the specified account', async () => {
      const accountId = uuidv4();
      updateStub.resolves([3]);

      await service.markAllSeenForAccount(accountId);

      expect(updateStub.calledOnce).toBe(true);
      const [values, options] = updateStub.firstCall.args;
      expect(values.seen).toBe(true);
      expect(options.where.account_id).toBe(accountId);
      expect(options.where.seen).toBe(false);
    });

    it('should not affect notifications belonging to other accounts', async () => {
      const accountId = uuidv4();
      updateStub.resolves([0]);

      await service.markAllSeenForAccount(accountId);

      const [, options] = updateStub.firstCall.args;
      // The WHERE clause must scope to the specific account
      expect(options.where.account_id).toBe(accountId);
    });

    it('should complete without error when there are no unseen notifications', async () => {
      updateStub.resolves([0]);

      await expect(service.markAllSeenForAccount(uuidv4())).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // deleteOldNotifications
  // ---------------------------------------------------------------------------

  describe('deleteOldNotifications', () => {
    let destroyStub: sinon.SinonStub;

    beforeEach(() => {
      destroyStub = sandbox.stub(NotificationEntity, 'destroy');
    });

    it('should call destroy twice', async () => {
      destroyStub.resolves(0);

      await service.deleteOldNotifications();

      expect(destroyStub.callCount).toBe(2);
    });

    it('should delete seen notifications older than 7 days on the first pass', async () => {
      destroyStub.resolves(0);

      const before = Date.now();
      await service.deleteOldNotifications();
      const after = Date.now();

      const firstCallArgs = destroyStub.firstCall.args[0];
      expect(firstCallArgs.where.seen).toBe(true);

      // Verify the cutoff date is approximately 7 days ago
      const cutoff: Date = firstCallArgs.where.created_at[Object.getOwnPropertySymbols(firstCallArgs.where.created_at)[0]];
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(cutoff.getTime()).toBeLessThanOrEqual(before - sevenDaysMs);
      expect(cutoff.getTime()).toBeGreaterThanOrEqual(after - sevenDaysMs - 1000); // 1s tolerance
    });

    it('should delete all notifications older than 90 days on the second pass', async () => {
      destroyStub.resolves(0);

      const before = Date.now();
      await service.deleteOldNotifications();
      const after = Date.now();

      const secondCallArgs = destroyStub.secondCall.args[0];
      // No 'seen' filter on the second pass
      expect(secondCallArgs.where.seen).toBeUndefined();

      // Verify the cutoff date is approximately 90 days ago
      const cutoff: Date = secondCallArgs.where.created_at[Object.getOwnPropertySymbols(secondCallArgs.where.created_at)[0]];
      const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
      expect(cutoff.getTime()).toBeLessThanOrEqual(before - ninetyDaysMs);
      expect(cutoff.getTime()).toBeGreaterThanOrEqual(after - ninetyDaysMs - 1000); // 1s tolerance
    });

    it('should complete without error when there are no old notifications', async () => {
      destroyStub.resolves(0);

      await expect(service.deleteOldNotifications()).resolves.toBeUndefined();
    });
  });
});
