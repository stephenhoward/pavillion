import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import ActivityPubMemberRoutes from '@/server/activitypub/api/v1/members';
import ActivityPubInterface from '@/server/activitypub/interface';

/**
 * Creates a mock CalendarInterface with stubbed methods needed by member routes.
 */
function createMockCalendarInterface() {
  return {
    getCalendar: sinon.stub().resolves(null),
    userCanModifyCalendar: sinon.stub().resolves(true),
  };
}

describe ('followCalendar', () => {
  let routes: ActivityPubMemberRoutes;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let activityPubInterface: ActivityPubInterface;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    activityPubInterface = new ActivityPubInterface(eventBus) as any;
    const mockCalendarAPI = createMockCalendarInterface();
    routes = new ActivityPubMemberRoutes(activityPubInterface, mockCalendarAPI as any);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should fail without current user', async () => {
    let req = { body: {} };
    let res = { status: sinon.stub(), json: sinon.stub() };
    res.status.returns(res);

    await routes.followCalendar(req as any, res as any);

    expect(res.status.calledWith(403)).toBe(true);
    expect(res.json.calledOnce).toBe(true);
    const response = res.json.firstCall.args[0];
    expect(response.errorName).toBe('UnauthenticatedError');
  });

  it('should fail without remote account', async () => {
    let req = { body: {}, user: {} };
    let res = { status: sinon.stub(), json: sinon.stub() };
    res.status.returns(res);

    await routes.followCalendar(req as any, res as any);

    expect(res.status.calledWith(400)).toBe(true);
    expect(res.json.calledOnce).toBe(true);
    const response = res.json.firstCall.args[0];
    expect(response.errorName).toBe('InvalidRequestError');
  });

  it('should succeed with remote account', async () => {
    let req = {
      body: { remoteCalendar: 'testCalendarName' },
      user: Account.fromObject({id: 'testAccountId' }),
    };
    let res = { status: sinon.stub(), send: sinon.stub() };
    res.status.returns(res);

    let followMock = sandbox.stub(activityPubInterface, 'followCalendar');
    followMock.resolves();

    await routes.followCalendar(req as any, res as any);

    expect(res.status.calledWith(200)).toBe(true);
    expect(res.send.calledWith('Followed')).toBe(true);
  });
});

describe('unfollowCalendar', () => {
  let routes: ActivityPubMemberRoutes;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let activityPubInterface: ActivityPubInterface;
  let mockCalendarAPI: ReturnType<typeof createMockCalendarInterface>;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    activityPubInterface = new ActivityPubInterface(eventBus) as any;
    mockCalendarAPI = createMockCalendarInterface();
    routes = new ActivityPubMemberRoutes(activityPubInterface, mockCalendarAPI as any);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should fail without current user', async () => {
    let req = { body: {}, params: { id: 'testfollowid' } };
    let res = { status: sinon.stub(), json: sinon.stub() };
    res.status.returns(res);

    await routes.unfollowCalendar(req as any, res as any);

    expect(res.status.calledWith(403)).toBe(true);
    expect(res.json.calledOnce).toBe(true);
    const response = res.json.firstCall.args[0];
    expect(response.errorName).toBe('UnauthenticatedError');
  });

  it('should fail without follow ID', async () => {
    let testCalendar = Calendar.fromObject({ id: 'testcalendarid' });
    let req = {
      body: {
        calendar: testCalendar,
      },
      params: {},  // Missing 'id' parameter - will result in undefined
      user: Account.fromObject({ id: 'testAccountId' }),
    };
    let res = { status: sinon.stub(), json: sinon.stub() };
    res.status.returns(res);

    await routes.unfollowCalendar(req as any, res as any);

    // The route should detect undefined followId and return 400
    expect(res.status.calledWith(400)).toBe(true);
    expect(res.json.calledOnce).toBe(true);
    const response = res.json.firstCall.args[0];
    expect(response.errorName).toBe('InvalidRequestError');
  });

  it('should succeed with follow ID', async () => {
    let testCalendar = Calendar.fromObject({ id: 'testcalendarid' });
    let req = {
      body: {
        calendar: testCalendar,
      },
      params: { id: 'testfollowid' },
      user: Account.fromObject({id: 'testAccountId' }),
    };
    let res = { status: sinon.stub(), send: sinon.stub() };
    res.status.returns(res);

    // Mock the interface method for unfollowing by ID
    let unfollowByIdMock = sandbox.stub(activityPubInterface, 'unfollowCalendarById');
    unfollowByIdMock.resolves();

    await routes.unfollowCalendar(req as any, res as any);

    expect(res.status.calledWith(200)).toBe(true);
    expect(res.send.calledWith('Unfollowed')).toBe(true);
  });
});

describe('shareEvent', () => {
  let routes: ActivityPubMemberRoutes;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let activityPubInterface: ActivityPubInterface;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    activityPubInterface = new ActivityPubInterface(eventBus) as any;
    const mockCalendarAPI = createMockCalendarInterface();
    routes = new ActivityPubMemberRoutes(activityPubInterface, mockCalendarAPI as any);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should fail without current user', async () => {
    let req = { body: {} };
    let res = { status: sinon.stub(), json: sinon.stub() };
    res.status.returns(res);

    await routes.shareEvent(req as any, res as any);

    expect(res.status.calledWith(403)).toBe(true);
    expect(res.json.calledOnce).toBe(true);
    const response = res.json.firstCall.args[0];
    expect(response.errorName).toBe('UnauthenticatedError');
  });

  it('should fail without event id', async () => {
    let req = { body: {}, user: {} };
    let res = { status: sinon.stub(), json: sinon.stub() };
    res.status.returns(res);

    await routes.shareEvent(req as any, res as any);

    expect(res.status.calledWith(400)).toBe(true);
    expect(res.json.calledOnce).toBe(true);
    const response = res.json.firstCall.args[0];
    expect(response.errorName).toBe('InvalidRequestError');
  });

  it('should succeed with event id', async () => {
    let req = {
      body: { eventId: 'testEventId' },
      user: Account.fromObject({id: 'testAccountId' }),
    };
    let res = { status: sinon.stub(), send: sinon.stub() };
    res.status.returns(res);

    let shareMock = sandbox.stub(activityPubInterface, 'shareEvent');
    shareMock.resolves();

    await routes.shareEvent(req as any, res as any);

    expect(res.status.calledWith(200)).toBe(true);
    expect(res.send.calledWith('Shared')).toBe(true);
  });
});

describe('unshareEvent', () => {
  let routes: ActivityPubMemberRoutes;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let activityPubInterface: ActivityPubInterface;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    activityPubInterface = new ActivityPubInterface(eventBus) as any;
    const mockCalendarAPI = createMockCalendarInterface();
    routes = new ActivityPubMemberRoutes(activityPubInterface, mockCalendarAPI as any);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should fail without current user', async () => {
    let req = { body: {} };
    let res = { status: sinon.stub(), json: sinon.stub() };
    res.status.returns(res);

    await routes.unshareEvent(req as any, res as any);

    expect(res.status.calledWith(403)).toBe(true);
    expect(res.json.calledOnce).toBe(true);
    const response = res.json.firstCall.args[0];
    expect(response.errorName).toBe('UnauthenticatedError');
  });

  it('should fail without event id', async () => {
    let req = { body: {}, user: {} };
    let res = { status: sinon.stub(), json: sinon.stub() };
    res.status.returns(res);

    await routes.unshareEvent(req as any, res as any);

    expect(res.status.calledWith(400)).toBe(true);
    expect(res.json.calledOnce).toBe(true);
    const response = res.json.firstCall.args[0];
    expect(response.errorName).toBe('InvalidRequestError');
  });

  it('should succeed with event id', async () => {
    let req = {
      body: { eventId: 'testEventId' },
      user: Account.fromObject({id: 'testAccountId' }),
    };
    let res = { status: sinon.stub(), send: sinon.stub() };
    res.status.returns(res);

    let unshareMock = sandbox.stub(activityPubInterface, 'unshareEvent');
    unshareMock.resolves();

    await routes.unshareEvent(req as any, res as any);

    expect(res.status.calledWith(200)).toBe(true);
    expect(res.send.calledWith('Unshared')).toBe(true);
  });
});
