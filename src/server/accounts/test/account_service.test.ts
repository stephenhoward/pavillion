import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import sinon from 'sinon';

import { Account } from '@/common/model/account';
import { AccountEntity, AccountSecretsEntity, AccountApplicationEntity, AccountRoleEntity } from '@/server/common/entity/account';
import AccountInvitationEntity from '@/server/accounts/entity/account_invitation';
import EmailInterface from '@/server/email/interface';
import ServiceSettings from '@/server/configuration/service/settings';
import AccountService from '@/server/accounts/service/account';
import { AccountAlreadyExistsError, AccountInviteAlreadyExistsError, AccountRegistrationClosedError, AccountApplicationsClosedError, noAccountInviteExistsError, noAccountApplicationExistsError, AccountInvitationPermissionError } from '@/server/accounts/exceptions';
import { ValidationError } from '@/common/exceptions/base';
import { initI18Next } from '@/server/common/test/lib/i18next';
import EventEmitter from 'events';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';

initI18Next();

describe('inviteNewAccount', () => {

  let sandbox = sinon.createSandbox();
  let accountService: AccountService;
  let adminUser: Account;
  let emailInterface: EmailInterface;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    emailInterface = new EmailInterface();
    accountService = new AccountService(eventBus, configurationInterface, setupInterface, emailInterface);
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
    getAccountStub.resolves(new Account('id', 'test_user', 'testme'));

    await expect( accountService.inviteNewAccount(adminUser,'test@example.com','test_message')).rejects
      .toThrow(AccountAlreadyExistsError);
  });

  it('should throw AccountInviteAlreadyExistsError if invitation already exists', async () => {
    let getAccountStub = sandbox.stub(accountService, 'getAccountByEmail');
    let findInviteStub = sandbox.stub(AccountInvitationEntity, 'findOne');
    let getAllSettingsStub = sandbox.stub(ConfigurationInterface.prototype, 'getAllSettings');

    getAllSettingsStub.resolves({ registrationMode: 'invitation' });
    getAccountStub.resolves(undefined);
    findInviteStub.resolves(AccountInvitationEntity.build({ email: 'test@example.com' }));
    await expect(accountService.inviteNewAccount(adminUser,'test@example.com','test_message')).rejects
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

    let invitation = await accountService.inviteNewAccount(adminUser,'test@example.com','test_message');
    expect(invitation.email).toBe('test@example.com');
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

      let invitation = await accountService.inviteNewAccount(regularUser,'test@example.com','test_message');
      expect(invitation.email).toBe('test@example.com');
      expect(sendInviteStub.called).toBe(true);
      expect(saveInviteStub.called).toBe(true);
    }
    else {
      // For modes that should deny invitations, expect an error
      await expect(accountService.inviteNewAccount(regularUser,'test@example.com','test_message')).rejects
        .toThrow(AccountInvitationPermissionError);
    }
  });

  it('should throw ValidationError with email field error for invalid email format', async () => {
    const error = await accountService.inviteNewAccount(adminUser, 'not-an-email', 'test_message')
      .catch(e => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toHaveProperty('email');
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
    const invitation = await accountService.inviteNewAccount(adminUser,'test@example.com','test_message', calendarId);

    expect(invitation.email).toBe('test@example.com');
    expect(invitation.calendarId).toBe(calendarId);
    expect(sendInviteStub.called).toBe(true);
    expect(saveInviteStub.called).toBe(true);
  });
});

describe('registerNewAccount', () => {

  let sandbox = sinon.createSandbox();
  let accountService: AccountService;
  let emailInterface: EmailInterface;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    emailInterface = new EmailInterface();
    accountService = new AccountService(eventBus, configurationInterface, setupInterface, emailInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should throw ValidationError with email field error for invalid email format', async () => {
    const error = await accountService.registerNewAccount('not-an-email')
      .catch(e => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toHaveProperty('email');
  });

  it('no registration allowed', async () => {
    let getSettingStub = sandbox.stub(ServiceSettings.prototype, 'get');
    let initSettingsStub = sandbox.stub(ServiceSettings.prototype, 'init');
    let emailStub = sandbox.stub(emailInterface, 'sendEmail');

    for (let mode of ['closed', 'apply', 'invite']) {
      getSettingStub.withArgs('registrationMode').returns(mode);
      await expect(accountService.registerNewAccount('test@example.com')).rejects
        .toThrow(AccountRegistrationClosedError);
      expect(emailStub.called).toBe(false);
    }
    expect(initSettingsStub.called).toBe(true);
  });

  it('open registration', async () => {
    let getSettingStub = sandbox.stub(ServiceSettings.prototype, 'get');
    let setupAccountStub = sandbox.stub(accountService, '_setupAccount');
    let emailStub = sandbox.stub(emailInterface, 'sendEmail');

    getSettingStub.withArgs('registrationMode').returns('open');
    setupAccountStub.resolves({ account: new Account('id', 'testme', 'test@example.com'), password_code: 'test_code' });

    let account = await accountService.registerNewAccount('test@example.com');

    expect(account.email).toBe('test@example.com');
    expect(emailStub.called).toBe(true);
  });

  it('sends notification email when account already exists', async () => {
    let getSettingStub = sandbox.stub(ServiceSettings.prototype, 'get');
    let setupAccountStub = sandbox.stub(accountService, '_setupAccount');
    let getAccountStub = sandbox.stub(accountService, 'getAccountByEmail');
    let emailStub = sandbox.stub(emailInterface, 'sendEmail');

    getSettingStub.withArgs('registrationMode').returns('open');
    setupAccountStub.rejects(new AccountAlreadyExistsError());

    const existingAccount = new Account('existing-id', 'existinguser', 'test@example.com');
    existingAccount.language = 'fr';
    getAccountStub.resolves(existingAccount);

    await expect(accountService.registerNewAccount('test@example.com')).rejects
      .toThrow(AccountAlreadyExistsError);

    expect(emailStub.calledOnce).toBe(true);
    const mailData = emailStub.firstCall.args[0];
    expect(mailData.emailAddress).toBe('test@example.com');
  });
});

describe('applyForNewAccount', () => {
  let applySandbox = sinon.createSandbox();
  let accountService: AccountService;
  let emailInterface: EmailInterface;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    emailInterface = new EmailInterface();
    accountService = new AccountService(eventBus, configurationInterface, setupInterface, emailInterface);
  });

  afterEach(() => {
    applySandbox.restore();
  });

  it('should throw ValidationError with email field error for invalid email format', async () => {
    const error = await accountService.applyForNewAccount('not-an-email', 'test_message')
      .catch(e => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toHaveProperty('email');
  });

  it('no applications allowed', async () => {
    let getSettingStub = applySandbox.stub(ServiceSettings.prototype, 'get');

    for (let mode of ['closed', 'open', 'invite']) {
      getSettingStub.withArgs('registrationMode').returns(mode);
      await expect(accountService.applyForNewAccount('test@example.com','test_message')).rejects
        .toThrow(AccountApplicationsClosedError);
    }
  });

  // Branch 1: no existing account, no existing application — happy path.
  it('Branch 1: creates pending_confirmation row with token + expiration and sends confirmation email', async () => {
    const getAllSettingsStub = applySandbox.stub(ConfigurationInterface.prototype, 'getAllSettings');
    const getAccountByEmailStub = applySandbox.stub(accountService, 'getAccountByEmail');
    const findApplicationStub = applySandbox.stub(AccountApplicationEntity, 'findOne');
    const buildSpy = applySandbox.spy(AccountApplicationEntity, 'build');
    const saveApplicationStub = applySandbox.stub(AccountApplicationEntity.prototype, 'save').resolves();
    const emailStub = applySandbox.stub(emailInterface, 'sendEmail').resolves();

    getAllSettingsStub.resolves({ registrationMode: 'apply' });
    getAccountByEmailStub.resolves(undefined);
    findApplicationStub.resolves(undefined);

    const before = Date.now();
    const result = await accountService.applyForNewAccount('newuser@example.com','I would like to apply');
    const after = Date.now();

    expect(result).toBe(true);
    expect(saveApplicationStub.called).toBe(true);
    expect(emailStub.calledOnce).toBe(true);

    // Verify the entity was built with pending_confirmation status + token + expiration
    expect(buildSpy.calledOnce).toBe(true);
    const buildArgs = buildSpy.firstCall.args[0] as Record<string, unknown>;
    expect(buildArgs.email).toBe('newuser@example.com');
    expect(buildArgs.status).toBe('pending_confirmation');
    expect(buildArgs.message).toBe('I would like to apply');

    // Token primitive: randomBytes(16).toString('hex') = 32 hex chars
    expect(buildArgs.confirmation_token).toMatch(/^[0-9a-f]{32}$/);

    // Expiration is ~7 days from now (within a few seconds tolerance)
    const expiration = buildArgs.confirmation_token_expiration as Date;
    expect(expiration).toBeInstanceOf(Date);
    const expirationMs = expiration.getTime();
    const expectedMin = before + 7 * 24 * 60 * 60 * 1000 - 5000;
    const expectedMax = after + 7 * 24 * 60 * 60 * 1000 + 5000;
    expect(expirationMs).toBeGreaterThanOrEqual(expectedMin);
    expect(expirationMs).toBeLessThanOrEqual(expectedMax);

    // The confirmation email must be addressed to the applicant
    const sentMail = emailStub.firstCall.args[0];
    expect(sentMail.emailAddress).toBe('newuser@example.com');
  });

  // Branch 2: re-applying while still pending_confirmation regenerates the
  // token, resets the expiration, refreshes the message, and resends.
  it('Branch 2: resubmit on pending_confirmation regenerates token, resets expiration, and resends confirmation email', async () => {
    const originalToken = 'a'.repeat(32);
    const originalExpiration = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1hr from now
    const existing = AccountApplicationEntity.build({
      id: 'existing-id',
      email: 'resubmit@example.com',
      message: 'Original message',
      status: 'pending_confirmation',
      status_timestamp: new Date(Date.now() - 60 * 60 * 1000),
      confirmation_token: originalToken,
      confirmation_token_expiration: originalExpiration,
    });

    const saveStub = applySandbox.stub(existing, 'save').resolves();
    const getAllSettingsStub = applySandbox.stub(ConfigurationInterface.prototype, 'getAllSettings');
    const getAccountByEmailStub = applySandbox.stub(accountService, 'getAccountByEmail');
    const findApplicationStub = applySandbox.stub(AccountApplicationEntity, 'findOne');
    const emailStub = applySandbox.stub(emailInterface, 'sendEmail').resolves();

    getAllSettingsStub.resolves({ registrationMode: 'apply' });
    getAccountByEmailStub.resolves(undefined);
    findApplicationStub.resolves(existing);

    const before = Date.now();
    const result = await accountService.applyForNewAccount('resubmit@example.com', 'Refreshed message');
    const after = Date.now();

    expect(result).toBe(true);
    expect(saveStub.calledOnce).toBe(true);
    expect(emailStub.calledOnce).toBe(true);

    // Token must be regenerated (not the same as the original)
    expect(existing.confirmation_token).not.toBe(originalToken);
    expect(existing.confirmation_token).toMatch(/^[0-9a-f]{32}$/);

    // Expiration is reset to ~7 days from now (not the old 1hr expiration)
    expect(existing.confirmation_token_expiration).not.toBe(originalExpiration);
    const newExpirationMs = (existing.confirmation_token_expiration as Date).getTime();
    expect(newExpirationMs).toBeGreaterThanOrEqual(before + 7 * 24 * 60 * 60 * 1000 - 5000);
    expect(newExpirationMs).toBeLessThanOrEqual(after + 7 * 24 * 60 * 60 * 1000 + 5000);

    // Message refreshed
    expect(existing.message).toBe('Refreshed message');

    // Confirmation email sent to the applicant
    const sentMail = emailStub.firstCall.args[0];
    expect(sentMail.emailAddress).toBe('resubmit@example.com');
  });

  // Branch 3: existing application in `pending` — silently swallowed; still
  // performs DB + email work for timing parity.
  it('Branch 3: dup pending application silently swallows error and performs real DB + email work', async () => {
    const buildSpy = applySandbox.spy(AccountApplicationEntity, 'build');
    const existing = AccountApplicationEntity.build({
      id: 'existing-id',
      email: 'pending@example.com',
      message: 'Original',
      status: 'pending',
      status_timestamp: new Date(Date.now() - 60 * 60 * 1000),
    });
    buildSpy.resetHistory();

    const saveStub = applySandbox.stub(existing, 'save').resolves();
    const getAllSettingsStub = applySandbox.stub(ConfigurationInterface.prototype, 'getAllSettings');
    const getAccountByEmailStub = applySandbox.stub(accountService, 'getAccountByEmail');
    const findApplicationStub = applySandbox.stub(AccountApplicationEntity, 'findOne');
    const emailStub = applySandbox.stub(emailInterface, 'sendEmail').resolves();

    getAllSettingsStub.resolves({ registrationMode: 'apply' });
    getAccountByEmailStub.resolves(undefined);
    findApplicationStub.resolves(existing);

    const result = await accountService.applyForNewAccount('pending@example.com', 'Resubmit message');

    // Identical success shape, no error propagated
    expect(result).toBe(true);

    // Real DB work: row was touched + saved (no new row created)
    expect(saveStub.calledOnce).toBe(true);
    expect(buildSpy.called).toBe(false);

    // Real email work
    expect(emailStub.calledOnce).toBe(true);

    // Status not flipped (admin queue unchanged)
    expect(existing.status).toBe('pending');
  });

  // Branch 4: existing application in `rejected` — silently swallowed; still
  // performs DB + email work for timing parity.
  it('Branch 4: dup rejected application silently swallows error and performs real DB + email work', async () => {
    const buildSpy = applySandbox.spy(AccountApplicationEntity, 'build');
    const existing = AccountApplicationEntity.build({
      id: 'existing-id',
      email: 'rejected@example.com',
      message: 'Original',
      status: 'rejected',
      status_timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    buildSpy.resetHistory();

    const saveStub = applySandbox.stub(existing, 'save').resolves();
    const getAllSettingsStub = applySandbox.stub(ConfigurationInterface.prototype, 'getAllSettings');
    const getAccountByEmailStub = applySandbox.stub(accountService, 'getAccountByEmail');
    const findApplicationStub = applySandbox.stub(AccountApplicationEntity, 'findOne');
    const emailStub = applySandbox.stub(emailInterface, 'sendEmail').resolves();

    getAllSettingsStub.resolves({ registrationMode: 'apply' });
    getAccountByEmailStub.resolves(undefined);
    findApplicationStub.resolves(existing);

    const result = await accountService.applyForNewAccount('rejected@example.com', 'Resubmit');

    expect(result).toBe(true);
    expect(saveStub.calledOnce).toBe(true);
    expect(buildSpy.called).toBe(false);
    expect(emailStub.calledOnce).toBe(true);

    // Status not flipped — admin's rejection decision is preserved
    expect(existing.status).toBe('rejected');
  });

  // Branch 5: existing account — silently swallowed; emails the existing
  // account owner via AccountAlreadyExistsEmail (mirrors registerNewAccount).
  it('Branch 5: existing account silently swallows error and emails the existing account owner', async () => {
    const buildSpy = applySandbox.spy(AccountApplicationEntity, 'build');
    const saveStub = applySandbox.stub(AccountApplicationEntity.prototype, 'save').resolves();
    const getAllSettingsStub = applySandbox.stub(ConfigurationInterface.prototype, 'getAllSettings');
    const getAccountByEmailStub = applySandbox.stub(accountService, 'getAccountByEmail');
    const findApplicationStub = applySandbox.stub(AccountApplicationEntity, 'findOne');
    const emailStub = applySandbox.stub(emailInterface, 'sendEmail').resolves();

    getAllSettingsStub.resolves({ registrationMode: 'apply' });
    const existingAccount = new Account('account-id', 'existinguser', 'existing@example.com');
    existingAccount.language = 'fr';
    getAccountByEmailStub.resolves(existingAccount);
    findApplicationStub.resolves(undefined);

    const result = await accountService.applyForNewAccount('existing@example.com', 'I want to apply');

    // Identical success shape, no error propagated
    expect(result).toBe(true);

    // No new application row created
    expect(buildSpy.called).toBe(false);
    expect(saveStub.called).toBe(false);

    // Real email work — addressed to the account owner
    expect(emailStub.calledOnce).toBe(true);
    const sentMail = emailStub.firstCall.args[0];
    expect(sentMail.emailAddress).toBe('existing@example.com');
  });
});

describe('confirmAccountApplication', () => {
  let confirmSandbox = sinon.createSandbox();
  let accountService: AccountService;
  let emailInterface: EmailInterface;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    emailInterface = new EmailInterface();
    accountService = new AccountService(eventBus, configurationInterface, setupInterface, emailInterface);
  });

  afterEach(() => {
    confirmSandbox.restore();
  });

  // Happy path: valid token consumes, flips status, clears fields, sends ack.
  it('happy path: consumes token, flips status, clears fields, sends acknowledgment email', async () => {
    const token = 'a'.repeat(32);
    const futureExpiration = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);
    const application = AccountApplicationEntity.build({
      id: 'app-id',
      email: 'applicant@example.com',
      message: 'I would like to apply',
      status: 'pending_confirmation',
      status_timestamp: new Date(Date.now() - 60 * 1000),
      confirmation_token: token,
      confirmation_token_expiration: futureExpiration,
    });

    const findOneStub = confirmSandbox.stub(AccountApplicationEntity, 'findOne');
    findOneStub.resolves(application);
    const updateStub = confirmSandbox.stub(AccountApplicationEntity, 'update').resolves([1] as unknown as [number]);
    const emailStub = confirmSandbox.stub(emailInterface, 'sendEmail').resolves();

    const result = await accountService.confirmAccountApplication(token);

    expect(result).toBe(true);

    // Atomic update was called with the correct WHERE clause + payload
    expect(updateStub.calledOnce).toBe(true);
    const [updatePayload, updateOptions] = updateStub.firstCall.args as [Record<string, unknown>, { where: Record<string, unknown> }];
    expect(updatePayload.status).toBe('pending');
    expect(updatePayload.confirmation_token).toBe(null);
    expect(updatePayload.confirmation_token_expiration).toBe(null);
    expect(updateOptions.where.id).toBe('app-id');
    expect(updateOptions.where.confirmation_token).toBe(token);
    expect(updateOptions.where.status).toBe('pending_confirmation');

    // Acknowledgment email sent to the applicant
    expect(emailStub.calledOnce).toBe(true);
    const sentMail = emailStub.firstCall.args[0];
    expect(sentMail.emailAddress).toBe('applicant@example.com');
  });

  // Terminal failure: token not found
  it('returns false when token not found', async () => {
    const findOneStub = confirmSandbox.stub(AccountApplicationEntity, 'findOne');
    const updateStub = confirmSandbox.stub(AccountApplicationEntity, 'update');
    const emailStub = confirmSandbox.stub(emailInterface, 'sendEmail').resolves();

    findOneStub.resolves(null);

    const confirmResult = await accountService.confirmAccountApplication('no-such-token');
    expect(confirmResult).toBe(false);
    expect(updateStub.called).toBe(false);
    expect(emailStub.called).toBe(false);
  });

  // Terminal failure: empty/missing token
  it('returns false when token is empty string', async () => {
    const findOneStub = confirmSandbox.stub(AccountApplicationEntity, 'findOne');
    const emailStub = confirmSandbox.stub(emailInterface, 'sendEmail').resolves();

    const confirmResult = await accountService.confirmAccountApplication('');
    expect(confirmResult).toBe(false);

    // No DB or email work attempted on empty token
    expect(findOneStub.called).toBe(false);
    expect(emailStub.called).toBe(false);
  });

  // Terminal failure: token expired (verifies fields are cleared on expiry detection)
  it('returns false when token is expired and clears the token fields', async () => {
    const token = 'b'.repeat(32);
    const expiredAt = new Date(Date.now() - 60 * 1000); // 1 minute ago
    const application = AccountApplicationEntity.build({
      id: 'app-id',
      email: 'applicant@example.com',
      status: 'pending_confirmation',
      status_timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      confirmation_token: token,
      confirmation_token_expiration: expiredAt,
    });

    const saveStub = confirmSandbox.stub(application, 'save').resolves();
    const findOneStub = confirmSandbox.stub(AccountApplicationEntity, 'findOne');
    const updateStub = confirmSandbox.stub(AccountApplicationEntity, 'update');
    const emailStub = confirmSandbox.stub(emailInterface, 'sendEmail').resolves();

    findOneStub.resolves(application);

    const result = await accountService.confirmAccountApplication(token);

    expect(result).toBe(false);

    // Token fields are cleared on expiry detection
    expect(application.confirmation_token).toBe(null);
    expect(application.confirmation_token_expiration).toBe(null);
    expect(saveStub.calledOnce).toBe(true);

    // No atomic update + no acknowledgment email
    expect(updateStub.called).toBe(false);
    expect(emailStub.called).toBe(false);

    // Status is left as pending_confirmation so the applicant can re-apply
    expect(application.status).toBe('pending_confirmation');
  });

  // Boundary: 1 second past expiration → fails
  it('returns false at expiration boundary (1 second past expiration)', async () => {
    const token = 'c'.repeat(32);
    const expiredAt = new Date(Date.now() - 1000); // exactly 1 second past
    const application = AccountApplicationEntity.build({
      id: 'app-id',
      email: 'applicant@example.com',
      status: 'pending_confirmation',
      status_timestamp: new Date(),
      confirmation_token: token,
      confirmation_token_expiration: expiredAt,
    });
    confirmSandbox.stub(application, 'save').resolves();

    const findOneStub = confirmSandbox.stub(AccountApplicationEntity, 'findOne');
    const updateStub = confirmSandbox.stub(AccountApplicationEntity, 'update');

    findOneStub.resolves(application);

    const confirmResult = await accountService.confirmAccountApplication(token);
    expect(confirmResult).toBe(false);
    expect(updateStub.called).toBe(false);
  });

  // Terminal failure: status not pending_confirmation (covers double-consume
  // where token is null AND admin-rejected). Both cases collapse to identical
  // false because the lookup-by-token would either miss (null token) or hit
  // a non-pending_confirmation row.
  it('returns false when status is not pending_confirmation (already-pending case)', async () => {
    const token = 'd'.repeat(32);
    // Simulate a row whose status was somehow flipped to 'pending' but the
    // token is still set (defensive: should not happen given consume nulls
    // the token, but the guard is real).
    const application = AccountApplicationEntity.build({
      id: 'app-id',
      email: 'applicant@example.com',
      status: 'pending',
      status_timestamp: new Date(),
      confirmation_token: token,
      confirmation_token_expiration: new Date(Date.now() + 60 * 60 * 1000),
    });

    const findOneStub = confirmSandbox.stub(AccountApplicationEntity, 'findOne');
    const updateStub = confirmSandbox.stub(AccountApplicationEntity, 'update');
    const emailStub = confirmSandbox.stub(emailInterface, 'sendEmail').resolves();

    findOneStub.resolves(application);

    const result = await accountService.confirmAccountApplication(token);
    expect(result).toBe(false);

    // No update + no email
    expect(updateStub.called).toBe(false);
    expect(emailStub.called).toBe(false);
  });

  it('returns false when status is rejected (admin-rejected case)', async () => {
    const token = 'e'.repeat(32);
    const application = AccountApplicationEntity.build({
      id: 'app-id',
      email: 'applicant@example.com',
      status: 'rejected',
      status_timestamp: new Date(),
      confirmation_token: token,
      confirmation_token_expiration: new Date(Date.now() + 60 * 60 * 1000),
    });

    const findOneStub = confirmSandbox.stub(AccountApplicationEntity, 'findOne');
    const updateStub = confirmSandbox.stub(AccountApplicationEntity, 'update');
    const emailStub = confirmSandbox.stub(emailInterface, 'sendEmail').resolves();

    findOneStub.resolves(application);

    const result = await accountService.confirmAccountApplication(token);
    expect(result).toBe(false);

    expect(updateStub.called).toBe(false);
    expect(emailStub.called).toBe(false);
  });

  // Atomic update returning 0 affected rows (race: another consume already
  // happened between findOne and update). Returns false; no ack email.
  it('returns false when atomic update affects 0 rows (concurrent consume race)', async () => {
    const token = 'f'.repeat(32);
    const application = AccountApplicationEntity.build({
      id: 'app-id',
      email: 'applicant@example.com',
      status: 'pending_confirmation',
      status_timestamp: new Date(),
      confirmation_token: token,
      confirmation_token_expiration: new Date(Date.now() + 60 * 60 * 1000),
    });

    const findOneStub = confirmSandbox.stub(AccountApplicationEntity, 'findOne');
    const updateStub = confirmSandbox.stub(AccountApplicationEntity, 'update').resolves([0] as unknown as [number]);
    const emailStub = confirmSandbox.stub(emailInterface, 'sendEmail').resolves();

    findOneStub.resolves(application);

    const result = await accountService.confirmAccountApplication(token);

    expect(result).toBe(false);
    expect(updateStub.calledOnce).toBe(true);
    expect(emailStub.called).toBe(false);
  });

  // Token lookup uses the DB WHERE clause, not an app-layer compare
  it('looks up the token via findOne WHERE confirmation_token = :token (no app-layer compare)', async () => {
    const token = 'h'.repeat(32);
    const findOneStub = confirmSandbox.stub(AccountApplicationEntity, 'findOne');
    findOneStub.resolves(null);

    await accountService.confirmAccountApplication(token);

    expect(findOneStub.calledOnce).toBe(true);
    const callArgs = findOneStub.firstCall.args[0] as { where: Record<string, unknown> };
    expect(callArgs.where).toEqual({ confirmation_token: token });
  });
});

describe('validateInviteCode', () => {
  let validateSandbox = sinon.createSandbox();
  let accountService: AccountService;
  let emailInterface: EmailInterface;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    emailInterface = new EmailInterface();
    accountService = new AccountService(eventBus, configurationInterface, setupInterface, emailInterface);
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
  let emailInterface: EmailInterface;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    emailInterface = new EmailInterface();
    accountService = new AccountService(eventBus, configurationInterface, setupInterface, emailInterface);
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
  let emailInterface: EmailInterface;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    emailInterface = new EmailInterface();
    accountService = new AccountService(eventBus, configurationInterface, setupInterface, emailInterface);
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
    let sendEmailStub = acceptSandbox.stub(emailInterface, 'sendEmail');

    const application = AccountApplicationEntity.build({ email: 'test@example.com' });
    const destroyStub = acceptSandbox.stub(application, 'destroy').resolves();

    findApplicationStub.resolves(application);
    setupAccountStub.resolves({ account: new Account('id', 'testme', 'test@example.com'), password_code: 'test_code' });

    let account = await accountService.acceptAccountApplication('test_id');

    expect(sendEmailStub.called).toBe(true);
    expect(destroyStub.called).toBe(true);
    expect(account).toBeTruthy();
  });
});

describe('rejectAccountApplication', () => {
  let rejectSandbox = sinon.createSandbox();
  let accountService: AccountService;
  let emailInterface: EmailInterface;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    emailInterface = new EmailInterface();
    accountService = new AccountService(eventBus, configurationInterface, setupInterface, emailInterface);
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
    let sendEmailStub = rejectSandbox.stub(emailInterface, 'sendEmail');

    const application = AccountApplicationEntity.build({
      email: 'test@example.com',
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
    let sendEmailStub = rejectSandbox.stub(emailInterface, 'sendEmail');

    const application = AccountApplicationEntity.build({
      email: 'test@example.com',
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
  let emailInterface: EmailInterface;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    emailInterface = new EmailInterface();
    accountService = new AccountService(eventBus, configurationInterface, setupInterface, emailInterface);
  });

  afterEach(() => {
    setupSandbox.restore();
  });

  it('should fail to create an account with an existing email', async () => {
    let accountServiceStub = setupSandbox.stub(accountService, 'getAccountByEmail');

    accountServiceStub.resolves(new Account('id', 'testme', 'test@example.com'));

    await expect(accountService._setupAccount('test@example.com','test_password')).rejects
      .toThrow(AccountAlreadyExistsError);
  });

  it('should create an account without a password', async () => {

    let accountServiceStub = setupSandbox.stub(accountService, 'getAccountByEmail');
    let accountSaveStub = setupSandbox.stub(AccountEntity.prototype, 'save');
    let accountSecretsSaveStub = setupSandbox.stub(AccountSecretsEntity.prototype, 'save');
    let accountRoleSaveStub = setupSandbox.stub(AccountRoleEntity.prototype, 'save');
    let accountRoleFindAllStub = setupSandbox.stub(AccountRoleEntity, 'findAll');
    let passwordCodeStub = setupSandbox.stub(accountService, 'generatePasswordResetCodeForAccount');

    passwordCodeStub.resolves('test_code');
    accountServiceStub.resolves(undefined);
    accountRoleFindAllStub.resolves([]); // No existing admins

    let accountInfo = await accountService._setupAccount('test@example.com');

    expect(accountInfo.account.email).toBe('test@example.com');
    expect(accountInfo.password_code).toBeTruthy();
    expect(accountSaveStub.called).toBe(true);
    expect(accountSecretsSaveStub.called).toBe(true);
  });

  it('should create an account with a password', async () => {

    let accountServiceStub = setupSandbox.stub(accountService, 'getAccountByEmail');
    let accountSaveStub = setupSandbox.stub(AccountEntity.prototype, 'save');
    let setPasswordStub = sinon.stub(accountService, 'setPassword');
    let accountSecretsSaveStub = setupSandbox.stub(AccountSecretsEntity.prototype, 'save');
    let accountRoleSaveStub = setupSandbox.stub(AccountRoleEntity.prototype, 'save');
    let accountRoleFindAllStub = setupSandbox.stub(AccountRoleEntity, 'findAll');
    let passwordCodeStub = setupSandbox.stub(accountService, 'generatePasswordResetCodeForAccount');

    accountServiceStub.resolves(undefined);
    setPasswordStub.resolves(true);
    accountRoleFindAllStub.resolves([]); // No existing admins

    let accountInfo = await accountService._setupAccount('test@example.com','test_password');

    expect(accountInfo.account.email).toBe('test@example.com');
    expect(accountInfo.password_code).toBe('');
    expect(accountSaveStub.called).toBe(true);
    expect(passwordCodeStub.called).toBe(false);
    expect(accountSecretsSaveStub.called).toBe(true);
  });

});

describe('listInvitations', () => {

  let sandbox = sinon.createSandbox();
  let accountService: AccountService;
  let emailInterface: EmailInterface;
  let findAndCountAllStub: sinon.SinonStub;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    emailInterface = new EmailInterface();
    accountService = new AccountService(eventBus, configurationInterface, setupInterface, emailInterface);
    findAndCountAllStub = sandbox.stub(AccountInvitationEntity, 'findAndCountAll');
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
        inviter: {
          toModel: () => ({ id: 'admin1', username: 'admin' }),
        },
        toModel: () => ({ id: 'inv1', email: 'user1@test.com' }),
      },
      {
        id: 'inv2',
        email: 'user2@test.com',
        invited_by: 'admin1',
        calendar_id: 'cal1',
        created_at: new Date('2025-09-30'),
        inviter: {
          toModel: () => ({ id: 'admin1', username: 'admin' }),
        },
        toModel: () => ({ id: 'inv2', email: 'user2@test.com' }),
      },
    ];

    findAndCountAllStub.resolves({ count: 2, rows: mockInvitations });

    const result = await accountService.listInvitations();

    expect(result.invitations).toHaveLength(2);
    expect(result.pagination.totalCount).toBe(2);
    expect(result.pagination.currentPage).toBe(1);
    expect(result.pagination.limit).toBe(50);
    expect(findAndCountAllStub.calledOnce).toBe(true);
    expect(findAndCountAllStub.firstCall.args[0]).toEqual({
      where: {},
      order: [['createdAt', 'DESC']],
      include: [{
        model: AccountEntity,
        as: 'inviter',
      }],
      limit: 50,
      offset: 0,
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
        inviter: {
          toModel: () => ({ id: 'user123', username: 'user123' }),
        },
        toModel: () => ({ id: 'inv1', email: 'user1@test.com' }),
      },
    ];

    findAndCountAllStub.resolves({ count: 1, rows: mockInvitations });

    const result = await accountService.listInvitations(1, 50, 'user123');

    expect(result.invitations).toHaveLength(1);
    expect(result.pagination.totalCount).toBe(1);
    expect(findAndCountAllStub.calledOnce).toBe(true);
    expect(findAndCountAllStub.firstCall.args[0]).toEqual({
      where: { invited_by: 'user123' },
      order: [['createdAt', 'DESC']],
      include: [{
        model: AccountEntity,
        as: 'inviter',
      }],
      limit: 50,
      offset: 0,
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
        inviter: {
          toModel: () => ({ id: 'owner123', username: 'owner123' }),
        },
        toModel: () => ({ id: 'inv1', email: 'editor@test.com' }),
      },
    ];

    findAndCountAllStub.resolves({ count: 1, rows: mockInvitations });

    const result = await accountService.listInvitations(1, 50, undefined, 'cal456');

    expect(result.invitations).toHaveLength(1);
    expect(result.pagination.totalCount).toBe(1);
    expect(findAndCountAllStub.calledOnce).toBe(true);
    expect(findAndCountAllStub.firstCall.args[0]).toEqual({
      where: { calendar_id: 'cal456' },
      order: [['createdAt', 'DESC']],
      include: [{
        model: AccountEntity,
        as: 'inviter',
      }],
      limit: 50,
      offset: 0,
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
        inviter: {
          toModel: () => ({ id: 'owner123', username: 'owner123' }),
        },
        toModel: () => ({ id: 'inv1', email: 'editor@test.com' }),
      },
    ];

    findAndCountAllStub.resolves({ count: 1, rows: mockInvitations });

    const result = await accountService.listInvitations(1, 50, 'owner123', 'cal456');

    expect(result.invitations).toHaveLength(1);
    expect(result.pagination.totalCount).toBe(1);
    expect(findAndCountAllStub.calledOnce).toBe(true);
    expect(findAndCountAllStub.firstCall.args[0]).toEqual({
      where: {
        invited_by: 'owner123',
        calendar_id: 'cal456',
      },
      order: [['createdAt', 'DESC']],
      include: [{
        model: AccountEntity,
        as: 'inviter',
      }],
      limit: 50,
      offset: 0,
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
        inviter: {
          toModel: () => ({ id: 'admin1', username: 'admin' }),
        },
        toModel: () => ({ id: 'inv1', email: 'user1@test.com' }),
      },
      {
        id: 'inv2',
        email: 'user2@test.com',
        invited_by: 'admin1',
        calendar_id: null,
        created_at: new Date('2025-09-30'),
        inviter: {
          toModel: () => ({ id: 'admin1', username: 'admin' }),
        },
        toModel: () => ({ id: 'inv2', email: 'user2@test.com' }),
      },
    ];

    findAndCountAllStub.resolves({ count: 2, rows: mockInvitations });

    await accountService.listInvitations();

    const callArgs = findAndCountAllStub.firstCall.args[0];
    expect(callArgs.order).toEqual([['createdAt', 'DESC']]);
  });

  it('should include inviter relation', async () => {
    findAndCountAllStub.resolves({ count: 0, rows: [] });

    await accountService.listInvitations();

    const callArgs = findAndCountAllStub.firstCall.args[0];
    expect(callArgs.include).toEqual([{
      model: AccountEntity,
      as: 'inviter',
    }]);
  });

  it('should return empty array when no invitations found', async () => {
    findAndCountAllStub.resolves({ count: 0, rows: [] });

    const result = await accountService.listInvitations();

    expect(result.invitations).toEqual([]);
    expect(result.invitations).toHaveLength(0);
    expect(result.pagination.totalCount).toBe(0);
  });

});

describe('updateProfile', () => {
  let sandbox = sinon.createSandbox();
  let accountService: AccountService;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const emailInterface = new EmailInterface();
    accountService = new AccountService(eventBus, configurationInterface, setupInterface, emailInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should update display name successfully', async () => {
    const testAccount = new Account('user-id', 'testuser', 'test@example.com');
    const mockEntity = {
      id: 'user-id',
      username: 'testuser',
      email: 'test@example.com',
      display_name: null,
      save: sandbox.stub().resolves(),
      toModel: () => {
        const account = new Account('user-id', 'testuser', 'test@example.com');
        account.displayName = 'New Display Name';
        return account;
      },
    } as any;

    const findByPkStub = sandbox.stub(AccountEntity, 'findByPk');
    findByPkStub.resolves(mockEntity);

    const result = await accountService.updateProfile(testAccount, 'New Display Name');

    expect(findByPkStub.calledWith('user-id')).toBe(true);
    expect(mockEntity.display_name).toBe('New Display Name');
    expect(mockEntity.save.called).toBe(true);
    expect(result.displayName).toBe('New Display Name');
  });

  it('should allow clearing display name with null', async () => {
    const testAccount = new Account('user-id', 'testuser', 'test@example.com');
    testAccount.displayName = 'Current Name';
    const mockEntity = {
      id: 'user-id',
      username: 'testuser',
      email: 'test@example.com',
      display_name: 'Current Name',
      save: sandbox.stub().resolves(),
      toModel: () => {
        const account = new Account('user-id', 'testuser', 'test@example.com');
        account.displayName = null;
        return account;
      },
    } as any;

    const findByPkStub = sandbox.stub(AccountEntity, 'findByPk');
    findByPkStub.resolves(mockEntity);

    const result = await accountService.updateProfile(testAccount, null);

    expect(findByPkStub.calledWith('user-id')).toBe(true);
    expect(mockEntity.display_name).toBe(null);
    expect(mockEntity.save.called).toBe(true);
    expect(result.displayName).toBe(null);
  });

  it('should throw error if account not found', async () => {
    const testAccount = new Account('non-existent-id', 'testuser', 'test@example.com');

    const findByPkStub = sandbox.stub(AccountEntity, 'findByPk');
    findByPkStub.resolves(null);

    await expect(accountService.updateProfile(testAccount, 'New Name')).rejects
      .toThrow('Account not found');

    expect(findByPkStub.calledWith('non-existent-id')).toBe(true);
  });

  it('should handle empty string display name', async () => {
    const testAccount = new Account('user-id', 'testuser', 'test@example.com');
    const mockEntity = {
      id: 'user-id',
      username: 'testuser',
      email: 'test@example.com',
      display_name: null,
      save: sandbox.stub().resolves(),
      toModel: () => {
        const account = new Account('user-id', 'testuser', 'test@example.com');
        account.displayName = '';
        return account;
      },
    } as any;

    const findByPkStub = sandbox.stub(AccountEntity, 'findByPk');
    findByPkStub.resolves(mockEntity);

    const result = await accountService.updateProfile(testAccount, '');

    expect(findByPkStub.calledWith('user-id')).toBe(true);
    expect(mockEntity.display_name).toBe('');
    expect(mockEntity.save.called).toBe(true);
    expect(result.displayName).toBe('');
  });

  it('should update display name when one already exists', async () => {
    const testAccount = new Account('user-id', 'testuser', 'test@example.com');
    testAccount.displayName = 'Old Name';
    const mockEntity = {
      id: 'user-id',
      username: 'testuser',
      email: 'test@example.com',
      display_name: 'Old Name',
      save: sandbox.stub().resolves(),
      toModel: () => {
        const account = new Account('user-id', 'testuser', 'test@example.com');
        account.displayName = 'Updated Name';
        return account;
      },
    } as any;

    const findByPkStub = sandbox.stub(AccountEntity, 'findByPk');
    findByPkStub.resolves(mockEntity);

    const result = await accountService.updateProfile(testAccount, 'Updated Name');

    expect(findByPkStub.calledWith('user-id')).toBe(true);
    expect(mockEntity.display_name).toBe('Updated Name');
    expect(mockEntity.save.called).toBe(true);
    expect(result.displayName).toBe('Updated Name');
  });

  it('should persist display name to database', async () => {
    const testAccount = new Account('user-id', 'testuser', 'test@example.com');
    const saveStub = sandbox.stub();
    const mockEntity = {
      id: 'user-id',
      username: 'testuser',
      email: 'test@example.com',
      display_name: null,
      save: saveStub,
      toModel: () => {
        const account = new Account('user-id', 'testuser', 'test@example.com');
        account.displayName = 'Persisted Name';
        return account;
      },
    } as any;

    const findByPkStub = sandbox.stub(AccountEntity, 'findByPk');
    findByPkStub.resolves(mockEntity);

    await accountService.updateProfile(testAccount, 'Persisted Name');

    expect(saveStub.calledOnce).toBe(true);
    expect(mockEntity.display_name).toBe('Persisted Name');
  });

  it('should throw ValidationError for an invalid language code', async () => {
    const testAccount = new Account('user-id', 'testuser', 'test@example.com');

    await expect(accountService.updateProfile(testAccount, 'Name', 'xx'))
      .rejects.toThrow(ValidationError);
  });

  it('should update language when a valid language code is provided', async () => {
    const testAccount = new Account('user-id', 'testuser', 'test@example.com');
    const mockEntity = {
      id: 'user-id',
      username: 'testuser',
      email: 'test@example.com',
      display_name: null,
      language: 'en',
      save: sandbox.stub().resolves(),
      toModel: () => {
        const account = new Account('user-id', 'testuser', 'test@example.com');
        account.language = 'es';
        return account;
      },
    } as any;

    const findByPkStub = sandbox.stub(AccountEntity, 'findByPk');
    findByPkStub.resolves(mockEntity);

    const result = await accountService.updateProfile(testAccount, 'Name', 'es');

    expect(mockEntity.language).toBe('es');
    expect(mockEntity.save.called).toBe(true);
    expect(result.language).toBe('es');
  });

  it('should not update language when language is not provided', async () => {
    const testAccount = new Account('user-id', 'testuser', 'test@example.com');
    const mockEntity = {
      id: 'user-id',
      username: 'testuser',
      email: 'test@example.com',
      display_name: null,
      language: 'en',
      save: sandbox.stub().resolves(),
      toModel: () => {
        const account = new Account('user-id', 'testuser', 'test@example.com');
        account.language = 'en';
        return account;
      },
    } as any;

    const findByPkStub = sandbox.stub(AccountEntity, 'findByPk');
    findByPkStub.resolves(mockEntity);

    await accountService.updateProfile(testAccount, 'Name');

    // language should remain unchanged
    expect(mockEntity.language).toBe('en');
    expect(mockEntity.save.called).toBe(true);
  });
});
