import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import ActivityPubService from '@/server/activitypub/service/members';
import AccountService from '@/server/accounts/service/account';
import { Account } from '@/common/model/account';
import { FollowedAccountEntity } from '@/server/activitypub/entity/activitypub';
import { ActivityPubOutboxMessageEntity } from '@/server/activitypub/entity/activitypub';

describe("followAccount", () => {
    let service: ActivityPubService;
    let sandbox: sinon.SinonSandbox = sinon.createSandbox();

    beforeEach(() => {
        service = new ActivityPubService();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('should follow the account', async () => {

        let account = Account.fromObject({ id: 'testid' });

        let getExistingFollowStub = sandbox.stub(FollowedAccountEntity, 'findOne');
        getExistingFollowStub.resolves(null);

        let getActorUrlStub = sandbox.stub(service, 'actorUrl');
        getActorUrlStub.resolves('https://testdomain.com/users/testuser');

        let buildFollowStub = sandbox.spy(FollowedAccountEntity, 'build');

        let saveFollowStub = sandbox.stub(FollowedAccountEntity.prototype, 'save');
        saveFollowStub.resolves();

        let addToOutboxStub = sandbox.stub(service, 'addToOutbox');
        addToOutboxStub.resolves();

        await service.followAccount(account,'testuser@testdomain.com');

        expect( buildFollowStub.calledOnce ).toBe(true);
        expect(saveFollowStub.calledOnce ).toBe(true);
        expect(addToOutboxStub.calledOnce).toBe(true);

        let call = buildFollowStub.getCall(0);
        let callargs = call.args[0];
        if ( callargs ) {
            expect( callargs.id ).toMatch(/https:\/\/testdomain.com\/users\/testuser\/follows\/[a-z0-9-]+/);
            expect( callargs.account_id ).toBe('testid');
            expect( callargs.remote_account_id ).toBe('testuser@testdomain.com');
            expect( callargs.direction ).toBe('following');

            let outboxCall = addToOutboxStub.getCall(0);
            if ( outboxCall ) {
                expect(outboxCall.args[0]).toBe(account);
                expect(outboxCall.args[1].id).toBe(callargs.id);
                expect(outboxCall.args[1].type).toBe('Follow');
            }
        }
    });

    it('already follows the account, do nothing', async () => {

        let account = Account.fromObject({ id: 'testid' });

        let getExistingFollowStub = sandbox.stub(FollowedAccountEntity, 'findOne');
        getExistingFollowStub.resolves(FollowedAccountEntity.build({}));

        let getActorUrlStub = sandbox.stub(service, 'actorUrl');
        getActorUrlStub.resolves('https://testdomain.com/users/testuser');

        let buildFollowStub = sandbox.spy(FollowedAccountEntity, 'build');

        let saveFollowStub = sandbox.stub(FollowedAccountEntity.prototype, 'save');
        saveFollowStub.resolves();

        let addToOutboxStub = sandbox.stub(service, 'addToOutbox');
        addToOutboxStub.resolves();

        await service.followAccount(account,'testuser@testdomain.com');

        expect( buildFollowStub.called ).toBe(false);
        expect( saveFollowStub.called ).toBe(false);
        expect( addToOutboxStub.called ).toBe(false);
    });

    it('fails with an invalid account identifier', async () => {

        let account = Account.fromObject({ id: 'testid' });

        let buildFollowStub = sandbox.spy(FollowedAccountEntity, 'build');

        let saveFollowStub = sandbox.stub(FollowedAccountEntity.prototype, 'save');
        saveFollowStub.resolves();

        let addToOutboxStub = sandbox.stub(service, 'addToOutbox');
        addToOutboxStub.resolves();

        expect( service.followAccount(account,'invalidUserIdentifier') ).rejects.toThrow('Invalid remote account identifier: invalidUserIdentifier');
        expect( buildFollowStub.called ).toBe(false);
        expect( saveFollowStub.called ).toBe(false);
        expect( addToOutboxStub.called ).toBe(false);
    });

});

describe("unfollowAccount", () => {
    let service: ActivityPubService;
    let sandbox: sinon.SinonSandbox = sinon.createSandbox();

    beforeEach(() => {
        service = new ActivityPubService();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('should unfollow the account', async () => {

        let account = Account.fromObject({ id: 'testid' });

        let getExistingFollowStub = sandbox.stub(FollowedAccountEntity, 'findAll');
        getExistingFollowStub.resolves([
            FollowedAccountEntity.build({
                id: 'testfollowid',
                remote_account_id: 'testuser@testdomain.com'
            })
        ]);

        let getActorUrlStub = sandbox.stub(service, 'actorUrl');
        getActorUrlStub.resolves('https://testdomain.com/users/testuser');

        let destroyFollowStub = sandbox.stub(FollowedAccountEntity.prototype, 'destroy');
        destroyFollowStub.resolves();

        let addToOutboxStub = sandbox.stub(service, 'addToOutbox');
        addToOutboxStub.resolves();

        await service.unfollowAccount(account,'testuser@testdomain.com');

        expect(destroyFollowStub.calledOnce ).toBe(true);
        expect(addToOutboxStub.calledOnce).toBe(true);

        let outboxCall = addToOutboxStub.getCall(0);
        if ( outboxCall ) {
            expect(outboxCall.args[0]).toBe(account);
            expect(outboxCall.args[1].type).toBe('Undo');
            expect(outboxCall.args[1].actor).toBe('https://testdomain.com/users/testuser');
            expect(outboxCall.args[1].object).toBe('testfollowid');
        }
    });

    it('does not follow this account, do nothing', async () => {

        let account = Account.fromObject({ id: 'testid' });

        let getExistingFollowStub = sandbox.stub(FollowedAccountEntity, 'findAll');
        getExistingFollowStub.resolves([]);

        let getActorUrlStub = sandbox.stub(service, 'actorUrl');
        getActorUrlStub.resolves('https://testdomain.com/users/testuser');

        let destroyFollowStub = sandbox.stub(FollowedAccountEntity.prototype, 'destroy');
        destroyFollowStub.resolves();

        let addToOutboxStub = sandbox.stub(service, 'addToOutbox');
        addToOutboxStub.resolves();

        await service.unfollowAccount(account,'testuser@testdomain.com');

        expect( destroyFollowStub.called ).toBe(false);
        expect( addToOutboxStub.called ).toBe(false);
    });
});