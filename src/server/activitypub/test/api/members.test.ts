import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import CalendarService from '@/server/calendar/service/calendar';
import ActivityPubMemberRoutes from '@/server/activitypub/api/v1/members';
import ActivityPubInterface from '@/server/activitypub/interface';
import { FollowingCalendarEntity } from '@/server/activitypub/entity/activitypub';

describe ('followCalendar', () => {
  let routes: ActivityPubMemberRoutes;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let activityPubInterface: ActivityPubInterface;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    activityPubInterface = new ActivityPubInterface(eventBus);
    routes = new ActivityPubMemberRoutes(activityPubInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should fail without current user', async () => {
    let req = { body: {} };
    let res = { status: sinon.stub(), send: sinon.stub() };
    res.status.returns(res);

    await routes.followCalendar(req as any, res as any);

    expect(res.status.calledWith(403)).toBe(true);
    expect(res.send.calledWith('Not logged in')).toBe(true);
  });

  it('should fail without remote account', async () => {
    let req = { body: {}, user: {} };
    let res = { status: sinon.stub(), send: sinon.stub() };
    res.status.returns(res);

    await routes.followCalendar(req as any, res as any);

    expect(res.status.calledWith(400)).toBe(true);
    expect(res.send.calledWith('Invalid request')).toBe(true);
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

  beforeEach(() => {
    const eventBus = new EventEmitter();
    activityPubInterface = new ActivityPubInterface(eventBus);
    routes = new ActivityPubMemberRoutes(activityPubInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should fail without current user', async () => {
    let req = { body: {}, params: { id: 'testfollowid' } };
    let res = { status: sinon.stub(), send: sinon.stub() };
    res.status.returns(res);

    await routes.unfollowCalendar(req as any, res as any);

    expect(res.status.calledWith(403)).toBe(true);
    expect(res.send.calledWith('Not logged in')).toBe(true);
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
    let res = { status: sinon.stub(), send: sinon.stub(), json: sinon.stub() };
    res.status.returns(res);

    await routes.unfollowCalendar(req as any, res as any);

    // The route should detect undefined followId and return 400 with 'Invalid follow ID'
    expect(res.status.calledWith(400)).toBe(true);
    expect(res.send.calledWith('Invalid follow ID')).toBe(true);
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

    // Stub CalendarService.prototype to avoid database calls
    let userCanModifyStub = sandbox.stub(CalendarService.prototype, 'userCanModifyCalendar');
    userCanModifyStub.resolves(true);

    // Mock follow entity lookup
    let findOneStub = sandbox.stub(FollowingCalendarEntity, 'findOne');
    findOneStub.resolves(FollowingCalendarEntity.build({
      id: 'testfollowid',
      remote_calendar_id: 'https://remote.example/o/remotecal',
      calendar_id: 'testcalendarid',
    }));

    // Mock the interface method, not the internal service
    let unfollowMock = sandbox.stub(activityPubInterface, 'unfollowCalendar');
    unfollowMock.resolves();

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
    activityPubInterface = new ActivityPubInterface(eventBus);
    routes = new ActivityPubMemberRoutes(activityPubInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should fail without current user', async () => {
    let req = { body: {} };
    let res = { status: sinon.stub(), send: sinon.stub() };
    res.status.returns(res);

    await routes.shareEvent(req as any, res as any);

    expect(res.status.calledWith(403)).toBe(true);
    expect(res.send.calledWith('Not logged in')).toBe(true);
  });

  it('should fail without event id', async () => {
    let req = { body: {}, user: {} };
    let res = { status: sinon.stub(), send: sinon.stub() };
    res.status.returns(res);

    await routes.shareEvent(req as any, res as any);

    expect(res.status.calledWith(400)).toBe(true);
    expect(res.send.calledWith('Invalid request')).toBe(true);
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
    activityPubInterface = new ActivityPubInterface(eventBus);
    routes = new ActivityPubMemberRoutes(activityPubInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should fail without current user', async () => {
    let req = { body: {} };
    let res = { status: sinon.stub(), send: sinon.stub() };
    res.status.returns(res);

    await routes.unshareEvent(req as any, res as any);

    expect(res.status.calledWith(403)).toBe(true);
    expect(res.send.calledWith('Not logged in')).toBe(true);
  });

  it('should fail without event id', async () => {
    let req = { body: {}, user: {} };
    let res = { status: sinon.stub(), send: sinon.stub() };
    res.status.returns(res);

    await routes.unshareEvent(req as any, res as any);

    expect(res.status.calledWith(400)).toBe(true);
    expect(res.send.calledWith('Invalid request')).toBe(true);
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
