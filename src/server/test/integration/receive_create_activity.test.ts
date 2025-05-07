import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import sinon from 'sinon';
import axios from 'axios';
import httpSignature from 'http-signature';
import crypto from 'crypto';

import db from '@/server/common/entity/db';
import initPavillionServer from '@/server/server';
import AccountService from '@/server/accounts/service/account';
import { EventEntity } from '@/server/calendar/entity/event';
import { ActivityPubOutboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import CalendarService from '@/server/calendar/service/calendar';

describe('ActivityPub Create Activity', async () => {

  await db.sync({force: true});
  let account = await AccountService._setupAccount('testcalendar@pavillion.dev','testpassword');
  let calendar = await CalendarService.createCalendarForUser(account.account);
  await CalendarService.setUrlName(account.account, calendar, 'testcalendar');
  // let inboxService = new ProcessInboxService();
  // await inboxService.processFollowAccount(account.account,{ actor: 'testcalendar@remotedomain', object: 'testcalendar@pavillion.dev' });

  let app = express();
  initPavillionServer(app);

  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  it('createEvent: should fail without signature', async () => {

    // let getStub = sinon.stub(axios, 'get');
    // let postStub = sinon.stub(axios, 'post');
    const webFingerResponse = await request(app).get('/.well-known/webfinger?resource=acct:testcalendar@pavillion.dev');
    expect(webFingerResponse.status,"webfinger lookup succeeded").toBe(200);

    const profileLink = webFingerResponse.body.links.find( (link: any) => link.rel === 'self' );
    expect(profileLink,"found an inbox url").toBeDefined();

    const profileResponse = await request(app).get(profileLink.href.replace('https://pavillion.dev',''));
    expect(profileResponse.status,"webfinger lookup succeeded").toBe(200);

    const response = await request(app)
      .post(profileResponse.body.inbox.replace('https://pavillion.dev',''))
      .send({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://remotedomain.dev/api/v1/events/1',
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
    let entity = await EventEntity.findOne({ where: { id: 'https://remotedomain.dev/api/v1/events/1' } });

    expect(response.status).toBe(500);
    expect(entity).toBe(null);
  });

  it('createEvent: should succeed', async () => {

    const webFingerResponse = await request(app).get('/.well-known/webfinger?resource=acct:testcalendar@pavillion.dev');
    expect(webFingerResponse.status,"webfinger lookup succeeded").toBe(200);

    const profileLink = webFingerResponse.body.links.find( (link: any) => link.rel === 'self' );
    expect(profileLink,"found an inbox url").toBeDefined();

    const profileResponse = await request(app).get(profileLink.href.replace('https://pavillion.dev',''));
    expect(profileResponse.status,"webfinger lookup succeeded").toBe(200);

    const authHeader = 'Signature keyId="https://remotedomain.dev/o/testcalendar#main_key",algorithm="rsa-sha256",' +
                        'headers="(request-target) host date content-type digest",' +
                        'signature="fakeSignature"';

    const getStub = sandbox.stub(axios, 'get');
    const verifyStub = sandbox.stub(httpSignature, 'verifySignature');
    getStub.withArgs('https://remotedomain.dev/o/testcalendar').resolves({
      status: 200,
      data: {
        publicKey: {
          publicKeyPem: 'fake key',
        },
      },
    });
    verifyStub.returns(true);

    const requestData = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: 'https://remotedomain.dev/api/v1/events/1',
      type: 'Create',
      actor: 'https://remotedomain.dev/o/testcalendar',
      object: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Event',
        attributedTo: 'https://remotedomain.dev/o/testcalendar',
        content: {
          en: {
            name: 'Test Event',
            description: 'This is a test event',
          },
        },
      },
    };

    const response = await request(app)
      .post(profileResponse.body.inbox.replace('https://pavillion.dev',''))
      .set('Authorization', authHeader )
      .set('Date', new Date().toUTCString())
      .set('Digest', 'SHA-256='+crypto.createHash('sha256').update(JSON.stringify(requestData)).digest('base64'))
      .send(requestData);

    let entity = await EventEntity.findOne({ where: { id: 'https://remotedomain.dev/api/v1/events/1' } });

    // wait for create event to propogate to activitypub service:
    await new Promise(resolve => setTimeout(resolve, 100));

    let message = await ActivityPubOutboxMessageEntity.findOne({ where: { calendar_id: calendar.id } });

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
