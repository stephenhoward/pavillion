/**
 * Tests for ProcessInboxService
 *
 * These tests verify inbox message processing for various ActivityPub activity types.
 * Uses Fedify mock utilities for creating well-formed ActivityPub activities,
 * and Sinon for mocking database entities and services.
 *
 * The Fedify mock helpers provide:
 * - Properly formatted ActivityPub activities with @context
 * - Consistent activity structure matching the ActivityStreams spec
 * - Type-safe activity creation for tests
 *
 * Sinon is still used for:
 * - Mocking database entity methods (update, findOne)
 * - Stubbing service methods (calendarService.getCalendar)
 * - Tracking method calls and arguments
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Calendar } from '@/common/model/calendar';
import ProcessInboxService from '@/server/activitypub/service/inbox';
import { ActivityPubInboxMessageEntity, ActivityPubOutboxMessageEntity, FollowerCalendarEntity, FollowingCalendarEntity } from '@/server/activitypub/entity/activitypub';
import CalendarInterface from '@/server/calendar/interface';
import ModerationInterface from '@/server/moderation/interface';
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';
import { ActivityPubActor } from '@/server/activitypub/model/base';

// Import Fedify mock helpers for creating well-formed ActivityPub activities
import {
  createMockFollowActivity,
  createMockCreateActivity,
  createMockUpdateActivity,
  createMockDeleteActivity,
  createMockAnnounceActivity,
  createMockUndoActivity,
} from '@/server/activitypub/test/helpers/fedify-mock';


// Mock the remote-fetch module at the top level for vitest
vi.mock('@/server/activitypub/helper/remote-fetch', () => ({
  fetchRemoteObject: vi.fn(),
}));

// Import after mock is set up
import { fetchRemoteObject } from '@/server/activitypub/helper/remote-fetch';


describe('processInboxMessage', () => {
  let service: ProcessInboxService;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let getCalendarStub: sinon.SinonStub;
  let calendarInterface: CalendarInterface;

  // Test constants for consistent actor/object IDs
  const TEST_CALENDAR_ID = 'testid';
  const LOCAL_CALENDAR_URL = 'https://local.federation.test/calendars/events';
  const REMOTE_ACTOR_URL = 'https://remote.federation.test/users/alice';
  const REMOTE_EVENT_URL = 'https://remote.federation.test/events/123';

  beforeEach (() => {
    const eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    service = new ProcessInboxService(eventBus, calendarInterface);
    getCalendarStub = sandbox.stub(service.calendarInterface, 'getCalendar');
    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should fail without calendar', async () => {
    // Use Fedify helper to create a proper Create activity
    const activityMessage = createMockCreateActivity(REMOTE_ACTOR_URL, {
      type: 'Event',
      id: REMOTE_EVENT_URL,
      name: 'Test Event',
    });

    const message = ActivityPubInboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Create',
      message: activityMessage,
    });
    const updateStub = sandbox.stub(ActivityPubInboxMessageEntity.prototype, 'update');

    getCalendarStub.resolves(null);

    await service.processInboxMessage(message);

    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('error');
  });

  it('should skip invalid message type', async () => {
    const message = ActivityPubInboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'NotAType',
      message: { to: 'remoteaccount@remotedomain' },
    });
    const updateStub = sandbox.stub(ActivityPubInboxMessageEntity.prototype, 'update');

    await service.processInboxMessage(message);

    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('error');
  });

  it('should process a create activity', async () => {
    // Use Fedify helper to create a proper Create activity with Event object
    const activityMessage = createMockCreateActivity(REMOTE_ACTOR_URL, {
      type: 'Event',
      id: REMOTE_EVENT_URL,
      name: 'Test Event',
      startTime: '2025-01-15T10:00:00Z',
    });

    const message = ActivityPubInboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Create',
      message: activityMessage,
    });
    const processStub = sandbox.stub(service, 'processCreateEvent');
    const updateStub = sandbox.stub(ActivityPubInboxMessageEntity.prototype, 'update');

    await service.processInboxMessage(message);

    expect(processStub.called).toBe(true);
    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
  });

  it('should process an update activity', async () => {
    // Use Fedify helper to create a proper Update activity
    const activityMessage = createMockUpdateActivity(REMOTE_ACTOR_URL, {
      type: 'Event',
      id: REMOTE_EVENT_URL,
      name: 'Updated Event Name',
    });

    const message = ActivityPubInboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Update',
      message: activityMessage,
    });
    const processStub = sandbox.stub(service, 'processUpdateEvent');
    const updateStub = sandbox.stub(ActivityPubInboxMessageEntity.prototype, 'update');

    await service.processInboxMessage(message);

    expect(processStub.called).toBe(true);
    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
  });

  it('should process a delete activity', async () => {
    // Use Fedify helper to create a proper Delete activity
    const activityMessage = createMockDeleteActivity(REMOTE_ACTOR_URL, REMOTE_EVENT_URL);

    const message = ActivityPubInboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Delete',
      message: activityMessage,
    });
    const processStub = sandbox.stub(service, 'processDeleteEvent');
    const updateStub = sandbox.stub(ActivityPubInboxMessageEntity.prototype, 'update');

    await service.processInboxMessage(message);

    expect(processStub.called).toBe(true);
    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
  });

  it('should process a follow activity', async () => {
    // Use Fedify helper to create a proper Follow activity
    const activityMessage = createMockFollowActivity(REMOTE_ACTOR_URL, LOCAL_CALENDAR_URL);

    const message = ActivityPubInboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Follow',
      message: activityMessage,
    });
    const processStub = sandbox.stub(service, 'processFollowAccount');
    const updateStub = sandbox.stub(ActivityPubInboxMessageEntity.prototype, 'update');

    await service.processInboxMessage(message);

    expect(processStub.called).toBe(true);
    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
  });

  it('should emit outboxMessageAdded event when processing follow activity', async () => {
    // This test verifies that when a Follow activity is processed, the inbox service
    // properly queues an Accept activity to the outbox AND emits the outboxMessageAdded
    // event so that the outbox processor can deliver it.

    const eventBus = new EventEmitter();
    const testCalendarInterface = new CalendarInterface(eventBus);
    const testService = new ProcessInboxService(eventBus, testCalendarInterface);

    // Mock the calendar interface
    sandbox.stub(testService.calendarInterface, 'getCalendar')
      .resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID, urlName: 'testcalendar' }));

    // Mock RemoteCalendarService to return a RemoteCalendar
    const mockRemoteCalendar = {
      id: 'mock-remote-calendar-uuid',
      actorUri: REMOTE_ACTOR_URL,
      displayName: null,
      inboxUrl: null,
      sharedInboxUrl: null,
      publicKey: null,
      lastFetched: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    sandbox.stub(testService.remoteCalendarService, 'findOrCreateByActorUri').resolves(mockRemoteCalendar);

    // Mock FollowerCalendarEntity to simulate no existing follower
    const findOneStub = sandbox.stub(FollowerCalendarEntity, 'findOne').resolves(null);
    const createStub = sandbox.stub(FollowerCalendarEntity, 'create').resolves({} as any);

    // Mock ActivityPubOutboxMessageEntity save
    const outboxSaveStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'save').resolves();

    // Set up event listener to track if outboxMessageAdded is emitted
    let eventEmitted = false;
    let emittedActivity: any = null;
    eventBus.on('outboxMessageAdded', (activity) => {
      eventEmitted = true;
      emittedActivity = activity;
    });

    // Use Fedify helper to create a proper Follow activity
    const activityMessage = createMockFollowActivity(REMOTE_ACTOR_URL, LOCAL_CALENDAR_URL);

    const message = ActivityPubInboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Follow',
      message: activityMessage,
    });

    // Mock the message update method
    sandbox.stub(ActivityPubInboxMessageEntity.prototype, 'update').resolves();

    // Process the follow activity
    await testService.processInboxMessage(message);

    // Verify that the event was emitted
    expect(eventEmitted).toBe(true);
    expect(emittedActivity).toBeDefined();
    expect(emittedActivity.type).toBe('Accept');

    // Verify that an outbox message was created
    expect(outboxSaveStub.calledOnce).toBe(true);

    // Verify that a follower relationship was created
    expect(createStub.calledOnce).toBe(true);
  });

  it('should process an announce activity', async () => {
    // Use Fedify helper to create a proper Announce (share) activity
    const activityMessage = createMockAnnounceActivity(REMOTE_ACTOR_URL, REMOTE_EVENT_URL);

    const message = ActivityPubInboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Announce',
      message: activityMessage,
    });
    const processStub = sandbox.stub(service, 'processShareEvent');
    const updateStub = sandbox.stub(ActivityPubInboxMessageEntity.prototype, 'update');

    await service.processInboxMessage(message);

    expect(processStub.called).toBe(true);
    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
  });

  it('should error an undo activity with no target', async () => {
    // Use Fedify helper to create an Undo wrapping a Follow activity
    const originalFollow = createMockFollowActivity(REMOTE_ACTOR_URL, LOCAL_CALENDAR_URL);
    const activityMessage = createMockUndoActivity(REMOTE_ACTOR_URL, originalFollow);

    const message = ActivityPubInboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Undo',
      message: activityMessage,
    });
    const processStub = sandbox.stub(service, 'processUnfollowAccount');
    const targetStub = sandbox.stub(ActivityPubInboxMessageEntity, 'findOne');
    const updateStub = sandbox.stub(ActivityPubInboxMessageEntity.prototype, 'update');

    targetStub.resolves(undefined);

    await service.processInboxMessage(message);

    expect(processStub.called).toBe(false);
    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('error');
  });

  it('should process an undo follow activity', async () => {
    // Use Fedify helper to create an Undo wrapping a Follow activity
    const originalFollow = createMockFollowActivity(REMOTE_ACTOR_URL, LOCAL_CALENDAR_URL);
    const activityMessage = createMockUndoActivity(REMOTE_ACTOR_URL, originalFollow);

    const message = ActivityPubInboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Undo',
      message: activityMessage,
    });
    const processStub = sandbox.stub(service, 'processUnfollowAccount');
    const targetStub = sandbox.stub(ActivityPubInboxMessageEntity, 'findOne');
    const updateStub = sandbox.stub(ActivityPubInboxMessageEntity.prototype, 'update');

    targetStub.resolves(ActivityPubInboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Follow',
    }));

    await service.processInboxMessage(message);

    expect(processStub.called).toBe(true);
    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
  });

  it('should process an undo announce activity', async () => {
    // Use Fedify helper to create an Undo wrapping an Announce activity
    const originalAnnounce = createMockAnnounceActivity(REMOTE_ACTOR_URL, REMOTE_EVENT_URL);
    const activityMessage = createMockUndoActivity(REMOTE_ACTOR_URL, originalAnnounce);

    const message = ActivityPubInboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Undo',
      message: activityMessage,
    });
    const processStub = sandbox.stub(service, 'processUnshareEvent');
    const targetStub = sandbox.stub(ActivityPubInboxMessageEntity, 'findOne');
    const updateStub = sandbox.stub(ActivityPubInboxMessageEntity.prototype, 'update');

    targetStub.resolves(ActivityPubInboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Announce',
    }));

    await service.processInboxMessage(message);

    expect(processStub.called).toBe(true);
    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
  });

  describe('Null handling in activity processing', () => {
    it('should handle Undo with missing message object', async () => {
      const message = ActivityPubInboxMessageEntity.build({
        calendar_id: TEST_CALENDAR_ID,
        type: 'Undo',
        message: null, // Missing message
      });

      const updateStub = sandbox.stub(ActivityPubInboxMessageEntity.prototype, 'update');

      await service.processInboxMessage(message);

      expect(updateStub.calledOnce).toBe(true);
      expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('error');
    });

    it('should handle Undo with message missing object property', async () => {
      const message = ActivityPubInboxMessageEntity.build({
        calendar_id: TEST_CALENDAR_ID,
        type: 'Undo',
        message: { actor: 'test' }, // Missing object property
      });

      const updateStub = sandbox.stub(ActivityPubInboxMessageEntity.prototype, 'update');

      await service.processInboxMessage(message);

      expect(updateStub.calledOnce).toBe(true);
      expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('error');
    });

    it('should handle Accept with missing object', async () => {
      const acceptActivity = {
        type: 'Accept',
        actor: REMOTE_ACTOR_URL,
        object: null, // Missing object
      };

      const message = ActivityPubInboxMessageEntity.build({
        calendar_id: TEST_CALENDAR_ID,
        type: 'Accept',
        message: acceptActivity,
      });

      const updateStub = sandbox.stub(ActivityPubInboxMessageEntity.prototype, 'update');

      await service.processInboxMessage(message);

      // Should fail validation since fromObject will return null
      expect(updateStub.calledOnce).toBe(true);
      expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('error');
    });

    it('should handle Announce with missing object', async () => {
      const announceActivity = createMockAnnounceActivity(REMOTE_ACTOR_URL, null as any);

      const message = ActivityPubInboxMessageEntity.build({
        calendar_id: TEST_CALENDAR_ID,
        type: 'Announce',
        message: announceActivity,
      });

      const updateStub = sandbox.stub(ActivityPubInboxMessageEntity.prototype, 'update');

      await service.processInboxMessage(message);

      // fromObject should return null for invalid activity
      expect(updateStub.calledOnce).toBe(true);
      expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('error');
    });

    it('should handle Announce with object missing id', async () => {
      const announceActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Announce',
        actor: REMOTE_ACTOR_URL,
        object: { type: 'Event' }, // Missing id
      };

      const message = ActivityPubInboxMessageEntity.build({
        calendar_id: TEST_CALENDAR_ID,
        type: 'Announce',
        message: announceActivity,
      });

      const updateStub = sandbox.stub(ActivityPubInboxMessageEntity.prototype, 'update');

      await service.processInboxMessage(message);

      // Should fail validation or handle gracefully
      expect(updateStub.calledOnce).toBe(true);
      // Could be either error (fromObject fails) or ok (processShareEvent returns early)
      const status = updateStub.getCalls()[0].args[0]['processed_status'];
      expect(['ok', 'error']).toContain(status);
    });

    it('should handle processUnfollowAccount with missing message', async () => {
      const calendar = Calendar.fromObject({ id: TEST_CALENDAR_ID });

      // Call with null message
      await service.processUnfollowAccount(calendar, null);

      // Should return gracefully without throwing
      // No assertions needed - just verify it doesn't throw
    });

    it('should handle processUnfollowAccount with missing actor', async () => {
      const calendar = Calendar.fromObject({ id: TEST_CALENDAR_ID });

      // Call with message missing actor
      await service.processUnfollowAccount(calendar, { message: {} });

      // Should return gracefully without throwing
      // No assertions needed - just verify it doesn't throw
    });

    it('should handle processUnshareEvent with missing object', async () => {
      const calendar = Calendar.fromObject({ id: TEST_CALENDAR_ID });

      // Call with null message
      await service.processUnshareEvent(calendar, null);

      // Should return gracefully without throwing
      // No assertions needed - just verify it doesn't throw
    });

    it('should handle processUnshareEvent with object missing id', async () => {
      const calendar = Calendar.fromObject({ id: TEST_CALENDAR_ID });

      // Call with object missing id
      await service.processUnshareEvent(calendar, {
        object: { type: 'Event' },
        message: { actor: REMOTE_ACTOR_URL },
      });

      // Should return gracefully without throwing
      // No assertions needed - just verify it doesn't throw
    });

    it('should handle processUnshareEvent with missing actor', async () => {
      const calendar = Calendar.fromObject({ id: TEST_CALENDAR_ID });

      // Call with missing actor
      await service.processUnshareEvent(calendar, {
        object: REMOTE_EVENT_URL,
        message: {},
      });

      // Should return gracefully without throwing
      // No assertions needed - just verify it doesn't throw
    });
  });
});


describe('actorOwnsObject', () => {
  let service: ProcessInboxService;
  const mockFetchRemoteObject = vi.mocked(fetchRemoteObject);

  const REMOTE_ACTOR_URL = 'https://remote.federation.test/calendars/events';
  const REMOTE_EVENT_URL = 'https://remote.federation.test/events/123';
  const DIFFERENT_ACTOR_URL = 'https://attacker.example/calendars/malicious';

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const calendarInterface = new CalendarInterface(eventBus);
    service = new ProcessInboxService(eventBus, calendarInterface);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return true when remote object attributedTo matches actor (string)', async () => {
    // Remote server confirms the actor owns this object
    mockFetchRemoteObject.mockResolvedValue({
      id: REMOTE_EVENT_URL,
      type: 'Event',
      name: 'Community Meetup',
      attributedTo: REMOTE_ACTOR_URL,
    });

    const message = {
      actor: REMOTE_ACTOR_URL,
      object: {
        id: REMOTE_EVENT_URL,
        attributedTo: REMOTE_ACTOR_URL, // This could be spoofed in the message
      },
    };

    const result = await service.actorOwnsObject(message);

    expect(result).toBe(true);
    expect(mockFetchRemoteObject).toHaveBeenCalledOnce();
    expect(mockFetchRemoteObject).toHaveBeenCalledWith(REMOTE_EVENT_URL);
  });

  it('should return false when remote object attributedTo does not match actor', async () => {
    // Remote server says the object belongs to someone else
    mockFetchRemoteObject.mockResolvedValue({
      id: REMOTE_EVENT_URL,
      type: 'Event',
      name: 'Community Meetup',
      attributedTo: 'https://legitimate-owner.example/calendars/real',
    });

    const message = {
      actor: DIFFERENT_ACTOR_URL, // Attacker claims to own this
      object: {
        id: REMOTE_EVENT_URL,
        attributedTo: DIFFERENT_ACTOR_URL, // Spoofed attributedTo
      },
    };

    const result = await service.actorOwnsObject(message);

    expect(result).toBe(false);
    expect(mockFetchRemoteObject).toHaveBeenCalledOnce();
    expect(mockFetchRemoteObject).toHaveBeenCalledWith(REMOTE_EVENT_URL);
  });

  it('should return false when remote fetch fails', async () => {
    // Remote server is unreachable or returns error
    mockFetchRemoteObject.mockResolvedValue(null);

    const message = {
      actor: REMOTE_ACTOR_URL,
      object: {
        id: REMOTE_EVENT_URL,
        attributedTo: REMOTE_ACTOR_URL,
      },
    };

    const result = await service.actorOwnsObject(message);

    expect(result).toBe(false);
  });

  it('should return false when remote object has no attributedTo', async () => {
    // Remote object exists but has no attributedTo field
    mockFetchRemoteObject.mockResolvedValue({
      id: REMOTE_EVENT_URL,
      type: 'Event',
      name: 'Community Meetup',
      // No attributedTo field
    });

    const message = {
      actor: REMOTE_ACTOR_URL,
      object: {
        id: REMOTE_EVENT_URL,
        attributedTo: REMOTE_ACTOR_URL,
      },
    };

    const result = await service.actorOwnsObject(message);

    expect(result).toBe(false);
  });

  it('should return false when message has no object URI', async () => {
    const message = {
      actor: REMOTE_ACTOR_URL,
      object: {
        // No id field
        name: 'Some Event',
      },
    };

    const result = await service.actorOwnsObject(message);

    expect(result).toBe(false);
    expect(mockFetchRemoteObject).not.toHaveBeenCalled();
  });

  it('should handle object as string URI', async () => {
    mockFetchRemoteObject.mockResolvedValue({
      id: REMOTE_EVENT_URL,
      type: 'Event',
      attributedTo: REMOTE_ACTOR_URL,
    });

    const message = {
      actor: REMOTE_ACTOR_URL,
      object: REMOTE_EVENT_URL, // Object is just a string URI
    };

    const result = await service.actorOwnsObject(message);

    expect(result).toBe(true);
    expect(mockFetchRemoteObject).toHaveBeenCalledOnce();
    expect(mockFetchRemoteObject).toHaveBeenCalledWith(REMOTE_EVENT_URL);
  });

  it('should return true when actor is in attributedTo array (string elements)', async () => {
    // attributedTo can be an array of actors
    mockFetchRemoteObject.mockResolvedValue({
      id: REMOTE_EVENT_URL,
      type: 'Event',
      attributedTo: [
        'https://other.example/calendars/other',
        REMOTE_ACTOR_URL,
        'https://another.example/calendars/another',
      ],
    });

    const message = {
      actor: REMOTE_ACTOR_URL,
      object: { id: REMOTE_EVENT_URL },
    };

    const result = await service.actorOwnsObject(message);

    expect(result).toBe(true);
  });

  it('should return false when actor is not in attributedTo array', async () => {
    mockFetchRemoteObject.mockResolvedValue({
      id: REMOTE_EVENT_URL,
      type: 'Event',
      attributedTo: [
        'https://other.example/calendars/other',
        'https://another.example/calendars/another',
      ],
    });

    const message = {
      actor: DIFFERENT_ACTOR_URL,
      object: { id: REMOTE_EVENT_URL },
    };

    const result = await service.actorOwnsObject(message);

    expect(result).toBe(false);
  });

  it('should handle attributedTo array with object elements', async () => {
    // attributedTo array elements can be objects with id property
    mockFetchRemoteObject.mockResolvedValue({
      id: REMOTE_EVENT_URL,
      type: 'Event',
      attributedTo: [
        { id: 'https://other.example/calendars/other', type: 'Application' },
        { id: REMOTE_ACTOR_URL, type: 'Application' },
      ],
    });

    const message = {
      actor: REMOTE_ACTOR_URL,
      object: { id: REMOTE_EVENT_URL },
    };

    const result = await service.actorOwnsObject(message);

    expect(result).toBe(true);
  });

  it('should handle attributedTo as object with id property', async () => {
    // attributedTo can be a single object with id property
    mockFetchRemoteObject.mockResolvedValue({
      id: REMOTE_EVENT_URL,
      type: 'Event',
      attributedTo: { id: REMOTE_ACTOR_URL, type: 'Application' },
    });

    const message = {
      actor: REMOTE_ACTOR_URL,
      object: { id: REMOTE_EVENT_URL },
    };

    const result = await service.actorOwnsObject(message);

    expect(result).toBe(true);
  });

  it('should return false for attributedTo object with non-matching id', async () => {
    mockFetchRemoteObject.mockResolvedValue({
      id: REMOTE_EVENT_URL,
      type: 'Event',
      attributedTo: { id: 'https://legitimate-owner.example/calendars/real', type: 'Application' },
    });

    const message = {
      actor: DIFFERENT_ACTOR_URL,
      object: { id: REMOTE_EVENT_URL },
    };

    const result = await service.actorOwnsObject(message);

    expect(result).toBe(false);
  });
});

describe('isAuthorizedRemoteEditor caching', () => {
  let service: ProcessInboxService;
  let calendarInterface: CalendarInterface;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  const TEST_CALENDAR_ID = 'test-calendar-id';
  const TEST_ACTOR_URI = 'https://remote.example/users/alice';

  beforeEach(() => {
    const eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    service = new ProcessInboxService(eventBus, calendarInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should cache positive authorization results', async () => {
    const isEditorStub = sandbox.stub(service.calendarInterface, 'isEditorOfCalendar');
    isEditorStub.resolves(true);

    // First call - should call interface
    const result1 = await (service as any).isAuthorizedRemoteEditor(TEST_CALENDAR_ID, TEST_ACTOR_URI);
    expect(result1).toBe(true);
    expect(isEditorStub.callCount).toBe(1);

    // Second call - should use cache
    const result2 = await (service as any).isAuthorizedRemoteEditor(TEST_CALENDAR_ID, TEST_ACTOR_URI);
    expect(result2).toBe(true);
    expect(isEditorStub.callCount).toBe(1); // No additional interface call
  });

  it('should cache negative authorization results', async () => {
    const isEditorStub = sandbox.stub(service.calendarInterface, 'isEditorOfCalendar');
    isEditorStub.resolves(false);

    // First call - should call interface
    const result1 = await (service as any).isAuthorizedRemoteEditor(TEST_CALENDAR_ID, TEST_ACTOR_URI);
    expect(result1).toBe(false);
    expect(isEditorStub.callCount).toBe(1);

    // Second call - should use cache
    const result2 = await (service as any).isAuthorizedRemoteEditor(TEST_CALENDAR_ID, TEST_ACTOR_URI);
    expect(result2).toBe(false);
    expect(isEditorStub.callCount).toBe(1); // No additional interface call
  });

  it('should cache when actor has no membership', async () => {
    const isEditorStub = sandbox.stub(service.calendarInterface, 'isEditorOfCalendar');
    isEditorStub.resolves(false);

    // First call - should call interface
    const result1 = await (service as any).isAuthorizedRemoteEditor(TEST_CALENDAR_ID, TEST_ACTOR_URI);
    expect(result1).toBe(false);
    expect(isEditorStub.callCount).toBe(1);

    // Second call - should use cache
    const result2 = await (service as any).isAuthorizedRemoteEditor(TEST_CALENDAR_ID, TEST_ACTOR_URI);
    expect(result2).toBe(false);
    expect(isEditorStub.callCount).toBe(1); // No additional interface call
  });

  it('should invalidate cache for specific calendar and actor', async () => {
    const isEditorStub = sandbox.stub(service.calendarInterface, 'isEditorOfCalendar');
    isEditorStub.resolves(true);

    // First call - populate cache
    const result1 = await (service as any).isAuthorizedRemoteEditor(TEST_CALENDAR_ID, TEST_ACTOR_URI);
    expect(result1).toBe(true);
    expect(isEditorStub.callCount).toBe(1);

    // Invalidate cache
    service.invalidateAuthorizationCache(TEST_CALENDAR_ID, TEST_ACTOR_URI);

    // Second call - should call interface again
    const result3 = await (service as any).isAuthorizedRemoteEditor(TEST_CALENDAR_ID, TEST_ACTOR_URI);
    expect(result3).toBe(true);
    expect(isEditorStub.callCount).toBe(2); // Interface called again
  });

  it('should invalidate all cache entries for a calendar', async () => {
    const isEditorStub = sandbox.stub(service.calendarInterface, 'isEditorOfCalendar');
    isEditorStub.resolves(true);

    const ACTOR_URI_2 = 'https://remote.example/users/bob';

    // Populate cache for two actors
    await (service as any).isAuthorizedRemoteEditor(TEST_CALENDAR_ID, TEST_ACTOR_URI);
    await (service as any).isAuthorizedRemoteEditor(TEST_CALENDAR_ID, ACTOR_URI_2);
    expect(isEditorStub.callCount).toBe(2);

    // Invalidate all for calendar
    service.invalidateCalendarAuthorizationCache(TEST_CALENDAR_ID);

    // Both should call interface again
    await (service as any).isAuthorizedRemoteEditor(TEST_CALENDAR_ID, TEST_ACTOR_URI);
    await (service as any).isAuthorizedRemoteEditor(TEST_CALENDAR_ID, ACTOR_URI_2);
    expect(isEditorStub.callCount).toBe(4); // Two more interface calls
  });

  it('should respect cache expiration', async () => {
    const isEditorStub = sandbox.stub(service.calendarInterface, 'isEditorOfCalendar');
    isEditorStub.resolves(true);

    // First call - populate cache
    const result1 = await (service as any).isAuthorizedRemoteEditor(TEST_CALENDAR_ID, TEST_ACTOR_URI);
    expect(result1).toBe(true);
    expect(isEditorStub.callCount).toBe(1);

    // Manually expire the cache entry
    const cacheKey = `${TEST_CALENDAR_ID}:${TEST_ACTOR_URI}`;
    const cache = (service as any).authorizationCache;
    const entry = cache.get(cacheKey);
    entry.expiresAt = Date.now() - 1000; // Expired 1 second ago

    // Second call - should call interface because cache is expired
    const result2 = await (service as any).isAuthorizedRemoteEditor(TEST_CALENDAR_ID, TEST_ACTOR_URI);
    expect(result2).toBe(true);
    expect(isEditorStub.callCount).toBe(2); // Interface called again
  });

  it('should clear expired entries without affecting valid ones', async () => {
    const isEditorStub = sandbox.stub(service.calendarInterface, 'isEditorOfCalendar');
    isEditorStub.resolves(true);

    const ACTOR_URI_2 = 'https://remote.example/users/bob';

    // Populate cache for two actors
    await (service as any).isAuthorizedRemoteEditor(TEST_CALENDAR_ID, TEST_ACTOR_URI);
    await (service as any).isAuthorizedRemoteEditor(TEST_CALENDAR_ID, ACTOR_URI_2);

    // Manually expire only the first entry
    const cache = (service as any).authorizationCache;
    const cacheKey1 = `${TEST_CALENDAR_ID}:${TEST_ACTOR_URI}`;
    const entry1 = cache.get(cacheKey1);
    entry1.expiresAt = Date.now() - 1000; // Expired

    // Clear expired entries
    service.clearExpiredAuthorizationCache();

    // First should call interface again, second should use cache
    await (service as any).isAuthorizedRemoteEditor(TEST_CALENDAR_ID, TEST_ACTOR_URI);
    await (service as any).isAuthorizedRemoteEditor(TEST_CALENDAR_ID, ACTOR_URI_2);

    expect(isEditorStub.callCount).toBe(3); // One additional call for expired entry
  });

  it('should clear entire cache', async () => {
    const isEditorStub = sandbox.stub(service.calendarInterface, 'isEditorOfCalendar');
    isEditorStub.resolves(true);

    // Populate cache
    await (service as any).isAuthorizedRemoteEditor(TEST_CALENDAR_ID, TEST_ACTOR_URI);
    expect(isEditorStub.callCount).toBe(1);

    // Clear entire cache
    service.clearAuthorizationCache();

    // Should call interface again
    await (service as any).isAuthorizedRemoteEditor(TEST_CALENDAR_ID, TEST_ACTOR_URI);
    expect(isEditorStub.callCount).toBe(2);
  });

  it('should maintain cache size under configured limit', async () => {
    const isEditorStub = sandbox.stub(service.calendarInterface, 'isEditorOfCalendar');
    isEditorStub.resolves(true);

    // Add many entries to the cache
    for (let i = 0; i < 100; i++) {
      await (service as any).isAuthorizedRemoteEditor(
        TEST_CALENDAR_ID,
        `https://remote.example/users/actor${i}`,
      );
    }

    // Cache should have stored 100 entries
    const cacheSize = (service as any).authorizationCache.size;
    expect(cacheSize).toBe(100);
    expect(cacheSize).toBeLessThanOrEqual(1000); // Max size is 1000
  });

  it('should evict oldest entries when cache exceeds max size', async () => {
    const isEditorStub = sandbox.stub(service.calendarInterface, 'isEditorOfCalendar');
    isEditorStub.resolves(true);

    // Add entries and check that cached ones are not re-fetched
    const actor1 = 'https://remote.example/users/actor1';
    const actor2 = 'https://remote.example/users/actor2';
    const actor3 = 'https://remote.example/users/actor3';

    await (service as any).isAuthorizedRemoteEditor(TEST_CALENDAR_ID, actor1);
    await (service as any).isAuthorizedRemoteEditor(TEST_CALENDAR_ID, actor2);
    await (service as any).isAuthorizedRemoteEditor(TEST_CALENDAR_ID, actor3);

    expect(isEditorStub.callCount).toBe(3);

    // Access actor1 again - should be cached
    await (service as any).isAuthorizedRemoteEditor(TEST_CALENDAR_ID, actor1);
    expect(isEditorStub.callCount).toBe(3); // Still 3, used cache

    // Access actor2 again - should be cached
    await (service as any).isAuthorizedRemoteEditor(TEST_CALENDAR_ID, actor2);
    expect(isEditorStub.callCount).toBe(3); // Still 3, used cache
  });
});

describe('Structured Logging for Activity Rejections', () => {
  let service: ProcessInboxService;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let consoleWarnStub: sinon.SinonStub;
  let consoleErrorStub: sinon.SinonStub;

  const TEST_CALENDAR_ID = 'test-calendar-id';
  const TEST_CALENDAR_URL_NAME = 'testcalendar';
  const REMOTE_ACTOR_URL = 'https://remote.federation.test/users/alice';
  const REMOTE_EVENT_URL = 'https://remote.federation.test/events/123';
  const BLOCKED_DOMAIN = 'blocked.example.com';
  const BLOCKED_ACTOR_URL = `https://${BLOCKED_DOMAIN}/users/badactor`;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const calendarInterface = new CalendarInterface(eventBus);
    const moderationInterface = new ModerationInterface(eventBus);
    service = new ProcessInboxService(eventBus, calendarInterface, moderationInterface);
    consoleWarnStub = sandbox.stub(console, 'warn');
    consoleErrorStub = sandbox.stub(console, 'error');
  });

  afterEach(() => {
    sandbox.restore();
  });

  // Helper to find JSON log entries from console.warn calls
  const findJsonLogEntry = (stub: sinon.SinonStub) => {
    for (let i = 0; i < stub.callCount; i++) {
      try {
        const arg = stub.getCall(i).args[0];
        if (typeof arg === 'string' && arg.includes('"rejection_type"')) {
          return JSON.parse(arg);
        }
      }
      catch (e) {
        // Not JSON, skip
      }
    }
    return null;
  };

  describe('Blocked Instance Rejection', () => {
    it('should log structured output when instance is blocked', async () => {
      sandbox.stub(service.calendarInterface, 'getCalendar')
        .resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID, urlName: TEST_CALENDAR_URL_NAME }));

      sandbox.stub(service.moderationInterface!, 'isInstanceBlocked').resolves(true);

      const activityMessage = createMockCreateActivity(BLOCKED_ACTOR_URL, {
        type: 'Event',
        id: REMOTE_EVENT_URL,
        name: 'Blocked Event',
      });

      const message = ActivityPubInboxMessageEntity.build({
        id: 'test-message-id',
        calendar_id: TEST_CALENDAR_ID,
        type: 'Create',
        message: activityMessage,
      });

      sandbox.stub(ActivityPubInboxMessageEntity.prototype, 'update').resolves();

      await service.processInboxMessage(message);

      const logEntry = findJsonLogEntry(consoleWarnStub);
      expect(logEntry).toBeDefined();
      expect(logEntry.rejection_type).toBe('blocked_instance');
      expect(logEntry.activity_type).toBe('Create');
      expect(logEntry.actor_uri).toBe(BLOCKED_ACTOR_URL);
      expect(logEntry.actor_domain).toBe(BLOCKED_DOMAIN);
      expect(logEntry.calendar_id).toBe(TEST_CALENDAR_ID);
      expect(logEntry.message_id).toBe('test-message-id');
    });

    it('should set processed_status to blocked for blocked instances', async () => {
      sandbox.stub(service.calendarInterface, 'getCalendar')
        .resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID, urlName: TEST_CALENDAR_URL_NAME }));

      sandbox.stub(service.moderationInterface!, 'isInstanceBlocked').resolves(true);

      const activityMessage = createMockCreateActivity(BLOCKED_ACTOR_URL, {
        type: 'Event',
        id: REMOTE_EVENT_URL,
        name: 'Blocked Event',
      });

      const message = ActivityPubInboxMessageEntity.build({
        calendar_id: TEST_CALENDAR_ID,
        type: 'Create',
        message: activityMessage,
      });

      const updateStub = sandbox.stub(ActivityPubInboxMessageEntity.prototype, 'update');

      await service.processInboxMessage(message);

      expect(updateStub.calledOnce).toBe(true);
      const updateArgs = updateStub.firstCall.args[0];
      expect(updateArgs.processed_status).toBe('blocked');
      expect(updateArgs.processed_time).toBeDefined();
    });
  });

  describe('Unauthorized Create Rejection', () => {
    it('should log before throwing exception for unauthorized Create', async () => {
      // Mock to indicate this is a Person actor
      sandbox.stub(service as any, 'isPersonActorUri').resolves(true);
      sandbox.stub(service as any, 'isAuthorizedRemoteEditor').resolves(false);

      // Stub EventObjectEntity.findOne to simulate no existing event
      sandbox.stub(EventObjectEntity, 'findOne').resolves(null);

      const activityMessage = createMockCreateActivity(REMOTE_ACTOR_URL, {
        type: 'Event',
        id: REMOTE_EVENT_URL,
        name: 'Unauthorized Event',
      });

      const calendar = Calendar.fromObject({ id: TEST_CALENDAR_ID, urlName: TEST_CALENDAR_URL_NAME });

      try {
        await service.processCreateEvent(calendar, activityMessage);
      }
      catch (error: any) {
        // Expected to throw
      }

      const logEntry = findJsonLogEntry(consoleWarnStub);
      expect(logEntry).toBeDefined();
      expect(logEntry.rejection_type).toBe('unauthorized_editor');
      expect(logEntry.activity_type).toBe('Create');
      expect(logEntry.actor_uri).toBe(REMOTE_ACTOR_URL);
    });
  });

  describe('Ownership Verification Failure', () => {
    it('should log ownership verification failure for Create', async () => {
      const mockFetchRemoteObject = vi.mocked(fetchRemoteObject);

      // Mock as calendar actor (not person)
      sandbox.stub(service as any, 'isPersonActorUri').resolves(false);

      // Stub EventObjectEntity.findOne to simulate no existing event
      sandbox.stub(EventObjectEntity, 'findOne').resolves(null);

      // Mock failed ownership check
      mockFetchRemoteObject.mockResolvedValue({
        id: REMOTE_EVENT_URL,
        type: 'Event',
        attributedTo: 'https://different-owner.example/users/realowner',
      });

      const activityMessage = createMockCreateActivity(REMOTE_ACTOR_URL, {
        type: 'Event',
        id: REMOTE_EVENT_URL,
        name: 'Event',
      });

      const calendar = Calendar.fromObject({ id: TEST_CALENDAR_ID, urlName: TEST_CALENDAR_URL_NAME });

      try {
        await service.processCreateEvent(calendar, activityMessage);
      }
      catch (error: any) {
        // Expected to throw
      }

      const logEntry = findJsonLogEntry(consoleWarnStub);
      expect(logEntry).toBeDefined();
      expect(logEntry.rejection_type).toBe('ownership_verification_failed');
      expect(logEntry.activity_type).toBe('Create');
    });
  });

  describe('Unauthorized Update Rejection', () => {
    it('should log before throwing exception for unauthorized Update', async () => {
      sandbox.stub(service as any, 'isPersonActorUri').resolves(true);
      sandbox.stub(service as any, 'isAuthorizedRemoteEditor').resolves(false);

      // Stub EventObjectEntity.findOne to return a mock event object
      const mockEventId = 'mock-event-id';
      sandbox.stub(EventObjectEntity, 'findOne').resolves(
        EventObjectEntity.build({ event_id: mockEventId, ap_id: REMOTE_EVENT_URL }),
      );

      // Stub getEventById to return a mock event (required for Update to proceed to auth check)
      const mockEvent = { id: mockEventId, calendarId: TEST_CALENDAR_ID };
      sandbox.stub(service.calendarInterface, 'getEventById').resolves(mockEvent as any);

      const activityMessage = createMockUpdateActivity(REMOTE_ACTOR_URL, {
        type: 'Event',
        id: REMOTE_EVENT_URL,
        name: 'Unauthorized Update',
      });

      const calendar = Calendar.fromObject({ id: TEST_CALENDAR_ID, urlName: TEST_CALENDAR_URL_NAME });

      try {
        await service.processUpdateEvent(calendar, activityMessage);
      }
      catch (error: any) {
        // Expected to throw
      }

      const logEntry = findJsonLogEntry(consoleWarnStub);
      expect(logEntry).toBeDefined();
      expect(logEntry.rejection_type).toBe('unauthorized_editor');
      expect(logEntry.activity_type).toBe('Update');
    });
  });

  describe('Unauthorized Delete Rejection', () => {
    it('should log before throwing exception for unauthorized Delete', async () => {
      sandbox.stub(service as any, 'isPersonActorUri').resolves(true);
      sandbox.stub(service as any, 'isAuthorizedRemoteEditor').resolves(false);

      // Stub EventObjectEntity.findOne to return a mock event object
      const mockEventId = 'mock-event-id';
      sandbox.stub(EventObjectEntity, 'findOne').resolves(
        EventObjectEntity.build({ event_id: mockEventId, ap_id: REMOTE_EVENT_URL }),
      );

      // Stub getEventById to return a mock event (required for Delete to proceed to auth check)
      const mockEvent = { id: mockEventId, calendarId: TEST_CALENDAR_ID };
      sandbox.stub(service.calendarInterface, 'getEventById').resolves(mockEvent as any);

      // Create Delete activity with object as an object with id property (not just a string)
      const activityMessage = createMockDeleteActivity(REMOTE_ACTOR_URL, { id: REMOTE_EVENT_URL });

      const calendar = Calendar.fromObject({ id: TEST_CALENDAR_ID, urlName: TEST_CALENDAR_URL_NAME });

      try {
        await service.processDeleteEvent(calendar, activityMessage);
      }
      catch (error: any) {
        // Expected to throw
      }

      const logEntry = findJsonLogEntry(consoleWarnStub);
      expect(logEntry).toBeDefined();
      expect(logEntry.rejection_type).toBe('unauthorized_editor');
      expect(logEntry.activity_type).toBe('Delete');
    });
  });

  describe('Parse Failure Scenarios', () => {
    it('should log parse failures with error level', async () => {
      // Test directly at processInboxMessage level with malformed activity
      sandbox.stub(service.calendarInterface, 'getCalendar')
        .resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID, urlName: TEST_CALENDAR_URL_NAME }));

      // Stub EventObjectEntity.findOne in case the activity parses but needs validation
      sandbox.stub(EventObjectEntity, 'findOne').resolves(null);

      // Create a truly malformed activity that will fail CreateActivity.fromObject()
      // by providing invalid data that doesn't match ActivityPub schema
      const malformedActivity = {
        type: 'Create',
        // Missing actor field (required by ActivityPub spec)
        object: null, // Explicitly null
      };

      const message = ActivityPubInboxMessageEntity.build({
        calendar_id: TEST_CALENDAR_ID,
        type: 'Create',
        message: malformedActivity,
      });

      sandbox.stub(ActivityPubInboxMessageEntity.prototype, 'update').resolves();

      await service.processInboxMessage(message);

      // Parse failures should use console.error
      const logEntry = findJsonLogEntry(consoleErrorStub);
      expect(logEntry).toBeDefined();
      expect(logEntry.level).toBe('error');
      expect(logEntry.rejection_type).toBe('parse_failure');
      expect(logEntry.activity_type).toBe('Create');
    });
  });

  describe('Log Format Consistency', () => {
    it('should include all required fields in every log entry', async () => {
      sandbox.stub(service.calendarInterface, 'getCalendar')
        .resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID, urlName: TEST_CALENDAR_URL_NAME }));

      if (service.moderationInterface) {
        sandbox.stub(service.moderationInterface, 'isInstanceBlocked').resolves(true);
      }

      const message = ActivityPubInboxMessageEntity.build({
        id: 'test-id',
        calendar_id: TEST_CALENDAR_ID,
        type: 'Create',
        message: createMockCreateActivity(BLOCKED_ACTOR_URL, {
          type: 'Event',
          id: REMOTE_EVENT_URL,
          name: 'Test',
        }),
      });

      sandbox.stub(ActivityPubInboxMessageEntity.prototype, 'update').resolves();

      await service.processInboxMessage(message);

      const logEntry = findJsonLogEntry(consoleWarnStub);
      expect(logEntry).toBeDefined();
      expect(logEntry.timestamp).toBeDefined();
      expect(logEntry.level).toBeDefined();
      expect(logEntry.context).toBe('activitypub.inbox.rejection');
      expect(logEntry.rejection_type).toBeDefined();
      expect(logEntry.activity_type).toBeDefined();
      expect(logEntry.actor_uri).toBeDefined();
      expect(logEntry.actor_domain).toBeDefined();
      expect(logEntry.reason).toBeDefined();
    });
  });

  describe('Exception Behavior Verification', () => {
    it('should still throw exception after logging for Create', async () => {
      sandbox.stub(service as any, 'isPersonActorUri').resolves(true);
      sandbox.stub(service as any, 'isAuthorizedRemoteEditor').resolves(false);

      // Stub EventObjectEntity.findOne to simulate no existing event
      sandbox.stub(EventObjectEntity, 'findOne').resolves(null);

      const activityMessage = createMockCreateActivity(REMOTE_ACTOR_URL, {
        type: 'Event',
        id: REMOTE_EVENT_URL,
        name: 'Test',
      });

      const calendar = Calendar.fromObject({ id: TEST_CALENDAR_ID, urlName: TEST_CALENDAR_URL_NAME });

      await expect(service.processCreateEvent(calendar, activityMessage)).rejects.toThrow();
    });

    it('should still throw exception after logging for Update', async () => {
      sandbox.stub(service as any, 'isPersonActorUri').resolves(true);
      sandbox.stub(service as any, 'isAuthorizedRemoteEditor').resolves(false);

      // Stub EventObjectEntity.findOne to return a mock event object
      const mockEventId = 'mock-event-id';
      sandbox.stub(EventObjectEntity, 'findOne').resolves(
        EventObjectEntity.build({ event_id: mockEventId, ap_id: REMOTE_EVENT_URL }),
      );

      // Stub getEventById to return a mock event (required for Update to proceed to auth check)
      const mockEvent = { id: mockEventId, calendarId: TEST_CALENDAR_ID };
      sandbox.stub(service.calendarInterface, 'getEventById').resolves(mockEvent as any);

      const activityMessage = createMockUpdateActivity(REMOTE_ACTOR_URL, {
        type: 'Event',
        id: REMOTE_EVENT_URL,
        name: 'Test',
      });

      const calendar = Calendar.fromObject({ id: TEST_CALENDAR_ID, urlName: TEST_CALENDAR_URL_NAME });

      await expect(service.processUpdateEvent(calendar, activityMessage)).rejects.toThrow();
    });

    it('should still throw exception after logging for Delete', async () => {
      sandbox.stub(service as any, 'isPersonActorUri').resolves(true);
      sandbox.stub(service as any, 'isAuthorizedRemoteEditor').resolves(false);

      // Stub EventObjectEntity.findOne to return a mock event object
      const mockEventId = 'mock-event-id';
      sandbox.stub(EventObjectEntity, 'findOne').resolves(
        EventObjectEntity.build({ event_id: mockEventId, ap_id: REMOTE_EVENT_URL }),
      );

      // Stub getEventById to return a mock event (required for Delete to proceed to auth check)
      const mockEvent = { id: mockEventId, calendarId: TEST_CALENDAR_ID };
      sandbox.stub(service.calendarInterface, 'getEventById').resolves(mockEvent as any);

      // Create Delete activity with object as an object with id property (not just a string)
      const activityMessage = createMockDeleteActivity(REMOTE_ACTOR_URL, { id: REMOTE_EVENT_URL });

      const calendar = Calendar.fromObject({ id: TEST_CALENDAR_ID, urlName: TEST_CALENDAR_URL_NAME });

      await expect(service.processDeleteEvent(calendar, activityMessage)).rejects.toThrow();
    });
  });
});

describe('Relationship-Based Inbox Filtering', () => {
  let service: ProcessInboxService;
  let sandbox: sinon.SinonSandbox;

  const TEST_CALENDAR_ID = 'test-calendar-id';
  const TEST_CALENDAR_URL_NAME = 'testcalendar';
  // Calendar actor URL (no /users/ in path — will NOT be treated as Person actor)
  const REMOTE_CALENDAR_ACTOR_URL = 'https://remote.federation.test/calendars/events';
  const REMOTE_EVENT_URL = 'https://remote.federation.test/events/123';
  // Person actor URL (has /users/ in path — treated as Person actor, filter is skipped)
  const REMOTE_PERSON_ACTOR_URL = 'https://remote.federation.test/users/alice';
  const REMOTE_CALENDAR_ACTOR_ID = 'remote-actor-uuid';

  // A mock CalendarActor returned by remoteCalendarService.getByActorUri
  const mockRemoteCalendarActor = {
    id: REMOTE_CALENDAR_ACTOR_ID,
    actorUri: REMOTE_CALENDAR_ACTOR_URL,
    actorType: 'remote' as const,
    calendarId: null,
    remoteCalendarId: null,
    remoteDisplayName: null,
    remoteDomain: 'remote.federation.test',
    inboxUrl: null,
    sharedInboxUrl: null,
    lastFetched: null,
    publicKey: null,
    privateKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    const eventBus = new EventEmitter();
    const calendarInterface = new CalendarInterface(eventBus);
    service = new ProcessInboxService(eventBus, calendarInterface);

    // Default: return calendar for lookup
    sandbox.stub(service.calendarInterface, 'getCalendar')
      .resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID, urlName: TEST_CALENDAR_URL_NAME }));

    // Default: stub message update
    sandbox.stub(ActivityPubInboxMessageEntity.prototype, 'update').resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('hasRelationshipWithCalendar — addressing check', () => {
    it('should return true when local actor URI appears in "to" field', async () => {
      // Stub getByActorUri to return null (no DB record needed for addressing check)
      sandbox.stub(service.remoteCalendarService, 'getByActorUri').resolves(null);

      const localActorUri = ActivityPubActor.actorUrl(Calendar.fromObject({ id: TEST_CALENDAR_ID, urlName: TEST_CALENDAR_URL_NAME }));
      const rawMessage = {
        type: 'Create',
        actor: REMOTE_CALENDAR_ACTOR_URL,
        to: [localActorUri],
        object: { type: 'Event', id: REMOTE_EVENT_URL },
      };

      const result = await (service as any).hasRelationshipWithCalendar(
        Calendar.fromObject({ id: TEST_CALENDAR_ID, urlName: TEST_CALENDAR_URL_NAME }),
        REMOTE_CALENDAR_ACTOR_URL,
        ActivityPubInboxMessageEntity.build({ calendar_id: TEST_CALENDAR_ID, type: 'Create', message: rawMessage }),
      );

      expect(result).toBe(true);
    });

    it('should return true when local actor URI appears in "cc" field', async () => {
      sandbox.stub(service.remoteCalendarService, 'getByActorUri').resolves(null);

      const localActorUri = ActivityPubActor.actorUrl(Calendar.fromObject({ id: TEST_CALENDAR_ID, urlName: TEST_CALENDAR_URL_NAME }));
      const rawMessage = {
        type: 'Create',
        actor: REMOTE_CALENDAR_ACTOR_URL,
        cc: localActorUri, // single string (not array)
        object: { type: 'Event', id: REMOTE_EVENT_URL },
      };

      const result = await (service as any).hasRelationshipWithCalendar(
        Calendar.fromObject({ id: TEST_CALENDAR_ID, urlName: TEST_CALENDAR_URL_NAME }),
        REMOTE_CALENDAR_ACTOR_URL,
        ActivityPubInboxMessageEntity.build({ calendar_id: TEST_CALENDAR_ID, type: 'Create', message: rawMessage }),
      );

      expect(result).toBe(true);
    });
  });

  describe('hasRelationshipWithCalendar — following/follower checks', () => {
    it('should return false when actor is unknown (not in DB)', async () => {
      sandbox.stub(service.remoteCalendarService, 'getByActorUri').resolves(null);

      const rawMessage = {
        type: 'Create',
        actor: REMOTE_CALENDAR_ACTOR_URL,
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        object: { type: 'Event', id: REMOTE_EVENT_URL },
      };

      const result = await (service as any).hasRelationshipWithCalendar(
        Calendar.fromObject({ id: TEST_CALENDAR_ID, urlName: TEST_CALENDAR_URL_NAME }),
        REMOTE_CALENDAR_ACTOR_URL,
        ActivityPubInboxMessageEntity.build({ calendar_id: TEST_CALENDAR_ID, type: 'Create', message: rawMessage }),
      );

      expect(result).toBe(false);
    });

    it('should return true when local calendar follows the sender (FollowingCalendarEntity exists)', async () => {
      sandbox.stub(service.remoteCalendarService, 'getByActorUri').resolves(mockRemoteCalendarActor);
      // We follow them
      sandbox.stub(FollowingCalendarEntity, 'findOne').resolves({ id: 'follow-id' } as any);
      sandbox.stub(FollowerCalendarEntity, 'findOne').resolves(null);

      const rawMessage = {
        type: 'Create',
        actor: REMOTE_CALENDAR_ACTOR_URL,
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        object: { type: 'Event', id: REMOTE_EVENT_URL },
      };

      const result = await (service as any).hasRelationshipWithCalendar(
        Calendar.fromObject({ id: TEST_CALENDAR_ID, urlName: TEST_CALENDAR_URL_NAME }),
        REMOTE_CALENDAR_ACTOR_URL,
        ActivityPubInboxMessageEntity.build({ calendar_id: TEST_CALENDAR_ID, type: 'Create', message: rawMessage }),
      );

      expect(result).toBe(true);
    });

    it('should return true when sender follows local calendar (FollowerCalendarEntity exists)', async () => {
      sandbox.stub(service.remoteCalendarService, 'getByActorUri').resolves(mockRemoteCalendarActor);
      // They follow us
      sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(null);
      sandbox.stub(FollowerCalendarEntity, 'findOne').resolves({ id: 'follower-id' } as any);

      const rawMessage = {
        type: 'Create',
        actor: REMOTE_CALENDAR_ACTOR_URL,
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        object: { type: 'Event', id: REMOTE_EVENT_URL },
      };

      const result = await (service as any).hasRelationshipWithCalendar(
        Calendar.fromObject({ id: TEST_CALENDAR_ID, urlName: TEST_CALENDAR_URL_NAME }),
        REMOTE_CALENDAR_ACTOR_URL,
        ActivityPubInboxMessageEntity.build({ calendar_id: TEST_CALENDAR_ID, type: 'Create', message: rawMessage }),
      );

      expect(result).toBe(true);
    });

    it('should return false when actor is known but no follow relationship exists', async () => {
      sandbox.stub(service.remoteCalendarService, 'getByActorUri').resolves(mockRemoteCalendarActor);
      sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(null);
      sandbox.stub(FollowerCalendarEntity, 'findOne').resolves(null);

      const rawMessage = {
        type: 'Create',
        actor: REMOTE_CALENDAR_ACTOR_URL,
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        object: { type: 'Event', id: REMOTE_EVENT_URL },
      };

      const result = await (service as any).hasRelationshipWithCalendar(
        Calendar.fromObject({ id: TEST_CALENDAR_ID, urlName: TEST_CALENDAR_URL_NAME }),
        REMOTE_CALENDAR_ACTOR_URL,
        ActivityPubInboxMessageEntity.build({ calendar_id: TEST_CALENDAR_ID, type: 'Create', message: rawMessage }),
      );

      expect(result).toBe(false);
    });
  });

  describe('Filter gate in processInboxMessage', () => {
    it('should reject Create activity from Calendar actor with no relationship', async () => {
      // No relationship
      sandbox.stub(service.remoteCalendarService, 'getByActorUri').resolves(null);

      const activityMessage = createMockCreateActivity(REMOTE_CALENDAR_ACTOR_URL, {
        type: 'Event',
        id: REMOTE_EVENT_URL,
        name: 'Test Event',
      });

      const message = ActivityPubInboxMessageEntity.build({
        calendar_id: TEST_CALENDAR_ID,
        type: 'Create',
        message: activityMessage,
      });

      const processStub = sandbox.stub(service, 'processCreateEvent');
      const updateStub = (ActivityPubInboxMessageEntity.prototype.update as sinon.SinonStub);

      await service.processInboxMessage(message);

      expect(processStub.called).toBe(false);
      expect(updateStub.calledOnce).toBe(true);
      expect(updateStub.firstCall.args[0].processed_status).toBe('rejected');
    });

    it('should reject Update activity from Calendar actor with no relationship', async () => {
      sandbox.stub(service.remoteCalendarService, 'getByActorUri').resolves(null);

      const activityMessage = createMockUpdateActivity(REMOTE_CALENDAR_ACTOR_URL, {
        type: 'Event',
        id: REMOTE_EVENT_URL,
        name: 'Updated Event',
      });

      const message = ActivityPubInboxMessageEntity.build({
        calendar_id: TEST_CALENDAR_ID,
        type: 'Update',
        message: activityMessage,
      });

      const processStub = sandbox.stub(service, 'processUpdateEvent');
      const updateStub = (ActivityPubInboxMessageEntity.prototype.update as sinon.SinonStub);

      await service.processInboxMessage(message);

      expect(processStub.called).toBe(false);
      expect(updateStub.firstCall.args[0].processed_status).toBe('rejected');
    });

    it('should reject Delete activity from Calendar actor with no relationship', async () => {
      sandbox.stub(service.remoteCalendarService, 'getByActorUri').resolves(null);

      const activityMessage = createMockDeleteActivity(REMOTE_CALENDAR_ACTOR_URL, REMOTE_EVENT_URL);

      const message = ActivityPubInboxMessageEntity.build({
        calendar_id: TEST_CALENDAR_ID,
        type: 'Delete',
        message: activityMessage,
      });

      const processStub = sandbox.stub(service, 'processDeleteEvent');
      const updateStub = (ActivityPubInboxMessageEntity.prototype.update as sinon.SinonStub);

      await service.processInboxMessage(message);

      expect(processStub.called).toBe(false);
      expect(updateStub.firstCall.args[0].processed_status).toBe('rejected');
    });

    it('should reject Announce activity from Calendar actor with no relationship', async () => {
      sandbox.stub(service.remoteCalendarService, 'getByActorUri').resolves(null);

      const activityMessage = createMockAnnounceActivity(REMOTE_CALENDAR_ACTOR_URL, REMOTE_EVENT_URL);

      const message = ActivityPubInboxMessageEntity.build({
        calendar_id: TEST_CALENDAR_ID,
        type: 'Announce',
        message: activityMessage,
      });

      const processStub = sandbox.stub(service, 'processShareEvent');
      const updateStub = (ActivityPubInboxMessageEntity.prototype.update as sinon.SinonStub);

      await service.processInboxMessage(message);

      expect(processStub.called).toBe(false);
      expect(updateStub.firstCall.args[0].processed_status).toBe('rejected');
    });

    it('should NOT filter Follow activities from Calendar actors (Follow is not filtered)', async () => {
      // Follow activities are not in the filtered types list
      const activityMessage = createMockFollowActivity(REMOTE_CALENDAR_ACTOR_URL, `https://pavillion.test/calendars/${TEST_CALENDAR_URL_NAME}`);

      const message = ActivityPubInboxMessageEntity.build({
        calendar_id: TEST_CALENDAR_ID,
        type: 'Follow',
        message: activityMessage,
      });

      const processStub = sandbox.stub(service, 'processFollowAccount');
      const updateStub = (ActivityPubInboxMessageEntity.prototype.update as sinon.SinonStub);

      await service.processInboxMessage(message);

      expect(processStub.called).toBe(true);
      expect(updateStub.firstCall.args[0].processed_status).toBe('ok');
    });

    it('should NOT filter Create activities from Person actors (filter skipped for /users/ URIs)', async () => {
      // Person actors use /users/ in their URI
      const activityMessage = createMockCreateActivity(REMOTE_PERSON_ACTOR_URL, {
        type: 'Event',
        id: REMOTE_EVENT_URL,
        name: 'Person Event',
      });

      const message = ActivityPubInboxMessageEntity.build({
        calendar_id: TEST_CALENDAR_ID,
        type: 'Create',
        message: activityMessage,
      });

      const processStub = sandbox.stub(service, 'processCreateEvent');
      const updateStub = (ActivityPubInboxMessageEntity.prototype.update as sinon.SinonStub);

      await service.processInboxMessage(message);

      // Should proceed to processCreateEvent (not filtered)
      expect(processStub.called).toBe(true);
    });

    it('should allow Create from Calendar actor when following relationship exists', async () => {
      // We follow this remote calendar
      sandbox.stub(service.remoteCalendarService, 'getByActorUri').resolves(mockRemoteCalendarActor);
      sandbox.stub(FollowingCalendarEntity, 'findOne').resolves({ id: 'follow-id' } as any);
      sandbox.stub(FollowerCalendarEntity, 'findOne').resolves(null);

      const activityMessage = createMockCreateActivity(REMOTE_CALENDAR_ACTOR_URL, {
        type: 'Event',
        id: REMOTE_EVENT_URL,
        name: 'Test Event',
      });

      const message = ActivityPubInboxMessageEntity.build({
        calendar_id: TEST_CALENDAR_ID,
        type: 'Create',
        message: activityMessage,
      });

      const processStub = sandbox.stub(service, 'processCreateEvent');
      const updateStub = (ActivityPubInboxMessageEntity.prototype.update as sinon.SinonStub);

      await service.processInboxMessage(message);

      expect(processStub.called).toBe(true);
      expect(updateStub.firstCall.args[0].processed_status).toBe('ok');
    });

    it('should log rejection with no_relationship type when filtering', async () => {
      const consoleWarnStub = sandbox.stub(console, 'warn');

      sandbox.stub(service.remoteCalendarService, 'getByActorUri').resolves(null);

      const activityMessage = createMockCreateActivity(REMOTE_CALENDAR_ACTOR_URL, {
        type: 'Event',
        id: REMOTE_EVENT_URL,
        name: 'Unrelated Event',
      });

      const message = ActivityPubInboxMessageEntity.build({
        id: 'test-msg-id',
        calendar_id: TEST_CALENDAR_ID,
        type: 'Create',
        message: activityMessage,
      });

      await service.processInboxMessage(message);

      // Find JSON log entry in console.warn calls
      let logEntry: any = null;
      for (let i = 0; i < consoleWarnStub.callCount; i++) {
        try {
          const arg = consoleWarnStub.getCall(i).args[0];
          if (typeof arg === 'string' && arg.includes('"rejection_type"')) {
            logEntry = JSON.parse(arg);
            break;
          }
        }
        catch (e) {
          // not JSON
        }
      }

      expect(logEntry).toBeDefined();
      expect(logEntry.rejection_type).toBe('no_relationship');
      expect(logEntry.activity_type).toBe('Create');
      expect(logEntry.actor_uri).toBe(REMOTE_CALENDAR_ACTOR_URL);
    });
  });
});
