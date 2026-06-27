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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Calendar } from '@/common/model/calendar';
import ProcessOutboxService from '@/server/activitypub/service/outbox';
import ProcessInboxService from '@/server/activitypub/service/inbox';
import {
  EventActivityEntity,
  ActivityPubOutboxMessageEntity,
  FollowerCalendarEntity,
} from '@/server/activitypub/entity/activitypub';

// Import Fedify mock helpers for creating well-formed ActivityPub activities
import {
  createMockAnnounceActivity,
  createMockCreateActivity,
  createMockDeleteActivity,
  createMockFollowActivity,
  createMockUpdateActivity,
} from '@/server/activitypub/test/helpers/fedify-mock';

// Mock the ip-validation module so tests can control SSRF validation behaviour
// without performing real DNS lookups. Defaults to resolving safely (no throw).
vi.mock('@/server/common/helper/ip-validation', () => ({
  validateUrlNotPrivate: vi.fn().mockResolvedValue(true),
  isPrivateIP: vi.fn().mockReturnValue(false),
}));

import { validateUrlNotPrivate } from '@/server/common/helper/ip-validation';


// Test constants for consistent URLs across tests
const TEST_CALENDAR_ID = 'testid';
const LOCAL_ACTOR_URL = 'https://local.federation.test/calendars/events';
const REMOTE_CALENDAR_HANDLE = 'remotecalendar@remotedomain.test';
const REMOTE_PROFILE_URL = 'https://remotedomain.test/calendars/testcalendar';
const REMOTE_INBOX_URL = 'https://remotedomain.test/calendars/testcalendar/inbox';
const OBSERVER_CALENDAR_HANDLE = 'observercalendar@observerdomain.test';

/** Stub signing on a service so deliverViaHttp can proceed without real keypairs. */
function stubSigning(service: ProcessOutboxService, sandbox: sinon.SinonSandbox) {
  sandbox.stub(service.calendarActorService, 'signActivity').resolves({
    keyId: `${LOCAL_ACTOR_URL}#main-key`,
    signature: 'mock-signature-base64',
    algorithm: 'rsa-sha256',
    headers: '(request-target) host date digest',
    date: new Date().toUTCString(),
  });
}


describe('resolveInbox', () => {
  let service: ProcessOutboxService;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const mockInbox = {
      handleLocalActivityDispatch: sandbox.stub().resolves(),
    } as unknown as ProcessInboxService;
    service = new ProcessOutboxService(eventBus, mockInbox);
    vi.mocked(validateUrlNotPrivate).mockResolvedValue(true);
  });

  afterEach(() => {
    sandbox.restore();
    vi.restoreAllMocks();
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

  it('should return null when actor profile URL resolves to a private IP (SSRF)', async () => {
    // fetchProfileUrl returns a profile URL that resolves to a private IP
    const profileStub = sandbox.stub(service, 'fetchProfileUrl');
    profileStub.resolves(REMOTE_PROFILE_URL);

    // Simulate validateUrlNotPrivate blocking the profile URL (private IP SSRF)
    vi.mocked(validateUrlNotPrivate).mockRejectedValueOnce(
      new Error('Hostname remotedomain.test resolves to a private IP address'),
    );

    const result = await service.resolveInboxUrl(REMOTE_CALENDAR_HANDLE);
    expect(result).toBeNull();
  });
});


describe('fetchProfileUrl', () => {
  let service: ProcessOutboxService;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const mockInbox = {
      handleLocalActivityDispatch: sandbox.stub().resolves(),
    } as unknown as ProcessInboxService;
    service = new ProcessOutboxService(eventBus, mockInbox);
    vi.mocked(validateUrlNotPrivate).mockResolvedValue(true);
  });

  afterEach(() => {
    sandbox.restore();
    vi.restoreAllMocks();
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

  it('should return null when webfingerUrl resolves to a private IP (SSRF)', async () => {
    // Simulate validateUrlNotPrivate blocking the WebFinger URL (private IP SSRF)
    vi.mocked(validateUrlNotPrivate).mockRejectedValueOnce(
      new Error('Hostname private-domain.example resolves to a private IP address'),
    );

    const result = await service.fetchProfileUrl('user@private-domain.example');
    expect(result).toBeNull();
  });
});


describe('getRecipients', () => {
  let service: ProcessOutboxService;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const mockInbox = {
      handleLocalActivityDispatch: sandbox.stub().resolves(),
    } as unknown as ProcessInboxService;
    service = new ProcessOutboxService(eventBus, mockInbox);
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
    // Mock follower with calendarActor association containing actor_uri
    const mockFollower = {
      calendar_actor_id: 'mock-calendar-actor-uuid-1',
      calendarActor: {
        id: 'mock-calendar-actor-uuid-1',
        actor_uri: REMOTE_CALENDAR_HANDLE,
      },
    };
    followersStub.resolves([mockFollower as any]);

    const observersStub = sandbox.stub(EventActivityEntity, 'findAll');
    // Mock observer with calendarActor association containing actor_uri
    const mockObserver = {
      calendar_actor_id: 'mock-calendar-actor-uuid-2',
      calendarActor: {
        id: 'mock-calendar-actor-uuid-2',
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
    const mockInbox = {
      handleLocalActivityDispatch: sandbox.stub().resolves(),
    } as unknown as ProcessInboxService;
    service = new ProcessOutboxService(eventBus, mockInbox);
    vi.mocked(validateUrlNotPrivate).mockResolvedValue(true);

    // Default per-recipient local-resolution to "not local" so tests
    // exercising the HTTP delivery path don't hit the live SQLite
    // calendar_actor table. Tests focused on the local dispatch path
    // override this stub explicitly.
    sandbox
      .stub(service.calendarActorService, 'getLocalCalendarByActorUri')
      .resolves(null);
  });

  afterEach(() => {
    sandbox.restore();
    vi.restoreAllMocks();
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

  it('should send message to each recipient with signed headers', async () => {
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
    stubSigning(service, sandbox);

    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));
    getRecipientsStub.resolves([REMOTE_CALENDAR_HANDLE, OBSERVER_CALENDAR_HANDLE]);
    resolveStub.resolves(REMOTE_INBOX_URL);

    await service.processOutboxMessage(message);

    expect(postStub.calledTwice).toBe(true);

    // Verify signed headers are present on the POST request
    const firstCallHeaders = postStub.getCalls()[0].args[2]?.headers;
    expect(firstCallHeaders).toBeDefined();
    expect(firstCallHeaders['Signature']).toMatch(/keyId=.*algorithm=.*headers=.*signature=/);
    expect(firstCallHeaders['Date']).toBeDefined();
    expect(firstCallHeaders['Digest']).toMatch(/^SHA-256=/);

    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
  });

  it('should send JSON string body matching the Digest', async () => {
    const activityMessage = createMockCreateActivity(LOCAL_ACTOR_URL, {
      type: 'Event',
      id: `${LOCAL_ACTOR_URL}/events/456`,
      name: 'Digest Test Event',
    });

    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Create',
      message: activityMessage,
    });

    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    const postStub = sandbox.stub(axios, 'post');
    const _updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');
    const getRecipientsStub = sandbox.stub(service, 'getRecipients');
    const resolveStub = sandbox.stub(service, 'resolveInboxUrl');
    stubSigning(service, sandbox);

    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));
    getRecipientsStub.resolves([REMOTE_CALENDAR_HANDLE]);
    resolveStub.resolves(REMOTE_INBOX_URL);

    await service.processOutboxMessage(message);

    expect(postStub.calledOnce).toBe(true);

    // Body should be a string (JSON.stringify'd), not an object
    const bodyArg = postStub.getCalls()[0].args[1];
    expect(typeof bodyArg).toBe('string');

    // Verify the Digest matches the body bytes
    const { createHash } = await import('crypto');
    const expectedDigest = 'SHA-256=' + createHash('sha256').update(bodyArg as string).digest('base64');
    const actualDigest = postStub.getCalls()[0].args[2]?.headers['Digest'];
    expect(actualDigest).toBe(expectedDigest);
  });

  it('should record partial error when signing fails, not crash', async () => {
    const activityMessage = createMockCreateActivity(LOCAL_ACTOR_URL, {
      type: 'Event',
      id: `${LOCAL_ACTOR_URL}/events/789`,
      name: 'Signing Failure Event',
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

    // Both signing services throw — simulates no matching actor
    sandbox.stub(service.calendarActorService, 'signActivity').rejects(new Error('No calendar actor found'));

    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));
    getRecipientsStub.resolves([REMOTE_CALENDAR_HANDLE]);
    resolveStub.resolves(REMOTE_INBOX_URL);

    // Should NOT throw
    await service.processOutboxMessage(message);

    // HTTP POST should not have been called (signing failed before POST)
    expect(postStub.called).toBe(false);
    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toMatch(/^partial:.*Signing failed/);
  });

  it('should fall back to user actor signing when calendar actor fails', async () => {
    const activityMessage = createMockCreateActivity(LOCAL_ACTOR_URL, {
      type: 'Event',
      id: `${LOCAL_ACTOR_URL}/events/fallback`,
      name: 'Fallback Signing Event',
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

    // Calendar actor fails, user actor succeeds
    sandbox.stub(service.calendarActorService, 'signActivity').rejects(new Error('No calendar actor'));
    // Access userActorService via type assertion to stub private property
    const userActorStub = sandbox.stub(
      (service as any).userActorService, 'signActivity',
    ).resolves({
      keyId: `${LOCAL_ACTOR_URL}/users/admin#main-key`,
      signature: 'user-actor-signature',
      algorithm: 'rsa-sha256',
      headers: '(request-target) host date digest',
      date: new Date().toUTCString(),
    });

    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));
    getRecipientsStub.resolves([REMOTE_CALENDAR_HANDLE]);
    resolveStub.resolves(REMOTE_INBOX_URL);

    await service.processOutboxMessage(message);

    expect(userActorStub.calledOnce).toBe(true);
    expect(postStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
  });

  it('should skip delivery and record error when inbox URL resolves to a private IP (SSRF)', async () => {
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
    // resolveInboxUrl returns a private inbox URL (SSRF scenario from malicious actor profile)
    resolveStub.resolves('https://192.168.1.1/inbox');

    // Simulate validateUrlNotPrivate blocking the private inbox URL
    vi.mocked(validateUrlNotPrivate).mockRejectedValueOnce(
      new Error('Access to private IP address 192.168.1.1 is not allowed'),
    );

    await service.processOutboxMessage(message);

    // The POST should not be made to the private IP
    expect(postStub.called).toBe(false);
    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
    // The delivery error should be recorded in processed_status
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toMatch(/^partial:/);
  });
});


describe('processOutboxMessage — explicit `to` honoring and per-type local dispatch', () => {
  let service: ProcessOutboxService;
  let mockInbox: ProcessInboxService;
  let resolveLocalStub: sinon.SinonStub;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  const TARGETED_ACTOR_URI = 'https://target.federation.test/calendars/owner';
  const TARGETED_INBOX_URL = 'https://target.federation.test/calendars/owner/inbox';

  beforeEach(() => {
    const eventBus = new EventEmitter();
    mockInbox = {
      handleLocalActivityDispatch: sandbox.stub().resolves(),
    } as unknown as ProcessInboxService;
    service = new ProcessOutboxService(eventBus, mockInbox);
    vi.mocked(validateUrlNotPrivate).mockResolvedValue(true);

    // Default per-recipient local-resolution to "not local". Tests in
    // this block that exercise local dispatch reset this stub's return
    // value via `resolveLocalStub.resolves(localCalendar)`.
    resolveLocalStub = sandbox
      .stub(service.calendarActorService, 'getLocalCalendarByActorUri')
      .resolves(null);
  });

  afterEach(() => {
    sandbox.restore();
    vi.restoreAllMocks();
  });

  // ---------- Update ----------

  it('Update: honors explicit `to` and skips follower fan-out', async () => {
    const updateMsg = createMockUpdateActivity(LOCAL_ACTOR_URL, {
      type: 'Event',
      id: `${LOCAL_ACTOR_URL}/events/upd-1`,
      name: 'Updated Event',
    });
    updateMsg.to = [TARGETED_ACTOR_URI];

    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Update',
      message: updateMsg,
    });

    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    const postStub = sandbox.stub(axios, 'post').resolves();
    const updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');
    const getRecipientsStub = sandbox.stub(service, 'getRecipients');
    const resolveStub = sandbox.stub(service, 'resolveInboxUrl');
    stubSigning(service, sandbox);

    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));
    resolveStub.resolves(TARGETED_INBOX_URL);

    await service.processOutboxMessage(message);

    expect(getRecipientsStub.called, 'getRecipients must NOT be called when `to` is explicit').toBe(false);
    expect(resolveStub.calledOnceWith(TARGETED_ACTOR_URI)).toBe(true);
    expect(postStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
  });

  it('Update: falls back to getRecipients fan-out when `to` is absent', async () => {
    const updateMsg = createMockUpdateActivity(LOCAL_ACTOR_URL, {
      type: 'Event',
      id: `${LOCAL_ACTOR_URL}/events/upd-2`,
      name: 'Broadcast Update',
    });
    // no `to` field set

    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Update',
      message: updateMsg,
    });

    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    const postStub = sandbox.stub(axios, 'post').resolves();
    const updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');
    const getRecipientsStub = sandbox.stub(service, 'getRecipients');
    const resolveStub = sandbox.stub(service, 'resolveInboxUrl');
    stubSigning(service, sandbox);

    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));
    getRecipientsStub.resolves([REMOTE_CALENDAR_HANDLE]);
    resolveStub.resolves(REMOTE_INBOX_URL);

    await service.processOutboxMessage(message);

    expect(getRecipientsStub.calledOnce, 'getRecipients must be called for fan-out fallback').toBe(true);
    expect(postStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
  });

  it('Update: treats `to: [as:Public]` as a broadcast (filters public IRI, fans out to followers)', async () => {
    // Regression: addressPublic() puts as:Public in `to` for public broadcast.
    // The outbox must not treat the public IRI as a literal delivery target;
    // it must fall through to follower fan-out.
    const updateMsg = createMockUpdateActivity(LOCAL_ACTOR_URL, {
      type: 'Event',
      id: `${LOCAL_ACTOR_URL}/events/upd-public`,
      name: 'Public Broadcast Update',
    });
    updateMsg.to = ['https://www.w3.org/ns/activitystreams#Public'];
    updateMsg.cc = [`${LOCAL_ACTOR_URL}/followers`];

    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Update',
      message: updateMsg,
    });

    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    const postStub = sandbox.stub(axios, 'post').resolves();
    const updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');
    const getRecipientsStub = sandbox.stub(service, 'getRecipients');
    const resolveStub = sandbox.stub(service, 'resolveInboxUrl');
    stubSigning(service, sandbox);

    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));
    getRecipientsStub.resolves([REMOTE_CALENDAR_HANDLE]);
    resolveStub.resolves(REMOTE_INBOX_URL);

    await service.processOutboxMessage(message);

    expect(getRecipientsStub.calledOnce, 'getRecipients must be called when `to` is only as:Public').toBe(true);
    expect(resolveStub.calledOnceWith(REMOTE_CALENDAR_HANDLE)).toBe(true);
    expect(postStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
  });

  // ---------- Delete ----------

  it('Delete: honors explicit `to` and skips follower fan-out', async () => {
    const deleteMsg = createMockDeleteActivity(LOCAL_ACTOR_URL, `${LOCAL_ACTOR_URL}/events/del-1`);
    deleteMsg.to = [TARGETED_ACTOR_URI];

    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Delete',
      message: deleteMsg,
    });

    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    const postStub = sandbox.stub(axios, 'post').resolves();
    const updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');
    const getRecipientsStub = sandbox.stub(service, 'getRecipients');
    const resolveStub = sandbox.stub(service, 'resolveInboxUrl');
    stubSigning(service, sandbox);

    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));
    resolveStub.resolves(TARGETED_INBOX_URL);

    await service.processOutboxMessage(message);

    expect(getRecipientsStub.called, 'getRecipients must NOT be called when `to` is explicit').toBe(false);
    expect(resolveStub.calledOnceWith(TARGETED_ACTOR_URI)).toBe(true);
    expect(postStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
  });

  it('Delete: falls back to getRecipients fan-out when `to` is absent', async () => {
    const deleteMsg = createMockDeleteActivity(LOCAL_ACTOR_URL, `${LOCAL_ACTOR_URL}/events/del-2`);
    // no `to` field set

    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Delete',
      message: deleteMsg,
    });

    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    const postStub = sandbox.stub(axios, 'post').resolves();
    const updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');
    const getRecipientsStub = sandbox.stub(service, 'getRecipients');
    const resolveStub = sandbox.stub(service, 'resolveInboxUrl');
    stubSigning(service, sandbox);

    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));
    getRecipientsStub.resolves([REMOTE_CALENDAR_HANDLE]);
    resolveStub.resolves(REMOTE_INBOX_URL);

    await service.processOutboxMessage(message);

    expect(getRecipientsStub.calledOnce, 'getRecipients must be called for fan-out fallback').toBe(true);
    expect(postStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
  });

  it('Delete: treats `to: [as:Public]` as a broadcast (filters public IRI, fans out to followers)', async () => {
    // Regression: addressPublic() puts as:Public in `to` for public broadcast.
    // The outbox must not treat the public IRI as a literal delivery target;
    // it must fall through to follower fan-out.
    const deleteMsg = createMockDeleteActivity(LOCAL_ACTOR_URL, `${LOCAL_ACTOR_URL}/events/del-public`);
    deleteMsg.to = ['https://www.w3.org/ns/activitystreams#Public'];
    deleteMsg.cc = [`${LOCAL_ACTOR_URL}/followers`];

    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Delete',
      message: deleteMsg,
    });

    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    const postStub = sandbox.stub(axios, 'post').resolves();
    const updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');
    const getRecipientsStub = sandbox.stub(service, 'getRecipients');
    const resolveStub = sandbox.stub(service, 'resolveInboxUrl');
    stubSigning(service, sandbox);

    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));
    getRecipientsStub.resolves([REMOTE_CALENDAR_HANDLE]);
    resolveStub.resolves(REMOTE_INBOX_URL);

    await service.processOutboxMessage(message);

    expect(getRecipientsStub.calledOnce, 'getRecipients must be called when `to` is only as:Public').toBe(true);
    expect(resolveStub.calledOnceWith(REMOTE_CALENDAR_HANDLE)).toBe(true);
    expect(postStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
  });

  // ---------- Add ----------

  it('Add: honors explicit `to` and delivers only to that recipient', async () => {
    const addMsg = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Add',
      actor: LOCAL_ACTOR_URL,
      object: TARGETED_ACTOR_URI,
      target: `${LOCAL_ACTOR_URL}/editors`,
      id: `${LOCAL_ACTOR_URL}/adds/add-1`,
      to: [TARGETED_ACTOR_URI],
    };

    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Add',
      message: addMsg,
    });

    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    const postStub = sandbox.stub(axios, 'post').resolves();
    const updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');
    const getRecipientsStub = sandbox.stub(service, 'getRecipients');
    const resolveStub = sandbox.stub(service, 'resolveInboxUrl');
    stubSigning(service, sandbox);

    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));
    resolveStub.resolves(TARGETED_INBOX_URL);

    await service.processOutboxMessage(message);

    expect(getRecipientsStub.called, 'getRecipients must NOT be called for Add').toBe(false);
    expect(resolveStub.calledOnceWith(TARGETED_ACTOR_URI)).toBe(true);
    expect(postStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
  });

  it('Add: skips delivery (no fan-out) when `to` is absent', async () => {
    const addMsg = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Add',
      actor: LOCAL_ACTOR_URL,
      object: TARGETED_ACTOR_URI,
      target: `${LOCAL_ACTOR_URL}/editors`,
      id: `${LOCAL_ACTOR_URL}/adds/add-2`,
      // no `to` field
    };

    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Add',
      message: addMsg,
    });

    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    const postStub = sandbox.stub(axios, 'post').resolves();
    const updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');
    const getRecipientsStub = sandbox.stub(service, 'getRecipients');
    const resolveStub = sandbox.stub(service, 'resolveInboxUrl');

    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));

    await service.processOutboxMessage(message);

    // No follower fan-out for Add — getRecipients must NOT be called and
    // no HTTP delivery should happen. The message is still marked processed.
    expect(getRecipientsStub.called, 'getRecipients must NOT be called for Add fan-out').toBe(false);
    expect(resolveStub.called, 'resolveInboxUrl must NOT be called when no recipients').toBe(false);
    expect(postStub.called, 'No HTTP POST when Add has no recipients').toBe(false);
    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
  });

  // ---------- Remove ----------
  //
  // Remove mirrors Add: single-recipient editor-revoke delivery with no
  // follower fan-out fallback. The no-`to` skip path is the load-bearing
  // case — it prevents a regression where editor-revoke activities
  // accidentally broadcast to all followers.

  it('Remove: honors explicit `to` and delivers only to that recipient', async () => {
    const removeMsg = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Remove',
      actor: LOCAL_ACTOR_URL,
      object: TARGETED_ACTOR_URI,
      target: `${LOCAL_ACTOR_URL}/editors`,
      id: `${LOCAL_ACTOR_URL}/removes/remove-1`,
      to: [TARGETED_ACTOR_URI],
    };

    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Remove',
      message: removeMsg,
    });

    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    const postStub = sandbox.stub(axios, 'post').resolves();
    const updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');
    const getRecipientsStub = sandbox.stub(service, 'getRecipients');
    const resolveStub = sandbox.stub(service, 'resolveInboxUrl');
    stubSigning(service, sandbox);

    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));
    resolveStub.resolves(TARGETED_INBOX_URL);

    await service.processOutboxMessage(message);

    expect(getRecipientsStub.called, 'getRecipients must NOT be called for Remove').toBe(false);
    expect(resolveStub.calledOnceWith(TARGETED_ACTOR_URI)).toBe(true);
    expect(postStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
  });

  it('Remove: skips delivery (no fan-out) when `to` is absent', async () => {
    const removeMsg = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Remove',
      actor: LOCAL_ACTOR_URL,
      object: TARGETED_ACTOR_URI,
      target: `${LOCAL_ACTOR_URL}/editors`,
      id: `${LOCAL_ACTOR_URL}/removes/remove-2`,
      // no `to` field
    };

    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Remove',
      message: removeMsg,
    });

    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    const postStub = sandbox.stub(axios, 'post').resolves();
    const updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');
    const getRecipientsStub = sandbox.stub(service, 'getRecipients');
    const resolveStub = sandbox.stub(service, 'resolveInboxUrl');

    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));

    await service.processOutboxMessage(message);

    // No follower fan-out for Remove — getRecipients must NOT be called and
    // no HTTP delivery should happen. The message is still marked processed.
    expect(getRecipientsStub.called, 'getRecipients must NOT be called for Remove fan-out').toBe(false);
    expect(resolveStub.called, 'resolveInboxUrl must NOT be called when no recipients').toBe(false);
    expect(postStub.called, 'No HTTP POST when Remove has no recipients').toBe(false);
    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
  });

  // ---------- Per-type local-recipient dispatch ----------
  //
  // For each of the 8 currently-handled activity types, when the resolved
  // recipient is a local CalendarActor the outbox must route the activity
  // through handleLocalActivityDispatch instead of HTTP-posting it. These
  // tests pin the per-type contract: the dispatcher is type-agnostic and
  // must fire local dispatch for every type the outbox knows how to send.

  it('Create: local recipient routes to handleLocalActivityDispatch instead of HTTP', async () => {
    const localCalendar = Calendar.fromObject({ id: 'local-cal-create' });
    const localRecipientUri = 'https://local.federation.test/calendars/localcal-create';
    const createMsg = createMockCreateActivity(LOCAL_ACTOR_URL, {
      type: 'Event',
      id: `${LOCAL_ACTOR_URL}/events/local-create-1`,
      name: 'Local Create Event',
    });

    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Create',
      message: createMsg,
    });

    resolveLocalStub.resolves(localCalendar);
    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    const postStub = sandbox.stub(axios, 'post').resolves();
    sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');
    const getRecipientsStub = sandbox.stub(service, 'getRecipients');
    sandbox.stub(service, 'resolveInboxUrl');

    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));
    getRecipientsStub.resolves([localRecipientUri]);

    await service.processOutboxMessage(message);

    expect(resolveLocalStub.calledOnceWith(localRecipientUri)).toBe(true);
    expect(
      (mockInbox.handleLocalActivityDispatch as sinon.SinonStub).calledOnce,
      'Create: local dispatch must fire for local recipient',
    ).toBe(true);
    expect(postStub.called, 'Create: HTTP POST must not be used for local recipient').toBe(false);
  });

  it('Update: local recipient routes to handleLocalActivityDispatch instead of HTTP', async () => {
    const localCalendar = Calendar.fromObject({ id: 'local-cal-update' });
    const updateMsg = createMockUpdateActivity(LOCAL_ACTOR_URL, {
      type: 'Event',
      id: `${LOCAL_ACTOR_URL}/events/local-upd-1`,
      name: 'Local Update Event',
    });
    updateMsg.to = [TARGETED_ACTOR_URI];

    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Update',
      message: updateMsg,
    });

    resolveLocalStub.resolves(localCalendar);
    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    const postStub = sandbox.stub(axios, 'post').resolves();
    sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');
    sandbox.stub(service, 'resolveInboxUrl');

    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));

    await service.processOutboxMessage(message);

    expect(resolveLocalStub.calledOnceWith(TARGETED_ACTOR_URI)).toBe(true);
    expect(
      (mockInbox.handleLocalActivityDispatch as sinon.SinonStub).calledOnce,
      'Update: local dispatch must fire for local recipient',
    ).toBe(true);
    expect(postStub.called, 'Update: HTTP POST must not be used for local recipient').toBe(false);
  });

  it('Delete: local recipient routes to handleLocalActivityDispatch instead of HTTP', async () => {
    const localCalendar = Calendar.fromObject({ id: 'local-cal-delete' });
    const deleteMsg = createMockDeleteActivity(LOCAL_ACTOR_URL, `${LOCAL_ACTOR_URL}/events/local-del-1`);
    deleteMsg.to = [TARGETED_ACTOR_URI];

    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Delete',
      message: deleteMsg,
    });

    resolveLocalStub.resolves(localCalendar);
    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    const postStub = sandbox.stub(axios, 'post').resolves();
    sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');
    sandbox.stub(service, 'resolveInboxUrl');

    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));

    await service.processOutboxMessage(message);

    expect(resolveLocalStub.calledOnceWith(TARGETED_ACTOR_URI)).toBe(true);
    expect(
      (mockInbox.handleLocalActivityDispatch as sinon.SinonStub).calledOnce,
      'Delete: local dispatch must fire for local recipient',
    ).toBe(true);
    expect(postStub.called, 'Delete: HTTP POST must not be used for local recipient').toBe(false);
  });

  it('Follow: local recipient routes to handleLocalActivityDispatch instead of HTTP', async () => {
    const localCalendar = Calendar.fromObject({ id: 'local-cal-follow' });
    const localRecipientUri = 'https://local.federation.test/calendars/localcal-follow';
    const followMsg = createMockFollowActivity(LOCAL_ACTOR_URL, localRecipientUri);

    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Follow',
      message: followMsg,
    });

    resolveLocalStub.resolves(localCalendar);
    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    const postStub = sandbox.stub(axios, 'post').resolves();
    sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');
    sandbox.stub(service, 'resolveInboxUrl');

    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));

    await service.processOutboxMessage(message);

    expect(resolveLocalStub.calledOnceWith(localRecipientUri)).toBe(true);
    expect(
      (mockInbox.handleLocalActivityDispatch as sinon.SinonStub).calledOnce,
      'Follow: local dispatch must fire for local recipient',
    ).toBe(true);
    expect(postStub.called, 'Follow: HTTP POST must not be used for local recipient').toBe(false);
  });

  it('Accept: local recipient routes to handleLocalActivityDispatch instead of HTTP', async () => {
    const localCalendar = Calendar.fromObject({ id: 'local-cal-accept' });
    const localFollowActorUri = 'https://local.federation.test/calendars/localcal-accept';
    // Accept wraps the original Follow; the Follow's actor is the delivery recipient.
    const acceptMsg = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Accept',
      actor: LOCAL_ACTOR_URL,
      id: `${LOCAL_ACTOR_URL}/activities/accept-local-1`,
      object: {
        type: 'Follow',
        actor: localFollowActorUri,
        object: LOCAL_ACTOR_URL,
        id: `${localFollowActorUri}/activities/follow-1`,
      },
    };

    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Accept',
      message: acceptMsg,
    });

    resolveLocalStub.resolves(localCalendar);
    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    const postStub = sandbox.stub(axios, 'post').resolves();
    sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');
    sandbox.stub(service, 'resolveInboxUrl');

    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));

    await service.processOutboxMessage(message);

    expect(resolveLocalStub.calledOnceWith(localFollowActorUri)).toBe(true);
    expect(
      (mockInbox.handleLocalActivityDispatch as sinon.SinonStub).calledOnce,
      'Accept: local dispatch must fire for local recipient',
    ).toBe(true);
    expect(postStub.called, 'Accept: HTTP POST must not be used for local recipient').toBe(false);
  });

  it('Flag: local recipient routes to handleLocalActivityDispatch instead of HTTP', async () => {
    const localCalendar = Calendar.fromObject({ id: 'local-cal-flag' });
    const flagMsg = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Flag',
      id: `${LOCAL_ACTOR_URL}/flags/flag-local-1`,
      actor: LOCAL_ACTOR_URL,
      object: `${LOCAL_ACTOR_URL}/events/flagged-1`,
      content: 'Report description',
      to: [TARGETED_ACTOR_URI],
    };

    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Flag',
      message: flagMsg,
    });

    resolveLocalStub.resolves(localCalendar);
    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    const postStub = sandbox.stub(axios, 'post').resolves();
    sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');
    sandbox.stub(service, 'resolveInboxUrl');

    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));

    await service.processOutboxMessage(message);

    expect(resolveLocalStub.calledOnceWith(TARGETED_ACTOR_URI)).toBe(true);
    expect(
      (mockInbox.handleLocalActivityDispatch as sinon.SinonStub).calledOnce,
      'Flag: local dispatch must fire for local recipient',
    ).toBe(true);
    expect(postStub.called, 'Flag: HTTP POST must not be used for local recipient').toBe(false);
  });

  it('Announce: local recipient routes to handleLocalActivityDispatch instead of HTTP', async () => {
    const localCalendar = Calendar.fromObject({ id: 'local-cal-announce' });
    const localRecipientUri = 'https://local.federation.test/calendars/localcal-announce';
    const announceMsg = createMockAnnounceActivity(
      LOCAL_ACTOR_URL,
      `${LOCAL_ACTOR_URL}/events/announced-1`,
    );

    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Announce',
      message: announceMsg,
    });

    resolveLocalStub.resolves(localCalendar);
    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    const postStub = sandbox.stub(axios, 'post').resolves();
    sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');
    const getRecipientsStub = sandbox.stub(service, 'getRecipients');
    sandbox.stub(service, 'resolveInboxUrl');

    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));
    getRecipientsStub.resolves([localRecipientUri]);

    await service.processOutboxMessage(message);

    expect(resolveLocalStub.calledOnceWith(localRecipientUri)).toBe(true);
    expect(
      (mockInbox.handleLocalActivityDispatch as sinon.SinonStub).calledOnce,
      'Announce: local dispatch must fire for local recipient',
    ).toBe(true);
    expect(postStub.called, 'Announce: HTTP POST must not be used for local recipient').toBe(false);
  });

  it('Undo: local recipient routes to handleLocalActivityDispatch instead of HTTP', async () => {
    const localCalendar = Calendar.fromObject({ id: 'local-cal-undo' });
    // UndoActivity.fromObject expects `object` to be a string (the AP id
    // of the activity being undone), so we build the payload directly
    // rather than going through createMockUndoActivity which wraps a
    // nested object.
    const undoTargetId = `${LOCAL_ACTOR_URL}/activities/announce-undone-1`;
    const undoMsg: Record<string, unknown> = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Undo',
      actor: LOCAL_ACTOR_URL,
      object: undoTargetId,
      id: `${undoTargetId}/undo`,
      to: [TARGETED_ACTOR_URI],
    };

    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Undo',
      message: undoMsg,
    });

    resolveLocalStub.resolves(localCalendar);
    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    const postStub = sandbox.stub(axios, 'post').resolves();
    sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');
    sandbox.stub(service, 'resolveInboxUrl');

    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));

    await service.processOutboxMessage(message);

    expect(resolveLocalStub.calledOnceWith(TARGETED_ACTOR_URI)).toBe(true);
    expect(
      (mockInbox.handleLocalActivityDispatch as sinon.SinonStub).calledOnce,
      'Undo: local dispatch must fire for local recipient',
    ).toBe(true);
    expect(postStub.called, 'Undo: HTTP POST must not be used for local recipient').toBe(false);
  });
});


describe('processOutboxMessage — local/remote dispatcher split', () => {
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    vi.mocked(validateUrlNotPrivate).mockResolvedValue(true);
  });

  afterEach(() => {
    sandbox.restore();
    vi.restoreAllMocks();
  });

  const LOCAL_RECIPIENT_URI = 'https://local.federation.test/calendars/localcal';
  const BROKEN_LOCAL_RECIPIENT_URI = 'https://local.federation.test/calendars/broken';

  it('routes local recipients to handleLocalActivityDispatch instead of HTTP', async () => {
    const eventBus = new EventEmitter();
    const localCalendar = Calendar.fromObject({ id: 'local-cal-id' });
    const mockInbox = {
      handleLocalActivityDispatch: sandbox.stub().resolves(),
    } as unknown as ProcessInboxService;

    const service = new ProcessOutboxService(eventBus, mockInbox);
    const resolveLocalStub = sandbox
      .stub(service.calendarActorService, 'getLocalCalendarByActorUri')
      .resolves(localCalendar);

    // Build an Announce outbox message — this is the activity type used for
    // federation/auto-repost fan-out, which is the code path Phase 3 targets.
    const announceMessage = createMockAnnounceActivity(
      LOCAL_ACTOR_URL,
      `${LOCAL_ACTOR_URL}/events/123`,
    );
    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Announce',
      message: announceMessage,
    });

    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    const axiosPostStub = sandbox.stub(axios, 'post').resolves();
    const updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');
    const getRecipientsStub = sandbox.stub(service, 'getRecipients');
    const resolveInboxStub = sandbox.stub(service, 'resolveInboxUrl');

    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));
    getRecipientsStub.resolves([LOCAL_RECIPIENT_URI]);
    // resolveInboxUrl should not be reached for local recipients, but stub
    // defensively in case the current dispatcher still calls it.
    resolveInboxStub.resolves('https://local.federation.test/calendars/localcal/inbox');

    await service.processOutboxMessage(message);

    expect(
      resolveLocalStub.calledOnceWith(LOCAL_RECIPIENT_URI),
      'dispatcher must consult calendarActorService.getLocalCalendarByActorUri',
    ).toBe(true);
    expect(
      (mockInbox.handleLocalActivityDispatch as sinon.SinonStub).calledOnce,
      'handleLocalActivityDispatch must be called for a local recipient',
    ).toBe(true);
    expect(
      axiosPostStub.called,
      'HTTP POST must not be used for local recipients',
    ).toBe(false);
    expect(updateStub.calledOnce).toBe(true);
  });

  it('still HTTP POSTs to remote recipients', async () => {
    const eventBus = new EventEmitter();
    const mockInbox = {
      handleLocalActivityDispatch: sandbox.stub().resolves(),
    } as unknown as ProcessInboxService;

    const service = new ProcessOutboxService(eventBus, mockInbox);
    // Remote recipient — not a local calendar actor
    const resolveLocalStub = sandbox
      .stub(service.calendarActorService, 'getLocalCalendarByActorUri')
      .resolves(null);
    stubSigning(service, sandbox);

    const announceMessage = createMockAnnounceActivity(
      LOCAL_ACTOR_URL,
      `${LOCAL_ACTOR_URL}/events/123`,
    );
    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Announce',
      message: announceMessage,
    });

    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    const axiosPostStub = sandbox.stub(axios, 'post').resolves();
    const updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');
    const getRecipientsStub = sandbox.stub(service, 'getRecipients');
    const resolveInboxStub = sandbox.stub(service, 'resolveInboxUrl');

    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));
    getRecipientsStub.resolves([REMOTE_CALENDAR_HANDLE]);
    resolveInboxStub.resolves(REMOTE_INBOX_URL);

    await service.processOutboxMessage(message);

    expect(
      resolveLocalStub.called,
      'dispatcher must consult calendarActorService.getLocalCalendarByActorUri for each recipient',
    ).toBe(true);
    expect(
      axiosPostStub.called,
      'HTTP POST must be used for remote recipients',
    ).toBe(true);
    expect(
      (mockInbox.handleLocalActivityDispatch as sinon.SinonStub).called,
      'handleLocalActivityDispatch must not be called for remote recipients',
    ).toBe(false);
    expect(updateStub.calledOnce).toBe(true);
  });

  it('skips dispatch when getLocalCalendarByActorUri returns null for a local-looking actor with missing calendar', async () => {
    const eventBus = new EventEmitter();
    const mockInbox = {
      handleLocalActivityDispatch: sandbox.stub().resolves(),
    } as unknown as ProcessInboxService;

    const service = new ProcessOutboxService(eventBus, mockInbox);
    // Null calendar: recipient actor_uri looks local but no Calendar row exists
    sandbox
      .stub(service.calendarActorService, 'getLocalCalendarByActorUri')
      .resolves(null);

    const announceMessage = createMockAnnounceActivity(
      LOCAL_ACTOR_URL,
      `${LOCAL_ACTOR_URL}/events/123`,
    );
    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Announce',
      message: announceMessage,
    });

    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    const axiosPostStub = sandbox.stub(axios, 'post').resolves();
    const updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');
    const getRecipientsStub = sandbox.stub(service, 'getRecipients');
    const resolveInboxStub = sandbox.stub(service, 'resolveInboxUrl');

    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));
    // A URI that belongs to this instance's host (would be a local actor) but
    // resolves to no Calendar row. Dispatcher must treat this as the defensive
    // null-calendar branch — neither in-process dispatch nor HTTP fallback.
    getRecipientsStub.resolves([BROKEN_LOCAL_RECIPIENT_URI]);
    // Even if the inbox IS resolvable, the null-calendar guard must fire
    // first and skip delivery entirely. Today's dispatcher has no such guard
    // and would HTTP POST to this inbox URL — that's what makes this test fail.
    resolveInboxStub.resolves('https://local.federation.test/calendars/broken/inbox');

    await service.processOutboxMessage(message);

    expect(
      (mockInbox.handleLocalActivityDispatch as sinon.SinonStub).called,
      'handleLocalActivityDispatch must not be called when calendar is null',
    ).toBe(false);
    expect(
      axiosPostStub.called,
      'HTTP fallback must not run for null-calendar case',
    ).toBe(false);
    expect(updateStub.calledOnce).toBe(true);
  });
});


describe('deliverActivitySigned', () => {
  let service: ProcessOutboxService;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  const SIGNING_ACTOR_URI = `${LOCAL_ACTOR_URL}/users/admin`;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const mockInbox = {
      handleLocalActivityDispatch: sandbox.stub().resolves(),
    } as unknown as ProcessInboxService;
    service = new ProcessOutboxService(eventBus, mockInbox);
    vi.mocked(validateUrlNotPrivate).mockResolvedValue(true);
  });

  afterEach(() => {
    sandbox.restore();
    vi.restoreAllMocks();
  });

  function buildActivity() {
    return {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Create',
      id: `${LOCAL_ACTOR_URL}/activities/abc`,
      actor: SIGNING_ACTOR_URI,
      object: {
        type: 'Event',
        id: `${LOCAL_ACTOR_URL}/events/xyz`,
        name: 'Sync Event',
      },
    };
  }

  it('throws FederationDeliveryError when signing fails for both actor types', async () => {
    sandbox.stub(service.calendarActorService, 'signActivity').rejects(new Error('no calendar actor'));
    sandbox.stub((service as any).userActorService, 'signActivity').rejects(new Error('no user actor'));

    const postStub = sandbox.stub(axios, 'post');

    const { FederationDeliveryError } = await import('@/common/exceptions/activitypub');

    await expect(
      service.deliverActivitySigned(SIGNING_ACTOR_URI, buildActivity(), REMOTE_INBOX_URL),
    ).rejects.toBeInstanceOf(FederationDeliveryError);

    expect(postStub.called).toBe(false);
  });

  it('throws FederationDeliveryError on network/timeout failure', async () => {
    stubSigning(service, sandbox);
    sandbox.stub(axios, 'post').rejects(new Error('ETIMEDOUT'));

    const { FederationDeliveryError } = await import('@/common/exceptions/activitypub');

    await expect(
      service.deliverActivitySigned(SIGNING_ACTOR_URI, buildActivity(), REMOTE_INBOX_URL),
    ).rejects.toBeInstanceOf(FederationDeliveryError);
  });

  it('throws FederationDeliveryError when SSRF validation rejects the inbox URL', async () => {
    stubSigning(service, sandbox);
    vi.mocked(validateUrlNotPrivate).mockRejectedValueOnce(
      new Error('Access to private IP 10.0.0.1 is not allowed'),
    );
    const postStub = sandbox.stub(axios, 'post');

    const { FederationDeliveryError } = await import('@/common/exceptions/activitypub');

    await expect(
      service.deliverActivitySigned(SIGNING_ACTOR_URI, buildActivity(), 'https://10.0.0.1/inbox'),
    ).rejects.toBeInstanceOf(FederationDeliveryError);

    expect(postStub.called).toBe(false);
  });

  it('returns { status, data: null } on non-2xx HTTP response', async () => {
    stubSigning(service, sandbox);
    sandbox.stub(axios, 'post').resolves({ status: 403, data: { error: 'forbidden' } });

    const result = await service.deliverActivitySigned(SIGNING_ACTOR_URI, buildActivity(), REMOTE_INBOX_URL);

    expect(result).toEqual({ status: 403, data: null });
  });

  it('returns { status: 202, data: null } on 202 Accepted with empty body', async () => {
    stubSigning(service, sandbox);
    sandbox.stub(axios, 'post').resolves({ status: 202, data: '' });

    const result = await service.deliverActivitySigned(SIGNING_ACTOR_URI, buildActivity(), REMOTE_INBOX_URL);

    expect(result).toEqual({ status: 202, data: null });
  });

  it('returns { status, data } on 2xx with parsed JSON body', async () => {
    stubSigning(service, sandbox);
    const remoteEvent = { id: `${REMOTE_PROFILE_URL}/events/created-1`, type: 'Event', name: 'Echoed' };
    sandbox.stub(axios, 'post').resolves({ status: 201, data: remoteEvent });

    const result = await service.deliverActivitySigned(SIGNING_ACTOR_URI, buildActivity(), REMOTE_INBOX_URL);

    expect(result.status).toBe(201);
    expect(result.data).toEqual(remoteEvent);
  });

  it('JSON-stringifies the activity exactly once and uses the same bytes for digest and body', async () => {
    stubSigning(service, sandbox);
    const postStub = sandbox.stub(axios, 'post').resolves({ status: 202, data: '' });

    const activity = buildActivity();
    await service.deliverActivitySigned(SIGNING_ACTOR_URI, activity, REMOTE_INBOX_URL);

    const bodyArg = postStub.getCalls()[0].args[1];
    expect(typeof bodyArg).toBe('string');

    const { createHash } = await import('crypto');
    const expectedDigest = 'SHA-256=' + createHash('sha256').update(bodyArg as string).digest('base64');
    const actualDigest = postStub.getCalls()[0].args[2]?.headers['Digest'];
    expect(actualDigest).toBe(expectedDigest);
  });
});
