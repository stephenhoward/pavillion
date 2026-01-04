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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Calendar } from '@/common/model/calendar';
import ProcessInboxService from '@/server/activitypub/service/inbox';
import { ActivityPubInboxMessageEntity, ActivityPubOutboxMessageEntity, FollowerCalendarEntity } from '@/server/activitypub/entity/activitypub';
import CalendarInterface from '@/server/calendar/interface';

// Import Fedify mock helpers for creating well-formed ActivityPub activities
import {
  createMockFollowActivity,
  createMockCreateActivity,
  createMockUpdateActivity,
  createMockDeleteActivity,
  createMockAnnounceActivity,
  createMockUndoActivity,
} from '@/server/activitypub/test/helpers/fedify-mock';


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
});
