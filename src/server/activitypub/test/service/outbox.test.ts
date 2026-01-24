/**
 * Tests for ProcessOutboxService
 *
 * These tests verify outbox message processing for sending ActivityPub activities.
 * Uses Fedify mock utilities for creating well-formed ActivityPub activities,
 * and Sinon for mocking HTTP requests, database entities, and services.
 *
 * The Fedify mock helpers provide:
 * - Properly formatted ActivityPub activities with @context
 * - Consistent activity structure matching the ActivityStreams spec
 * - Mock federation context for tracking sent activities
 *
 * Sinon is still used for:
 * - Mocking axios HTTP requests (for WebFinger and actor profile fetching)
 * - Mocking database entity methods (findAll, update)
 * - Stubbing service methods (calendarService.getCalendar)
 *
 * Note: The outbox service currently uses axios directly for HTTP calls.
 * The Fedify mock federation utilities could replace this in the future
 * if the service is refactored to use Fedify's built-in HTTP handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Calendar } from '@/common/model/calendar';
import ProcessOutboxService from '@/server/activitypub/service/outbox';
import {
  EventActivityEntity,
  ActivityPubOutboxMessageEntity,
  FollowerCalendarEntity,
} from '@/server/activitypub/entity/activitypub';

// Import Fedify mock helpers for creating well-formed ActivityPub activities
import {
  createMockCreateActivity,
  createMockFollowActivity,
  createMockFederation,
  getSentActivities,
  type MockFederationContext,
} from '@/server/activitypub/test/helpers/fedify-mock';


// Test constants for consistent URLs across tests
const TEST_CALENDAR_ID = 'testid';
const LOCAL_ACTOR_URL = 'https://local.federation.test/calendars/events';
const REMOTE_CALENDAR_HANDLE = 'remotecalendar@remotedomain.test';
const REMOTE_PROFILE_URL = 'https://remotedomain.test/calendars/testcalendar';
const REMOTE_INBOX_URL = 'https://remotedomain.test/calendars/testcalendar/inbox';
const OBSERVER_CALENDAR_HANDLE = 'observercalendar@observerdomain.test';


describe('resolveInbox', () => {
  let service: ProcessOutboxService;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    const eventBus = new EventEmitter();
    service = new ProcessOutboxService(eventBus);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return null without profile url', async () => {
    const profileStub = sandbox.stub(service, 'fetchProfileUrl');
    profileStub.resolves(null);

    const result = await service.resolveInboxUrl(REMOTE_CALENDAR_HANDLE);
    expect(result).toBeNull();
  });

  it('should return null without profile response', async () => {
    const profileStub = sandbox.stub(service, 'fetchProfileUrl');
    profileStub.resolves(REMOTE_PROFILE_URL);

    // Stub axios to return null (simulating failed HTTP request)
    const getStub = sandbox.stub(axios, 'get');
    getStub.resolves(null);

    const result = await service.resolveInboxUrl(REMOTE_CALENDAR_HANDLE);
    expect(result).toBeNull();
  });

  it('should return a url for inbox', async () => {
    const profileStub = sandbox.stub(service, 'fetchProfileUrl');
    profileStub.resolves(REMOTE_PROFILE_URL);

    // Stub axios to return an ActivityPub actor profile with inbox
    const getStub = sandbox.stub(axios, 'get');
    getStub.resolves({
      data: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Organization',
        id: REMOTE_PROFILE_URL,
        inbox: REMOTE_INBOX_URL,
      },
    });

    const result = await service.resolveInboxUrl(REMOTE_CALENDAR_HANDLE);
    expect(result).toBe(REMOTE_INBOX_URL);
  });
});


describe('fetchProfileUrl', () => {
  let service: ProcessOutboxService;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    const eventBus = new EventEmitter();
    service = new ProcessOutboxService(eventBus);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return null without webfinger response', async () => {
    const getStub = sandbox.stub(axios, 'get');
    getStub.resolves(null);

    const result = await service.fetchProfileUrl(REMOTE_CALENDAR_HANDLE);
    expect(result).toBeNull();
  });

  it('should return null without profile link', async () => {
    // WebFinger response with empty links array
    const getStub = sandbox.stub(axios, 'get');
    getStub.resolves({ data: { links: [] } });

    const result = await service.fetchProfileUrl(REMOTE_CALENDAR_HANDLE);
    expect(result).toBeNull();
  });

  it('should return a url for profile', async () => {
    // WebFinger response with self link pointing to ActivityPub actor
    const getStub = sandbox.stub(axios, 'get');
    getStub.resolves({
      data: {
        subject: `acct:${REMOTE_CALENDAR_HANDLE}`,
        links: [
          {
            rel: 'self',
            type: 'application/activity+json',
            href: REMOTE_PROFILE_URL,
          },
        ],
      },
    });

    const result = await service.fetchProfileUrl(REMOTE_CALENDAR_HANDLE);
    expect(result).toBe(REMOTE_PROFILE_URL);
  });
});


describe('getRecipients', () => {
  let service: ProcessOutboxService;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    const eventBus = new EventEmitter();
    service = new ProcessOutboxService(eventBus);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return an empty array with no followers or observers', async () => {
    const followersStub = sandbox.stub(FollowerCalendarEntity, 'findAll');
    followersStub.resolves([]);

    const observersStub = sandbox.stub(EventActivityEntity, 'findAll');
    observersStub.resolves([]);

    const calendar = Calendar.fromObject({ id: TEST_CALENDAR_ID });
    const result = await service.getRecipients(calendar, { id: 'testobject' });
    expect(result).toStrictEqual([]);
  });

  it('should return an array with followers and observers', async () => {
    const followersStub = sandbox.stub(FollowerCalendarEntity, 'findAll');
    // Mock follower with remoteCalendar association containing actor_uri
    const mockFollower = {
      remote_calendar_id: 'mock-remote-calendar-uuid-1',
      remoteCalendar: {
        id: 'mock-remote-calendar-uuid-1',
        actor_uri: REMOTE_CALENDAR_HANDLE,
      },
    };
    followersStub.resolves([mockFollower as any]);

    const observersStub = sandbox.stub(EventActivityEntity, 'findAll');
    // Mock observer with remoteCalendar association containing actor_uri
    const mockObserver = {
      remote_calendar_id: 'mock-remote-calendar-uuid-2',
      remoteCalendar: {
        id: 'mock-remote-calendar-uuid-2',
        actor_uri: OBSERVER_CALENDAR_HANDLE,
      },
    };
    observersStub.resolves([mockObserver as any]);

    const calendar = Calendar.fromObject({ id: TEST_CALENDAR_ID });
    const result = await service.getRecipients(calendar, { id: 'testobject' });
    expect(result).toStrictEqual([REMOTE_CALENDAR_HANDLE, OBSERVER_CALENDAR_HANDLE]);
  });
});


describe('processOutboxMessage', () => {
  let service: ProcessOutboxService;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    const eventBus = new EventEmitter();
    service = new ProcessOutboxService(eventBus);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should fail without calendar', async () => {
    // Use Fedify helper to create a proper Create activity
    const activityMessage = createMockCreateActivity(LOCAL_ACTOR_URL, {
      type: 'Event',
      id: `${LOCAL_ACTOR_URL}/events/123`,
      name: 'Test Event',
    });

    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Create',
      message: activityMessage,
    });
    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    getCalendarStub.resolves(null);

    await expect(service.processOutboxMessage(message)).rejects.toThrow('No calendar found for message');
  });

  it('should skip invalid message type', async () => {
    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'NotAType',
      message: { to: REMOTE_CALENDAR_HANDLE },
    });

    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    const postStub = sandbox.stub(axios, 'post');
    const updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');

    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));

    await service.processOutboxMessage(message);

    expect(postStub.called).toBe(false);
    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('bad message type');
  });

  it('should skip message without recipients', async () => {
    // Use Fedify helper to create a proper Create activity with Event object
    const activityMessage = createMockCreateActivity(LOCAL_ACTOR_URL, {
      type: 'Event',
      id: `${LOCAL_ACTOR_URL}/events/123`,
      name: 'Test Event',
    });

    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Create',
      message: activityMessage,
    });

    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    const postStub = sandbox.stub(axios, 'post');
    const updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');
    const getRecipientsStub = sandbox.stub(service, 'getRecipients');
    const resolveStub = sandbox.stub(service, 'resolveInboxUrl');

    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));
    getRecipientsStub.resolves([]);
    resolveStub.resolves(null);

    await service.processOutboxMessage(message);

    expect(postStub.called).toBe(false);
    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
  });

  it('should skip recipients without inbox', async () => {
    // Use Fedify helper to create a proper Create activity
    const activityMessage = createMockCreateActivity(LOCAL_ACTOR_URL, {
      type: 'Event',
      id: `${LOCAL_ACTOR_URL}/events/123`,
      name: 'Test Event',
    });

    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Create',
      message: activityMessage,
    });

    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    const postStub = sandbox.stub(axios, 'post');
    const updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');
    const getRecipientsStub = sandbox.stub(service, 'getRecipients');
    const resolveStub = sandbox.stub(service, 'resolveInboxUrl');

    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));
    getRecipientsStub.resolves([REMOTE_CALENDAR_HANDLE]);
    resolveStub.resolves(null);

    await service.processOutboxMessage(message);

    expect(postStub.called).toBe(false);
    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
  });

  it('should send message to each recipient', async () => {
    // Use Fedify helper to create a proper Create activity
    const activityMessage = createMockCreateActivity(LOCAL_ACTOR_URL, {
      type: 'Event',
      id: `${LOCAL_ACTOR_URL}/events/123`,
      name: 'Test Event',
    });

    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Create',
      message: activityMessage,
    });

    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    const postStub = sandbox.stub(axios, 'post');
    const updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');
    const getRecipientsStub = sandbox.stub(service, 'getRecipients');
    const resolveStub = sandbox.stub(service, 'resolveInboxUrl');

    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));
    getRecipientsStub.resolves([REMOTE_CALENDAR_HANDLE, OBSERVER_CALENDAR_HANDLE]);
    resolveStub.resolves(REMOTE_INBOX_URL);

    await service.processOutboxMessage(message);

    expect(postStub.calledTwice).toBe(true);
    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
  });
});


/**
 * Additional tests demonstrating Fedify mock federation usage.
 *
 * These tests show how the MockFederationContext can be used to track
 * activities that would be sent, without making actual HTTP requests.
 * This pattern is useful for testing federation logic in isolation.
 */
describe('MockFederation Activity Tracking', () => {
  let mockFed: MockFederationContext;

  beforeEach(() => {
    mockFed = createMockFederation({ domain: 'local.federation.test' });
  });

  it('should track Create activities sent through mock federation', async () => {
    const createActivity = createMockCreateActivity(LOCAL_ACTOR_URL, {
      type: 'Event',
      id: `${LOCAL_ACTOR_URL}/events/123`,
      name: 'Community Meetup',
      startTime: '2025-01-15T18:00:00Z',
    });

    await mockFed.sendActivity(createActivity, [
      REMOTE_INBOX_URL,
      'https://observerdomain.test/inbox',
    ]);

    const sent = getSentActivities(mockFed);
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('Create');
    expect(sent[0].recipients).toHaveLength(2);
  });

  it('should track Follow activities sent through mock federation', async () => {
    const followActivity = createMockFollowActivity(LOCAL_ACTOR_URL, REMOTE_PROFILE_URL);

    await mockFed.sendActivity(followActivity, [REMOTE_INBOX_URL]);

    const sent = getSentActivities(mockFed);
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('Follow');
    expect(sent[0].recipients).toEqual([REMOTE_INBOX_URL]);
  });

  it('should allow tracking multiple activities in sequence', async () => {
    const createActivity = createMockCreateActivity(LOCAL_ACTOR_URL, { type: 'Event' });
    const followActivity = createMockFollowActivity(LOCAL_ACTOR_URL, REMOTE_PROFILE_URL);

    await mockFed.sendActivity(createActivity, [REMOTE_INBOX_URL]);
    await mockFed.sendActivity(followActivity, [REMOTE_INBOX_URL]);

    const sent = getSentActivities(mockFed);
    expect(sent).toHaveLength(2);
    expect(sent[0].type).toBe('Create');
    expect(sent[1].type).toBe('Follow');
  });
});
