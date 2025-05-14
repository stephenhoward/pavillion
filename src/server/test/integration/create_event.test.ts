import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import sinon from 'sinon';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

import db from '@/server/common/entity/db';
import initPavillionServer from '@/server/server';
import AccountService from '@/server/accounts/service/account';
import CalendarService from '@/server/calendar/service/calendar';
import { EventEntity } from '@/server/calendar/entity/event';
import { ActivityPubOutboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import ProcessInboxService from '@/server/activitypub/service/inbox';
import FollowActivity from '@/server/activitypub/model/action/follow';

describe('Event API', () => {
  let account: any;
  let calendar: any;
  let app: express.Application;

  beforeAll(async () => {
    await db.sync({force: true});
    account = await AccountService._setupAccount('testcalendar@pavillion.dev','testpassword');
    calendar = await CalendarService.createCalendar(account.account,'testcalendar');

    // Create a proper FollowActivity object
    let inboxService = new ProcessInboxService();
    const followActivity = new FollowActivity('testcalendar@remotedomain', 'testcalendar@pavillion.dev');
    followActivity.id = `https://remotedomain/users/testcalendar/follows/${uuidv4()}`;
    await inboxService.processFollowAccount(calendar, followActivity);

    app = express();
    await initPavillionServer(app);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('createEvent: should fail without user', async () => {
    const response = await request(app)
      .post('/api/v1/calendars/testCalendar/events')
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
    let webfingerStub = getStub.withArgs('https://remotedomain/.well-known/webfinger?resource=acct:testcalendar');
    webfingerStub.resolves({ data: { links: [ { rel:'self', href:'https://remotedomain/o/testcalendar' } ] } });
    let profileStub = getStub.withArgs('https://remotedomain/o/testcalendar');
    profileStub.resolves({ data: { inbox: 'https://remotedomain/o/testcalendar/inbox' } });

    let authResponse = await request(app).post('/api/auth/v1/login').send({ email: 'testcalendar@pavillion.dev', password: 'testpassword' });
    const response = await request(app)
      .post('/api/v1/calendars/testCalendar/events')
      .set('Authorization','Bearer ' + authResponse.text)
      .send({
        calendarId: calendar.id,
        content: {
          en: {
            name: 'Test Event',
            description: 'This is a test event',
          },
        },
      });
    let entity = await EventEntity.findOne({ where: { id: response.body.id } });

    // wait for create event to propagate to activitypub service:
    await new Promise(resolve => setTimeout(resolve, 100));

    let message = await ActivityPubOutboxMessageEntity.findOne({ where: { calendar_id: calendar.id } });

    expect(response.status,"api call succeeded").toBe(200);
    expect(response.body.id,"got back an object with an id").toBeDefined();
    expect(response.body.error,"no error in the response").toBeUndefined();
    expect(entity,"found the event in the database").toBeDefined();
    expect(message,"activity message was sent to outbox").toBeDefined();

    if (message && entity) {
      // Use type assertion to access properties
      const messageObj = message.message as any;
      expect(messageObj.type,"proper message type created").toBe('Create');
      expect(messageObj.object?.id, "has an appropriate id").toMatch(entity.id);
      expect(message.processed_time,"message in the outbox was processed").not.toBe(null);
    }
    expect(postStub.calledOnce,"post to remote inbox").toBe(true);
  });
});
