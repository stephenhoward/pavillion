import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import sinon from 'sinon';

import { Account } from '@/common/model/account';
import { AccountEntity, AccountSecretsEntity,AccountApplicationEntity } from '@/server/common/entity/account';
import AccountInvitationEntity from '@/server/accounts/entity/account_invitation';
import EmailService from '@/server/common/service/mail';
import ServiceSettings from '@/server/configuration/service/settings';
import AccountService from '@/server/accounts/service/account';
import { AccountAlreadyExistsError, AccountInviteAlreadyExistsError, AccountRegistrationClosedError, AccountApplicationAlreadyExistsError, AccountApplicationsClosedError, noAccountInviteExistsError, noAccountApplicationExistsError, AccountInvitationPermissionError } from '@/server/accounts/exceptions';
import { initI18Next } from '@/server/common/test/lib/i18next';
import EventEmitter from 'events';
import ConfigurationInterface from '@/server/configuration/interface';

initI18Next();

describe('inviteNewAccount', () => {

  let sandbox = sinon.createSandbox();
  let accountService: AccountService;
  let adminUser: Account;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    accountService = new AccountService(eventBus,configurationInterface);
    adminUser = new Account('admin_id', 'admin_user','admin@pavillion.dev');
    adminUser.roles = ['admin'];
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should throw AccountAlreadyExistsError if account already exists', async () => {
    let getAccountStub = sandbox.stub(accountService, 'getAccountByEmail');
    let getAllSettingsStub = sandbox.stub(ConfigurationInterface.prototype, 'getAllSettings');

    getAllSettingsStub.resolves({ registrationMode: 'invitation' });
    getAccountStub.resolves(new Account('id', 'test_email', 'testme'));

    await expect( accountService.inviteNewAccount(adminUser,'test_email','test_message')).rejects
      .toThrow(AccountAlreadyExistsError);
  });

  it('should throw AccountInviteAlreadyExistsError if invitation already exists', async () => {
    let getAccountStub = sandbox.stub(accountService, 'getAccountByEmail');
    let findInviteStub = sandbox.stub(AccountInvitationEntity, 'findOne');
    let getAllSettingsStub = sandbox.stub(ConfigurationInterface.prototype, 'getAllSettings');

    getAllSettingsStub.resolves({ registrationMode: 'invitation' });
    getAccountStub.resolves(undefined);
    findInviteStub.resolves(AccountInvitationEntity.build({ email: 'test_email' }));
    await expect(accountService.inviteNewAccount(adminUser,'test_email','test_message')).rejects
      .toThrow(AccountInviteAlreadyExistsError);
  });

  it('should return an invitation', async () => {
    let getAccountStub = sandbox.stub(accountService, 'getAccountByEmail');
    let findInvitationStub = sandbox.stub(AccountInvitationEntity, 'findOne');
    let sendInviteStub = sandbox.stub(accountService,'sendNewAccountInvite');
    let saveInviteStub = sandbox.stub(AccountInvitationEntity.prototype, 'save');
    let getAllSettingsStub = sandbox.stub(ConfigurationInterface.prototype, 'getAllSettings');

    getAllSettingsStub.resolves({ registrationMode: 'invitation' });
    getAccountStub.resolves(undefined);
    findInvitationStub.resolves(undefined);

    let invitation = await accountService.inviteNewAccount(adminUser,'test_email','test_message');
    expect(invitation.email).toBe('test_email');
    expect(sendInviteStub.called).toBe(true);
    expect(saveInviteStub.called).toBe(true);
  });

  it.each([
    { mode: 'closed', shouldAllow: false, description: 'should throw AccountInvitationPermissionError if non-admin user tries to invite in closed mode' },
    { mode: 'apply', shouldAllow: false, description: 'should throw AccountInvitationPermissionError if non-admin user tries to invite in apply mode' },
    { mode: 'invitation', shouldAllow: true, description: 'should allow non-admin user to invite in invitation mode' },
    { mode: 'open', shouldAllow: true, description: 'should allow non-admin user to invite in open mode' },
  ])('$description', async ({ mode, shouldAllow }) => {
    let getAllSettingsStub = sandbox.stub(ConfigurationInterface.prototype, 'getAllSettings');
    let regularUser = new Account('user_id', 'regular_user', 'user@pavillion.dev');
    regularUser.roles = []; // Not an admin

    getAllSettingsStub.resolves({ registrationMode: mode });

    if (shouldAllow) {
      // For modes that should allow invitations, we need to stub the success path
      let getAccountStub = sandbox.stub(accountService, 'getAccountByEmail');
      let findInvitationStub = sandbox.stub(AccountInvitationEntity, 'findOne');
      let sendInviteStub = sandbox.stub(accountService,'sendNewAccountInvite');
      let saveInviteStub = sandbox.stub(AccountInvitationEntity.prototype, 'save');

      getAccountStub.resolves(undefined);
      findInvitationStub.resolves(undefined);

      let invitation = await accountService.inviteNewAccount(regularUser,'test_email','test_message');
      expect(invitation.email).toBe('test_email');
      expect(sendInviteStub.called).toBe(true);
      expect(saveInviteStub.called).toBe(true);
    }
    else {
      // For modes that should deny invitations, expect an error
      await expect(accountService.inviteNewAccount(regularUser,'test_email','test_message')).rejects
        .toThrow(AccountInvitationPermissionError);
    }
  });

  it('should store calendar_id when creating calendar editor invitation', async () => {
    let getAccountStub = sandbox.stub(accountService, 'getAccountByEmail');
    let findInvitationStub = sandbox.stub(AccountInvitationEntity, 'findOne');
    let sendInviteStub = sandbox.stub(accountService,'sendNewAccountInvite');
    let saveInviteStub = sandbox.stub(AccountInvitationEntity.prototype, 'save');
    let getAllSettingsStub = sandbox.stub(ConfigurationInterface.prototype, 'getAllSettings');

    getAllSettingsStub.resolves({ registrationMode: 'invitation' });
    getAccountStub.resolves(undefined);
    findInvitationStub.resolves(undefined);

    const calendarId = 'test-calendar-id';
    const invitation = await accountService.inviteNewAccount(adminUser,'test_email','test_message', calendarId);

    expect(invitation.email).toBe('test_email');
    expect(invitation.calendarId).toBe(calendarId);
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

    await expect(accountService.validateInviteCode('test_code')).rejects.toThrow(noAccountInviteExistsError);
  });

  it('invite expired with null time', async () => {
    let findInviteStub = validateSandbox.stub(AccountInvitationEntity, 'findOne');

    findInviteStub.resolves(AccountInvitationEntity.build({
      invitation_code: 'test_code',
      expiration_time: null,
    }));
    await expect(accountService.validateInviteCode('test_code')).rejects.toThrow(noAccountInviteExistsError);
  });

  it('invite expired with past time', async () => {
    let findInviteStub = validateSandbox.stub(AccountInvitationEntity, 'findOne');

    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1); // yesterday

    findInviteStub.resolves(AccountInvitationEntity.build({
      invitation_code: 'test_code',
      expiration_time: pastDate,
    }));
    await expect(accountService.validateInviteCode('test_code')).rejects.toThrow(noAccountInviteExistsError);
  });

  it('invite valid', async () => {
    let findInviteStub = validateSandbox.stub(AccountInvitationEntity, 'findOne');

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 1); // tomorrow

    const mockInvitation = AccountInvitationEntity.build({
      invitation_code: 'test_code',
      expiration_time: futureDate,
    });

    findInviteStub.resolves(mockInvitation);

    await expect(accountService.validateInviteCode('test_code')).resolves.toBe(mockInvitation);
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
    // Set up validateInviteCode to throw exception (expired or invalid)
    let validateStub = acceptSandbox.stub(accountService, 'validateInviteCode');
    validateStub.rejects(new noAccountInviteExistsError());

    await expect(accountService.acceptAccountInvite('test_code', 'test_password'))
      .rejects.toThrow(noAccountInviteExistsError);

    expect(setupAccountStub.called).toBe(false);
    expect(destroyStub.called).toBe(false);
  });

  it('accepts valid invitation and creates account', async () => {
    // Mock the invitation entity
    const mockInvitation = AccountInvitationEntity.build({
      email: 'test@example.com',
      invitation_code: 'test_code',
      calendar_id: null,
    });

    // Set up validateInviteCode to return the invitation (valid)
    let validateStub = acceptSandbox.stub(accountService, 'validateInviteCode');
    validateStub.resolves(mockInvitation);

    // Mock findAll to return this invitation (needed since acceptAccountInvite now retrieves all invitations)
    let findAllStub = acceptSandbox.stub(AccountInvitationEntity, 'findAll');
    findAllStub.resolves([mockInvitation]);

    // Mock destroy static method (for cleaning up all invitations)
    let destroyStub = acceptSandbox.stub(AccountInvitationEntity, 'destroy').resolves(1);

    // Mock account creation
    let setupAccountStub = acceptSandbox.stub(accountService, '_setupAccount');
    setupAccountStub.resolves({
      account: new Account('id', 'test@example.com', 'testme'),
      password_code: '',
    });

    const result = await accountService.acceptAccountInvite('test_code', 'test_password');

    expect(setupAccountStub.called).toBe(true);
    expect(destroyStub.called).toBe(true);
    expect(result).toBeTruthy();
  });

  it('accepts valid invitation with calendar_id and grants editor access', async () => {
    // Mock the invitation entity with a calendar_id
    const invitation = AccountInvitationEntity.build({
      invitation_code: 'test_code',
      email: 'test_email@example.com',
      calendar_id: 'test-calendar-id',
      invited_by: 'inviter-id',
    });

    // Set up validateInviteCode to return the invitation (valid)
    let validateStub = acceptSandbox.stub(accountService, 'validateInviteCode');
    validateStub.resolves(invitation);

    // Mock findAll to return this invitation
    let findAllStub = acceptSandbox.stub(AccountInvitationEntity, 'findAll');
    findAllStub.resolves([invitation]);

    // Mock destroy method
    let destroyStub = acceptSandbox.stub(AccountInvitationEntity, 'destroy').resolves();

    // Mock _setupAccount
    let setupAccountStub = acceptSandbox.stub(accountService, '_setupAccount');
    const testAccount = new Account('new-account-id', 'test_email@example.com', 'testme');
    setupAccountStub.resolves({
      account: testAccount,
      password_code: '',
    });

    // Mock getAccountById for the inviter
    let getAccountStub = acceptSandbox.stub(accountService, 'getAccountById');
    const inviterAccount = new Account('inviter-id', 'inviter@example.com', 'inviter');
    getAccountStub.withArgs('inviter-id').resolves(inviterAccount);

    // Mock CalendarInterface to verify it gets called
    const mockCalendarInterface = {
      grantEditAccess: acceptSandbox.stub().resolves(),
    };

    // Override the accountService to inject our mock CalendarInterface
    (accountService as any).calendarInterface = mockCalendarInterface;

    const result = await accountService.acceptAccountInvite('test_code', 'test_password');

    expect(setupAccountStub.called).toBe(true);
    expect(destroyStub.called).toBe(true);
    expect(result).toBeTruthy();
    expect(mockCalendarInterface.grantEditAccess.calledOnce).toBe(true);
    expect(mockCalendarInterface.grantEditAccess.calledWith(
      inviterAccount,
      'test-calendar-id',
      testAccount.id,
    )).toBe(true);
  });

  it('accepts valid invitation without calendar_id and does not grant editor access', async () => {
    // Mock the invitation entity without calendar_id
    const invitation = AccountInvitationEntity.build({
      invitation_code: 'test_code',
      email: 'test_email@example.com',
      calendar_id: null,
    });

    // Set up validateInviteCode to return the invitation (valid)
    let validateStub = acceptSandbox.stub(accountService, 'validateInviteCode');
    validateStub.resolves(invitation);

    // Mock findAll to return this invitation
    let findAllStub = acceptSandbox.stub(AccountInvitationEntity, 'findAll');
    findAllStub.resolves([invitation]);

    // Mock destroy method
    let destroyStub = acceptSandbox.stub(AccountInvitationEntity, 'destroy').resolves();

    // Mock _setupAccount
    let setupAccountStub = acceptSandbox.stub(accountService, '_setupAccount');
    const testAccount = new Account('new-account-id', 'test_email@example.com', 'testme');
    setupAccountStub.resolves({
      account: testAccount,
      password_code: '',
    });

    // Mock CalendarInterface to verify it does NOT get called
    const mockCalendarInterface = {
      grantEditAccess: acceptSandbox.stub().resolves(),
    };

    // Override the accountService to inject our mock CalendarInterface
    (accountService as any).calendarInterface = mockCalendarInterface;

    const result = await accountService.acceptAccountInvite('test_code', 'test_password');

    expect(setupAccountStub.called).toBe(true);
    expect(destroyStub.called).toBe(true);
    expect(result).toBeTruthy();
    expect(mockCalendarInterface.grantEditAccess.called).toBe(false);
  });

  it('accepts invitation and grants access to multiple calendars for same email', async () => {
    // Mock the primary invitation entity with a calendar_id
    const primaryInvitation = AccountInvitationEntity.build({
      invitation_code: 'test_code',
      email: 'test_email@example.com',
      calendar_id: 'calendar-1',
      invited_by: 'inviter-1',
    });

    // Set up validateInviteCode to return the invitation (valid)
    let validateStub = acceptSandbox.stub(accountService, 'validateInviteCode');
    validateStub.resolves(primaryInvitation);

    // Mock findAll to return multiple invitations for the same email
    let findAllStub = acceptSandbox.stub(AccountInvitationEntity, 'findAll');
    const invitation2 = AccountInvitationEntity.build({
      email: 'test_email@example.com',
      calendar_id: 'calendar-2',
      invited_by: 'inviter-2',
    });
    const invitation3 = AccountInvitationEntity.build({
      email: 'test_email@example.com',
      calendar_id: null, // Non-calendar invitation
      invited_by: 'inviter-1',
    });
    findAllStub.resolves([primaryInvitation, invitation2, invitation3]);

    // Mock destroy method
    let destroyStub = acceptSandbox.stub(AccountInvitationEntity, 'destroy').resolves();

    // Mock _setupAccount
    let setupAccountStub = acceptSandbox.stub(accountService, '_setupAccount');
    const testAccount = new Account('new-account-id', 'test_email@example.com', 'testme');
    setupAccountStub.resolves({
      account: testAccount,
      password_code: '',
    });

    // Mock getAccountById for the inviters
    let getAccountStub = acceptSandbox.stub(accountService, 'getAccountById');
    const inviter1 = new Account('inviter-1', 'inviter1@example.com', 'inviter1');
    const inviter2 = new Account('inviter-2', 'inviter2@example.com', 'inviter2');
    getAccountStub.withArgs('inviter-1').resolves(inviter1);
    getAccountStub.withArgs('inviter-2').resolves(inviter2);

    // Mock CalendarInterface to verify it gets called for both calendars
    const mockCalendarInterface = {
      grantEditAccess: acceptSandbox.stub().resolves(),
    };

    // Override the accountService to inject our mock CalendarInterface
    (accountService as any).calendarInterface = mockCalendarInterface;

    const result = await accountService.acceptAccountInvite('test_code', 'test_password');

    expect(setupAccountStub.called).toBe(true);
    expect(destroyStub.called).toBe(true);
    expect(result).toBeTruthy();

    // Should be called twice for the two calendar invitations
    expect(mockCalendarInterface.grantEditAccess.calledTwice).toBe(true);
    expect(mockCalendarInterface.grantEditAccess.calledWith(
      inviter1,
      'calendar-1',
      testAccount.id,
    )).toBe(true);
    expect(mockCalendarInterface.grantEditAccess.calledWith(
      inviter2,
      'calendar-2',
      testAccount.id,
    )).toBe(true);

    // Verify all invitations are cleaned up
    expect(destroyStub.calledWith({
      where: { email: 'test_email@example.com' },
    })).toBe(true);
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

describe('listInvitations', () => {

  let sandbox = sinon.createSandbox();
  let accountService: AccountService;
  let findAllStub: sinon.SinonStub;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    accountService = new AccountService(eventBus, configurationInterface);
    findAllStub = sandbox.stub(AccountInvitationEntity, 'findAll');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return all invitations when no filters provided', async () => {
    const mockInvitations = [
      {
        id: 'inv1',
        email: 'user1@test.com',
        invited_by: 'admin1',
        calendar_id: null,
        created_at: new Date('2025-10-01'),
        toModel: () => ({ id: 'inv1', email: 'user1@test.com' }),
      },
      {
        id: 'inv2',
        email: 'user2@test.com',
        invited_by: 'admin1',
        calendar_id: 'cal1',
        created_at: new Date('2025-09-30'),
        toModel: () => ({ id: 'inv2', email: 'user2@test.com' }),
      },
    ];

    findAllStub.resolves(mockInvitations);

    const result = await accountService.listInvitations();

    expect(result).toHaveLength(2);
    expect(findAllStub.calledOnce).toBe(true);
    expect(findAllStub.firstCall.args[0]).toEqual({
      where: {},
      order: [['createdAt', 'DESC']],
      include: [{
        model: AccountEntity,
        as: 'inviter',
      }],
    });
  });

  it('should filter by inviterId when provided', async () => {
    const mockInvitations = [
      {
        id: 'inv1',
        email: 'user1@test.com',
        invited_by: 'user123',
        calendar_id: null,
        created_at: new Date('2025-10-01'),
        toModel: () => ({ id: 'inv1', email: 'user1@test.com' }),
      },
    ];

    findAllStub.resolves(mockInvitations);

    const result = await accountService.listInvitations('user123');

    expect(result).toHaveLength(1);
    expect(findAllStub.calledOnce).toBe(true);
    expect(findAllStub.firstCall.args[0]).toEqual({
      where: { invited_by: 'user123' },
      order: [['createdAt', 'DESC']],
      include: [{
        model: AccountEntity,
        as: 'inviter',
      }],
    });
  });

  it('should filter by calendarId when provided', async () => {
    const mockInvitations = [
      {
        id: 'inv1',
        email: 'editor@test.com',
        invited_by: 'owner123',
        calendar_id: 'cal456',
        created_at: new Date('2025-10-01'),
        toModel: () => ({ id: 'inv1', email: 'editor@test.com' }),
      },
    ];

    findAllStub.resolves(mockInvitations);

    const result = await accountService.listInvitations(undefined, 'cal456');

    expect(result).toHaveLength(1);
    expect(findAllStub.calledOnce).toBe(true);
    expect(findAllStub.firstCall.args[0]).toEqual({
      where: { calendar_id: 'cal456' },
      order: [['createdAt', 'DESC']],
      include: [{
        model: AccountEntity,
        as: 'inviter',
      }],
    });
  });

  it('should filter by both inviterId and calendarId when both provided', async () => {
    const mockInvitations = [
      {
        id: 'inv1',
        email: 'editor@test.com',
        invited_by: 'owner123',
        calendar_id: 'cal456',
        created_at: new Date('2025-10-01'),
        toModel: () => ({ id: 'inv1', email: 'editor@test.com' }),
      },
    ];

    findAllStub.resolves(mockInvitations);

    const result = await accountService.listInvitations('owner123', 'cal456');

    expect(result).toHaveLength(1);
    expect(findAllStub.calledOnce).toBe(true);
    expect(findAllStub.firstCall.args[0]).toEqual({
      where: {
        invited_by: 'owner123',
        calendar_id: 'cal456',
      },
      order: [['createdAt', 'DESC']],
      include: [{
        model: AccountEntity,
        as: 'inviter',
      }],
    });
  });

  it('should order results by created_at DESC', async () => {
    const mockInvitations = [
      {
        id: 'inv1',
        email: 'user1@test.com',
        invited_by: 'admin1',
        calendar_id: null,
        created_at: new Date('2025-10-01'),
        toModel: () => ({ id: 'inv1', email: 'user1@test.com' }),
      },
      {
        id: 'inv2',
        email: 'user2@test.com',
        invited_by: 'admin1',
        calendar_id: null,
        created_at: new Date('2025-09-30'),
        toModel: () => ({ id: 'inv2', email: 'user2@test.com' }),
      },
    ];

    findAllStub.resolves(mockInvitations);

    await accountService.listInvitations();

    const callArgs = findAllStub.firstCall.args[0];
    expect(callArgs.order).toEqual([['createdAt', 'DESC']]);
  });

  it('should include inviter relation', async () => {
    findAllStub.resolves([]);

    await accountService.listInvitations();

    const callArgs = findAllStub.firstCall.args[0];
    expect(callArgs.include).toEqual([{
      model: AccountEntity,
      as: 'inviter',
    }]);
  });

  it('should return empty array when no invitations found', async () => {
    findAllStub.resolves([]);

    const result = await accountService.listInvitations();

    expect(result).toEqual([]);
    expect(result).toHaveLength(0);
  });

});
