import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { Notification } from '@/common/model/notification';
import { NotificationEntity } from '@/server/notifications/entity/notification';

describe('NotificationEntity', () => {

  describe('fromModel', () => {
    it('should create entity from a follow notification model', () => {
      const id = uuidv4();
      const accountId = uuidv4();
      const calendarId = uuidv4();

      const notification = new Notification(id);
      notification.type = 'follow';
      notification.calendarId = calendarId;
      notification.eventId = null;
      notification.actorName = 'Follower Name';
      notification.actorUrl = 'https://example.com/follower';
      notification.seen = false;

      const entity = NotificationEntity.fromModel(notification, accountId);

      expect(entity.id).toBe(id);
      expect(entity.account_id).toBe(accountId);
      expect(entity.type).toBe('follow');
      expect(entity.calendar_id).toBe(calendarId);
      expect(entity.event_id).toBeNull();
      expect(entity.actor_name).toBe('Follower Name');
      expect(entity.actor_url).toBe('https://example.com/follower');
      expect(entity.seen).toBe(false);
    });

    it('should create entity from a repost notification model', () => {
      const id = uuidv4();
      const accountId = uuidv4();
      const calendarId = uuidv4();
      const eventId = uuidv4();

      const notification = new Notification(id);
      notification.type = 'repost';
      notification.calendarId = calendarId;
      notification.eventId = eventId;
      notification.actorName = 'Reposter Name';
      notification.actorUrl = null;
      notification.seen = false;

      const entity = NotificationEntity.fromModel(notification, accountId);

      expect(entity.id).toBe(id);
      expect(entity.account_id).toBe(accountId);
      expect(entity.type).toBe('repost');
      expect(entity.calendar_id).toBe(calendarId);
      expect(entity.event_id).toBe(eventId);
      expect(entity.actor_name).toBe('Reposter Name');
      expect(entity.actor_url).toBeNull();
      expect(entity.seen).toBe(false);
    });

    it('should map null actorUrl to null actor_url', () => {
      const notification = new Notification(uuidv4());
      notification.type = 'follow';
      notification.calendarId = uuidv4();
      notification.actorName = 'Actor';
      notification.actorUrl = null;

      const entity = NotificationEntity.fromModel(notification, uuidv4());

      expect(entity.actor_url).toBeNull();
    });
  });

  describe('toModel', () => {
    it('should convert a follow notification entity to model', () => {
      const id = uuidv4();
      const accountId = uuidv4();
      const calendarId = uuidv4();
      const createdAt = new Date('2026-02-28T12:00:00.000Z');

      const notification = new Notification(id);
      notification.type = 'follow';
      notification.calendarId = calendarId;
      notification.eventId = null;
      notification.actorName = 'Follower Name';
      notification.actorUrl = 'https://example.com/follower';
      notification.seen = false;
      notification.createdAt = createdAt;

      const entity = NotificationEntity.fromModel(notification, accountId);
      // Simulate db-assigned createdAt
      (entity as any).created_at = createdAt;

      const model = entity.toModel();

      expect(model).toBeInstanceOf(Notification);
      expect(model.id).toBe(id);
      expect(model.type).toBe('follow');
      expect(model.calendarId).toBe(calendarId);
      expect(model.eventId).toBeNull();
      expect(model.actorName).toBe('Follower Name');
      expect(model.actorUrl).toBe('https://example.com/follower');
      expect(model.seen).toBe(false);
    });

    it('should convert a repost notification entity to model', () => {
      const id = uuidv4();
      const accountId = uuidv4();
      const calendarId = uuidv4();
      const eventId = uuidv4();

      const notification = new Notification(id);
      notification.type = 'repost';
      notification.calendarId = calendarId;
      notification.eventId = eventId;
      notification.actorName = 'Reposter Name';
      notification.actorUrl = null;
      notification.seen = true;

      const entity = NotificationEntity.fromModel(notification, accountId);
      const model = entity.toModel();

      expect(model).toBeInstanceOf(Notification);
      expect(model.id).toBe(id);
      expect(model.type).toBe('repost');
      expect(model.calendarId).toBe(calendarId);
      expect(model.eventId).toBe(eventId);
      expect(model.actorName).toBe('Reposter Name');
      expect(model.actorUrl).toBeNull();
      expect(model.seen).toBe(true);
    });

    it('should not expose account_id in the returned model', () => {
      const notification = new Notification(uuidv4());
      notification.type = 'follow';
      notification.calendarId = uuidv4();
      notification.actorName = 'Actor';

      const entity = NotificationEntity.fromModel(notification, uuidv4());
      const model = entity.toModel();

      expect((model as any).account_id).toBeUndefined();
      expect((model as any).accountId).toBeUndefined();
    });
  });

  describe('round-trip conversion', () => {
    it('should maintain data integrity for a follow notification through model-entity-model', () => {
      const id = uuidv4();
      const accountId = uuidv4();
      const calendarId = uuidv4();

      const original = new Notification(id);
      original.type = 'follow';
      original.calendarId = calendarId;
      original.eventId = null;
      original.actorName = 'Test Follower';
      original.actorUrl = 'https://example.com/actor';
      original.seen = false;

      const entity = NotificationEntity.fromModel(original, accountId);
      const roundTrip = entity.toModel();

      expect(roundTrip.id).toBe(original.id);
      expect(roundTrip.type).toBe(original.type);
      expect(roundTrip.calendarId).toBe(original.calendarId);
      expect(roundTrip.eventId).toBe(original.eventId);
      expect(roundTrip.actorName).toBe(original.actorName);
      expect(roundTrip.actorUrl).toBe(original.actorUrl);
      expect(roundTrip.seen).toBe(original.seen);
    });

    it('should maintain data integrity for a repost notification through model-entity-model', () => {
      const id = uuidv4();
      const accountId = uuidv4();
      const calendarId = uuidv4();
      const eventId = uuidv4();

      const original = new Notification(id);
      original.type = 'repost';
      original.calendarId = calendarId;
      original.eventId = eventId;
      original.actorName = 'Test Reposter';
      original.actorUrl = null;
      original.seen = true;

      const entity = NotificationEntity.fromModel(original, accountId);
      const roundTrip = entity.toModel();

      expect(roundTrip.id).toBe(original.id);
      expect(roundTrip.type).toBe(original.type);
      expect(roundTrip.calendarId).toBe(original.calendarId);
      expect(roundTrip.eventId).toBe(original.eventId);
      expect(roundTrip.actorName).toBe(original.actorName);
      expect(roundTrip.actorUrl).toBeNull();
      expect(roundTrip.seen).toBe(original.seen);
    });
  });
});
