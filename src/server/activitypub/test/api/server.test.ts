import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Calendar } from '@/common/model/calendar';
import { WebFingerResponse } from '@/server/activitypub/model/webfinger';
import ActivityPubServerRoutes from '@/server/activitypub/api/v1/server';
import ActivityPubInterface from '@/server/activitypub/interface';
import CalendarInterface from '@/server/calendar/interface';
import { logInboxActivityAccepted } from '@/server/activitypub/helper/inbox-acceptance-log';

// The acceptance record is the observable that federation e2e assertions key
// off (tests/e2e/federation/helpers/instances.ts). Stubbing the emitter lets
// these tests pin WHERE in the handler it fires.
vi.mock('@/server/activitypub/helper/inbox-acceptance-log', () => ({
  logInboxActivityAccepted: vi.fn(),
}));

describe('lookupUser', () => {
  let routes: ActivityPubServerRoutes;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let activityPubInterface: ActivityPubInterface;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    activityPubInterface = new ActivityPubInterface(eventBus);
    const calendarAPI = new CalendarInterface(eventBus);
    routes = new ActivityPubServerRoutes(activityPubInterface, calendarAPI);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should fail without resource', async () => {
    let req = { query: {} };
    let res = { status: sinon.stub(), send: sinon.stub() };
    res.status.returns(res);

    await routes.lookupUser(req as any, res as any);

    expect(res.status.calledWith(400)).toBe(true);
    expect(res.send.calledWith('Invalid request')).toBe(true);
  });

  it('should fail with unknown user', async () => {
    let req = { query: { resource: 'acct:testuser@testdomain.com' } };
    let res = { status: sinon.stub(), send: sinon.stub() };
    res.status.returns(res);

    let lookupMock = sandbox.stub(activityPubInterface, 'lookupWebFinger');
    lookupMock.resolves(null);

    await routes.lookupUser(req as any, res as any);

    expect(res.status.calledWith(404)).toBe(true);
    expect(res.send.calledWith('Calendar not found')).toBe(true);
  });

  it('should succeed with known user', async () => {
    let req = { query: { resource: 'acct:testuser@testdomain.com' } };
    let res = { json: sinon.stub() };

    let lookupMock = sandbox.stub(activityPubInterface, 'lookupWebFinger');
    lookupMock.resolves(new WebFingerResponse('testuser', 'testdomain.com'));

    await routes.lookupUser(req as any, res as any);

    expect(res.json.called).toBe(true);
  });
});

describe('addToInbox', () => {
  let routes: ActivityPubServerRoutes;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let activityPubInterface: ActivityPubInterface;
  let calendarAPI: CalendarInterface;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    activityPubInterface = new ActivityPubInterface(eventBus);
    calendarAPI = new CalendarInterface(eventBus);
    routes = new ActivityPubServerRoutes(activityPubInterface, calendarAPI);
    vi.mocked(logInboxActivityAccepted).mockClear();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should fail without user', async () => {
    let req = { params: {} };
    let res = { status: sinon.stub(), send: sinon.stub() };
    let calendarFindMock = sandbox.stub(calendarAPI, 'getCalendarByName');
    res.status.returns(res);
    calendarFindMock.resolves(null);

    await routes.addToInbox(req as any, res as any);

    expect(res.status.calledWith(404)).toBe(true);
    expect(res.send.calledWith('Calendar not found')).toBe(true);
  });

  it('should fail with invalid message type', async () => {
    let req = { params: { orgname: 'testuser' }, body: { type: 'Foobar', actor: 'https://example.com/actor' } };
    let res = { status: sinon.stub(), send: sinon.stub(), json: sinon.stub() };
    let userFindMock = sandbox.stub(calendarAPI, 'getCalendarByName');
    let inboxMock = sandbox.stub(activityPubInterface, 'addToInbox');

    res.status.returns(res);
    userFindMock.resolves(new Calendar("testId","testuser"));
    inboxMock.resolves();

    await routes.addToInbox(req as any, res as any);

    expect(res.status.calledWith(400)).toBe(true);
    expect(res.json.calledOnce).toBe(true);
    const response = res.json.firstCall.args[0];
    expect(response.error).toBe('Unsupported activity type');
  });

  it('should succeed with valid message type', async () => {
    let req = {
      params: { orgname: 'testuser' },
      body: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Create',
        id: 'https://example.com/activities/123',
        actor: 'https://example.com/actor',
        object: { id: 'https://example.com/objects/456', type: 'Event' },
      },
    };
    let res = { status: sinon.stub(), send: sinon.stub() };
    let userFindMock = sandbox.stub(calendarAPI, 'getCalendarByName');
    let inboxMock = sandbox.stub(activityPubInterface, 'addToInbox');

    res.status.returns(res);
    userFindMock.resolves(new Calendar("testId","testuser"));
    inboxMock.resolves();

    await routes.addToInbox(req as any, res as any);

    expect(res.status.calledWith(200)).toBe(true);
    expect(res.send.calledWith('Message received')).toBe(true);
    expect(inboxMock.calledOnce).toBe(true);
    const auth = inboxMock.firstCall.args[2] as any;
    expect(auth).toBeDefined();
    expect(auth.source).toBe('http_signature');
    // No Signature header on the request, so origin must be null but the row still writes.
    expect(auth.origin).toBe(null);
  });

  it('should record acceptance only after the inbox write succeeds', async () => {
    let req = {
      params: { urlname: 'testuser' },
      body: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Create',
        id: 'https://example.com/activities/125',
        actor: 'https://example.com/actor',
        object: { id: 'https://example.com/objects/456', type: 'Event' },
      },
    };
    let res = { status: sinon.stub(), send: sinon.stub() };
    let userFindMock = sandbox.stub(calendarAPI, 'getCalendarByName');
    let inboxMock = sandbox.stub(activityPubInterface, 'addToInbox');

    res.status.returns(res);
    userFindMock.resolves(new Calendar('testId', 'testuser'));
    inboxMock.resolves();

    await routes.addToInbox(req as any, res as any);

    expect(inboxMock.calledOnce).toBe(true);
    expect(vi.mocked(logInboxActivityAccepted)).toHaveBeenCalledOnce();
    expect(vi.mocked(logInboxActivityAccepted)).toHaveBeenCalledWith('calendar', 'testuser', req.body);
  });

  it('should not record acceptance when the inbox write fails', async () => {
    // Ordering is the point: the acceptance record must sit downstream of the
    // write, so a write that throws leaves no acceptance behind.
    let req = {
      params: { urlname: 'testuser' },
      body: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Create',
        id: 'https://example.com/activities/127',
        actor: 'https://example.com/actor',
        object: { id: 'https://example.com/objects/456', type: 'Event' },
      },
    };
    let res = { status: sinon.stub(), send: sinon.stub() };
    let userFindMock = sandbox.stub(calendarAPI, 'getCalendarByName');
    let inboxMock = sandbox.stub(activityPubInterface, 'addToInbox');

    res.status.returns(res);
    userFindMock.resolves(new Calendar('testId', 'testuser'));
    inboxMock.rejects(new Error('Account not found'));

    await expect(routes.addToInbox(req as any, res as any)).rejects.toThrow('Account not found');

    expect(vi.mocked(logInboxActivityAccepted)).not.toHaveBeenCalled();
  });

  it('should not record acceptance for an activity rejected at the validation switch', async () => {
    // 'Foobar' falls through to the unsupported-type branch. The handler has
    // already logged arrival by then; nothing may log acceptance.
    let req = { params: { urlname: 'testuser' }, body: { type: 'Foobar', actor: 'https://example.com/actor' } };
    let res = { status: sinon.stub(), send: sinon.stub(), json: sinon.stub() };
    let userFindMock = sandbox.stub(calendarAPI, 'getCalendarByName');
    let inboxMock = sandbox.stub(activityPubInterface, 'addToInbox');

    res.status.returns(res);
    userFindMock.resolves(new Calendar('testId', 'testuser'));
    inboxMock.resolves();

    await routes.addToInbox(req as any, res as any);

    expect(res.status.calledWith(400)).toBe(true);
    expect(vi.mocked(logInboxActivityAccepted)).not.toHaveBeenCalled();
  });

  it('should not record acceptance for an activity that fails schema validation', async () => {
    // A supported type whose payload fails its zod schema: the Create carries
    // no object, so validation rejects it after the arrival log.
    let req = {
      params: { urlname: 'testuser' },
      body: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Create',
        id: 'https://example.com/activities/126',
        actor: 'https://example.com/actor',
      },
    };
    let res = { status: sinon.stub(), send: sinon.stub(), json: sinon.stub() };
    let userFindMock = sandbox.stub(calendarAPI, 'getCalendarByName');
    let inboxMock = sandbox.stub(activityPubInterface, 'addToInbox');

    res.status.returns(res);
    userFindMock.resolves(new Calendar('testId', 'testuser'));
    inboxMock.resolves();

    await routes.addToInbox(req as any, res as any);

    expect(res.status.calledWith(400)).toBe(true);
    expect(inboxMock.called).toBe(false);
    expect(vi.mocked(logInboxActivityAccepted)).not.toHaveBeenCalled();
  });

  // The synchronous Person-actor branch is a separate inbound dispatch surface
  // from the async addToInbox path above: a Create/Update/Delete from a
  // `/users/` actor never reaches the inbox write, and records acceptance from
  // its own call site. It refuses unauthorized editors with a 403, so it needs
  // the same two-sided pinning the async path has.
  const personActorCreate = (activityId: string) => ({
    params: { urlname: 'testuser' },
    body: {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Create',
      id: activityId,
      actor: 'https://example.com/users/alice',
      object: { id: 'https://example.com/objects/789', type: 'Event' },
    },
  });

  it('should record acceptance when the Person actor activity is processed', async () => {
    let req = personActorCreate('https://example.com/activities/128');
    let res = { status: sinon.stub(), send: sinon.stub(), json: sinon.stub() };
    let userFindMock = sandbox.stub(calendarAPI, 'getCalendarByName');
    let inboxMock = sandbox.stub(activityPubInterface, 'addToInbox');
    let personMock = sandbox.stub(activityPubInterface, 'processPersonActorActivity');

    res.status.returns(res);
    userFindMock.resolves(new Calendar('testId', 'testuser'));
    personMock.resolves(null);

    await routes.addToInbox(req as any, res as any);

    expect(personMock.calledOnce).toBe(true);
    // The synchronous branch returns before the async inbox write.
    expect(inboxMock.called).toBe(false);
    expect(res.status.calledWith(200)).toBe(true);
    expect(vi.mocked(logInboxActivityAccepted)).toHaveBeenCalledOnce();
    expect(vi.mocked(logInboxActivityAccepted)).toHaveBeenCalledWith('calendar', 'testuser', req.body);
  });

  it('should not record acceptance when the Person actor is not an authorized editor', async () => {
    // The 403 refusal is the failure mode this pinning exists for: a handler
    // that rejects the activity must leave no acceptance record behind.
    let req = personActorCreate('https://example.com/activities/129');
    let res = { status: sinon.stub(), send: sinon.stub(), json: sinon.stub() };
    let userFindMock = sandbox.stub(calendarAPI, 'getCalendarByName');
    let inboxMock = sandbox.stub(activityPubInterface, 'addToInbox');
    let personMock = sandbox.stub(activityPubInterface, 'processPersonActorActivity');

    res.status.returns(res);
    userFindMock.resolves(new Calendar('testId', 'testuser'));
    personMock.rejects(new Error('Actor is not an authorized editor of this calendar'));

    await routes.addToInbox(req as any, res as any);

    expect(res.status.calledWith(403)).toBe(true);
    expect(res.send.calledWith('Forbidden: Not an authorized editor')).toBe(true);
    expect(inboxMock.called).toBe(false);
    expect(vi.mocked(logInboxActivityAccepted)).not.toHaveBeenCalled();
  });

  it('should not record acceptance when Person actor processing errors', async () => {
    let req = personActorCreate('https://example.com/activities/130');
    let res = { status: sinon.stub(), send: sinon.stub(), json: sinon.stub() };
    let userFindMock = sandbox.stub(calendarAPI, 'getCalendarByName');
    let inboxMock = sandbox.stub(activityPubInterface, 'addToInbox');
    let personMock = sandbox.stub(activityPubInterface, 'processPersonActorActivity');

    res.status.returns(res);
    userFindMock.resolves(new Calendar('testId', 'testuser'));
    personMock.rejects(new Error('Database unavailable'));

    await routes.addToInbox(req as any, res as any);

    expect(res.status.calledWith(500)).toBe(true);
    expect(res.send.calledWith('Error processing activity')).toBe(true);
    expect(inboxMock.called).toBe(false);
    expect(vi.mocked(logInboxActivityAccepted)).not.toHaveBeenCalled();
  });

  it('should pass keyId origin from Signature header as auth_origin', async () => {
    let req = {
      params: { orgname: 'testuser' },
      method: 'POST',
      url: '/api/ap/v1/calendars/testuser/inbox',
      headers: {
        host: 'local.example.com',
        date: new Date().toUTCString(),
        signature: 'keyId="https://remote.example.com/calendars/foo#main-key",algorithm="rsa-sha256",headers="(request-target) host date",signature="dGVzdA=="',
      },
      body: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Create',
        id: 'https://example.com/activities/124',
        actor: 'https://remote.example.com/calendars/foo',
        object: { id: 'https://example.com/objects/789', type: 'Event' },
      },
    };
    let res = { status: sinon.stub(), send: sinon.stub() };
    let userFindMock = sandbox.stub(calendarAPI, 'getCalendarByName');
    let inboxMock = sandbox.stub(activityPubInterface, 'addToInbox');

    res.status.returns(res);
    userFindMock.resolves(new Calendar('testId', 'testuser'));
    inboxMock.resolves();

    await routes.addToInbox(req as any, res as any);

    expect(inboxMock.calledOnce).toBe(true);
    const auth = inboxMock.firstCall.args[2] as any;
    expect(auth.source).toBe('http_signature');
    expect(auth.origin).toBe('https://remote.example.com');
  });

  it('should fail with missing actor URI', async () => {
    let req = { params: { urlname: 'testuser' }, body: { type: 'Create', object: { id: 'testObjectId' } } };
    let res = { status: sinon.stub(), json: sinon.stub() };
    let userFindMock = sandbox.stub(calendarAPI, 'getCalendarByName');

    res.status.returns(res);
    userFindMock.resolves(new Calendar("testId","testuser"));

    await routes.addToInbox(req as any, res as any);

    expect(res.status.calledWith(400)).toBe(true);
    expect(res.json.calledOnce).toBe(true);
    const response = res.json.firstCall.args[0];
    expect(response.error).toBe('Invalid actor URI');
    expect(response.details).toBeDefined();
  });

  it('should fail with invalid actor URI (not a URL)', async () => {
    let req = { params: { urlname: 'testuser' }, body: { type: 'Create', actor: 'not-a-url', object: { id: 'testObjectId' } } };
    let res = { status: sinon.stub(), json: sinon.stub() };
    let userFindMock = sandbox.stub(calendarAPI, 'getCalendarByName');

    res.status.returns(res);
    userFindMock.resolves(new Calendar("testId","testuser"));

    await routes.addToInbox(req as any, res as any);

    expect(res.status.calledWith(400)).toBe(true);
    expect(res.json.calledOnce).toBe(true);
    const response = res.json.firstCall.args[0];
    expect(response.error).toBe('Invalid actor URI');
    expect(response.details).toBeDefined();
  });

  it('should allow HTTP actor URI in test environment', async () => {
    let req = {
      params: { urlname: 'testuser' },
      body: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Create',
        id: 'http://example.com/activities/123',
        actor: 'http://example.com/actor',
        object: { id: 'http://example.com/objects/testObjectId', type: 'Event' },
      },
    };
    let res = { status: sinon.stub(), send: sinon.stub(), json: sinon.stub() };
    let userFindMock = sandbox.stub(calendarAPI, 'getCalendarByName');
    let inboxMock = sandbox.stub(activityPubInterface, 'addToInbox');

    res.status.returns(res);
    userFindMock.resolves(new Calendar("testId","testuser"));
    inboxMock.resolves();

    await routes.addToInbox(req as any, res as any);

    // HTTP URLs are allowed in test environment
    expect(res.status.calledWith(200)).toBe(true);
    expect(res.send.calledWith('Message received')).toBe(true);
  });

  it('should succeed with valid HTTPS actor URI', async () => {
    let req = {
      params: { urlname: 'testuser' },
      body: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Follow',
        id: 'https://remote.example.com/activities/follow-123',
        actor: 'https://remote.example.com/calendars/remote',
        object: 'https://local.example.com/calendars/testuser',
      },
    };
    let res = { status: sinon.stub(), send: sinon.stub() };
    let userFindMock = sandbox.stub(calendarAPI, 'getCalendarByName');
    let inboxMock = sandbox.stub(activityPubInterface, 'addToInbox');

    res.status.returns(res);
    userFindMock.resolves(new Calendar("testId","testuser"));
    inboxMock.resolves();

    await routes.addToInbox(req as any, res as any);

    expect(res.status.calledWith(200)).toBe(true);
    expect(res.send.calledWith('Message received')).toBe(true);
  });

  it('should succeed with a valid Accept activity', async () => {
    let req = {
      params: { urlname: 'testuser' },
      body: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Accept',
        id: 'https://remote.example.com/activities/accept-456',
        actor: 'https://remote.example.com/calendars/remote',
        object: {
          type: 'Follow',
          id: 'https://local.example.com/calendars/testuser/follows/789',
          actor: 'https://local.example.com/calendars/testuser',
          object: 'https://remote.example.com/calendars/remote',
        },
      },
    };
    let res = { status: sinon.stub(), send: sinon.stub() };
    let userFindMock = sandbox.stub(calendarAPI, 'getCalendarByName');
    let inboxMock = sandbox.stub(activityPubInterface, 'addToInbox');

    res.status.returns(res);
    userFindMock.resolves(new Calendar('testId', 'testuser'));
    inboxMock.resolves();

    await routes.addToInbox(req as any, res as any);

    expect(res.status.calledWith(200)).toBe(true);
    expect(res.send.calledWith('Message received')).toBe(true);
  });

  it('should succeed with a valid Ignore activity and record http_signature auth', async () => {
    // FEP-8a8e: a peer answers an unhandled Join with an Ignore. Pavillion
    // emits that reply itself, so it must also be able to receive one.
    const embeddedJoin = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Join',
      id: 'https://local.example.com/calendars/testuser/joins/1',
      actor: 'https://local.example.com/calendars/testuser',
      object: 'https://remote.example.com/events/6b1f0a5e-0000-4000-8000-000000000001',
    };
    let req = {
      params: { urlname: 'testuser' },
      body: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Ignore',
        id: 'https://remote.example.com/calendars/remote/ignores/abc-123',
        actor: 'https://remote.example.com/calendars/remote',
        object: embeddedJoin,
        to: ['https://local.example.com/calendars/testuser'],
      },
    };
    let res = { status: sinon.stub(), send: sinon.stub(), json: sinon.stub() };
    let userFindMock = sandbox.stub(calendarAPI, 'getCalendarByName');
    let inboxMock = sandbox.stub(activityPubInterface, 'addToInbox');

    res.status.returns(res);
    userFindMock.resolves(new Calendar('testId', 'testuser'));
    inboxMock.resolves();

    await routes.addToInbox(req as any, res as any);

    expect(res.status.calledWith(200)).toBe(true);
    expect(res.send.calledWith('Message received')).toBe(true);
    expect(inboxMock.calledOnce).toBe(true);

    const message = inboxMock.firstCall.args[1] as any;
    expect(message.type).toBe('Ignore');
    expect(message.id).toBe('https://remote.example.com/calendars/remote/ignores/abc-123');
    // The embedded activity is preserved so the row records what was ignored.
    expect(message.object).toEqual(embeddedJoin);

    const auth = inboxMock.firstCall.args[2] as any;
    expect(auth.source).toBe('http_signature');
  });

  it('should fail with an Ignore activity missing object', async () => {
    let req = {
      params: { urlname: 'testuser' },
      body: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Ignore',
        id: 'https://remote.example.com/calendars/remote/ignores/abc-124',
        actor: 'https://remote.example.com/calendars/remote',
      },
    };
    let res = { status: sinon.stub(), send: sinon.stub(), json: sinon.stub() };
    let userFindMock = sandbox.stub(calendarAPI, 'getCalendarByName');
    let inboxMock = sandbox.stub(activityPubInterface, 'addToInbox');

    res.status.returns(res);
    userFindMock.resolves(new Calendar('testId', 'testuser'));
    inboxMock.resolves();

    await routes.addToInbox(req as any, res as any);

    expect(res.status.calledWith(400)).toBe(true);
    const response = res.json.firstCall.args[0];
    expect(response.error).toBe('Invalid Ignore activity');
    expect(inboxMock.called).toBe(false);
  });

  it('should succeed with a valid Flag activity and record http_signature auth', async () => {
    let req = {
      params: { urlname: 'testuser' },
      body: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Flag',
        id: 'https://remote.example.com/flags/abc-123',
        actor: 'https://remote.example.com/calendars/reporter',
        object: 'https://local.example.com/events/6b1f0a5e-0000-4000-8000-000000000001',
        content: 'This event is spam.',
        summary: 'Event report: spam',
        tag: [{ type: 'Hashtag', name: '#spam' }],
        published: '2026-05-22T12:00:00Z',
      },
    };
    let res = { status: sinon.stub(), send: sinon.stub(), json: sinon.stub() };
    let userFindMock = sandbox.stub(calendarAPI, 'getCalendarByName');
    let inboxMock = sandbox.stub(activityPubInterface, 'addToInbox');

    res.status.returns(res);
    userFindMock.resolves(new Calendar('testId', 'testuser'));
    inboxMock.resolves();

    await routes.addToInbox(req as any, res as any);

    expect(res.status.calledWith(200)).toBe(true);
    expect(res.send.calledWith('Message received')).toBe(true);
    expect(inboxMock.calledOnce).toBe(true);

    // The Flag must be constructed and handed to the inbox intact — the
    // category hashtag is what processFlagActivity round-trips into the
    // report's category.
    const message = inboxMock.firstCall.args[1] as any;
    expect(message.type).toBe('Flag');
    expect(message.id).toBe('https://remote.example.com/flags/abc-123');
    expect(message.tag).toEqual([{ type: 'Hashtag', name: '#spam' }]);

    const auth = inboxMock.firstCall.args[2] as any;
    expect(auth.source).toBe('http_signature');
  });

  it('should fail with a Flag activity missing object', async () => {
    let req = {
      params: { urlname: 'testuser' },
      body: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Flag',
        id: 'https://remote.example.com/flags/abc-124',
        actor: 'https://remote.example.com/calendars/reporter',
      },
    };
    let res = { status: sinon.stub(), send: sinon.stub(), json: sinon.stub() };
    let userFindMock = sandbox.stub(calendarAPI, 'getCalendarByName');
    let inboxMock = sandbox.stub(activityPubInterface, 'addToInbox');

    res.status.returns(res);
    userFindMock.resolves(new Calendar('testId', 'testuser'));
    inboxMock.resolves();

    await routes.addToInbox(req as any, res as any);

    expect(res.status.calledWith(400)).toBe(true);
    const response = res.json.firstCall.args[0];
    expect(response.error).toBe('Invalid Flag activity');
    expect(inboxMock.called).toBe(false);
  });

  it('should fail with a Flag activity whose content exceeds the report description cap', async () => {
    let req = {
      params: { urlname: 'testuser' },
      body: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Flag',
        id: 'https://remote.example.com/flags/abc-125',
        actor: 'https://remote.example.com/calendars/reporter',
        object: 'https://local.example.com/events/6b1f0a5e-0000-4000-8000-000000000001',
        content: 'x'.repeat(2001),
      },
    };
    let res = { status: sinon.stub(), send: sinon.stub(), json: sinon.stub() };
    let userFindMock = sandbox.stub(calendarAPI, 'getCalendarByName');
    let inboxMock = sandbox.stub(activityPubInterface, 'addToInbox');

    res.status.returns(res);
    userFindMock.resolves(new Calendar('testId', 'testuser'));
    inboxMock.resolves();

    await routes.addToInbox(req as any, res as any);

    expect(res.status.calledWith(400)).toBe(true);
    const response = res.json.firstCall.args[0];
    expect(response.error).toBe('Invalid Flag activity');
    expect(inboxMock.called).toBe(false);
  });

  it('should fail with missing @context field', async () => {
    let req = {
      params: { urlname: 'testuser' },
      body: {
        type: 'Create',
        id: 'https://example.com/activities/123',
        actor: 'https://example.com/actor',
        object: { id: 'https://example.com/objects/456', type: 'Event' },
      },
    };
    let res = { status: sinon.stub(), json: sinon.stub() };
    let userFindMock = sandbox.stub(calendarAPI, 'getCalendarByName');

    res.status.returns(res);
    userFindMock.resolves(new Calendar("testId","testuser"));

    await routes.addToInbox(req as any, res as any);

    expect(res.status.calledWith(400)).toBe(true);
    expect(res.json.calledOnce).toBe(true);
    const response = res.json.firstCall.args[0];
    expect(response.error).toBe('Invalid Create activity');
    expect(response.details).toBeDefined();
  });

  it('should fail with missing activity id', async () => {
    let req = {
      params: { urlname: 'testuser' },
      body: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Update',
        actor: 'https://example.com/actor',
        object: { id: 'https://example.com/objects/456', type: 'Event' },
      },
    };
    let res = { status: sinon.stub(), json: sinon.stub() };
    let userFindMock = sandbox.stub(calendarAPI, 'getCalendarByName');

    res.status.returns(res);
    userFindMock.resolves(new Calendar("testId","testuser"));

    await routes.addToInbox(req as any, res as any);

    expect(res.status.calledWith(400)).toBe(true);
    expect(res.json.calledOnce).toBe(true);
    const response = res.json.firstCall.args[0];
    expect(response.error).toBe('Invalid Update activity');
    expect(response.details).toBeDefined();
  });

  it('should fail with missing object field in Create activity', async () => {
    let req = {
      params: { urlname: 'testuser' },
      body: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Create',
        id: 'https://example.com/activities/123',
        actor: 'https://example.com/actor',
      },
    };
    let res = { status: sinon.stub(), json: sinon.stub() };
    let userFindMock = sandbox.stub(calendarAPI, 'getCalendarByName');

    res.status.returns(res);
    userFindMock.resolves(new Calendar("testId","testuser"));

    await routes.addToInbox(req as any, res as any);

    expect(res.status.calledWith(400)).toBe(true);
    expect(res.json.calledOnce).toBe(true);
    const response = res.json.firstCall.args[0];
    expect(response.error).toBe('Invalid Create activity');
    expect(response.details).toBeDefined();
  });

  it('should fail with invalid object URI in Delete activity', async () => {
    let req = {
      params: { urlname: 'testuser' },
      body: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Delete',
        id: 'https://example.com/activities/123',
        actor: 'https://example.com/actor',
        object: 'not-a-valid-url',
      },
    };
    let res = { status: sinon.stub(), json: sinon.stub() };
    let userFindMock = sandbox.stub(calendarAPI, 'getCalendarByName');

    res.status.returns(res);
    userFindMock.resolves(new Calendar("testId","testuser"));

    await routes.addToInbox(req as any, res as any);

    expect(res.status.calledWith(400)).toBe(true);
    expect(res.json.calledOnce).toBe(true);
    const response = res.json.firstCall.args[0];
    expect(response.error).toBe('Invalid Delete activity');
    expect(response.details).toBeDefined();
  });
});
