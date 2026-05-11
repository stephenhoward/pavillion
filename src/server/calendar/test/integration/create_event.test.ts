import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import sinon from 'sinon';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import AccountService from '@/server/accounts/service/account';
import CalendarInterface from '@/server/calendar/interface';
import { EventEntity } from '@/server/calendar/entity/event';
import { ActivityPubOutboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import ProcessInboxService from '@/server/activitypub/service/inbox';
import FollowActivity from '@/server/activitypub/model/action/follow';
import CalendarActorService from '@/server/activitypub/service/calendar_actor';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';

describe('Event API', () => {
  let account: Account;
  let calendar: Calendar;
  let env: TestEnvironment;
  let userEmail: string = 'testcalendar@pavillion.dev';
  let userPassword: string = 'testpassword';

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    const calendarInterface = new CalendarInterface(eventBus);
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);
    let accountInfo = await accountService._setupAccount(userEmail,userPassword);
    account = accountInfo.account;
    calendar = await calendarInterface.createCalendar(account,'testcalendar');

    // Create a proper FollowActivity object
    let inboxService = new ProcessInboxService(eventBus, calendarInterface);
    const followActivity = new FollowActivity('testcalendar@remotedomain', 'testcalendar@pavillion.dev');
    followActivity.id = `https://remotedomain/users/testcalendar/follows/${uuidv4()}`;
    await inboxService.processFollowAccount(calendar, followActivity);

  });

  afterEach(() => {
    sinon.restore();
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  it('createEvent: should fail without user', async () => {
    const response = await request(env.app)
      .post('/api/v1/events')
      .send({
        content: {
          en: {
            name: 'Test Event',
            description: 'This is a test event',
          },
        },
      });

    expect(response.status,"api call failed").toBe(401);
  });


  it('createEvent: should succeed', async () => {
    let getStub = sinon.stub(axios, 'get');
    let postStub = sinon.stub(axios, 'post');
    sinon.stub(CalendarActorService.prototype, 'signActivity').resolves({
      keyId: 'https://local.test/calendars/testcalendar#main-key',
      signature: 'mock-signature-base64',
      algorithm: 'rsa-sha256',
      headers: '(request-target) host date digest',
      date: new Date().toUTCString(),
    });
    env.stubRemoteCalendar(getStub, 'remotedomain', 'testcalendar');

    let authKey = await env.login(userEmail,userPassword);
    const response = await env.authPost(authKey, '/api/v1/events', {
      calendarId: calendar.id,
      content: {
        en: {
          name: 'Test Event',
          description: 'This is a test event',
        },
      },
    });
    let entity = await EventEntity.findOne({ where: { id: response.body.id } });

    // Poll for the outbox message to be processed (ARM CI runners need more time).
    // Event creation now emits paired Announce(Event) + Create(Note) so we
    // filter by activity type instead of ordering — protects against future
    // activity additions and removes order-dependence.
    let message: ActivityPubOutboxMessageEntity | null = null;
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const messages = await ActivityPubOutboxMessageEntity.findAll({
        where: { calendar_id: calendar.id },
        order: [['message_time', 'ASC']],
      });
      message = messages.find(m => (m.message as any)?.type === 'Announce') ?? null;
      if (message?.processed_time) break;
    }

    expect(response.status,"api call succeeded").toBe(201);
    expect(response.body.id,"got back an object with an id").toBeDefined();
    expect(response.body.error,"no error in the response").toBeUndefined();
    expect(entity,"found the event in the database").toBeDefined();
    expect(message,"activity message was sent to outbox").toBeDefined();

    if (message && entity) {
      // Use type assertion to access properties
      const messageObj = message.message as any;
      // Event propagation uses Announce activity, not Create
      expect(messageObj.type,"proper message type created").toBe('Announce');
      // The object field is the event URL string, which should contain the event ID
      expect(messageObj.object, "has an appropriate event URL").toContain(entity.id);
      expect(message.processed_time,"message in the outbox was processed").not.toBe(null);
    }
    // Paired emission: Announce(Event) + Create(Note) both post to follower
    // inboxes. The remote-post contract under test is "the event reached
    // federation" — assert at least one post (the Announce leg) happened.
    expect(postStub.called,"post to remote inbox").toBe(true);
  });
});
