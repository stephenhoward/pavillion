import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import sinon from 'sinon';
import axios from 'axios';
import httpSignature from 'http-signature';
import express from 'express';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { TestEnvironment } from '@/server/test/lib/test_environment';
import AccountService from '@/server/accounts/service/account';
import { EventEntity } from '@/server/calendar/entity/event';
import { ActivityPubOutboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';

const findInboxForCalendar = async (calendarName: string, app: express.Application): Promise<string> => {

  const webFingerResponse = await request(app).get(`/.well-known/webfinger?resource=acct:${calendarName}@pavillion.dev`);
  expect(webFingerResponse.status,"webfinger lookup succeeded").toBe(200);

  const profileLink = webFingerResponse.body.links.find( (link: any) => link.rel === 'self' );
  expect(profileLink,"found an inbox url").toBeDefined();

  const profileResponse = await request(app).get(profileLink.href.replace('https://pavillion.dev',''));
  expect(profileResponse.status,"webfinger lookup succeeded").toBe(200);

  return profileResponse.body.inbox.replace('https://pavillion.dev','');
};

describe('ActivityPub Create Activity', async () => {
  let env: TestEnvironment;
  let account: Account;
  let calendar: Calendar;
  const calendarName: string = 'testcalendar';
  const userEmail: string = 'testcalendar@pavillion.dev';
  const userPassword: string = 'testpassword';
  const sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init(3014); // Use unique port

    const eventBus = new EventEmitter();
    const calendarInterface = new CalendarInterface(eventBus);
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    let accountInfo = await accountService._setupAccount(userEmail,userPassword);
    account = accountInfo.account;

    // Create CalendarService instance
    calendar = await calendarInterface.createCalendar(account,calendarName);
  });

  afterEach(() => {
    sandbox.restore();
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  it('createEvent: should fail without signature', async () => {
    let remoteEventUrl = 'https://remotedomain.dev/api/v1/events/1';

    const inboxUrl = await findInboxForCalendar(calendarName, env.app);
    const response = await request(env.app)
      .post(inboxUrl)
      .send({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: remoteEventUrl,
        type: 'Create',
        actor: 'testcalendar@remotedomain',
        object: {
          '@context': 'https://www.w3.org/ns/activitystreams',
          type: 'Event',
          content: {
            en: {
              name: 'Test Event',
              description: 'This is a test event',
            },
          },
        },
      });
    const entity = await EventEntity.findOne({ where: { id: remoteEventUrl } });

    expect(response.status).toBe(500);
    expect(entity).toBe(null);
  });

  it('createEvent: should succeed', async () => {
    const remoteDomain = 'remotedomain.dev';
    const remoteCalendar = 'testcalendar';

    const inboxUrl = await findInboxForCalendar(calendarName, env.app);
    const getStub = sandbox.stub(axios, 'get');
    const verifyStub = sandbox.stub(httpSignature, 'verifySignature');
    verifyStub.returns(true);
    env.stubRemoteCalendar(getStub, remoteDomain, remoteCalendar);

    const response = await env.signedPost(
      inboxUrl,
      env.fakeRemoteAuth(remoteDomain, remoteCalendar),
      {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: `https://${remoteDomain}/api/v1/events/1`,
        type: 'Create',
        actor: `https://${remoteDomain}/o/testcalendar`,
        object: {
          '@context': 'https://www.w3.org/ns/activitystreams',
          type: 'Event',
          attributedTo: `https://${remoteDomain}/o/testcalendar`,
          content: {
            en: {
              name: 'Test Event',
              description: 'This is a test event',
            },
          },
        },
      });

    const entity = await EventEntity.findOne({ where: { id: `https://${remoteDomain}/api/v1/events/1` } });

    // wait for create event to propogate to activitypub service:
    await new Promise(resolve => setTimeout(resolve, 100));

    const message = await ActivityPubOutboxMessageEntity.findOne({ where: { calendar_id: calendar.id } });

    expect(response.status,"api call succeeded").toBe(200);
    expect(response.body.error,"no error in the response").toBeUndefined();
    expect(entity,"found the event in the database").toBeDefined();
    expect(message,"activity message was sent to outbox").toBeDefined();
    if ( message && entity ) {
      expect(message.message.type,"proper message type created").toBe('Create');
      expect(message.message.object.id, "has an appropriate id").toMatch(entity.id);
      expect(message.processed_time,"message in the outbox was processed").not.toBe(null);
    }
  });
});
