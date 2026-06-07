import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { UserProfileResponse } from '@/server/activitypub/model/userprofile';
import { WebFingerResponse } from '@/server/activitypub/model/webfinger';
import ActivityPubService from '@/server/activitypub/service/server';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import { Calendar } from '@/common/model/calendar';
import { ActivityPubActivity } from '@/server/activitypub/model/base';
import { ActivityPubInboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import { CalendarActorEntity } from '@/server/activitypub/entity/calendar_actor';

describe('parseWebFingerResource', () => {

  it('should succeed', async () => {
    const eventBus = new EventEmitter();
    const calendarInterface = new CalendarInterface(eventBus);
    const accountsInterface = new AccountsInterface(eventBus);
    let service = new ActivityPubService(eventBus, calendarInterface, accountsInterface);

    let { name, domain } = service.parseWebFingerResource("acct:testuser@testdomain.com");

    expect(name).toBe("testuser");
    expect(domain).toBe("testdomain.com");
  });

  it('should succeed even missing acct prefix', async () => {
    const eventBus = new EventEmitter();
    const calendarInterface = new CalendarInterface(eventBus);
    const accountsInterface = new AccountsInterface(eventBus);
    let service = new ActivityPubService(eventBus, calendarInterface, accountsInterface);

    let { name, domain } = service.parseWebFingerResource("testuser@testdomain.com");

    expect(name).toBe("testuser");
    expect(domain).toBe("testdomain.com");
  });

  it('should not return values if malformed', async () => {
    const eventBus = new EventEmitter();
    const calendarInterface = new CalendarInterface(eventBus);
    const accountsInterface = new AccountsInterface(eventBus);
    let service = new ActivityPubService(eventBus, calendarInterface, accountsInterface);

    let badstrings = [
      "acct:@testdomain.com",
      "acct:username",
      "acct:username@",
      "",
      "acct:",
    ];

    for( let badstring of badstrings ) {
      let { name, domain } = service.parseWebFingerResource(badstring);

      expect(name).toBe("");
      expect(domain).toBe("");
    }
  });

});

describe('lookupWebFinger', () => {
  let service: ActivityPubService;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const calendarInterface = new CalendarInterface(eventBus);
    const accountsInterface = new AccountsInterface(eventBus);
    service = new ActivityPubService(eventBus, calendarInterface, accountsInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return null if no profile', async () => {
    let profileStub = sandbox.stub(service.calendarService, 'getCalendarByName');
    profileStub.resolves(null);

    let response = await service.lookupWebFinger('testuser', 'testdomain.com', 'calendar');

    expect(response).toBe(null);
  });

  it('should return a WebFingerResponse', async () => {
    let calendarStub = sandbox.stub(service.calendarService, 'getCalendarByName');
    calendarStub.resolves(Calendar.fromObject({ id: 'testid', urlName: 'testuser' }));

    let response = await service.lookupWebFinger('testuser', 'pavillion.dev', 'calendar');
    let expected = new WebFingerResponse('testuser', 'pavillion.dev', 'calendar').toObject();

    expect(response).toBeDefined();
    expect(response).toEqual(expected);
  });
});

describe('lookupUserProfile', () => {
  let service: ActivityPubService;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const calendarInterface = new CalendarInterface(eventBus);
    const accountsInterface = new AccountsInterface(eventBus);
    service = new ActivityPubService(eventBus, calendarInterface, accountsInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return null if no profile', async () => {
    let calendarStub = sandbox.stub(service.calendarService, 'getCalendarByName');
    calendarStub.resolves(null);

    let response = await service.lookupUserProfile('testuser');

    expect(response).toBe(null);
  });

  it('should return a UserProfileResponse', async () => {
    let calendarStub = sandbox.stub(service.calendarService, 'getCalendarByName');
    calendarStub.resolves(Calendar.fromObject({ id: 'testid', urlName: 'testCalendar' }));

    // Stub CalendarActorService dependencies for public key lookup
    // The service now uses CalendarInterface.getCalendarByName internally,
    // which is already stubbed via service.calendarService above.
    // We only need to stub the CalendarActorEntity lookup.
    sandbox.stub(CalendarActorEntity, 'findOne').resolves({
      id: 'actor-id',
      calendar_id: 'testid',
      actor_uri: 'https://pavillion.dev/calendars/testCalendar',
      public_key: '-----BEGIN PUBLIC KEY-----\nTEST_KEY\n-----END PUBLIC KEY-----',
      private_key: 'PRIVATE_KEY',
      toModel: function() {
        return {
          id: this.id,
          calendarId: this.calendar_id,
          actorUri: this.actor_uri,
          publicKey: this.public_key,
          privateKey: this.private_key,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
    } as any);

    let response = await service.lookupUserProfile('testCalendar');
    let expected = new UserProfileResponse('testCalendar', 'pavillion.dev', '-----BEGIN PUBLIC KEY-----\nTEST_KEY\n-----END PUBLIC KEY-----').toObject();

    expect(response).toBeDefined();
    expect(response?.toObject()).toEqual(expected);
  });
});

describe("addToInbox", () => {
  let service: ActivityPubService;
  let eventBus: EventEmitter;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    eventBus = new EventEmitter();
    const calendarInterface = new CalendarInterface(eventBus);
    const accountsInterface = new AccountsInterface(eventBus);
    service = new ActivityPubService(eventBus, calendarInterface, accountsInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should persist the message with auth context and emit inboxMessageAdded', async () => {
    // fromObject only copies actor/object, so set id/type explicitly to
    // verify addToInbox forwards them into the shared writer.
    let message = ActivityPubActivity.fromObject({ type: 'Create', id: 'testid' });
    message.id = 'testid';
    message.type = 'Create';
    let calendar = Calendar.fromObject({ id: 'testid' });

    let getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    getCalendarStub.resolves(calendar);

    // The shared inbox writer persists via findOrCreate (first writer wins).
    let findOrCreateStub = sandbox.stub(ActivityPubInboxMessageEntity, 'findOrCreate');
    findOrCreateStub.resolves([{ id: 'testid' } as any, true]);

    let emitSpy = sandbox.spy(eventBus, 'emit');

    let response = await service.addToInbox(calendar, message, {
      source: 'http_signature',
      origin: 'https://remote.example.com',
    });

    expect(response).toBe(null);
    expect(findOrCreateStub.calledOnce).toBe(true);
    const findOrCreateArgs = findOrCreateStub.firstCall.args[0] as any;
    expect(findOrCreateArgs.where.id).toBe('testid');
    expect(findOrCreateArgs.defaults.type).toBe('Create');
    expect(findOrCreateArgs.defaults.auth_source).toBe('http_signature');
    expect(findOrCreateArgs.defaults.auth_origin).toBe('https://remote.example.com');

    // The live entry point emits so the inbox subscription drains immediately.
    expect(emitSpy.calledWith('inboxMessageAdded', { calendar_id: 'testid', id: 'testid' })).toBe(true);
  });

  it('should persist null auth_origin when origin is unknown', async () => {
    let message = ActivityPubActivity.fromObject({ type: 'Create', id: 'testid' });
    let calendar = Calendar.fromObject({ id: 'testid' });

    let getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    getCalendarStub.resolves(calendar);

    let findOrCreateStub = sandbox.stub(ActivityPubInboxMessageEntity, 'findOrCreate');
    findOrCreateStub.resolves([{ id: 'testid' } as any, true]);

    await service.addToInbox(calendar, message, { source: 'http_signature', origin: null });

    expect(findOrCreateStub.calledOnce).toBe(true);
    const findOrCreateArgs = findOrCreateStub.firstCall.args[0] as any;
    expect(findOrCreateArgs.defaults.auth_source).toBe('http_signature');
    expect(findOrCreateArgs.defaults.auth_origin).toBe(null);
  });

  it('should throw an error if calendar not found', async () => {
    let message = ActivityPubActivity.fromObject({ type: 'Create', id: 'testid' });
    let calendar = Calendar.fromObject({ id: 'testid' });

    let getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    getCalendarStub.resolves(null);

    await expect(
      service.addToInbox(calendar, message, { source: 'http_signature', origin: null }),
    ).rejects.toThrow('Account not found');
  });
});

describe("enqueueInboxRow", () => {
  let service: ActivityPubService;
  let eventBus: EventEmitter;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    eventBus = new EventEmitter();
    const calendarInterface = new CalendarInterface(eventBus);
    const accountsInterface = new AccountsInterface(eventBus);
    service = new ActivityPubService(eventBus, calendarInterface, accountsInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should persist the row via findOrCreate without emitting inboxMessageAdded', async () => {
    let findOrCreateStub = sandbox.stub(ActivityPubInboxMessageEntity, 'findOrCreate');
    findOrCreateStub.resolves([{ id: 'testid' } as any, true]);

    let emitSpy = sandbox.spy(eventBus, 'emit');

    const messageTime = new Date('2026-05-15T00:00:00Z');
    let result = await service.enqueueInboxRow({
      calendarId: 'cal-1',
      id: 'testid',
      type: 'Create',
      messageTime,
      message: { type: 'Create', id: 'testid' },
      auth: { source: 'outbox_pull', origin: 'https://remote.example.com' },
    });

    expect(result).toEqual({ created: true });
    expect(findOrCreateStub.calledOnce).toBe(true);
    const findOrCreateArgs = findOrCreateStub.firstCall.args[0] as any;
    expect(findOrCreateArgs.where.id).toBe('testid');
    expect(findOrCreateArgs.defaults.calendar_id).toBe('cal-1');
    expect(findOrCreateArgs.defaults.message_time).toBe(messageTime);
    expect(findOrCreateArgs.defaults.auth_source).toBe('outbox_pull');
    expect(findOrCreateArgs.defaults.auth_origin).toBe('https://remote.example.com');

    // The deferred entry point never emits — the caller drains explicitly.
    expect(emitSpy.calledWith('inboxMessageAdded')).toBe(false);
  });

  it('should return created=false on an idempotent no-op against an existing id', async () => {
    let findOrCreateStub = sandbox.stub(ActivityPubInboxMessageEntity, 'findOrCreate');
    findOrCreateStub.resolves([{ id: 'testid' } as any, false]);

    let result = await service.enqueueInboxRow({
      calendarId: 'cal-1',
      id: 'testid',
      type: 'Create',
      messageTime: new Date('2026-05-15T00:00:00Z'),
      message: { type: 'Create', id: 'testid' },
      auth: { source: 'outbox_pull', origin: null },
    });

    expect(result).toEqual({ created: false });
  });
});
