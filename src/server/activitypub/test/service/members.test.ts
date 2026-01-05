import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import ActivityPubService from '@/server/activitypub/service/members';
import { Calendar } from '@/common/model/calendar';
import { FollowingCalendarEntity } from '@/server/activitypub/entity/activitypub';
import { InvalidRemoteCalendarIdentifierError } from '@/common/exceptions/activitypub';

describe("followCalendar", () => {
  let service: ActivityPubService;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let getCalendarStub: sinon.SinonStub;
  let userCanEditCalendarStub: sinon.SinonStub;
  let account: Account = Account.fromObject({ id: 'testAccountId' });

  beforeEach(() => {
    const eventBus = new EventEmitter();
    service = new ActivityPubService(eventBus);
    getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    getCalendarStub.resolves(Calendar.fromObject({ id: 'testid' }));
    userCanEditCalendarStub = sandbox.stub(service.calendarService, 'userCanModifyCalendar');
    userCanEditCalendarStub.resolves(true);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should follow the calendar', async () => {

    let calendar = Calendar.fromObject({ id: 'testid' });

    // Mock the WebFinger/ActivityPub lookup to avoid real HTTP calls
    let lookupRemoteCalendarStub = sandbox.stub(service, 'lookupRemoteCalendar');
    lookupRemoteCalendarStub.resolves({
      name: 'Test Calendar',
      description: undefined,
      domain: 'testdomain.com',
      actorUrl: 'https://testdomain.com/o/testcalendar',
      calendarId: undefined,
    });

    let getExistingFollowStub = sandbox.stub(FollowingCalendarEntity, 'findOne');
    getExistingFollowStub.resolves(null);

    let getActorUrlStub = sandbox.stub(service, 'actorUrl');
    getActorUrlStub.resolves('https://testdomain.com/o/testcalendar');

    let buildFollowStub = sandbox.spy(FollowingCalendarEntity, 'build');

    let saveFollowStub = sandbox.stub(FollowingCalendarEntity.prototype, 'save');
    saveFollowStub.resolves();

    let addToOutboxStub = sandbox.stub(service, 'addToOutbox');
    addToOutboxStub.resolves();

    await service.followCalendar(account, calendar,'testcalendar@testdomain.com');

    expect( buildFollowStub.calledOnce ).toBe(true);
    expect(saveFollowStub.calledOnce ).toBe(true);
    expect(addToOutboxStub.calledOnce).toBe(true);

    let call = buildFollowStub.getCall(0);
    let callargs = call.args[0];
    if ( callargs ) {
      expect( callargs.id ).toMatch(/https:\/\/testdomain.com\/o\/testcalendar\/follows\/[a-z0-9-]+/);
      expect( callargs.calendar_id ).toBe('testid');
      // The remote_calendar_id should now be the ActivityPub actor URL, not the WebFinger identifier
      expect( callargs.remote_calendar_id ).toBe('https://testdomain.com/o/testcalendar');

      let outboxCall = addToOutboxStub.getCall(0);
      if ( outboxCall ) {
        expect(outboxCall.args[0]).toBe(calendar);
        expect(outboxCall.args[1].id).toBe(callargs.id);
        expect(outboxCall.args[1].type).toBe('Follow');
      }
    }
  });

  it('already follows the calendar, do nothing', async () => {

    let calendar = Calendar.fromObject({ id: 'testid' });

    // Mock the WebFinger/ActivityPub lookup to avoid real HTTP calls
    let lookupRemoteCalendarStub = sandbox.stub(service, 'lookupRemoteCalendar');
    lookupRemoteCalendarStub.resolves({
      name: 'Test Calendar',
      description: undefined,
      domain: 'testdomain.com',
      actorUrl: 'https://testdomain.com/o/testcalendar',
      calendarId: undefined,
    });

    let getExistingFollowStub = sandbox.stub(FollowingCalendarEntity, 'findOne');
    getExistingFollowStub.resolves(FollowingCalendarEntity.build({
      auto_repost_originals: false,
      auto_repost_reposts: false,
    }));

    let getActorUrlStub = sandbox.stub(service, 'actorUrl');
    getActorUrlStub.resolves('https://testdomain.com/o/testcalendar');

    let buildFollowStub = sandbox.spy(FollowingCalendarEntity, 'build');

    let saveFollowStub = sandbox.stub(FollowingCalendarEntity.prototype, 'save');
    saveFollowStub.resolves();

    let addToOutboxStub = sandbox.stub(service, 'addToOutbox');
    addToOutboxStub.resolves();

    await service.followCalendar(account, calendar,'testcalendar@testdomain.com');

    expect( buildFollowStub.called ).toBe(false);
    expect( saveFollowStub.called ).toBe(false);
    expect( addToOutboxStub.called ).toBe(false);
  });

  it('fails with an invalid calendar identifier', async () => {

    let calendar = Calendar.fromObject({ id: 'testid' });

    let buildFollowStub = sandbox.spy(FollowingCalendarEntity, 'build');

    let saveFollowStub = sandbox.stub(FollowingCalendarEntity.prototype, 'save');
    saveFollowStub.resolves();

    let addToOutboxStub = sandbox.stub(service, 'addToOutbox');
    addToOutboxStub.resolves();

    await expect( service.followCalendar(account, calendar,'invalidUserIdentifier') ).rejects.toThrow(InvalidRemoteCalendarIdentifierError);
    expect( buildFollowStub.called ).toBe(false);
    expect( saveFollowStub.called ).toBe(false);
    expect( addToOutboxStub.called ).toBe(false);
  });

});

describe("unfollowCalendar", () => {
  let service: ActivityPubService;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let getCalendarStub: sinon.SinonStub;
  let userCanEditCalendarStub: sinon.SinonStub;
  let account: Account = Account.fromObject({ id: 'testAccountId' });

  beforeEach(() => {
    const eventBus = new EventEmitter();
    service = new ActivityPubService(eventBus);
    getCalendarStub = sandbox.stub(service.calendarService, 'getCalendar');
    getCalendarStub.resolves(Calendar.fromObject({ id: 'testid' }));
    userCanEditCalendarStub = sandbox.stub(service.calendarService, 'userCanModifyCalendar');
    userCanEditCalendarStub.resolves(true);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should unfollow the calendar', async () => {

    let calendar = Calendar.fromObject({ id: 'testid' });

    let getExistingFollowStub = sandbox.stub(FollowingCalendarEntity, 'findAll');
    getExistingFollowStub.resolves([
      FollowingCalendarEntity.build({
        id: 'testfollowid',
        remote_calendar_id: 'testcalendar@testdomain.com',
      }),
    ]);

    let getActorUrlStub = sandbox.stub(service, 'actorUrl');
    getActorUrlStub.resolves('https://testdomain.com/o/testcalendar');

    let destroyFollowStub = sandbox.stub(FollowingCalendarEntity.prototype, 'destroy');
    destroyFollowStub.resolves();

    let addToOutboxStub = sandbox.stub(service, 'addToOutbox');
    addToOutboxStub.resolves();

    await service.unfollowCalendar(account, calendar,'testcalendar@testdomain.com');

    expect(destroyFollowStub.calledOnce ).toBe(true);
    expect(addToOutboxStub.calledOnce).toBe(true);

    let outboxCall = addToOutboxStub.getCall(0);
    if ( outboxCall ) {
      expect(outboxCall.args[0]).toBe(calendar);
      expect(outboxCall.args[1].type).toBe('Undo');
      expect(outboxCall.args[1].actor).toBe('https://testdomain.com/o/testcalendar');
      expect(outboxCall.args[1].object).toBe('testfollowid');
    }
  });

  it('does not follow this calendar, do nothing', async () => {

    let calendar = Calendar.fromObject({ id: 'testid' });

    let getExistingFollowStub = sandbox.stub(FollowingCalendarEntity, 'findAll');
    getExistingFollowStub.resolves([]);

    let getActorUrlStub = sandbox.stub(service, 'actorUrl');
    getActorUrlStub.resolves('https://testdomain.com/o/testcalendar');

    let destroyFollowStub = sandbox.stub(FollowingCalendarEntity.prototype, 'destroy');
    destroyFollowStub.resolves();

    let addToOutboxStub = sandbox.stub(service, 'addToOutbox');
    addToOutboxStub.resolves();

    await service.unfollowCalendar(account, calendar,'testcalendar@testdomain.com');

    expect( destroyFollowStub.called ).toBe(false);
    expect( addToOutboxStub.called ).toBe(false);
  });
});
