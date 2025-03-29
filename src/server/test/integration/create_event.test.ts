import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import sinon from 'sinon';
import axios from 'axios';

import db from '@/server/common/entity/db';
import initPavillionServer from '@/server/server';
import AccountService from '@/server/accounts/service/account';
import CalendarService from '@/server/calendar/service/calendar';
import { EventEntity } from '@/server/calendar/entity/event';
import { ActivityPubOutboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import ProcessInboxService from '@/server/activitypub/service/inbox';

describe('Event API', async () => {

    await db.sync({force: true});
    let account = await AccountService._setupAccount('testcalendar@pavillion.dev','testpassword');
    let calendar = await CalendarService.getPrimaryCalendarForUser(account.account);
    await CalendarService.setUrlName(account.account, calendar, 'testCalendar');
    let inboxService = new ProcessInboxService();
    await inboxService.processFollowAccount(calendar,{ actor: 'testcalendar@remotedomain', object: 'testcalendar@pavillion.dev' });

    let app = express();
    initPavillionServer(app);

    it('createEvent: should fail without user', async () => {

        const response = await request(app)
            .post('/api/v1/events')
            .send({
                content: {
                    en: {
                        name: 'Test Event',
                        description: 'This is a test event'
                    }
                }
            });

        expect(response.status,"api call failed").toBe(401);
    });


    it('createEvent: should succeed', async () => {

        let getStub = sinon.stub(axios, 'get');
        let postStub = sinon.stub(axios, 'post');
        let webfingerStub = getStub.withArgs('https://remotedomain/.well-known/webfinger?resource=acct:testcalendar')
        webfingerStub.resolves({ data: { links: [ { rel:'self', href:'https://remotedomain/o/testcalendar' } ] } });
        let profileStub = getStub.withArgs('https://remotedomain/o/testcalendar');
        profileStub.resolves({ data: { inbox: 'https://remotedomain/o/testcalendar/inbox' } });

        let authResponse = await request(app).post('/api/auth/v1/login').send({ email: 'testcalendar@pavillion.dev', password: 'testpassword' });
        const response = await request(app)
            .post('/api/v1/events')
            .set('Authorization','Bearer ' + authResponse.text)
            .send({
                calendarId: calendar.id,
                content: {
                    en: {
                        name: 'Test Event',
                        description: 'This is a test event'
                    }
                }
            });
        let entity = await EventEntity.findOne({ where: { id: response.body.id } });

        // wait for create event to propogate to activitypub service:
        await new Promise(resolve => setTimeout(resolve, 100));

        let message = await ActivityPubOutboxMessageEntity.findOne({ where: { calendar_id: calendar.id } });

        expect(response.status,"api call succeeded").toBe(200);
        expect(response.body.id,"got back an object with an id").toBeDefined();
        expect(response.body.error,"no error in the response").toBeUndefined();
        expect(entity,"found the event in the database").toBeDefined();
        expect(message,"activity message was sent to outbox").toBeDefined();
        if ( message && entity ) {
            expect(message.message.type,"proper message type created").toBe('Create');
            expect(message.message.object.id, "has an appropriate id").toMatch(entity.id);
            expect(message.processed_time,"message in the outbox was processed").not.toBe(null);
        }
        expect(postStub.calledOnce,"post to remote inbox").toBe(true);
    });
});
