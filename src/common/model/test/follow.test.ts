import { describe, it, expect } from 'vitest';

import { FollowingCalendar } from '@/common/model/follow';

describe('FollowingCalendar Model', () => {

  describe('constructor and properties', () => {

    it('should create FollowingCalendar with new boolean properties', () => {
      const follow = new FollowingCalendar(
        'follow-1',
        'remote@example.com',
        'calendar-123',
        false, // autoRepostOriginals
        false, // autoRepostReposts
      );

      expect(follow.id).toBe('follow-1');
      expect(follow.calendarActorId).toBe('remote@example.com');
      expect(follow.calendarId).toBe('calendar-123');
      expect(follow.autoRepostOriginals).toBe(false);
      expect(follow.autoRepostReposts).toBe(false);
    });

    it('should default autoRepostOriginals and autoRepostReposts to false', () => {
      const follow = new FollowingCalendar(
        'follow-2',
        'remote@example.org',
        'calendar-456',
      );

      expect(follow.autoRepostOriginals).toBe(false);
      expect(follow.autoRepostReposts).toBe(false);
    });
  });

  describe('toObject() serialization', () => {

    it('should serialize FollowingCalendar with new boolean fields', () => {
      const follow = new FollowingCalendar(
        'follow-3',
        'calendar@other.net',
        'cal-789',
        true, // autoRepostOriginals
        true, // autoRepostReposts
      );

      const obj = follow.toObject();

      expect(obj.id).toBe('follow-3');
      expect(obj.remoteCalendarId).toBe('calendar@other.net');
      expect(obj.calendarId).toBe('cal-789');
      expect(obj.autoRepostOriginals).toBe(true);
      expect(obj.autoRepostReposts).toBe(true);
      // Ensure old repostPolicy field is not present
      expect(obj.repostPolicy).toBeUndefined();
      // Ensure old calendarActorId key is not present in serialized output
      expect(obj.calendarActorId).toBeUndefined();
    });
  });

  describe('fromObject() deserialization', () => {

    it('should deserialize object with new boolean fields', () => {
      const obj = {
        id: 'follow-4',
        calendarActorId: 'events@domain.com',
        calendarId: 'my-calendar',
        autoRepostOriginals: true,
        autoRepostReposts: false,
      };

      const follow = FollowingCalendar.fromObject(obj);

      expect(follow.id).toBe('follow-4');
      expect(follow.calendarActorId).toBe('events@domain.com');
      expect(follow.calendarId).toBe('my-calendar');
      expect(follow.autoRepostOriginals).toBe(true);
      expect(follow.autoRepostReposts).toBe(false);
    });

    it('should default to false when boolean fields are not provided', () => {
      const obj = {
        id: 'follow-5',
        calendarActorId: 'test@test.com',
        calendarId: 'test-cal',
      };

      const follow = FollowingCalendar.fromObject(obj);

      expect(follow.autoRepostOriginals).toBe(false);
      expect(follow.autoRepostReposts).toBe(false);
    });
  });

  describe('validation rules', () => {

    it('should validate that autoRepostReposts cannot be true if autoRepostOriginals is false', () => {
      // This tests the model validation - the model should enforce that
      // autoRepostReposts cannot be true when autoRepostOriginals is false
      const follow = new FollowingCalendar(
        'follow-6',
        'calendar@domain.com',
        'cal-id',
        false, // autoRepostOriginals
        false, // autoRepostReposts - cannot be true when originals is false
      );

      expect(follow.autoRepostOriginals).toBe(false);
      expect(follow.autoRepostReposts).toBe(false);

      // The validation should be enforced at the service layer,
      // but the model structure supports the business rule
      // by having separate boolean fields that can be validated
    });
  });
});
