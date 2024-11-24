import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import CommonAccountService from '../../common/service/accounts';
import AccountService from '../service/account';
import { AccountInvitationEntity,AccountApplicationEntity } from '../../common/entity/account';
import { Account } from '../../../common/model/account';
import { AccountAlreadyExistsError, AccountInviteAlreadyExistsError, AccountRegistrationClosedError, AccountApplicationAlreadyExistsError, AccountApplicationsClosedError } from '../../exceptions/account_exceptions';
import ServiceSettings from '../../common/service/settings';

describe('inviteNewAccount', () => {

    let sandbox = sinon.createSandbox();

    afterEach(() => {
        sandbox.restore();
    });

    it('should throw AccountAlreadyExistsError if account already exists', async () => {
        let getAccountStub = sandbox.stub(CommonAccountService, 'getAccountByEmail');

        getAccountStub.resolves(new Account('id', 'test_email', 'testme'));

        await expect( AccountService.inviteNewAccount('test_email','test_message')).rejects
            .toThrow(AccountAlreadyExistsError);
    });

    it('should throw AccountInviteAlreadyExistsError if invitation already exists', async () => {
        let getAccountStub = sandbox.stub(CommonAccountService, 'getAccountByEmail');
        let findInviteStub = sandbox.stub(AccountInvitationEntity, 'findOne');

        getAccountStub.resolves(undefined);
        findInviteStub.resolves(AccountInvitationEntity.build({ email: 'test_email' }));
        await expect(AccountService.inviteNewAccount('test_email','test_message')).rejects
            .toThrow(AccountInviteAlreadyExistsError);
    });

    it('should return an invitation', async () => {
        let getAccountStub = sandbox.stub(CommonAccountService, 'getAccountByEmail');
        let findInvitationStub = sandbox.stub(AccountInvitationEntity, 'findOne');
        let sendInviteStub = sandbox.stub(AccountService,'sendNewAccountInvite');
        let saveinviteStub = sandbox.stub(AccountInvitationEntity.prototype, 'save');

        getAccountStub.resolves(undefined);
        findInvitationStub.resolves(undefined);

        let invitation = await AccountService.inviteNewAccount('test_email','test_message');
        expect(invitation.email).toBe('test_email');
    });
});

describe('registerNewAccount', () => {

    let sandbox = sinon.createSandbox();

    afterEach(() => {
        sandbox.restore();
    });

    it('no registration allowed', async () => {
        let getSettingStub = sandbox.stub(ServiceSettings.prototype, 'get');
        let initSettingsStub = sandbox.stub(ServiceSettings.prototype, 'init');

        for (let mode of ['closed', 'apply', 'invite']) {
            getSettingStub.withArgs('registrationMode').returns(mode);
            await expect(AccountService.registerNewAccount('test_email')).rejects
                .toThrow(AccountRegistrationClosedError);
        }
    });

    it('open registration', async () => {
        let getSettingStub = sandbox.stub(ServiceSettings.prototype, 'get');
        let setupAccountStub = sandbox.stub(AccountService, '_setupAccount');

        getSettingStub.withArgs('registrationMode').returns('open');
        setupAccountStub.resolves({ account: new Account('id', 'testme', 'test_email'), password_code: 'test_code' });

        let account = await AccountService.registerNewAccount('test_email');

        expect(account.email).toBe('test_email');
    });
});

describe('applyForNewAccount', () => {
    let applySandbox = sinon.createSandbox();

    afterEach(() => {
        applySandbox.restore();
    });

    it('no applications allowed', async () => {
        let getSettingStub = applySandbox.stub(ServiceSettings.prototype, 'get');
        let initSettingsStub = applySandbox.stub(ServiceSettings.prototype, 'init');

        for (let mode of ['closed', 'open', 'invite']) {
            getSettingStub.withArgs('registrationMode').returns(mode);
            await expect(AccountService.applyForNewAccount('test_email','test_message')).rejects
                .toThrow(AccountApplicationsClosedError);
        }
    });

    it('application already exists', async () => {
        let getSettingStub = applySandbox.stub(ServiceSettings.prototype, 'get');
        let buildAccountStub = applySandbox.stub(AccountApplicationEntity, 'findOne');

        getSettingStub.withArgs('registrationMode').returns('apply');
        buildAccountStub.resolves(AccountApplicationEntity.build({ email: 'test_email' }));

        await expect(AccountService.applyForNewAccount('test_email','test_message')).rejects
            .toThrow(AccountApplicationAlreadyExistsError);
    });

    it('application succeeds', async () => {
        let getSettingStub = applySandbox.stub(ServiceSettings.prototype, 'get');
        let findApplicationStub = applySandbox.stub(AccountApplicationEntity, 'findOne');
        let saveApplicationStub = applySandbox.stub(AccountApplicationEntity.prototype, 'save');

        getSettingStub.withArgs('registrationMode').returns('apply');
        findApplicationStub.resolves(undefined);

        let result = await AccountService.applyForNewAccount('test_email','test_message');

        expect(result).toBe(true);
    });
});