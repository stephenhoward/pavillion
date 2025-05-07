import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { UserProfileResponse } from '@/server/activitypub/model/userprofile';
import { WebFingerResponse } from '@/server/activitypub/model/webfinger';
import ActivityPubService from '@/server/activitypub/service/server';
import CalendarService from '@/server/calendar/service/calendar';
import { Calendar } from '@/common/model/calendar';
import { ActivityPubActivity } from '@/server/activitypub/model/base';
import { ActivityPubInboxMessageEntity } from '@/server/activitypub/entity/activitypub';

describe('parseWebFingerResource', () => {

  it('should succeed', async () => {
    let service = new ActivityPubService();

    let { username, domain } = service.parseWebFingerResource("acct:testuser@testdomain.com");

    expect(username).toBe("testuser");
    expect(domain).toBe("testdomain.com");
  });

  it('should succeed even missing acct prefix', async () => {
    let service = new ActivityPubService();

    let { username, domain } = service.parseWebFingerResource("testuser@testdomain.com");

    expect(username).toBe("testuser");
    expect(domain).toBe("testdomain.com");
  });

  it('should not return values if malformed', async () => {
    let service = new ActivityPubService();

    let badstrings = [
      "acct:@testdomain.com",
      "acct:username",
      "acct:username@",
      "",
      "acct:",
    ];

    for( let badstring of badstrings ) {
      let { username, domain } = service.parseWebFingerResource(badstring);

      expect(username).toBe("");
      expect(domain).toBe("");
    }
  });

});

describe('lookupWebFinger', () => {
  let service: ActivityPubService;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    service = new ActivityPubService();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return null if no profile', async () => {
    let profileStub = sandbox.stub(CalendarService, 'getCalendarByName');
    profileStub.resolves(null);

    let response = await service.lookupWebFinger('testuser', 'testdomain.com');

    expect(response).toBe(null);
  });

  it('should return a WebFingerResponse', async () => {
    let calendarStub = sandbox.stub(CalendarService, 'getCalendarByName');
    calendarStub.resolves(Calendar.fromObject({ id: 'testid', urlName: 'testuser' }));

    let response = await service.lookupWebFinger('testuser', 'pavillion.dev');
    let expected = new WebFingerResponse('testuser', 'pavillion.dev').toObject();

    expect(response).toBeDefined();
    expect(response).toEqual(expected);
  });
});

describe('lookupUserProfile', () => {
  let service: ActivityPubService;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    service = new ActivityPubService();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return null if no profile', async () => {
    let calendarStub = sandbox.stub(CalendarService, 'getCalendarByName');
    calendarStub.resolves(null);

    let response = await service.lookupUserProfile('testuser');

    expect(response).toBe(null);
  });

  it('should return a UserProfileResponse', async () => {
    let calendarStub = sandbox.stub(CalendarService, 'getCalendarByName');
    calendarStub.resolves(Calendar.fromObject({ id: 'testid', urlName: 'testCalendar' }));

    let response = await service.lookupUserProfile('testCalendar');
    let expected = new UserProfileResponse('testCalendar', 'pavillion.dev').toObject();

    expect(response).toBeDefined();
    expect(response?.toObject()).toEqual(expected);
  });
});

describe("addToInbox", () => {
  let service: ActivityPubService;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    service = new ActivityPubService();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should save the message', async () => {
    let message = ActivityPubActivity.fromObject({ type: 'Create', id: 'testid' });
    let calendar = Calendar.fromObject({ id: 'testid' });

    let getCalendarStub = sandbox.stub(CalendarService, 'getCalendar');
    getCalendarStub.resolves(calendar);

    let findMessageStub = sandbox.stub(ActivityPubInboxMessageEntity, 'findByPk');
    findMessageStub.resolves(null);

    let saveMessageStub = sandbox.stub(ActivityPubInboxMessageEntity.prototype, 'save');
    saveMessageStub.resolves(undefined);

    let response = await service.addToInbox(calendar, message);

    expect(response).toBe(null);
    expect(saveMessageStub.called).toBe(true);
  });

  it('should throw an error if calendar not found', async () => {
    let message = ActivityPubActivity.fromObject({ type: 'Create', id: 'testid' });
    let calendar = Calendar.fromObject({ id: 'testid' });

    let getCalendarStub = sandbox.stub(CalendarService, 'getCalendar');
    getCalendarStub.resolves(null);

    await expect( service.addToInbox(calendar, message) ).rejects.toThrow('Account not found');
  });
});
