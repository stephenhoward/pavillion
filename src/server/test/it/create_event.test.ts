import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';

import initPavillionServer from '@/server/server';
import AccountService from '@/server/accounts/service/account';
import { EventEntity } from '@/server/calendar/entity/event';
import { ActivityPubOutboxMessageEntity } from '@/server/activitypub/entity/activitypub';

describe('Event API', async () => {

    await db.sync({force: true});
    let account = await AccountService._setupAccount('testuser@pavillion.dev','testpassword');
    await AccountService._setUsername(account.account,'testuser');

    it('createEvent: should succeed', async () => {
        let app = express();
        initPavillionServer(app);

        let authResponse = await request(app).post('/api/auth/v1/login').send({ email: 'testuser@pavillion.dev', password: 'testpassword' });
        const response = await request(app)
            .post('/api/v1/events')
            .set('Authorization','Bearer ' + authResponse.text)
            .send({
                content: {
                    en: {
                        name: 'Test Event',
                        description: 'This is a test event'
                    }
                }
            });

        expect(response.status).toBe(200);
        expect(response.body.id).toBeDefined();
        expect(response.body.error).toBeUndefined();

        let entity = await EventEntity.findOne({ where: { id: response.body.id } });
        expect(entity).toBeDefined();

        // wait for create event to propogate to activitypub service:
        await new Promise(resolve => setTimeout(resolve, 100))

        let message = await ActivityPubOutboxMessageEntity.findOne({ where: { account_id: account.account.id } });
        expect(message).toBeDefined();
        if ( message && entity ) {
            expect(message.message.type).toBe('Create');
            expect(message.message.object.id).toMatch(entity.id);
        }
    });
});
