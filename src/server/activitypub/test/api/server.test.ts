import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Calendar } from '@/common/model/calendar';
import { WebFingerResponse } from '@/server/activitypub/model/webfinger';
import { UserProfileResponse } from '@/server/activitypub/model/userprofile';
import ActivityPubServerRoutes from '@/server/activitypub/api/v1/server';
import ActivityPubInterface from '@/server/activitypub/interface';
import CalendarInterface from '@/server/calendar/interface';

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
