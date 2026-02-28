import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { Notification } from '@/common/model/notification';

describe('Notification Model', () => {

  describe('constructor and properties', () => {
    it('should create instance with required properties', () => {
      const id = uuidv4();
      const notification = new Notification(id);

      expect(notification.id).toBe(id);
      expect(notification.type).toBe('');
      expect(notification.calendarId).toBe('');
      expect(notification.eventId).toBeNull();
      expect(notification.actorName).toBe('');
      expect(notification.actorUrl).toBeNull();
      expect(notification.seen).toBe(false);
      expect(notification.createdAt).toBeNull();
    });

    it('should allow setting all properties', () => {
      const id = uuidv4();
      const calendarId = uuidv4();
      const eventId = uuidv4();
      const createdAt = new Date();

      const notification = new Notification(id);
      notification.type = 'follow';
      notification.calendarId = calendarId;
      notification.eventId = eventId;
      notification.actorName = 'Test Actor';
      notification.actorUrl = 'https://example.com/actor';
      notification.seen = true;
      notification.createdAt = createdAt;

      expect(notification.type).toBe('follow');
      expect(notification.calendarId).toBe(calendarId);
      expect(notification.eventId).toBe(eventId);
      expect(notification.actorName).toBe('Test Actor');
      expect(notification.actorUrl).toBe('https://example.com/actor');
      expect(notification.seen).toBe(true);
      expect(notification.createdAt).toBe(createdAt);
    });
  });

  describe('toObject', () => {
    it('should return correct shape for a follow notification', () => {
      const id = uuidv4();
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

      const obj = notification.toObject();

      expect(obj).toEqual({
        id,
        type: 'follow',
        calendarId,
        eventId: null,
        actorName: 'Follower Name',
        actorUrl: 'https://example.com/follower',
        seen: false,
        createdAt,
      });
    });

    it('should return correct shape for a repost notification', () => {
      const id = uuidv4();
      const calendarId = uuidv4();
      const eventId = uuidv4();
      const createdAt = new Date('2026-02-28T12:00:00.000Z');

      const notification = new Notification(id);
      notification.type = 'repost';
      notification.calendarId = calendarId;
      notification.eventId = eventId;
      notification.actorName = 'Reposter Name';
      notification.actorUrl = null;
      notification.seen = true;
      notification.createdAt = createdAt;

      const obj = notification.toObject();

      expect(obj).toEqual({
        id,
        type: 'repost',
        calendarId,
        eventId,
        actorName: 'Reposter Name',
        actorUrl: null,
        seen: true,
        createdAt,
      });
    });

    it('should exclude account_id from the returned object', () => {
      const notification = new Notification(uuidv4());
      notification.type = 'follow';
      notification.calendarId = uuidv4();

      const obj = notification.toObject();

      expect(obj).not.toHaveProperty('account_id');
      expect(obj).not.toHaveProperty('accountId');
    });

    it('should handle null actorUrl', () => {
      const notification = new Notification(uuidv4());
      notification.actorUrl = null;

      const obj = notification.toObject();

      expect(obj.actorUrl).toBeNull();
    });
  });

  describe('fromObject', () => {
    it('should deserialize a follow notification object', () => {
      const id = uuidv4();
      const calendarId = uuidv4();
      const createdAt = new Date('2026-02-28T12:00:00.000Z');

      const obj = {
        id,
        type: 'follow',
        calendarId,
        eventId: null,
        actorName: 'Follower Name',
        actorUrl: 'https://example.com/follower',
        seen: false,
        createdAt,
      };

      const notification = Notification.fromObject(obj);

      expect(notification).toBeInstanceOf(Notification);
      expect(notification.id).toBe(id);
      expect(notification.type).toBe('follow');
      expect(notification.calendarId).toBe(calendarId);
      expect(notification.eventId).toBeNull();
      expect(notification.actorName).toBe('Follower Name');
      expect(notification.actorUrl).toBe('https://example.com/follower');
      expect(notification.seen).toBe(false);
      expect(notification.createdAt).toEqual(createdAt);
    });

    it('should deserialize a repost notification object', () => {
      const id = uuidv4();
      const calendarId = uuidv4();
      const eventId = uuidv4();
      const createdAt = new Date('2026-02-28T12:00:00.000Z');

      const obj = {
        id,
        type: 'repost',
        calendarId,
        eventId,
        actorName: 'Reposter Name',
        actorUrl: null,
        seen: true,
        createdAt,
      };

      const notification = Notification.fromObject(obj);

      expect(notification).toBeInstanceOf(Notification);
      expect(notification.id).toBe(id);
      expect(notification.type).toBe('repost');
      expect(notification.calendarId).toBe(calendarId);
      expect(notification.eventId).toBe(eventId);
      expect(notification.actorName).toBe('Reposter Name');
      expect(notification.actorUrl).toBeNull();
      expect(notification.seen).toBe(true);
    });

    it('should handle missing optional fields gracefully', () => {
      const id = uuidv4();
      const obj = {
        id,
        type: 'follow',
        calendarId: uuidv4(),
        actorName: 'Actor',
      };

      const notification = Notification.fromObject(obj);

      expect(notification.eventId).toBeNull();
      expect(notification.actorUrl).toBeNull();
      expect(notification.seen).toBe(false);
      expect(notification.createdAt).toBeNull();
    });
  });

  describe('toObject/fromObject round-trip', () => {
    it('should maintain data integrity for a follow notification', () => {
      const id = uuidv4();
      const calendarId = uuidv4();
      const createdAt = new Date('2026-02-28T12:00:00.000Z');

      const original = new Notification(id);
      original.type = 'follow';
      original.calendarId = calendarId;
      original.eventId = null;
      original.actorName = 'Test Actor';
      original.actorUrl = 'https://example.com/actor';
      original.seen = false;
      original.createdAt = createdAt;

      const roundTrip = Notification.fromObject(original.toObject());

      expect(roundTrip.id).toBe(original.id);
      expect(roundTrip.type).toBe(original.type);
      expect(roundTrip.calendarId).toBe(original.calendarId);
      expect(roundTrip.eventId).toBe(original.eventId);
      expect(roundTrip.actorName).toBe(original.actorName);
      expect(roundTrip.actorUrl).toBe(original.actorUrl);
      expect(roundTrip.seen).toBe(original.seen);
      expect(roundTrip.createdAt).toEqual(original.createdAt);
    });

    it('should maintain data integrity for a repost notification with eventId', () => {
      const id = uuidv4();
      const calendarId = uuidv4();
      const eventId = uuidv4();

      const original = new Notification(id);
      original.type = 'repost';
      original.calendarId = calendarId;
      original.eventId = eventId;
      original.actorName = 'Reposter';
      original.actorUrl = null;
      original.seen = true;
      original.createdAt = new Date();

      const roundTrip = Notification.fromObject(original.toObject());

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
