import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import sinon from 'sinon';

import { Account } from '@/common/model/account';
import { AccountEntity, AccountSecretsEntity, AccountInvitationEntity,AccountApplicationEntity } from '@/server/common/entity/account';
import EmailService from '@/server/common/service/mail';
import ServiceSettings from '@/server/configuration/service/settings';
import AccountService from '@/server/accounts/service/account';
import { AccountAlreadyExistsError, AccountInviteAlreadyExistsError, AccountRegistrationClosedError, AccountApplicationAlreadyExistsError, AccountApplicationsClosedError, noAccountInviteExistsError, noAccountApplicationExistsError } from '@/server/accounts/exceptions';
import { initI18Next } from '@/server/common/test/lib/i18next';
import EventEmitter from 'events';
import ConfigurationInterface from '@/server/configuration/interface';

initI18Next();

describe('inviteNewAccount', () => {

  let sandbox = sinon.createSandbox();
  let accountService: AccountService;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    accountService = new AccountService(eventBus,configurationInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should throw AccountAlreadyExistsError if account already exists', async () => {
    let getAccountStub = sandbox.stub(accountService, 'getAccountByEmail');

    getAccountStub.resolves(new Account('id', 'test_email', 'testme'));

    await expect( accountService.inviteNewAccount('test_email','test_message')).rejects
      .toThrow(AccountAlreadyExistsError);
  });

  it('should throw AccountInviteAlreadyExistsError if invitation already exists', async () => {
    let getAccountStub = sandbox.stub(accountService, 'getAccountByEmail');
    let findInviteStub = sandbox.stub(AccountInvitationEntity, 'findOne');

    getAccountStub.resolves(undefined);
    findInviteStub.resolves(AccountInvitationEntity.build({ email: 'test_email' }));
    await expect(accountService.inviteNewAccount('test_email','test_message')).rejects
      .toThrow(AccountInviteAlreadyExistsError);
  });

  it('should return an invitation', async () => {
    let getAccountStub = sandbox.stub(accountService, 'getAccountByEmail');
    let findInvitationStub = sandbox.stub(AccountInvitationEntity, 'findOne');
    let sendInviteStub = sandbox.stub(accountService,'sendNewAccountInvite');
    let saveInviteStub = sandbox.stub(AccountInvitationEntity.prototype, 'save');

    getAccountStub.resolves(undefined);
    findInvitationStub.resolves(undefined);

    let invitation = await accountService.inviteNewAccount('test_email','test_message');
    expect(invitation.email).toBe('test_email');
    expect(sendInviteStub.called).toBe(true);
    expect(saveInviteStub.called).toBe(true);
  });
});

describe('registerNewAccount', () => {

  let sandbox = sinon.createSandbox();
  let accountService: AccountService;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    accountService = new AccountService(eventBus,configurationInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('no registration allowed', async () => {
    let getSettingStub = sandbox.stub(ServiceSettings.prototype, 'get');
    let initSettingsStub = sandbox.stub(ServiceSettings.prototype, 'init');
    let emailStub = sandbox.stub(EmailService, 'sendEmail');

    for (let mode of ['closed', 'apply', 'invite']) {
      getSettingStub.withArgs('registrationMode').returns(mode);
      await expect(accountService.registerNewAccount('test_email')).rejects
        .toThrow(AccountRegistrationClosedError);
      expect(emailStub.called).toBe(false);
    }
    expect(initSettingsStub.called).toBe(true);
  });

  it('open registration', async () => {
    let getSettingStub = sandbox.stub(ServiceSettings.prototype, 'get');
    let setupAccountStub = sandbox.stub(accountService, '_setupAccount');
    let emailStub = sandbox.stub(EmailService, 'sendEmail');

    getSettingStub.withArgs('registrationMode').returns('open');
    setupAccountStub.resolves({ account: new Account('id', 'testme', 'test_email'), password_code: 'test_code' });

    let account = await accountService.registerNewAccount('test_email');

    expect(account.email).toBe('test_email');
    expect(emailStub.called).toBe(true);
  });
});

describe('applyForNewAccount', () => {
  let applySandbox = sinon.createSandbox();
  let accountService: AccountService;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    accountService = new AccountService(eventBus,configurationInterface);
  });

  afterEach(() => {
    applySandbox.restore();
  });

  it('no applications allowed', async () => {
    let getSettingStub = applySandbox.stub(ServiceSettings.prototype, 'get');

    for (let mode of ['closed', 'open', 'invite']) {
      getSettingStub.withArgs('registrationMode').returns(mode);
      await expect(accountService.applyForNewAccount('test_email','test_message')).rejects
        .toThrow(AccountApplicationsClosedError);
    }
  });

  it('application already exists', async () => {
    let getSettingStub = applySandbox.stub(ServiceSettings.prototype, 'get');
    let buildAccountStub = applySandbox.stub(AccountApplicationEntity, 'findOne');

    getSettingStub.withArgs('registrationMode').returns('apply');
    buildAccountStub.resolves(AccountApplicationEntity.build({ email: 'test_email' }));

    await expect(accountService.applyForNewAccount('test_email','test_message')).rejects
      .toThrow(AccountApplicationAlreadyExistsError);
  });

  it('application succeeds', async () => {
    let getSettingStub = applySandbox.stub(ServiceSettings.prototype, 'get');
    let findApplicationStub = applySandbox.stub(AccountApplicationEntity, 'findOne');
    let saveApplicationStub = applySandbox.stub(AccountApplicationEntity.prototype, 'save');
    let emailStub = applySandbox.stub(EmailService, 'sendEmail');

    getSettingStub.withArgs('registrationMode').returns('apply');
    findApplicationStub.resolves(undefined);

    let result = await accountService.applyForNewAccount('test_email','test_message');

    expect(result).toBe(true);
    expect(saveApplicationStub.called).toBe(true);
    expect(emailStub.called).toBe(true);
  });
});

describe('validateInviteCode', () => {
  let validateSandbox = sinon.createSandbox();
  let accountService: AccountService;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    accountService = new AccountService(eventBus,configurationInterface);
  });

  afterEach(() => {
    validateSandbox.restore();
  });

  it('no invite found', async () => {
    let findInviteStub = validateSandbox.stub(AccountInvitationEntity, 'findOne');

    findInviteStub.resolves(undefined);

    await expect(accountService.validateInviteCode('test_code')).resolves.toBe(false);
  });

  it('invite expired with null time', async () => {
    let findInviteStub = validateSandbox.stub(AccountInvitationEntity, 'findOne');

    findInviteStub.resolves(AccountInvitationEntity.build({
      invitation_code: 'test_code',
      expiration_time: null,
    }));
    await expect(accountService.validateInviteCode('test_code')).resolves.toBe(false);
  });

  it('invite expired with null time', async () => {
    let findInviteStub = validateSandbox.stub(AccountInvitationEntity, 'findOne');

    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1); // yesterday

    findInviteStub.resolves(AccountInvitationEntity.build({
      invitation_code: 'test_code',
      expiration_time: pastDate,
    }));
    await expect(accountService.validateInviteCode('test_code')).resolves.toBe(false);
  });

  it('invite valid', async () => {
    let findInviteStub = validateSandbox.stub(AccountInvitationEntity, 'findOne');

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 1); // tomorrow

    findInviteStub.resolves(AccountInvitationEntity.build({
      invitation_code: 'test_code',
      expiration_time: futureDate,
    }));

    await expect(accountService.validateInviteCode('test_code')).resolves.toBe(true);
  });
});

describe('acceptAccountInvite', () => {
  let acceptSandbox = sinon.createSandbox();
  let accountService: AccountService;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    accountService = new AccountService(eventBus,configurationInterface);
  });

  afterEach(() => {
    acceptSandbox.restore();
  });

  it('rejects expired invitations', async () => {
    let setupAccountStub = acceptSandbox.stub(accountService, '_setupAccount');
    let destroyStub = acceptSandbox.stub(AccountInvitationEntity, 'destroy').resolves();
    // Set up validateInviteCode to return false (expired or invalid)
    let validateStub = acceptSandbox.stub(accountService, 'validateInviteCode');
    validateStub.resolves(false);

    await expect(accountService.acceptAccountInvite('test_code', 'test_password'))
      .rejects.toThrow('Invitation has expired or does not exist');

    expect(setupAccountStub.called).toBe(false);
    expect(destroyStub.called).toBe(false);
  });

  it('rejects when invite not found after validation', async () => {
    let setupAccountStub = acceptSandbox.stub(accountService, '_setupAccount');
    let destroyStub = acceptSandbox.stub(AccountInvitationEntity, 'destroy').resolves();
    let validateStub = acceptSandbox.stub(accountService, 'validateInviteCode');

    // validateInviteCode returns true but invitation is not found
    validateStub.resolves(true);

    let findInviteStub = acceptSandbox.stub(AccountInvitationEntity, 'findOne');
    findInviteStub.resolves(undefined);

    await expect(accountService.acceptAccountInvite('test_code', 'test_password'))
      .rejects.toThrow(noAccountInviteExistsError);

    expect(setupAccountStub.called).toBe(false);
    expect(destroyStub.called).toBe(false);
  });

  it('accepts valid invitation and creates account', async () => {
    // Set up validateInviteCode to return true (valid)
    let validateStub = acceptSandbox.stub(accountService, 'validateInviteCode');
    validateStub.resolves(true);

    // Mock the invitation entity
    let findInviteStub = acceptSandbox.stub(AccountInvitationEntity, 'findOne');
    const invitation = AccountInvitationEntity.build({
      invitation_code: 'test_code',
      email: 'test_email@example.com',
    });
    findInviteStub.resolves(invitation);

    // Mock destroy method
    let destroyStub = acceptSandbox.stub(invitation, 'destroy').resolves();

    // Mock account creation
    let setupAccountStub = acceptSandbox.stub(accountService, '_setupAccount');
    setupAccountStub.resolves({
      account: new Account('id', 'test_email@example.com', 'testme'),
      password_code: '',
    });

    const account = await accountService.acceptAccountInvite('test_code', 'test_password');

    expect(setupAccountStub.called).toBe(true);
    expect(destroyStub.called).toBe(true);
    expect(account).toBeTruthy();
  });
});

describe('acceptAccountApplication', () => {
  let acceptSandbox = sinon.createSandbox();
  let accountService: AccountService;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    accountService = new AccountService(eventBus,configurationInterface);
  });

  afterEach(() => {
    acceptSandbox.restore();
  });

  it('no application found', async () => {
    let findApplicationStub = acceptSandbox.stub(AccountApplicationEntity, 'findByPk');

    findApplicationStub.resolves(undefined);

    await expect(accountService.acceptAccountApplication('test_id')).rejects
      .toThrow(noAccountApplicationExistsError);
  });

  it('application found', async () => {
    let findApplicationStub = acceptSandbox.stub(AccountApplicationEntity, 'findByPk');
    let setupAccountStub = acceptSandbox.stub(accountService, '_setupAccount');
    let sendEmailStub = acceptSandbox.stub(EmailService, 'sendEmail');

    const application = AccountApplicationEntity.build({ email: 'test_email' });
    const destroyStub = acceptSandbox.stub(application, 'destroy').resolves();

    findApplicationStub.resolves(application);
    setupAccountStub.resolves({ account: new Account('id', 'testme', 'test_email'), password_code: 'test_code' });

    let account = await accountService.acceptAccountApplication('test_id');

    expect(sendEmailStub.called).toBe(true);
    expect(destroyStub.called).toBe(true);
    expect(account).toBeTruthy();
  });
});

describe('rejectAccountApplication', () => {
  let rejectSandbox = sinon.createSandbox();
  let accountService: AccountService;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    accountService = new AccountService(eventBus,configurationInterface);
  });

  afterEach(() => {
    rejectSandbox.restore();
  });

  it('no application found', async () => {
    let findApplicationStub = rejectSandbox.stub(AccountApplicationEntity, 'findByPk');

    findApplicationStub.resolves(undefined);

    await expect(accountService.rejectAccountApplication('test_id')).rejects
      .toThrow(noAccountApplicationExistsError);
  });

  it('application rejected with notification', async () => {
    let findApplicationStub = rejectSandbox.stub(AccountApplicationEntity, 'findByPk');
    let sendEmailStub = rejectSandbox.stub(EmailService, 'sendEmail');

    const application = AccountApplicationEntity.build({
      email: 'test_email',
      message: 'test message',
    });
    const saveStub = rejectSandbox.stub(application, 'save').resolves();

    findApplicationStub.resolves(application);

    await accountService.rejectAccountApplication('test_id', false);

    expect(sendEmailStub.called).toBe(true);
    expect(saveStub.called).toBe(true);
    expect(application.status).toBe('rejected');
  });

  it('application rejected silently (no email)', async () => {
    let findApplicationStub = rejectSandbox.stub(AccountApplicationEntity, 'findByPk');
    let sendEmailStub = rejectSandbox.stub(EmailService, 'sendEmail');

    const application = AccountApplicationEntity.build({
      email: 'test_email',
      message: 'test message',
    });
    const saveStub = rejectSandbox.stub(application, 'save').resolves();

    findApplicationStub.resolves(application);

    await accountService.rejectAccountApplication('test_id', true);

    expect(sendEmailStub.called).toBe(false);
    expect(saveStub.called).toBe(true);
    expect(application.status).toBe('rejected');
  });
});

describe('_setupAccount', () => {
  let setupSandbox = sinon.createSandbox();
  let accountService: AccountService;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    accountService = new AccountService(eventBus,configurationInterface);
  });

  afterEach(() => {
    setupSandbox.restore();
  });

  it('should fail to create an account with an existing email', async () => {
    let accountServiceStub = setupSandbox.stub(accountService, 'getAccountByEmail');

    accountServiceStub.resolves(new Account('id', 'testme', 'test_email'));

    await expect(accountService._setupAccount('test_email','test_password')).rejects
      .toThrow(AccountAlreadyExistsError);
  });

  it('should create an account without a password', async () => {

    let accountServiceStub = setupSandbox.stub(accountService, 'getAccountByEmail');
    let accountSaveStub = setupSandbox.stub(AccountEntity.prototype, 'save');
    let accountSecretsSaveStub = setupSandbox.stub(AccountSecretsEntity.prototype, 'save');
    let passwordCodeStub = setupSandbox.stub(accountService, 'generatePasswordResetCodeForAccount');

    passwordCodeStub.resolves('test_code');
    accountServiceStub.resolves(undefined);

    let accountInfo = await accountService._setupAccount('test_email');

    expect(accountInfo.account.email).toBe('test_email');
    expect(accountInfo.password_code).toBeTruthy();
    expect(accountSaveStub.called).toBe(true);
    expect(accountSecretsSaveStub.called).toBe(true);
  });

  it('should create an account with a password', async () => {

    let accountServiceStub = setupSandbox.stub(accountService, 'getAccountByEmail');
    let accountSaveStub = setupSandbox.stub(AccountEntity.prototype, 'save');
    let setPasswordStub = sinon.stub(accountService, 'setPassword');
    let accountSecretsSaveStub = setupSandbox.stub(AccountSecretsEntity.prototype, 'save');
    let passwordCodeStub = setupSandbox.stub(accountService, 'generatePasswordResetCodeForAccount');

    accountServiceStub.resolves(undefined);
    setPasswordStub.resolves(true);

    let accountInfo = await accountService._setupAccount('test_email','test_password');

    expect(accountInfo.account.email).toBe('test_email');
    expect(accountInfo.password_code).toBe('');
    expect(accountSaveStub.called).toBe(true);
    expect(passwordCodeStub.called).toBe(false);
    expect(accountSecretsSaveStub.called).toBe(true);
  });

});
