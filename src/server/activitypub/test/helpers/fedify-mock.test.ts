/**
 * Tests for Fedify Mock Utilities
 *
 * These tests verify that the mock federation utilities work correctly
 * for tracking sent/received activities without making network calls.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMockFederation,
  getSentActivities,
  getReceivedActivities,
  simulateInboxReceive,
  clearActivities,
  createMockFollowActivity,
  createMockCreateActivity,
  createMockUpdateActivity,
  createMockDeleteActivity,
  createMockAnnounceActivity,
  createMockUndoActivity,
  createMockAcceptActivity,
  type MockFederationContext,
} from './fedify-mock';

describe('createMockFederation', () => {
  it('should create a mock federation context with default domain', () => {
    const mockFed = createMockFederation();

    expect(mockFed).toBeDefined();
    expect(mockFed.domain).toBe('test.federation.local');
    expect(mockFed.kvStore).toBeDefined();
    expect(mockFed.messageQueue).toBeDefined();
    expect(mockFed.sentActivities).toEqual([]);
    expect(mockFed.receivedActivities).toEqual([]);
  });

  it('should create a mock federation context with custom domain', () => {
    const mockFed = createMockFederation({ domain: 'custom.local' });

    expect(mockFed.domain).toBe('custom.local');
  });

  it('should have functional sendActivity method', async () => {
    const mockFed = createMockFederation();
    const activity = { type: 'Follow', actor: 'https://test/user', object: 'https://remote/calendar' };

    await mockFed.sendActivity(activity, ['https://remote/inbox']);

    expect(mockFed.sentActivities).toHaveLength(1);
    expect(mockFed.sentActivities[0].type).toBe('Follow');
    expect(mockFed.sentActivities[0].recipients).toEqual(['https://remote/inbox']);
  });

  it('should have functional receiveActivity method', async () => {
    const mockFed = createMockFederation();
    const activity = { type: 'Create', actor: 'https://remote/user', object: { type: 'Event' } };

    await mockFed.receiveActivity(activity, 'https://remote/user');

    expect(mockFed.receivedActivities).toHaveLength(1);
    expect(mockFed.receivedActivities[0].type).toBe('Create');
  });

  it('should have functional reset method', async () => {
    const mockFed = createMockFederation();

    await mockFed.sendActivity({ type: 'Follow' }, ['https://remote/inbox']);
    await mockFed.receiveActivity({ type: 'Create' }, 'https://remote/user');

    expect(mockFed.sentActivities).toHaveLength(1);
    expect(mockFed.receivedActivities).toHaveLength(1);

    mockFed.reset();

    expect(mockFed.sentActivities).toHaveLength(0);
    expect(mockFed.receivedActivities).toHaveLength(0);
  });
});

describe('getSentActivities', () => {
  let mockFed: MockFederationContext;

  beforeEach(() => {
    mockFed = createMockFederation();
  });

  it('should return empty array when no activities sent', () => {
    const sent = getSentActivities(mockFed);
    expect(sent).toEqual([]);
  });

  it('should track activities correctly', async () => {
    const followActivity = { type: 'Follow', actor: 'https://local/user', object: 'https://remote/calendar' };
    const createActivity = { type: 'Create', actor: 'https://local/user', object: { type: 'Event' } };

    await mockFed.sendActivity(followActivity, ['https://remote/inbox']);
    await mockFed.sendActivity(createActivity, ['https://other/inbox', 'https://another/inbox']);

    const sent = getSentActivities(mockFed);

    expect(sent).toHaveLength(2);
    expect(sent[0].type).toBe('Follow');
    expect(sent[0].recipients).toEqual(['https://remote/inbox']);
    expect(sent[1].type).toBe('Create');
    expect(sent[1].recipients).toEqual(['https://other/inbox', 'https://another/inbox']);
  });

  it('should return a copy of activities (not reference)', async () => {
    await mockFed.sendActivity({ type: 'Follow' }, ['https://remote/inbox']);

    const sent1 = getSentActivities(mockFed);
    const sent2 = getSentActivities(mockFed);

    expect(sent1).not.toBe(sent2);
    expect(sent1).toEqual(sent2);
  });

  it('should include timestamp for each activity', async () => {
    await mockFed.sendActivity({ type: 'Follow' }, ['https://remote/inbox']);

    const sent = getSentActivities(mockFed);

    expect(sent[0].timestamp).toBeInstanceOf(Date);
  });
});

describe('simulateInboxReceive', () => {
  let mockFed: MockFederationContext;

  beforeEach(() => {
    mockFed = createMockFederation();
  });

  it('should simulate receiving a Follow activity', async () => {
    const followActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Follow',
      actor: 'https://remote/user',
      object: 'https://local/calendar',
    };

    await simulateInboxReceive(mockFed, followActivity, 'https://remote/user');

    const received = getReceivedActivities(mockFed);
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('Follow');
  });

  it('should simulate receiving a Create activity', async () => {
    const createActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Create',
      actor: 'https://remote/user',
      object: {
        type: 'Event',
        name: 'Test Event',
      },
    };

    await simulateInboxReceive(mockFed, createActivity, 'https://remote/user');

    const received = getReceivedActivities(mockFed);
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('Create');
  });

  it('should throw error for invalid activity (not an object)', async () => {
    await expect(simulateInboxReceive(mockFed, null, 'https://remote/user'))
      .rejects.toThrow('Activity must be an object');

    await expect(simulateInboxReceive(mockFed, 'string', 'https://remote/user'))
      .rejects.toThrow('Activity must be an object');
  });

  it('should throw error for activity without type', async () => {
    const invalidActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      actor: 'https://remote/user',
      object: 'https://local/calendar',
    };

    await expect(simulateInboxReceive(mockFed, invalidActivity, 'https://remote/user'))
      .rejects.toThrow('Activity must have a type property');
  });

  it('should handle multiple inbox receives', async () => {
    const activity1 = { type: 'Follow', actor: 'https://remote1/user', object: 'https://local/calendar' };
    const activity2 = { type: 'Create', actor: 'https://remote2/user', object: { type: 'Event' } };
    const activity3 = { type: 'Announce', actor: 'https://remote3/user', object: 'https://local/event' };

    await simulateInboxReceive(mockFed, activity1, 'https://remote1/user');
    await simulateInboxReceive(mockFed, activity2, 'https://remote2/user');
    await simulateInboxReceive(mockFed, activity3, 'https://remote3/user');

    const received = getReceivedActivities(mockFed);
    expect(received).toHaveLength(3);
    expect(received.map(r => r.type)).toEqual(['Follow', 'Create', 'Announce']);
  });
});

describe('clearActivities', () => {
  it('should clear all sent and received activities', async () => {
    const mockFed = createMockFederation();

    await mockFed.sendActivity({ type: 'Follow' }, ['https://remote/inbox']);
    await mockFed.sendActivity({ type: 'Create' }, ['https://other/inbox']);
    await simulateInboxReceive(mockFed, { type: 'Follow', actor: 'test' }, 'https://remote/user');

    expect(getSentActivities(mockFed)).toHaveLength(2);
    expect(getReceivedActivities(mockFed)).toHaveLength(1);

    clearActivities(mockFed);

    expect(getSentActivities(mockFed)).toHaveLength(0);
    expect(getReceivedActivities(mockFed)).toHaveLength(0);
  });
});

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

describe('Activity Type Extraction', () => {
  let mockFed: MockFederationContext;

  beforeEach(() => {
    mockFed = createMockFederation();
  });

  it('should extract type from standard type property', async () => {
    await mockFed.sendActivity({ type: 'Follow' }, []);
    expect(getSentActivities(mockFed)[0].type).toBe('Follow');
  });

  it('should extract type from @type property', async () => {
    await mockFed.sendActivity({ '@type': 'Create' }, []);
    expect(getSentActivities(mockFed)[0].type).toBe('Create');
  });

  it('should extract type from array type property', async () => {
    await mockFed.sendActivity({ type: ['Update', 'Activity'] }, []);
    expect(getSentActivities(mockFed)[0].type).toBe('Update');
  });

  it('should return Unknown for missing type', async () => {
    await mockFed.sendActivity({ actor: 'test' }, []);
    expect(getSentActivities(mockFed)[0].type).toBe('Unknown');
  });

  it('should return Unknown for non-object activity', async () => {
    // This shouldn't happen in practice but tests the edge case
    await mockFed.sendActivity(null as unknown, []);
    expect(getSentActivities(mockFed)[0].type).toBe('Unknown');
  });
});
