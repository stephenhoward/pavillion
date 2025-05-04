import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { Account } from '@/common/model/account';
import { AccountEntity, AccountSecretsEntity, AccountInvitationEntity,AccountApplicationEntity } from '@/server/common/entity/account';
import CommonAccountService from '@/server/common/service/accounts';
import EmailService from '@/server/common/service/mail';
import ServiceSettings from '@/server/configuration/service/settings';
import AccountService from '@/server/accounts/service/account';
import AuthenticationService from '@/server/authentication/service/auth';
import { AccountAlreadyExistsError, AccountInviteAlreadyExistsError, AccountRegistrationClosedError, AccountApplicationAlreadyExistsError, AccountApplicationsClosedError, noAccountInviteExistsError, noAccountApplicationExistsError } from '@/server/accounts/exceptions';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

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
        let emailStub = sandbox.stub(EmailService, 'sendEmail');

        for (let mode of ['closed', 'apply', 'invite']) {
            getSettingStub.withArgs('registrationMode').returns(mode);
            await expect(AccountService.registerNewAccount('test_email')).rejects
                .toThrow(AccountRegistrationClosedError);
            expect(emailStub.called).toBe(false);

        }
    });

    it('open registration', async () => {
        let getSettingStub = sandbox.stub(ServiceSettings.prototype, 'get');
        let setupAccountStub = sandbox.stub(AccountService, '_setupAccount');
        let emailStub = sandbox.stub(EmailService, 'sendEmail');

        getSettingStub.withArgs('registrationMode').returns('open');
        setupAccountStub.resolves({ account: new Account('id', 'testme', 'test_email'), password_code: 'test_code' });

        let account = await AccountService.registerNewAccount('test_email');

        expect(account.email).toBe('test_email');
        expect(emailStub.called).toBe(true);
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
        let emailStub = applySandbox.stub(EmailService, 'sendEmail');

        getSettingStub.withArgs('registrationMode').returns('apply');
        findApplicationStub.resolves(undefined);

        let result = await AccountService.applyForNewAccount('test_email','test_message');

        expect(result).toBe(true);
    });
});

describe('validateInviteCode', () => {
    let validateSandbox = sinon.createSandbox();

    afterEach(() => {
        validateSandbox.restore();
    });

    it('no invite found', async () => {
        let findInviteStub = validateSandbox.stub(AccountInvitationEntity, 'findOne');

        findInviteStub.resolves(undefined);

        await expect(AccountService.validateInviteCode('test_code')).resolves.toBe(false);
    });

    it('invite found', async () => {
        let findInviteStub = validateSandbox.stub(AccountInvitationEntity, 'findOne');

        findInviteStub.resolves(AccountInvitationEntity.build({ invitation_code: 'test_code' }));

        await expect(AccountService.validateInviteCode('test_code')).resolves.toBe(true);
    });
});

describe('acceptAccountInvite', () => {
    let acceptSandbox = sinon.createSandbox();

    afterEach(() => {
        acceptSandbox.restore();
    });

    it('no invite found', async () => {
        let findInviteStub = acceptSandbox.stub(AccountInvitationEntity, 'findOne');

        findInviteStub.resolves(undefined);

        await expect(AccountService.acceptAccountInvite('test_code','test_password')).rejects
            .toThrow(noAccountInviteExistsError);
    });

    it('invite found', async () => {
        let findInviteStub = acceptSandbox.stub(AccountInvitationEntity, 'findOne');
        let setupAccountStub = acceptSandbox.stub(AccountService, '_setupAccount');

        findInviteStub.resolves(AccountInvitationEntity.build({ invitation_code: 'test_code' }));
        setupAccountStub.resolves({ account: new Account('id', 'testme', 'test_email'), password_code: 'test_code' });

        let account = await AccountService.acceptAccountInvite('test_code','test_password');

        expect(account).toBeTruthy();
    });
});

describe('acceptAccountApplication', () => {
    let acceptSandbox = sinon.createSandbox();

    afterEach(() => {
        acceptSandbox.restore();
    });

    it('no application found', async () => {
        let findApplicationStub = acceptSandbox.stub(AccountApplicationEntity, 'findByPk');

        findApplicationStub.resolves(undefined);

        await expect(AccountService.acceptAccountApplication('test_id')).rejects
            .toThrow(noAccountApplicationExistsError);
    });

    it('application found', async () => {
        let findApplicationStub = acceptSandbox.stub(AccountApplicationEntity, 'findByPk');
        let setupAccountStub = acceptSandbox.stub(AccountService, '_setupAccount');
        let sendEmailStub = acceptSandbox.stub(EmailService, 'sendEmail');

        findApplicationStub.resolves(AccountApplicationEntity.build({ email: 'test_email' }));
        setupAccountStub.resolves({ account: new Account('id', 'testme', 'test_email'), password_code: 'test_code' });

        let account = await AccountService.acceptAccountApplication('test_id');

        expect(sendEmailStub.called).toBe(true);
        expect(account).toBeTruthy();
    });
});

describe('rejectAccountApplication', () => {
    let rejectSandbox = sinon.createSandbox();

    afterEach(() => {
        rejectSandbox.restore();
    });

    it('no application found', async () => {
        let findApplicationStub = rejectSandbox.stub(AccountApplicationEntity, 'findByPk');

        findApplicationStub.resolves(undefined);

        await expect(AccountService.acceptAccountApplication('test_id')).rejects
            .toThrow(noAccountApplicationExistsError);
    });

    it('application found', async () => {
        let findApplicationStub = rejectSandbox.stub(AccountApplicationEntity, 'findByPk');
        let sendEmailStub = rejectSandbox.stub(EmailService, 'sendEmail');
        let destroyStub = rejectSandbox.stub(AccountApplicationEntity.prototype, 'destroy');

        findApplicationStub.resolves(AccountApplicationEntity.build({ email: 'test_email' }));

        let account = await AccountService.rejectAccountApplication('test_id');

        expect(sendEmailStub.called).toBe(true);
        expect(destroyStub.called).toBe(true);
    });
});

describe('_setupAccount', () => {
    let setupSandbox = sinon.createSandbox();

    afterEach(() => {
        setupSandbox.restore();
    });

    it('should fail to create an account with an existing email', async () => {
        let accountServiceStub = setupSandbox.stub(CommonAccountService, 'getAccountByEmail');

        accountServiceStub.resolves(new Account('id', 'testme', 'test_email'));

        await expect(AccountService._setupAccount('test_email','test_password')).rejects
            .toThrow(AccountAlreadyExistsError);
    });

    it('should create an account without a password', async () => {

        let accountServiceStub = setupSandbox.stub(CommonAccountService, 'getAccountByEmail');
        let accountSaveStub = setupSandbox.stub(AccountEntity.prototype, 'save');
        let accountSecretsSaveStub = setupSandbox.stub(AccountSecretsEntity.prototype, 'save');
        let passwordCodeStub = setupSandbox.stub(AuthenticationService, 'generatePasswordResetCodeForAccount');

        passwordCodeStub.resolves('test_code');
        accountServiceStub.resolves(undefined);

        let accountInfo = await AccountService._setupAccount('test_email');

        expect(accountInfo.account.email).toBe('test_email');
        expect(accountInfo.password_code).toBeTruthy();
        expect(accountSaveStub.called).toBe(true);
        expect(accountSecretsSaveStub.called).toBe(true);
    });

    it('should create an account with a password', async () => {

        let accountServiceStub = setupSandbox.stub(CommonAccountService, 'getAccountByEmail');
        let accountSaveStub = setupSandbox.stub(AccountEntity.prototype, 'save');
        let setPasswordStub = sinon.stub(CommonAccountService, 'setPassword');
        let accountSecretsSaveStub = setupSandbox.stub(AccountSecretsEntity.prototype, 'save');
        let passwordCodeStub = setupSandbox.stub(AuthenticationService, 'generatePasswordResetCodeForAccount');

        accountServiceStub.resolves(undefined);
        setPasswordStub.resolves(true);

        let accountInfo = await AccountService._setupAccount('test_email','test_password');

        expect(accountInfo.account.email).toBe('test_email');
        expect(accountInfo.password_code).toBe('');
        expect(accountSaveStub.called).toBe(true);
        expect(passwordCodeStub.called).toBe(false);
        expect(accountSecretsSaveStub.called).toBe(true);
    });

});