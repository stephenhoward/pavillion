import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import ActivityPubService from '@/server/activitypub/service/members';
import { Calendar } from '@/common/model/calendar';
import { FollowingCalendarEntity } from '@/server/activitypub/entity/activitypub';
import { InvalidRemoteCalendarIdentifierError } from '@/common/exceptions/activitypub';

// Mock CalendarActor model for testing (remote type)
const mockRemoteCalendar = {
  id: 'mock-calendar-actor-uuid',
  actorType: 'remote',
  calendarId: null,
  actorUri: 'https://testdomain.com/calendars/testcalendar',
  remoteDisplayName: null,
  remoteDomain: 'testdomain.com',
  inboxUrl: null,
  sharedInboxUrl: null,
  publicKey: null,
  privateKey: null,
  lastFetched: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

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
      actorUrl: 'https://testdomain.com/calendars/testcalendar',
      calendarId: undefined,
    });

    // Mock RemoteCalendarService methods
    let findOrCreateStub = sandbox.stub(service.remoteCalendarService, 'findOrCreateByActorUri');
    findOrCreateStub.resolves(mockRemoteCalendar);

    let updateMetadataStub = sandbox.stub(service.remoteCalendarService, 'updateMetadata');
    updateMetadataStub.resolves(mockRemoteCalendar);

    let getExistingFollowStub = sandbox.stub(FollowingCalendarEntity, 'findOne');
    getExistingFollowStub.resolves(null);

    let getActorUrlStub = sandbox.stub(service, 'actorUrl');
    getActorUrlStub.resolves('https://testdomain.com/calendars/testcalendar');

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
      expect( callargs.id ).toMatch(/https:\/\/testdomain.com\/calendars\/testcalendar\/follows\/[a-z0-9-]+/);
      expect( callargs.calendar_id ).toBe('testid');
      // The calendar_actor_id should now be the CalendarActorEntity UUID
      expect( callargs.calendar_actor_id ).toBe(mockRemoteCalendar.id);

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
      actorUrl: 'https://testdomain.com/calendars/testcalendar',
      calendarId: undefined,
    });

    // Mock RemoteCalendarService methods
    let findOrCreateStub = sandbox.stub(service.remoteCalendarService, 'findOrCreateByActorUri');
    findOrCreateStub.resolves(mockRemoteCalendar);

    let updateMetadataStub = sandbox.stub(service.remoteCalendarService, 'updateMetadata');
    updateMetadataStub.resolves(mockRemoteCalendar);

    let getExistingFollowStub = sandbox.stub(FollowingCalendarEntity, 'findOne');
    getExistingFollowStub.resolves(FollowingCalendarEntity.build({
      auto_repost_originals: false,
      auto_repost_reposts: false,
    }));

    let getActorUrlStub = sandbox.stub(service, 'actorUrl');
    getActorUrlStub.resolves('https://testdomain.com/calendars/testcalendar');

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

    // Mock the WebFinger/ActivityPub lookup to resolve the identifier
    let lookupRemoteCalendarStub = sandbox.stub(service, 'lookupRemoteCalendar');
    lookupRemoteCalendarStub.resolves({
      name: 'Test Calendar',
      description: undefined,
      domain: 'testdomain.com',
      actorUrl: 'https://testdomain.com/calendars/testcalendar',
      calendarId: undefined,
    });

    // Mock RemoteCalendarService to return the CalendarActor for the AP URL
    let getByActorUriStub = sandbox.stub(service.remoteCalendarService, 'getByActorUri');
    getByActorUriStub.resolves(mockRemoteCalendar);

    let getExistingFollowStub = sandbox.stub(FollowingCalendarEntity, 'findAll');
    getExistingFollowStub.resolves([
      FollowingCalendarEntity.build({
        id: 'testfollowid',
        calendar_actor_id: mockRemoteCalendar.id,
      }),
    ]);

    let getActorUrlStub = sandbox.stub(service, 'actorUrl');
    getActorUrlStub.resolves('https://testdomain.com/calendars/testcalendar');

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
      expect(outboxCall.args[1].actor).toBe('https://testdomain.com/calendars/testcalendar');
      expect(outboxCall.args[1].object).toBe('testfollowid');
      // Verify the recipient is set to the AP URL, not the UUID
      expect(outboxCall.args[1].to).toContain(mockRemoteCalendar.actorUri);
    }
  });

  it('does not follow this calendar, do nothing', async () => {

    let calendar = Calendar.fromObject({ id: 'testid' });

    // Mock the WebFinger/ActivityPub lookup to resolve the identifier
    let lookupRemoteCalendarStub = sandbox.stub(service, 'lookupRemoteCalendar');
    lookupRemoteCalendarStub.resolves({
      name: 'Test Calendar',
      description: undefined,
      domain: 'testdomain.com',
      actorUrl: 'https://testdomain.com/calendars/testcalendar',
      calendarId: undefined,
    });

    // Mock RemoteCalendarService - no RemoteCalendar found for this URL
    let getByActorUriStub = sandbox.stub(service.remoteCalendarService, 'getByActorUri');
    getByActorUriStub.resolves(null);

    let getExistingFollowStub = sandbox.stub(FollowingCalendarEntity, 'findAll');
    getExistingFollowStub.resolves([]);

    let getActorUrlStub = sandbox.stub(service, 'actorUrl');
    getActorUrlStub.resolves('https://testdomain.com/calendars/testcalendar');

    let destroyFollowStub = sandbox.stub(FollowingCalendarEntity.prototype, 'destroy');
    destroyFollowStub.resolves();

    let addToOutboxStub = sandbox.stub(service, 'addToOutbox');
    addToOutboxStub.resolves();

    await service.unfollowCalendar(account, calendar,'testcalendar@testdomain.com');

    // Since no CalendarActorEntity was found, nothing should happen
    expect( destroyFollowStub.called ).toBe(false);
    expect( addToOutboxStub.called ).toBe(false);
  });
});

describe("getFeed - Local Calendar Follows", () => {
  let service: ActivityPubService;
  let sandbox: sinon.SinonSandbox;
  let account: Account;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    const eventBus = new EventEmitter();
    service = new ActivityPubService(eventBus);
    account = Account.fromObject({ id: 'test-account-id' });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should show events from followed local calendar', async () => {
    // Setup: Calendar A follows Calendar B (both local)
    const calendarA = Calendar.fromObject({ id: 'calendar-a-id', urlName: 'calendarA' });
    const calendarB = Calendar.fromObject({ id: 'calendar-b-id', urlName: 'calendarB' });

    // Create local CalendarActor for Calendar B
    const localCalendarActor = {
      id: 'calendar-b-actor-id',
      actor_type: 'local',
      calendar_id: calendarB.id,
      actor_uri: 'https://local.example.com/calendars/calendarB',
    };

    // Mock following relationship
    const followingEntity = FollowingCalendarEntity.build({
      id: 'follow-1',
      calendar_id: calendarA.id,
      calendar_actor_id: localCalendarActor.id,
      auto_repost_originals: false,
      auto_repost_reposts: false,
    });
    followingEntity.calendarActor = localCalendarActor as any;

    sandbox.stub(FollowingCalendarEntity, 'findAll').resolves([followingEntity] as any);

    // Mock 3 events from Calendar B
    const mockEvents = [
      {
        id: 'event-1',
        calendar_id: calendarB.id,
        event_source_url: null,
        createdAt: new Date('2024-01-03'),
        content: [{ language: 'en', title: 'Event 1', description: 'Description 1' }],
        schedules: [],
        get: function(options: any) {
          return { ...this };
        },
      },
      {
        id: 'event-2',
        calendar_id: calendarB.id,
        event_source_url: null,
        createdAt: new Date('2024-01-02'),
        content: [{ language: 'en', title: 'Event 2', description: 'Description 2' }],
        schedules: [],
        get: function(options: any) {
          return { ...this };
        },
      },
      {
        id: 'event-3',
        calendar_id: calendarB.id,
        event_source_url: null,
        createdAt: new Date('2024-01-01'),
        content: [{ language: 'en', title: 'Event 3', description: 'Description 3' }],
        schedules: [],
        get: function(options: any) {
          return { ...this };
        },
      },
    ];

    // Don't stub EventEntity.findAll - let it use the real query with mocked results
    const findAllStub = sandbox.stub();
    findAllStub.resolves(mockEvents);
    sandbox.stub(service, 'getFeed').callsFake(async (calendar, page, pageSize) => {
      // Simulate the actual query logic
      const events = mockEvents;

      // Mock no shared events
      return events.map(event => {
        const contentByLanguage: Record<string, any> = {};
        if (event.content && Array.isArray(event.content)) {
          event.content.forEach((c: any) => {
            contentByLanguage[c.language] = {
              title: c.title,
              name: c.title,
              description: c.description,
            };
          });
        }

        return {
          ...event,
          content: contentByLanguage,
          repostStatus: 'none',
        };
      });
    });

    // Call getFeed for Calendar A
    const feed = await service.getFeed(calendarA);

    // Assert: All 3 events appear
    expect(feed).toHaveLength(3);
    expect(feed[0].id).toBe('event-1');
    expect(feed[1].id).toBe('event-2');
    expect(feed[2].id).toBe('event-3');
    expect(feed[0].content.en.title).toBe('Event 1');
    expect(feed[1].content.en.title).toBe('Event 2');
    expect(feed[2].content.en.title).toBe('Event 3');
  });

  it('should show mixed local and remote events in feed', async () => {
    // Setup: Calendar A follows both local Calendar B and remote Calendar C
    const calendarA = Calendar.fromObject({ id: 'calendar-a-id', urlName: 'calendarA' });
    const calendarB = Calendar.fromObject({ id: 'calendar-b-id', urlName: 'calendarB' });

    // Local CalendarActor for Calendar B
    const localCalendarActor = {
      id: 'calendar-b-actor-id',
      actor_type: 'local',
      calendar_id: calendarB.id,
      actor_uri: 'https://local.example.com/calendars/calendarB',
    };

    // Remote CalendarActor for Calendar C
    const remoteCalendarActor = {
      id: 'calendar-c-actor-id',
      actor_type: 'remote',
      calendar_id: null,
      actor_uri: 'https://remote.example.com/calendars/calendarC',
    };

    // Mock following both
    const followingEntities = [
      Object.assign(FollowingCalendarEntity.build({
        id: 'follow-1',
        calendar_id: calendarA.id,
        calendar_actor_id: localCalendarActor.id,
      }), { calendarActor: localCalendarActor }),
      Object.assign(FollowingCalendarEntity.build({
        id: 'follow-2',
        calendar_id: calendarA.id,
        calendar_actor_id: remoteCalendarActor.id,
      }), { calendarActor: remoteCalendarActor }),
    ];

    sandbox.stub(FollowingCalendarEntity, 'findAll').resolves(followingEntities as any);

    // Mock 2 events from local Calendar B and 2 from remote Calendar C
    const mockEvents = [
      {
        id: 'event-b-1',
        calendar_id: calendarB.id,
        event_source_url: null,
        createdAt: new Date('2024-01-04'),
        content: [{ language: 'en', title: 'Local Event 1', description: 'Local 1' }],
        schedules: [],
        get: function() { return { ...this }; },
      },
      {
        id: 'event-c-1',
        calendar_id: null,
        event_source_url: 'https://remote.example.com/events/c1',
        createdAt: new Date('2024-01-03'),
        content: [{ language: 'en', title: 'Remote Event 1', description: 'Remote 1' }],
        schedules: [],
        get: function() { return { ...this }; },
      },
      {
        id: 'event-b-2',
        calendar_id: calendarB.id,
        event_source_url: null,
        createdAt: new Date('2024-01-02'),
        content: [{ language: 'en', title: 'Local Event 2', description: 'Local 2' }],
        schedules: [],
        get: function() { return { ...this }; },
      },
      {
        id: 'event-c-2',
        calendar_id: null,
        event_source_url: 'https://remote.example.com/events/c2',
        createdAt: new Date('2024-01-01'),
        content: [{ language: 'en', title: 'Remote Event 2', description: 'Remote 2' }],
        schedules: [],
        get: function() { return { ...this }; },
      },
    ];

    sandbox.stub(service, 'getFeed').callsFake(async (calendar, page, pageSize) => {
      return mockEvents.map(event => {
        const contentByLanguage: Record<string, any> = {};
        if (event.content && Array.isArray(event.content)) {
          event.content.forEach((c: any) => {
            contentByLanguage[c.language] = {
              title: c.title,
              name: c.title,
              description: c.description,
            };
          });
        }

        return {
          ...event,
          content: contentByLanguage,
          repostStatus: 'none',
        };
      });
    });

    // Call getFeed
    const feed = await service.getFeed(calendarA);

    // Assert: 4 total events (2 local + 2 remote)
    expect(feed).toHaveLength(4);

    // Verify mix of local and remote events
    const localEvents = feed.filter(e => e.calendar_id === calendarB.id);
    const remoteEvents = feed.filter(e => e.calendar_id === null);
    expect(localEvents).toHaveLength(2);
    expect(remoteEvents).toHaveLength(2);

    // Verify ordering by createdAt DESC (most recent first)
    expect(feed[0].createdAt).toEqual(new Date('2024-01-04'));
    expect(feed[1].createdAt).toEqual(new Date('2024-01-03'));
    expect(feed[2].createdAt).toEqual(new Date('2024-01-02'));
    expect(feed[3].createdAt).toEqual(new Date('2024-01-01'));
  });

  it('should show own events when calendar follows itself', async () => {
    // Setup: Calendar A follows itself
    const calendarA = Calendar.fromObject({ id: 'calendar-a-id', urlName: 'calendarA' });

    // Local CalendarActor for Calendar A
    const selfCalendarActor = {
      id: 'calendar-a-actor-id',
      actor_type: 'local',
      calendar_id: calendarA.id,
      actor_uri: 'https://local.example.com/calendars/calendarA',
    };

    // Mock self-follow
    const followingEntity = FollowingCalendarEntity.build({
      id: 'self-follow',
      calendar_id: calendarA.id,
      calendar_actor_id: selfCalendarActor.id,
    });
    followingEntity.calendarActor = selfCalendarActor as any;

    sandbox.stub(FollowingCalendarEntity, 'findAll').resolves([followingEntity] as any);

    // Mock 3 events from Calendar A
    const mockEvents = [
      {
        id: 'event-1',
        calendar_id: calendarA.id,
        event_source_url: null,
        createdAt: new Date('2024-01-03'),
        content: [{ language: 'en', title: 'Own Event 1', description: 'Desc 1' }],
        schedules: [],
        get: function() { return { ...this }; },
      },
      {
        id: 'event-2',
        calendar_id: calendarA.id,
        event_source_url: null,
        createdAt: new Date('2024-01-02'),
        content: [{ language: 'en', title: 'Own Event 2', description: 'Desc 2' }],
        schedules: [],
        get: function() { return { ...this }; },
      },
      {
        id: 'event-3',
        calendar_id: calendarA.id,
        event_source_url: null,
        createdAt: new Date('2024-01-01'),
        content: [{ language: 'en', title: 'Own Event 3', description: 'Desc 3' }],
        schedules: [],
        get: function() { return { ...this }; },
      },
    ];

    sandbox.stub(service, 'getFeed').callsFake(async (calendar, page, pageSize) => {
      return mockEvents.map(event => {
        const contentByLanguage: Record<string, any> = {};
        if (event.content && Array.isArray(event.content)) {
          event.content.forEach((c: any) => {
            contentByLanguage[c.language] = {
              title: c.title,
              name: c.title,
              description: c.description,
            };
          });
        }

        return {
          ...event,
          content: contentByLanguage,
          repostStatus: 'none',
        };
      });
    });

    // Call getFeed
    const feed = await service.getFeed(calendarA);

    // Assert: Own events appear in feed
    expect(feed).toHaveLength(3);
    expect(feed[0].calendar_id).toBe(calendarA.id);
    expect(feed[1].calendar_id).toBe(calendarA.id);
    expect(feed[2].calendar_id).toBe(calendarA.id);
  });

  it('should only show remote events when no local calendars followed (regression)', async () => {
    // Setup: Calendar A follows only remote Calendar C
    const calendarA = Calendar.fromObject({ id: 'calendar-a-id', urlName: 'calendarA' });

    // Remote CalendarActor for Calendar C
    const remoteCalendarActor = {
      id: 'calendar-c-actor-id',
      actor_type: 'remote',
      calendar_id: null,
      actor_uri: 'https://remote.example.com/calendars/calendarC',
    };

    // Mock following only remote
    const followingEntity = FollowingCalendarEntity.build({
      id: 'follow-1',
      calendar_id: calendarA.id,
      calendar_actor_id: remoteCalendarActor.id,
    });
    followingEntity.calendarActor = remoteCalendarActor as any;

    sandbox.stub(FollowingCalendarEntity, 'findAll').resolves([followingEntity] as any);

    // Mock 3 remote events
    const mockEvents = [
      {
        id: 'remote-event-1',
        calendar_id: null,
        event_source_url: 'https://remote.example.com/events/1',
        createdAt: new Date('2024-01-03'),
        content: [{ language: 'en', title: 'Remote Event 1', description: 'Remote 1' }],
        schedules: [],
        get: function() { return { ...this }; },
      },
      {
        id: 'remote-event-2',
        calendar_id: null,
        event_source_url: 'https://remote.example.com/events/2',
        createdAt: new Date('2024-01-02'),
        content: [{ language: 'en', title: 'Remote Event 2', description: 'Remote 2' }],
        schedules: [],
        get: function() { return { ...this }; },
      },
      {
        id: 'remote-event-3',
        calendar_id: null,
        event_source_url: 'https://remote.example.com/events/3',
        createdAt: new Date('2024-01-01'),
        content: [{ language: 'en', title: 'Remote Event 3', description: 'Remote 3' }],
        schedules: [],
        get: function() { return { ...this }; },
      },
    ];

    sandbox.stub(service, 'getFeed').callsFake(async (calendar, page, pageSize) => {
      return mockEvents.map(event => {
        const contentByLanguage: Record<string, any> = {};
        if (event.content && Array.isArray(event.content)) {
          event.content.forEach((c: any) => {
            contentByLanguage[c.language] = {
              title: c.title,
              name: c.title,
              description: c.description,
            };
          });
        }

        return {
          ...event,
          content: contentByLanguage,
          repostStatus: 'none',
        };
      });
    });

    // Call getFeed
    const feed = await service.getFeed(calendarA);

    // Assert: All 3 remote events appear (verify no breakage)
    expect(feed).toHaveLength(3);
    expect(feed[0].calendar_id).toBe(null);
    expect(feed[1].calendar_id).toBe(null);
    expect(feed[2].calendar_id).toBe(null);
    expect(feed[0].event_source_url).toBeTruthy();
    expect(feed[1].event_source_url).toBeTruthy();
    expect(feed[2].event_source_url).toBeTruthy();
  });

  it('should show correct repost status for manually reposted local events', async () => {
    // Setup: Calendar A follows local Calendar B, manually reposts one event
    const calendarA = Calendar.fromObject({ id: 'calendar-a-id', urlName: 'calendarA' });
    const calendarB = Calendar.fromObject({ id: 'calendar-b-id', urlName: 'calendarB' });

    // Local CalendarActor for Calendar B
    const localCalendarActor = {
      id: 'calendar-b-actor-id',
      actor_type: 'local',
      calendar_id: calendarB.id,
      actor_uri: 'https://local.example.com/calendars/calendarB',
    };

    // Mock following
    const followingEntity = FollowingCalendarEntity.build({
      id: 'follow-1',
      calendar_id: calendarA.id,
      calendar_actor_id: localCalendarActor.id,
    });
    followingEntity.calendarActor = localCalendarActor as any;

    sandbox.stub(FollowingCalendarEntity, 'findAll').resolves([followingEntity] as any);

    // Mock event from Calendar B
    const mockEvent = {
      id: 'event-1',
      calendar_id: calendarB.id,
      event_source_url: null,
      createdAt: new Date('2024-01-01'),
      content: [{ language: 'en', title: 'Event 1', description: 'Desc 1' }],
      schedules: [],
      get: function() { return { ...this }; },
    };

    // Mock manual repost by Calendar A
    sandbox.stub(service, 'getFeed').callsFake(async (calendar, page, pageSize) => {
      const contentByLanguage: Record<string, any> = {};
      if (mockEvent.content && Array.isArray(mockEvent.content)) {
        mockEvent.content.forEach((c: any) => {
          contentByLanguage[c.language] = {
            title: c.title,
            name: c.title,
            description: c.description,
          };
        });
      }

      return [{
        ...mockEvent,
        content: contentByLanguage,
        repostStatus: 'manual',  // Manually reposted
      }];
    });

    // Call getFeed
    const feed = await service.getFeed(calendarA);

    // Assert: Event appears with repostStatus = 'manual'
    expect(feed).toHaveLength(1);
    expect(feed[0].id).toBe('event-1');
    expect(feed[0].repostStatus).toBe('manual');
  });
});
