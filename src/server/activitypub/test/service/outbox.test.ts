import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import AccountService from '@/server/accounts/service/account';
import ProcessOutboxService from '@/server/activitypub/service/outbox';
import { FollowedAccountEntity, EventActivityEntity, ActivityPubOutboxMessageEntity } from '@/server/activitypub/entity/activitypub';


describe('resolveInbox', () => {
    let service: ProcessOutboxService;
    let sandbox: sinon.SinonSandbox = sinon.createSandbox();

    beforeEach (() => {
        service = new ProcessOutboxService();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('should return null without profile url', async () => {
        let profileStub = sandbox.stub(service,'fetchProfileUrl');
        profileStub.resolves(null);

        let result = await service.resolveInboxUrl('remoteaccount@remotedomain');
        expect(result).toBeNull();
    });

    it('should return null without profile response', async () => {
        let profileStub = sandbox.stub(service,'fetchProfileUrl');
        profileStub.resolves('https://remotedomain/users/testuser');

        let getStub = sandbox.stub(axios,'get');
        getStub.resolves(null);

        let result = await service.resolveInboxUrl('remoteaccount@remotedomain');
        expect(result).toBeNull();
    });

    it('should return a url for inbox', async () => {
        let profileStub = sandbox.stub(service,'fetchProfileUrl');
        profileStub.resolves('https://remotedomain/users/testuser');

        let getStub = sandbox.stub(axios,'get');
        getStub.resolves({ data: { inbox: 'https://remotedomain/users/testuser/inbox' } });

        let result = await service.resolveInboxUrl('remoteaccount@remotedomain');
        expect(result).toBe('https://remotedomain/users/testuser/inbox');
    });
});

describe('fetchProfileUrl', () => {
    let service: ProcessOutboxService;
    let sandbox: sinon.SinonSandbox = sinon.createSandbox();

    beforeEach (() => {
        service = new ProcessOutboxService();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('should return null without webfinger response', async () => {
        let getStub = sandbox.stub(axios,'get');
        getStub.resolves(null);

        let result = await service.fetchProfileUrl('remoteaccount@remotedomain');
        expect(result).toBeNull();
    });

    it('should return null without profile link', async () => {
        let getStub = sandbox.stub(axios,'get');
        getStub.resolves({ data: { links: [] } });

        let result = await service.fetchProfileUrl('remoteaccount@remotedomain');
        expect(result).toBeNull();
    });

    it('should return a url for profile', async () => {
        let getStub = sandbox.stub(axios,'get');
        getStub.resolves({ data: { links: [ { rel:'self', href:'https://remotedomain/users/testuser' } ] } });

        let result = await service.fetchProfileUrl('remoteaccount@remotedomain');
        expect(result).toBe('https://remotedomain/users/testuser');
    });
});

describe ('getRecipients', () => {
    let service: ProcessOutboxService;
    let sandbox: sinon.SinonSandbox = sinon.createSandbox();

    beforeEach (() => {
        service = new ProcessOutboxService();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('should return an empty array with no followers or observers', async () => {
        let followersStub = sandbox.stub(FollowedAccountEntity,'findAll');
        followersStub.resolves([]);

        let observersStub = sandbox.stub(EventActivityEntity,'findAll');
        observersStub.resolves([]);

        let result = await service.getRecipients(Account.fromObject({ id: 'testid' }),{ id: 'testobject' });
        expect(result).toStrictEqual([]);
    });

    it('should return an array with followers and observers', async () => {
        let followersStub = sandbox.stub(FollowedAccountEntity,'findAll');
        followersStub.resolves([ FollowedAccountEntity.build({ remote_account_id: 'remoteaccount@remotedomain' }) ]);

        let observersStub = sandbox.stub(EventActivityEntity,'findAll');
        observersStub.resolves([ EventActivityEntity.build({ remote_account_id: 'observeraccount@observerdomain' }) ]);

        let result = await service.getRecipients(Account.fromObject({ id: 'testid' }),{ id: 'testobject' });
        expect(result).toStrictEqual(['remoteaccount@remotedomain','observeraccount@observerdomain']);
    });
});

describe('processOutboxMessage', () => {
    let service: ProcessOutboxService;
    let sandbox: sinon.SinonSandbox = sinon.createSandbox();

    beforeEach (() => {
        service = new ProcessOutboxService();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('should fail without account', async () => {
        let message = ActivityPubOutboxMessageEntity.build({ account_id: 'testid', type: 'Create', message: { to: 'remoteaccount@remotedomain' } });
        let getAccountStub = sandbox.stub(AccountService,'getAccount');
        getAccountStub.resolves(null);
        await expect(service.processOutboxMessage(message)).rejects.toThrow('No account found for message');

    });

    it('should skip invalid message type', async () => {
        let message = ActivityPubOutboxMessageEntity.build({ account_id: 'testid', type: 'NotAType', message: { to: 'remoteaccount@remotedomain' } });

        let getAccountStub = sandbox.stub(AccountService,'getAccount');
        let postStub = sandbox.stub(axios,'post');
        let updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype,'update');

        getAccountStub.resolves(Account.fromObject({ id: 'testid' }));

        await service.processOutboxMessage(message);

        expect(postStub.called).toBe(false);
        expect(updateStub.calledOnce).toBe(true);
        expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
        expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('bad message type');
    });

    it('should skip message without recipients', async () => {
        let message = ActivityPubOutboxMessageEntity.build({ account_id: 'testid', type: 'Create', message: { object: { id: 'testid' } } });

        let getAccountStub = sandbox.stub(AccountService,'getAccount');
        let postStub = sandbox.stub(axios,'post');
        let updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype,'update');
        let getRecipientsStub = sandbox.stub(service,'getRecipients');
        let resolveStub = sandbox.stub(service,'resolveInboxUrl');

        getAccountStub.resolves(Account.fromObject({ id: 'testid' }));
        getRecipientsStub.resolves([]);
        resolveStub.resolves(null);

        await service.processOutboxMessage(message);

        expect(postStub.called).toBe(false);
        expect(updateStub.calledOnce).toBe(true);
        expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
        expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
    });

    it('should skip recipients without inbox', async () => {
        let message = ActivityPubOutboxMessageEntity.build({ account_id: 'testid', type: 'Create', message: { object: { id: 'testid' } } });

        let getAccountStub = sandbox.stub(AccountService,'getAccount');
        let postStub = sandbox.stub(axios,'post');
        let updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype,'update');
        let getRecipientsStub = sandbox.stub(service,'getRecipients');
        let resolveStub = sandbox.stub(service,'resolveInboxUrl');

        getAccountStub.resolves(Account.fromObject({ id: 'testid' }));
        getRecipientsStub.resolves(['remoteaccount@remotedomain']);
        resolveStub.resolves(null);

        await service.processOutboxMessage(message);

        expect(postStub.called).toBe(false);
        expect(updateStub.calledOnce).toBe(true);
        expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
        expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
    });

    it('should send message to each recipient', async () => {
        let message = ActivityPubOutboxMessageEntity.build({ account_id: 'testid', type: 'Create', message: { object: { id: 'testid' } } });

        let getAccountStub = sandbox.stub(AccountService,'getAccount');
        let postStub = sandbox.stub(axios,'post');
        let updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype,'update');
        let getRecipientsStub = sandbox.stub(service,'getRecipients');
        let resolveStub = sandbox.stub(service,'resolveInboxUrl');

        getAccountStub.resolves(Account.fromObject({ id: 'testid' }));
        getRecipientsStub.resolves(['remoteaccount@remotedomain','observeraccount@observerdomain']);
        resolveStub.resolves('https://remotedomain/users/testuser/inbox');

        await service.processOutboxMessage(message);

        expect(postStub.calledTwice).toBe(true);
        expect(updateStub.calledOnce).toBe(true);
        expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
        expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
    });

});

describe('event listener', () => {
    let service: ProcessOutboxService;
    let source: EventEmitter;
    let sandbox: sinon.SinonSandbox = sinon.createSandbox();

    beforeEach (() => {
        service = new ProcessOutboxService();
        source = new EventEmitter();
        service.registerListeners(source);
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('should process message found in database', async () => {

        let processorStub = sandbox.stub(service,'processOutboxMessage');
        let entityStub = sandbox.stub(ActivityPubOutboxMessageEntity,'findByPk');
        entityStub.resolves(
            ActivityPubOutboxMessageEntity.build({
                account_id: 'testid', type: 'Create', message: { object: { id: 'testid' } }
            })
        );

        source.emit('outboxMessageAdded',{
            account_id: 'testid',
            type: 'Create',
            message: { object: { id: 'testid' } }
        });

        // wait for event to propogate:
        await new Promise(resolve => setTimeout(resolve, 100))

        expect(processorStub.calledOnce).toBe(true);
    });

    it('should ignore message not found in database', async () => {

        let processorStub = sandbox.stub(service,'processOutboxMessage');
        let entityStub = sandbox.stub(ActivityPubOutboxMessageEntity,'findByPk');
        entityStub.resolves(undefined);

        source.emit('outboxMessageAdded',{
            account_id: 'testid',
            type: 'Create',
            message: { object: { id: 'testid' } }
        });

        // wait for event to propogate:
        await new Promise(resolve => setTimeout(resolve, 100))

        expect(processorStub.calledOnce).toBe(false);
    });
});
