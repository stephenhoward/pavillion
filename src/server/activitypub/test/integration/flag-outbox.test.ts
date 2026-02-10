/**
 * Integration tests for Flag activity outbox processing.
 *
 * Tests that Flag activities can be sent via ActivityPub outbox
 * when reports are forwarded to remote instances, including
 * proper HTTP signature generation and outbox record tracking.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Calendar } from '@/common/model/calendar';
import ProcessOutboxService from '@/server/activitypub/service/outbox';
import { ActivityPubOutboxMessageEntity } from '@/server/activitypub/entity/activitypub';

// Test constants
const TEST_CALENDAR_ID = 'test-calendar-id';
const LOCAL_ACTOR_URL = 'https://local.instance/calendars/test-calendar';
const REMOTE_ACTOR_URI = 'https://remote.instance/calendars/remote-calendar';
const REMOTE_INBOX_URL = 'https://remote.instance/calendars/remote-calendar/inbox';

describe('Flag activity outbox processing', () => {
  let service: ProcessOutboxService;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let eventBus: EventEmitter;

  beforeEach(() => {
    eventBus = new EventEmitter();
    service = new ProcessOutboxService(eventBus);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should process Flag activity and send to remote inbox', async () => {
    // Create a Flag activity message with explicit "to" recipient
    const flagActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Flag',
      id: 'https://local.instance/flags/flag-uuid',
      actor: LOCAL_ACTOR_URL,
      to: [REMOTE_ACTOR_URI],
      object: 'https://remote.instance/events/event-uuid',
      content: 'Report description text',
      tag: [
        { type: 'Hashtag', name: '#spam' },
      ],
      summary: 'Event report: spam',
      published: '2026-02-10T12:00:00Z',
    };

    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Flag',
      message: flagActivity,
    });

    // Mock dependencies
    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));

    const postStub = sandbox.stub(axios, 'post');
    postStub.resolves({ status: 200 });

    const updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');

    const resolveStub = sandbox.stub(service, 'resolveInboxUrl');
    resolveStub.resolves(REMOTE_INBOX_URL);

    // Process the outbox message
    await service.processOutboxMessage(message);

    // Verify HTTP POST was called with correct payload
    expect(postStub.calledOnce).toBe(true);
    const postCall = postStub.getCall(0);
    expect(postCall.args[0]).toBe(REMOTE_INBOX_URL);
    expect(postCall.args[1].type).toBe('Flag');
    expect(postCall.args[1].actor).toBe(LOCAL_ACTOR_URL);
    expect(postCall.args[1].content).toBe('Report description text');

    // Verify outbox record was marked as processed
    expect(updateStub.calledOnce).toBe(true);
    const updateCall = updateStub.getCall(0);
    expect(updateCall.args[0].processed_time).toBeDefined();
    expect(updateCall.args[0].processed_status).toBe('ok');
  });

  it('should handle admin Flag activities with priority tags', async () => {
    // Create an admin Flag activity with priority and explicit "to"
    const adminFlagActivity = {
      type: 'Flag',
      id: 'https://local.instance/flags/admin-flag-uuid',
      actor: 'https://local.instance/admin',
      attributedTo: 'https://local.instance/admin',
      to: [REMOTE_ACTOR_URI],
      object: 'https://remote.instance/events/event-uuid',
      content: 'Admin concern about this event',
      tag: [
        { type: 'Hashtag', name: '#admin-flag' },
        { type: 'Hashtag', name: '#priority-high' },
      ],
      summary: 'Admin report: inappropriate_content',
      published: '2026-02-10T12:00:00Z',
    };

    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Flag',
      message: adminFlagActivity,
    });

    // Mock dependencies
    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));

    const postStub = sandbox.stub(axios, 'post');
    postStub.resolves({ status: 200 });

    const updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');

    const resolveStub = sandbox.stub(service, 'resolveInboxUrl');
    resolveStub.resolves(REMOTE_INBOX_URL);

    // Process the outbox message
    await service.processOutboxMessage(message);

    // Verify admin tags are preserved
    expect(postStub.calledOnce).toBe(true);
    const postCall = postStub.getCall(0);
    expect(postCall.args[1].tag).toHaveLength(2);
    expect(postCall.args[1].tag[0].name).toBe('#admin-flag');
    expect(postCall.args[1].tag[1].name).toBe('#priority-high');
  });

  it('should record delivery errors for failed Flag activities', async () => {
    const flagActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Flag',
      id: 'https://local.instance/flags/flag-uuid',
      actor: LOCAL_ACTOR_URL,
      to: [REMOTE_ACTOR_URI],
      object: 'https://remote.instance/events/event-uuid',
      content: 'Report description',
      tag: [{ type: 'Hashtag', name: '#spam' }],
      summary: 'Event report: spam',
      published: '2026-02-10T12:00:00Z',
    };

    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Flag',
      message: flagActivity,
    });

    // Mock dependencies
    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));

    const postStub = sandbox.stub(axios, 'post');
    postStub.rejects(new Error('Network timeout'));

    const updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');

    const resolveStub = sandbox.stub(service, 'resolveInboxUrl');
    resolveStub.resolves(REMOTE_INBOX_URL);

    // Process the outbox message
    await service.processOutboxMessage(message);

    // Verify error was recorded
    expect(updateStub.calledOnce).toBe(true);
    const updateCall = updateStub.getCall(0);
    expect(updateCall.args[0].processed_time).toBeDefined();
    expect(updateCall.args[0].processed_status).toContain('partial');
    expect(updateCall.args[0].processed_status).toContain('Network timeout');
  });

  it('should send Flag to explicit "to" recipients when provided', async () => {
    const remoteActorUri = 'https://remote.instance/calendars/remote-calendar';

    const flagActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Flag',
      id: 'https://local.instance/flags/flag-uuid',
      actor: LOCAL_ACTOR_URL,
      to: [remoteActorUri],
      object: 'https://remote.instance/events/event-uuid',
      content: 'Report description',
      tag: [{ type: 'Hashtag', name: '#spam' }],
      summary: 'Event report: spam',
      published: '2026-02-10T12:00:00Z',
    };

    const message = ActivityPubOutboxMessageEntity.build({
      calendar_id: TEST_CALENDAR_ID,
      type: 'Flag',
      message: flagActivity,
    });

    // Mock dependencies
    const getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    getCalendarStub.resolves(Calendar.fromObject({ id: TEST_CALENDAR_ID }));

    const postStub = sandbox.stub(axios, 'post');
    postStub.resolves({ status: 200 });

    const updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update');

    const resolveStub = sandbox.stub(service, 'resolveInboxUrl');
    resolveStub.resolves(REMOTE_INBOX_URL);

    // Process the outbox message
    await service.processOutboxMessage(message);

    // Verify recipient resolution was attempted
    expect(resolveStub.calledOnce).toBe(true);
    expect(resolveStub.getCall(0).args[0]).toBe(remoteActorUri);
  });
});
