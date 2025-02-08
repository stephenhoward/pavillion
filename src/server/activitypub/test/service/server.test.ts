import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { UserProfileResponse } from '@/server/activitypub/model/userprofile';
import { WebFingerResponse } from '@/server/activitypub/model/webfinger';
import ActivityPubService from '@/server/activitypub/service/server';
import AccountService from '@/server/accounts/service/account';
import { ProfileEntity } from '@/server/common/entity/account';
import { Account } from '@/common/model/account';
import { ActivityPubActivity } from '@/server/activitypub/model/base';
import { ActivityPubInboxMessageEntity } from '@/server/activitypub/entity/activitypub';

describe('parseWebFingerResource', () => {

    it('should succeed', async () => {
        let service = new ActivityPubService();

        let { username, domain } = service.parseWebFingerResource("acct:testuser@testdomain.com");

        expect(username).toBe("testuser");
        expect(domain).toBe("testdomain.com");
    });

    it('should succeed even missing acct prefix', async () => {
        let service = new ActivityPubService();

        let { username, domain } = service.parseWebFingerResource("testuser@testdomain.com");

        expect(username).toBe("testuser");
        expect(domain).toBe("testdomain.com");
    });

    it('should not return values if malformed', async () => {
        let service = new ActivityPubService();

        let badstrings = [
            "acct:@testdomain.com",
            "acct:username",
            "acct:username@",
            "",
            "acct:"
        ]

        for( let badstring of badstrings ) {
            let { username, domain } = service.parseWebFingerResource(badstring);

            expect(username).toBe("");
            expect(domain).toBe("");
        }
    });

});

describe('lookupWebFinger', () => {
    let service: ActivityPubService;
    let sandbox: sinon.SinonSandbox = sinon.createSandbox();

    beforeEach(() => {
        service = new ActivityPubService();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('should return null if no profile', async () => {
        let profileStub = sandbox.stub(AccountService, 'getProfileForUsername');
        profileStub.resolves(null);

        let response = await service.lookupWebFinger('testuser', 'testdomain.com');

        expect(response).toBe(null);
    });

    it('should return a WebFingerResponse', async () => {
        let profileStub = sandbox.stub(AccountService, 'getProfileForUsername');
        profileStub.resolves(ProfileEntity.build({ account_id: 'testid', username: 'testuser'}));

        let response = await service.lookupWebFinger('testuser', 'testdomain.com');
        let expected = new WebFingerResponse('testuser', 'testdomain.com').toObject();

        expect(response).toBeDefined();
        expect(response).toEqual(expected);
    });
});

describe('lookupUserProfile', () => {
    let service: ActivityPubService;
    let sandbox: sinon.SinonSandbox = sinon.createSandbox();

    beforeEach(() => {
        service = new ActivityPubService();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('should return null if no profile', async () => {
        let profileStub = sandbox.stub(AccountService, 'getProfileForUsername');
        profileStub.resolves(null);

        let response = await service.lookupUserProfile('testuser', 'testdomain.com');

        expect(response).toBe(null);
    });

    it('should return a UserProfileResponse', async () => {
        let profileStub = sandbox.stub(AccountService, 'getProfileForUsername');
        profileStub.resolves(ProfileEntity.build({ account_id: 'testid', username: 'testuser'}));

        let response = await service.lookupUserProfile('testuser', 'testdomain.com');
        let expected = new UserProfileResponse('testuser', 'testdomain.com').toObject();

        expect(response).toBeDefined();
        expect(response).toEqual(expected);
    });
});

describe("addToInbox", () => {
    let service: ActivityPubService;
    let sandbox: sinon.SinonSandbox = sinon.createSandbox();

    beforeEach(() => {
        service = new ActivityPubService();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('should save the message', async () => {
        let message = ActivityPubActivity.fromObject({ type: 'Create', id: 'testid' });
        let account = Account.fromObject({ id: 'testid' });

        let getAccountStub = sandbox.stub(AccountService, 'getAccount');
        getAccountStub.resolves(account);

        let saveMessageStub = sandbox.stub(ActivityPubInboxMessageEntity.prototype, 'save');
        saveMessageStub.resolves(undefined);

        let response = await service.addToInbox(account, message);

        expect(response).toBe(null);
        expect(saveMessageStub.called).toBe(true);
    });

    it('should throw an error if account not found', async () => {
        let message = ActivityPubActivity.fromObject({ type: 'Create', id: 'testid' });
        let account = Account.fromObject({ id: 'testid' });

        let getAccountStub = sandbox.stub(AccountService, 'getAccount');
        getAccountStub.resolves(null);

        await expect( service.addToInbox(account, message) ).rejects.toThrow('Account not found');
    });
});