/**
 * Tests for the ActivityPub activity builders.
 */

import { describe, it, expect } from 'vitest';
import {
  createMockFollowActivity,
  createMockCreateActivity,
  createMockUpdateActivity,
  createMockDeleteActivity,
  createMockAnnounceActivity,
  createMockUndoActivity,
  createMockAcceptActivity,
} from './activity-builders';

describe('Mock Activity Helpers', () => {
  describe('createMockFollowActivity', () => {
    it('should create a valid Follow activity', () => {
      const activity = createMockFollowActivity(
        'https://local/users/alice',
        'https://remote/calendars/events',
      );

      expect(activity.type).toBe('Follow');
      expect(activity.actor).toBe('https://local/users/alice');
      expect(activity.object).toBe('https://remote/calendars/events');
      expect(activity['@context']).toBe('https://www.w3.org/ns/activitystreams');
      expect(activity.id).toContain('https://local/users/alice/activities/');
    });
  });

  describe('createMockCreateActivity', () => {
    it('should create a valid Create activity', () => {
      const eventObject = { type: 'Event', name: 'Test Event' };
      const activity = createMockCreateActivity('https://local/users/alice', eventObject);

      expect(activity.type).toBe('Create');
      expect(activity.actor).toBe('https://local/users/alice');
      expect(activity.object).toEqual(eventObject);
      expect(activity.published).toBeDefined();
    });
  });

  describe('createMockUpdateActivity', () => {
    it('should create a valid Update activity', () => {
      const eventObject = { type: 'Event', name: 'Updated Event' };
      const activity = createMockUpdateActivity('https://local/users/alice', eventObject);

      expect(activity.type).toBe('Update');
      expect(activity.actor).toBe('https://local/users/alice');
      expect(activity.object).toEqual(eventObject);
    });
  });

  describe('createMockDeleteActivity', () => {
    it('should create a valid Delete activity with string object', () => {
      const activity = createMockDeleteActivity(
        'https://local/users/alice',
        'https://local/events/123',
      );

      expect(activity.type).toBe('Delete');
      expect(activity.object).toBe('https://local/events/123');
    });

    it('should create a valid Delete activity with object', () => {
      const eventObject = { type: 'Event', id: 'https://local/events/123' };
      const activity = createMockDeleteActivity('https://local/users/alice', eventObject);

      expect(activity.type).toBe('Delete');
      expect(activity.object).toEqual(eventObject);
    });
  });

  describe('createMockAnnounceActivity', () => {
    it('should create a valid Announce activity', () => {
      const activity = createMockAnnounceActivity(
        'https://local/users/alice',
        'https://remote/events/456',
      );

      expect(activity.type).toBe('Announce');
      expect(activity.actor).toBe('https://local/users/alice');
      expect(activity.object).toBe('https://remote/events/456');
    });
  });

  describe('createMockUndoActivity', () => {
    it('should create a valid Undo activity', () => {
      const originalFollow = createMockFollowActivity(
        'https://local/users/alice',
        'https://remote/calendars/events',
      );
      const activity = createMockUndoActivity('https://local/users/alice', originalFollow);

      expect(activity.type).toBe('Undo');
      expect(activity.actor).toBe('https://local/users/alice');
      expect(activity.object).toEqual(originalFollow);
    });
  });

  describe('createMockAcceptActivity', () => {
    it('should create a valid Accept activity', () => {
      const originalFollow = createMockFollowActivity(
        'https://remote/users/bob',
        'https://local/calendars/events',
      );
      const activity = createMockAcceptActivity('https://local/users/alice', originalFollow);

      expect(activity.type).toBe('Accept');
      expect(activity.actor).toBe('https://local/users/alice');
      expect(activity.object).toEqual(originalFollow);
    });
  });
});
