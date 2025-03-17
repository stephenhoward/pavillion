import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import sinon from 'sinon';
import axios from 'axios';
import httpSignature from 'http-signature';

import db from '@/server/common/entity/db';
import initPavillionServer from '@/server/server';
import AccountService from '@/server/accounts/service/account';
import { EventEntity } from '@/server/calendar/entity/event';
import { ActivityPubOutboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import ProcessInboxService from '@/server/activitypub/service/inbox';

describe('ActivityPub Create Activity', async () => {

    await db.sync({force: true});
    let account = await AccountService._setupAccount('testuser@pavillion.dev','testpassword');
    await AccountService.setUsername(account.account,'testuser');
    // let inboxService = new ProcessInboxService();
    // await inboxService.processFollowAccount(account.account,{ actor: 'testuser@remotedomain', object: 'testuser@pavillion.dev' });

    let app = express();
    initPavillionServer(app);

    let sandbox: sinon.SinonSandbox = sinon.createSandbox();

    afterEach(() => {
        sandbox.restore();
    });

    it('createEvent: should fail without signature', async () => {

        // let getStub = sinon.stub(axios, 'get');
        // let postStub = sinon.stub(axios, 'post');
        const webFingerResponse = await request(app).get('/.well-known/webfinger?resource=acct:testuser@pavillion.dev');
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
                actor: 'testuser@remotedomain',
                object: {
                    '@context': 'https://www.w3.org/ns/activitystreams',
                    type: 'Event',
                    content: {
                        en: {
                            name: 'Test Event',
                            description: 'This is a test event'
                        }
                    }
                }
            });
        let entity = await EventEntity.findOne({ where: { id: 'https://remotedomain.dev/api/v1/events/1' } });

        expect(response.status).toBe(500);
        expect(entity).toBe(null);
    });

    it('createEvent: should succeed', async () => {

        const webFingerResponse = await request(app).get('/.well-known/webfinger?resource=acct:testuser@pavillion.dev');
        expect(webFingerResponse.status,"webfinger lookup succeeded").toBe(200);
        
        const profileLink = webFingerResponse.body.links.find( (link: any) => link.rel === 'self' );
        expect(profileLink,"found an inbox url").toBeDefined();

        const profileResponse = await request(app).get(profileLink.href.replace('https://pavillion.dev',''));
        expect(profileResponse.status,"webfinger lookup succeeded").toBe(200);

        const authHeader = 'Signature keyId="https://remotedomain.dev/users/testuser#main_key",algorithm="rsa-sha256",' +
                        'headers="(request-target) host date content-type digest",' +
                        'signature="fakeSignature"';
                       
        const getStub = sandbox.stub(axios, 'get');
        const verifyStub = sandbox.stub(httpSignature, 'verifySignature');
        getStub.withArgs('https://remotedomain.dev/users/testuser').resolves({
            status: 200,
            data: {
                publicKey: {
                    publicKeyPem: 'fake key'
                }
            }
        });
        verifyStub.returns(true);
        const response = await request(app)
            .post(profileResponse.body.inbox.replace('https://pavillion.dev',''))
            .set('Authorization', authHeader )
            .set('Date', new Date().toUTCString())
            .set('Digest', 'SHA-256=X48E9qOokqqrvdts8nOJRJN3OWDUoyWxBf7kbu9DBPE=')
            .send({
                    '@context': 'https://www.w3.org/ns/activitystreams',
                    id: 'https://remotedomain.dev/api/v1/events/1',
                    type: 'Create',
                    actor: 'https://remotedomain.dev/users/testuser',
                    object: {
                        '@context': 'https://www.w3.org/ns/activitystreams',
                        type: 'Event',
                        attributedTo: 'https://remotedomain.dev/users/testuser',
                        content: {
                            en: {
                                name: 'Test Event',
                                description: 'This is a test event'
                            }
                        }
                    }
                });

        let entity = await EventEntity.findOne({ where: { id: 'https://remotedomain.dev/api/v1/events/1' } });

        // wait for create event to propogate to activitypub service:
        await new Promise(resolve => setTimeout(resolve, 100));

        let message = await ActivityPubOutboxMessageEntity.findOne({ where: { account_id: account.account.id } });

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
