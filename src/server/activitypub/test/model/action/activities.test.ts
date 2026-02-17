import { describe, it, expect } from 'vitest';
import CreateActivity from '@/server/activitypub/model/action/create';
import DeleteActivity from '@/server/activitypub/model/action/delete';
import UpdateActivity from '@/server/activitypub/model/action/update';
import AnnounceActivity from '@/server/activitypub/model/action/announce';
import FollowActivity from '@/server/activitypub/model/action/follow';
import AcceptActivity from '@/server/activitypub/model/action/accept';
import UndoActivity from '@/server/activitypub/model/action/undo';

describe('Activity Model fromObject Null Checks', () => {

  describe('CreateActivity', () => {
    it('should return null for null input', () => {
      const result = CreateActivity.fromObject(null as any);
      expect(result).toBeNull();
    });

    it('should return null for undefined input', () => {
      const result = CreateActivity.fromObject(undefined as any);
      expect(result).toBeNull();
    });

    it('should return null for non-object input', () => {
      expect(CreateActivity.fromObject('string' as any)).toBeNull();
      expect(CreateActivity.fromObject(123 as any)).toBeNull();
      expect(CreateActivity.fromObject(true as any)).toBeNull();
    });

    it('should return null when actor is missing', () => {
      const result = CreateActivity.fromObject({
        object: { id: 'https://example.com/event/123', type: 'Event' },
      });
      expect(result).toBeNull();
    });

    it('should return null when actor is not a string', () => {
      const result = CreateActivity.fromObject({
        actor: 123,
        object: { id: 'https://example.com/event/123', type: 'Event' },
      });
      expect(result).toBeNull();
    });

    it('should return null when object is missing', () => {
      const result = CreateActivity.fromObject({
        actor: 'https://example.com/users/1',
      });
      expect(result).toBeNull();
    });

    it('should create activity with valid input', () => {
      const result = CreateActivity.fromObject({
        actor: 'https://example.com/users/1',
        object: { id: 'https://example.com/event/123', type: 'Event' },
        id: 'https://example.com/activities/create/1',
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: ['https://example.com/users/1/followers'],
      });
      expect(result).not.toBeNull();
      expect(result?.type).toBe('Create');
      expect(result?.actor).toBe('https://example.com/users/1');
      expect(result?.id).toBe('https://example.com/activities/create/1');
      expect(result?.to).toEqual(['https://www.w3.org/ns/activitystreams#Public']);
      expect(result?.cc).toEqual(['https://example.com/users/1/followers']);
    });

    it('should create activity without optional fields', () => {
      const result = CreateActivity.fromObject({
        actor: 'https://example.com/users/1',
        object: { id: 'https://example.com/event/123', type: 'Event' },
      });
      expect(result).not.toBeNull();
      expect(result?.type).toBe('Create');
      expect(result?.actor).toBe('https://example.com/users/1');
    });
  });

  describe('DeleteActivity', () => {
    it('should return null for null input', () => {
      const result = DeleteActivity.fromObject(null as any);
      expect(result).toBeNull();
    });

    it('should return null for undefined input', () => {
      const result = DeleteActivity.fromObject(undefined as any);
      expect(result).toBeNull();
    });

    it('should return null for non-object input', () => {
      expect(DeleteActivity.fromObject('string' as any)).toBeNull();
      expect(DeleteActivity.fromObject(123 as any)).toBeNull();
    });

    it('should return null when actor is missing', () => {
      const result = DeleteActivity.fromObject({
        object: 'https://example.com/event/123',
      });
      expect(result).toBeNull();
    });

    it('should return null when actor is not a string', () => {
      const result = DeleteActivity.fromObject({
        actor: { id: 'https://example.com/users/1' },
        object: 'https://example.com/event/123',
      });
      expect(result).toBeNull();
    });

    it('should return null when object is missing', () => {
      const result = DeleteActivity.fromObject({
        actor: 'https://example.com/users/1',
      });
      expect(result).toBeNull();
    });

    it('should return null when object is not a string and has no id', () => {
      const result = DeleteActivity.fromObject({
        actor: 'https://example.com/users/1',
        object: { type: 'Event' }, // object with no id field
      });
      expect(result).toBeNull();
    });

    it('should create activity with valid string object', () => {
      const result = DeleteActivity.fromObject({
        actor: 'https://example.com/users/1',
        object: 'https://example.com/event/123',
        id: 'https://example.com/activities/delete/1',
      });
      expect(result).not.toBeNull();
      expect(result?.type).toBe('Delete');
      expect(result?.actor).toBe('https://example.com/users/1');
      expect(result?.object).toBe('https://example.com/event/123');
      expect(result?.id).toBe('https://example.com/activities/delete/1');
    });

    it('should create activity with Tombstone object (cross-instance editor delete)', () => {
      const tombstone = {
        type: 'Tombstone',
        id: 'https://example.com/event/123',
        formerType: 'Event',
        eventId: 'abc-123',
      };
      const result = DeleteActivity.fromObject({
        actor: 'https://example.com/users/1',
        object: tombstone,
        id: 'https://example.com/activities/delete/1',
      });
      expect(result).not.toBeNull();
      expect(result?.type).toBe('Delete');
      expect(result?.actor).toBe('https://example.com/users/1');
      expect(result?.object).toEqual(tombstone);
      expect(result?.id).toBe('https://example.com/activities/delete/1');
    });
  });

  describe('UpdateActivity', () => {
    it('should return null for null input', () => {
      const result = UpdateActivity.fromObject(null as any);
      expect(result).toBeNull();
    });

    it('should return null for undefined input', () => {
      const result = UpdateActivity.fromObject(undefined as any);
      expect(result).toBeNull();
    });

    it('should return null for non-object input', () => {
      expect(UpdateActivity.fromObject('string' as any)).toBeNull();
      expect(UpdateActivity.fromObject(123 as any)).toBeNull();
    });

    it('should return null when actor is missing', () => {
      const result = UpdateActivity.fromObject({
        object: { id: 'https://example.com/event/123', type: 'Event' },
      });
      expect(result).toBeNull();
    });

    it('should return null when actor is not a string', () => {
      const result = UpdateActivity.fromObject({
        actor: 123,
        object: { id: 'https://example.com/event/123', type: 'Event' },
      });
      expect(result).toBeNull();
    });

    it('should return null when object is missing', () => {
      const result = UpdateActivity.fromObject({
        actor: 'https://example.com/users/1',
      });
      expect(result).toBeNull();
    });

    it('should create activity with valid input', () => {
      const result = UpdateActivity.fromObject({
        actor: 'https://example.com/users/1',
        object: { id: 'https://example.com/event/123', type: 'Event' },
        id: 'https://example.com/activities/update/1',
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: ['https://example.com/users/1/followers'],
      });
      expect(result).not.toBeNull();
      expect(result?.type).toBe('Update');
      expect(result?.actor).toBe('https://example.com/users/1');
      expect(result?.id).toBe('https://example.com/activities/update/1');
      expect(result?.to).toEqual(['https://www.w3.org/ns/activitystreams#Public']);
      expect(result?.cc).toEqual(['https://example.com/users/1/followers']);
    });
  });

  describe('AnnounceActivity', () => {
    it('should return null for null input', () => {
      const result = AnnounceActivity.fromObject(null as any);
      expect(result).toBeNull();
    });

    it('should return null for undefined input', () => {
      const result = AnnounceActivity.fromObject(undefined as any);
      expect(result).toBeNull();
    });

    it('should return null for non-object input', () => {
      expect(AnnounceActivity.fromObject('string' as any)).toBeNull();
      expect(AnnounceActivity.fromObject(123 as any)).toBeNull();
    });

    it('should return null when actor is missing', () => {
      const result = AnnounceActivity.fromObject({
        object: 'https://example.com/event/123',
      });
      expect(result).toBeNull();
    });

    it('should return null when actor is not a string', () => {
      const result = AnnounceActivity.fromObject({
        actor: { id: 'https://example.com/users/1' },
        object: 'https://example.com/event/123',
      });
      expect(result).toBeNull();
    });

    it('should return null when object is missing', () => {
      const result = AnnounceActivity.fromObject({
        actor: 'https://example.com/users/1',
      });
      expect(result).toBeNull();
    });

    it('should return null when object is not a string', () => {
      const result = AnnounceActivity.fromObject({
        actor: 'https://example.com/users/1',
        object: { id: 'https://example.com/event/123' },
      });
      expect(result).toBeNull();
    });

    it('should create activity with valid input', () => {
      const result = AnnounceActivity.fromObject({
        actor: 'https://example.com/users/1',
        object: 'https://example.com/event/123',
        id: 'https://example.com/activities/announce/1',
      });
      expect(result).not.toBeNull();
      expect(result?.type).toBe('Announce');
      expect(result?.actor).toBe('https://example.com/users/1');
      expect(result?.object).toBe('https://example.com/event/123');
      expect(result?.id).toBe('https://example.com/activities/announce/1');
    });
  });

  describe('FollowActivity', () => {
    it('should return null for null input', () => {
      const result = FollowActivity.fromObject(null as any);
      expect(result).toBeNull();
    });

    it('should return null for undefined input', () => {
      const result = FollowActivity.fromObject(undefined as any);
      expect(result).toBeNull();
    });

    it('should return null for non-object input', () => {
      expect(FollowActivity.fromObject('string' as any)).toBeNull();
      expect(FollowActivity.fromObject(123 as any)).toBeNull();
    });

    it('should return null when actor is missing', () => {
      const result = FollowActivity.fromObject({
        object: 'https://example.com/users/2',
      });
      expect(result).toBeNull();
    });

    it('should return null when actor is not a string', () => {
      const result = FollowActivity.fromObject({
        actor: { id: 'https://example.com/users/1' },
        object: 'https://example.com/users/2',
      });
      expect(result).toBeNull();
    });

    it('should return null when object is missing', () => {
      const result = FollowActivity.fromObject({
        actor: 'https://example.com/users/1',
      });
      expect(result).toBeNull();
    });

    it('should return null when object is not a string', () => {
      const result = FollowActivity.fromObject({
        actor: 'https://example.com/users/1',
        object: { id: 'https://example.com/users/2' },
      });
      expect(result).toBeNull();
    });

    it('should create activity with valid input', () => {
      const result = FollowActivity.fromObject({
        actor: 'https://example.com/users/1',
        object: 'https://example.com/users/2',
        id: 'https://example.com/activities/follow/1',
      });
      expect(result).not.toBeNull();
      expect(result?.type).toBe('Follow');
      expect(result?.actor).toBe('https://example.com/users/1');
      expect(result?.object).toBe('https://example.com/users/2');
      expect(result?.id).toBe('https://example.com/activities/follow/1');
    });
  });

  describe('AcceptActivity', () => {
    it('should return null for null input', () => {
      const result = AcceptActivity.fromObject(null as any);
      expect(result).toBeNull();
    });

    it('should return null for undefined input', () => {
      const result = AcceptActivity.fromObject(undefined as any);
      expect(result).toBeNull();
    });

    it('should return null for non-object input', () => {
      expect(AcceptActivity.fromObject('string' as any)).toBeNull();
      expect(AcceptActivity.fromObject(123 as any)).toBeNull();
    });

    it('should return null when actor is missing', () => {
      const result = AcceptActivity.fromObject({
        object: { type: 'Follow', actor: 'https://example.com/users/2' },
      });
      expect(result).toBeNull();
    });

    it('should return null when actor is not a string', () => {
      const result = AcceptActivity.fromObject({
        actor: { id: 'https://example.com/users/1' },
        object: { type: 'Follow', actor: 'https://example.com/users/2' },
      });
      expect(result).toBeNull();
    });

    it('should return null when object is missing', () => {
      const result = AcceptActivity.fromObject({
        actor: 'https://example.com/users/1',
      });
      expect(result).toBeNull();
    });

    it('should create activity with valid input', () => {
      const result = AcceptActivity.fromObject({
        actor: 'https://example.com/users/1',
        object: { type: 'Follow', actor: 'https://example.com/users/2', object: 'https://example.com/users/1' },
        id: 'https://example.com/activities/accept/1',
      });
      expect(result).not.toBeNull();
      expect(result?.type).toBe('Accept');
      expect(result?.actor).toBe('https://example.com/users/1');
      expect(result?.id).toBe('https://example.com/activities/accept/1');
    });

    it('should properly serialize nested FollowActivity with @context', () => {
      // Create a FollowActivity
      const followActivity = new FollowActivity(
        'https://beta.example.com/calendars/bx_6ztiy',
        'https://alpha.example.com/calendars/ax_5eggn',
      );

      // Create an AcceptActivity with the FollowActivity as the object
      const acceptActivity = new AcceptActivity(
        'https://alpha.example.com/calendars/ax_5eggn',
        followActivity,
      );

      // Serialize to object
      const serialized = acceptActivity.toObject();

      // Verify Accept has @context
      expect(serialized).toHaveProperty('@context');
      expect(serialized['@context']).toEqual(['https://www.w3.org/ns/activitystreams']);

      // Verify the nested Follow object also has @context, not context
      expect(serialized.object).toHaveProperty('@context');
      expect(serialized.object['@context']).toEqual(['https://www.w3.org/ns/activitystreams']);

      // Verify context property does NOT exist on nested object
      expect(serialized.object).not.toHaveProperty('context');

      // Verify the nested Follow has correct structure
      expect(serialized.object.type).toBe('Follow');
      expect(serialized.object.actor).toBe('https://beta.example.com/calendars/bx_6ztiy');
      expect(serialized.object.object).toBe('https://alpha.example.com/calendars/ax_5eggn');
    });
  });

  describe('UndoActivity', () => {
    it('should return null for null input', () => {
      const result = UndoActivity.fromObject(null as any);
      expect(result).toBeNull();
    });

    it('should return null for undefined input', () => {
      const result = UndoActivity.fromObject(undefined as any);
      expect(result).toBeNull();
    });

    it('should return null for non-object input', () => {
      expect(UndoActivity.fromObject('string' as any)).toBeNull();
      expect(UndoActivity.fromObject(123 as any)).toBeNull();
    });

    it('should return null when actor is missing', () => {
      const result = UndoActivity.fromObject({
        object: 'https://example.com/activities/follow/1',
      });
      expect(result).toBeNull();
    });

    it('should return null when actor is not a string', () => {
      const result = UndoActivity.fromObject({
        actor: { id: 'https://example.com/users/1' },
        object: 'https://example.com/activities/follow/1',
      });
      expect(result).toBeNull();
    });

    it('should return null when object is missing', () => {
      const result = UndoActivity.fromObject({
        actor: 'https://example.com/users/1',
      });
      expect(result).toBeNull();
    });

    it('should return null when object is not a string', () => {
      const result = UndoActivity.fromObject({
        actor: 'https://example.com/users/1',
        object: { id: 'https://example.com/activities/follow/1' },
      });
      expect(result).toBeNull();
    });

    it('should create activity with valid input', () => {
      const result = UndoActivity.fromObject({
        actor: 'https://example.com/users/1',
        object: 'https://example.com/activities/follow/1',
        id: 'https://example.com/activities/undo/1',
        to: ['https://example.com/users/2'],
      });
      expect(result).not.toBeNull();
      expect(result?.type).toBe('Undo');
      expect(result?.actor).toBe('https://example.com/users/1');
      expect(result?.object).toBe('https://example.com/activities/follow/1');
      expect(result?.id).toBe('https://example.com/activities/undo/1');
      expect(result?.to).toEqual(['https://example.com/users/2']);
    });

    it('should handle missing to field', () => {
      const result = UndoActivity.fromObject({
        actor: 'https://example.com/users/1',
        object: 'https://example.com/activities/follow/1',
      });
      expect(result).not.toBeNull();
      expect(result?.type).toBe('Undo');
      // The base class initializes 'to' as an empty array
      expect(result?.to).toEqual([]);
    });
  });
});
