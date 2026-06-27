import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import sinon from 'sinon';
import { DateTime } from 'luxon';

import { Account } from '@/common/model/account';
import { AccountEntity, AccountSecretsEntity } from '@/server/common/entity/account';
import AuthenticationService from '@/server/authentication/service/auth';
import { InvalidPasswordError } from '@/server/authentication/exceptions';
import EmailInterface from '@/server/email/interface';
import AccountsDomain from '@/server/accounts';
import { EventEmitter } from 'events';
import ConfigurationDomain from '@/server/configuration';
import SetupDomain from '@/server/setup';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();


describe( 'checkPassword', async () => {
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let service: AuthenticationService;
  let accountDomain: AccountsDomain;

  beforeEach( () => {
    const eventBus = new EventEmitter();
    const configurationDomain = new ConfigurationDomain(eventBus);
    const setupDomain = new SetupDomain();
    accountDomain = new AccountsDomain(eventBus, configurationDomain.interface, setupDomain.interface);
    service = new AuthenticationService(eventBus,accountDomain.interface);
  });

  afterEach( () => {
    sandbox.restore();
  });

  it( 'should return true', async () => {
    let pkSecretStub = sandbox.stub(AccountSecretsEntity, 'findByPk');
    let saveStub = sandbox.stub(AccountSecretsEntity.prototype, 'save');

    let account = new Account('1234', 'testme', 'testme');
    let secrets = AccountSecretsEntity.build({
      account_id: '1234',
    });

    pkSecretStub.resolves( secrets );

    expect( await accountDomain.interface.setPassword(account, 'newPassword') ).toBe(true);
    expect(saveStub.called).toBe(true);
    expect( secrets.password ).not.toBe('testme');
    expect( secrets.password ).not.toBe('newPassword');
    expect( secrets.salt ).not.toBe('testme');
    expect( await service.checkPassword(new Account(), 'testme') ).toBe(false);
    expect( await service.checkPassword(new Account(), 'newPassword') ).toBe(true);
  });

  it( 'should return false if no secret is found', async () => {
    let findSecretStub = sandbox.stub(AccountSecretsEntity, 'findByPk');
    findSecretStub.resolves( undefined );

    expect( await service.checkPassword(new Account(), 'testme') ).toBe(false);
  });

  it( 'should return false if no salt is found', async () => {
    let findSecretStub = sandbox.stub(AccountSecretsEntity, 'findByPk');
    let secrets = AccountSecretsEntity.build({
      account_id: '1234',
    });

    findSecretStub.resolves( secrets );

    expect( await service.checkPassword(new Account(), 'testme') ).toBe(false);
  });

});

describe('resetPassword', async () => {
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let service: AuthenticationService;
  let accountDomain: AccountsDomain;

  beforeEach( () => {
    const eventBus = new EventEmitter();
    const configurationDomain = new ConfigurationDomain(eventBus);
    const setupDomain = new SetupDomain();
    accountDomain = new AccountsDomain(eventBus, configurationDomain.interface, setupDomain.interface);
    service = new AuthenticationService(eventBus,accountDomain.interface);
  });

  afterEach( () => {
    sandbox.restore();
  });

  it('should return undefined if no secret is found', async () => {
    let findSecretStub = sandbox.stub(AccountSecretsEntity, 'findOne');
    findSecretStub.resolves(undefined);

    expect( await service.resetPassword('1234', 'password') ).toBe(undefined);
  });

  it('should return empty string if the code is expired', async () => {
    let findSecretStub = sandbox.stub(AccountSecretsEntity, 'findOne');
    let saveStub = sandbox.stub(AccountSecretsEntity.prototype, 'save');
    let secrets = AccountSecretsEntity.build({
      password_reset_expiration: DateTime.now().minus({ days: 1}),
      password_reset_code: '1234',
    });

    findSecretStub.resolves( secrets );

    expect( await service.resetPassword('1234', 'password') ).toBe(undefined);
    expect(saveStub.called).toBe(true);
    expect(secrets.password_reset_code).toBe('');
    expect(secrets.password_reset_expiration).toBe(null);
  });

  it('should return the account if the password is set', async () => {
    let findSecretStub = sandbox.stub(AccountSecretsEntity, 'findOne');
    let setPassSttub = sandbox.stub(accountDomain.interface, 'setPassword');
    let saveStub = sandbox.stub(AccountSecretsEntity.prototype, 'save');
    setPassSttub.resolves(true);
    let account = AccountEntity.build({ id: '1234', username: 'testme', email: 'testme'});
    let secrets = AccountSecretsEntity.build({
      password_reset_expiration: DateTime.now().plus({ days: 1 }).toJSDate(),
      password_reset_code: '1234',
    });
    secrets.account = account;

    findSecretStub.resolves( secrets );

    let acct = await service.resetPassword('1234', 'password');

    expect(saveStub.called).toBe(true);
    expect( acct ).not.toBe(undefined);
    if ( acct ) {
      expect( acct.id ).toBe(account.id);
    }
    expect(secrets.password_reset_code).toBe('');
    expect(secrets.password_reset_expiration).toBe(null);
  });
});

describe('initiateEmailChange', async () => {
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let service: AuthenticationService;
  let accountDomain: AccountsDomain;
  let emailInterface: EmailInterface;
  let sendEmailStub: sinon.SinonStub;

  beforeEach( () => {
    const eventBus = new EventEmitter();
    const configurationDomain = new ConfigurationDomain(eventBus);
    const setupDomain = new SetupDomain();
    accountDomain = new AccountsDomain(eventBus, configurationDomain.interface, setupDomain.interface);
    emailInterface = new EmailInterface();
    sendEmailStub = sandbox.stub(emailInterface, 'sendEmail').resolves(null);
    service = new AuthenticationService(eventBus, accountDomain.interface, emailInterface);
    // checkPassword succeeds by default; specific tests override.
    sandbox.stub(service, 'checkPassword').resolves(true);
  });

  afterEach( () => {
    sandbox.restore();
  });

  it('should store pending change and send one email to the new address when available', async () => {
    const account = new Account('1234', 'testme', 'old@example.com');
    const accountEntity = AccountEntity.build({ id: '1234', username: 'testme', email: 'old@example.com' });
    const secrets = AccountSecretsEntity.build({ id: '1234' });

    sandbox.stub(accountDomain.interface, 'getAccountByEmail').resolves(undefined);
    sandbox.stub(AccountSecretsEntity, 'findByPk').resolves(secrets);
    const secretSaveStub = sandbox.stub(AccountSecretsEntity.prototype, 'save').resolves();
    const accountSaveStub = sandbox.stub(AccountEntity.prototype, 'save').resolves();

    await service.initiateEmailChange(account, 'New@Example.com', 'password');

    // Pending fields written on the secrets sidecar.
    expect(secretSaveStub.called).toBe(true);
    expect(secrets.email_change_code).toMatch(/^[0-9a-f]{32}$/);
    expect(secrets.email_change_new_email).toBe('new@example.com');
    expect(secrets.email_change_expiration).not.toBe(null);

    // Mailer called exactly once, addressed to the new (normalized) address.
    expect(sendEmailStub.calledOnce).toBe(true);
    expect(sendEmailStub.firstCall.args[0].emailAddress).toBe('new@example.com');

    // The account's own email is NOT mutated at initiate time.
    expect(account.email).toBe('old@example.com');
    expect(accountEntity.email).toBe('old@example.com');
    expect(accountSaveStub.called).toBe(false);
  });

  it('should write nothing and send nothing when the address is taken', async () => {
    const account = new Account('1234', 'testme', 'old@example.com');
    const secrets = AccountSecretsEntity.build({ id: '1234' });

    const otherAccount = new Account('9999', 'other', 'new@example.com');
    sandbox.stub(accountDomain.interface, 'getAccountByEmail').resolves(otherAccount);
    const findSecretStub = sandbox.stub(AccountSecretsEntity, 'findByPk').resolves(secrets);
    const secretSaveStub = sandbox.stub(AccountSecretsEntity.prototype, 'save').resolves();

    // Must not throw — uniform with the available path.
    await expect(service.initiateEmailChange(account, 'new@example.com', 'password')).resolves.toBeUndefined();

    // Nothing written, nothing sent.
    expect(findSecretStub.called).toBe(false);
    expect(secretSaveStub.called).toBe(false);
    expect(secrets.email_change_code).toBe(undefined);
    expect(sendEmailStub.called).toBe(false);
    expect(account.email).toBe('old@example.com');
  });

  it('should be a no-op when the new email equals the current email', async () => {
    const account = new Account('1234', 'testme', 'old@example.com');
    const getByEmailStub = sandbox.stub(accountDomain.interface, 'getAccountByEmail');
    const findSecretStub = sandbox.stub(AccountSecretsEntity, 'findByPk');

    await expect(service.initiateEmailChange(account, 'OLD@example.com', 'password')).resolves.toBeUndefined();

    expect(getByEmailStub.called).toBe(false);
    expect(findSecretStub.called).toBe(false);
    expect(sendEmailStub.called).toBe(false);
    expect(account.email).toBe('old@example.com');
  });

  it('should throw InvalidPasswordError when the password is wrong', async () => {
    (service.checkPassword as sinon.SinonStub).resolves(false);
    const account = new Account('1234', 'testme', 'old@example.com');

    await expect(service.initiateEmailChange(account, 'new@example.com', 'wrong'))
      .rejects.toBeInstanceOf(InvalidPasswordError);
    expect(sendEmailStub.called).toBe(false);
  });
});

describe('confirmEmailChange', async () => {
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let service: AuthenticationService;
  let accountDomain: AccountsDomain;
  const validToken = 'a'.repeat(32);

  beforeEach( () => {
    const eventBus = new EventEmitter();
    const configurationDomain = new ConfigurationDomain(eventBus);
    const setupDomain = new SetupDomain();
    accountDomain = new AccountsDomain(eventBus, configurationDomain.interface, setupDomain.interface);
    const emailInterface = new EmailInterface();
    service = new AuthenticationService(eventBus, accountDomain.interface, emailInterface);
  });

  afterEach( () => {
    sandbox.restore();
  });

  it('should apply the pending address, clear fields, and return true on a valid token', async () => {
    const accountEntity = AccountEntity.build({ id: '1234', username: 'testme', email: 'old@example.com' });
    const secrets = AccountSecretsEntity.build({
      id: '1234',
      email_change_code: validToken,
      email_change_expiration: DateTime.now().plus({ minutes: 30 }).toJSDate(),
      email_change_new_email: 'new@example.com',
    });
    secrets.account = accountEntity;

    sandbox.stub(AccountSecretsEntity, 'findOne').resolves(secrets);
    sandbox.stub(accountDomain.interface, 'getAccountByEmail').resolves(undefined);
    const secretSaveStub = sandbox.stub(AccountSecretsEntity.prototype, 'save').resolves();
    const accountSaveStub = sandbox.stub(AccountEntity.prototype, 'save').resolves();

    const result = await service.confirmEmailChange(validToken);

    expect(result).toBe(true);
    expect(accountEntity.email).toBe('new@example.com');
    expect(accountSaveStub.called).toBe(true);
    expect(secretSaveStub.called).toBe(true);
    expect(secrets.email_change_code).toBe(null);
    expect(secrets.email_change_expiration).toBe(null);
    expect(secrets.email_change_new_email).toBe(null);
  });

  it('should return false, clear fields, and leave email unchanged when the token is expired', async () => {
    const accountEntity = AccountEntity.build({ id: '1234', username: 'testme', email: 'old@example.com' });
    const secrets = AccountSecretsEntity.build({
      id: '1234',
      email_change_code: validToken,
      email_change_expiration: DateTime.now().minus({ minutes: 1 }).toJSDate(),
      email_change_new_email: 'new@example.com',
    });
    secrets.account = accountEntity;

    sandbox.stub(AccountSecretsEntity, 'findOne').resolves(secrets);
    const secretSaveStub = sandbox.stub(AccountSecretsEntity.prototype, 'save').resolves();
    const accountSaveStub = sandbox.stub(AccountEntity.prototype, 'save').resolves();

    const result = await service.confirmEmailChange(validToken);

    expect(result).toBe(false);
    expect(accountEntity.email).toBe('old@example.com');
    expect(accountSaveStub.called).toBe(false);
    expect(secretSaveStub.called).toBe(true);
    expect(secrets.email_change_code).toBe(null);
    expect(secrets.email_change_expiration).toBe(null);
    expect(secrets.email_change_new_email).toBe(null);
  });

  it('should return false, clear fields, and leave email unchanged when the address is now taken', async () => {
    const accountEntity = AccountEntity.build({ id: '1234', username: 'testme', email: 'old@example.com' });
    const secrets = AccountSecretsEntity.build({
      id: '1234',
      email_change_code: validToken,
      email_change_expiration: DateTime.now().plus({ minutes: 30 }).toJSDate(),
      email_change_new_email: 'new@example.com',
    });
    secrets.account = accountEntity;

    sandbox.stub(AccountSecretsEntity, 'findOne').resolves(secrets);
    sandbox.stub(accountDomain.interface, 'getAccountByEmail')
      .resolves(new Account('9999', 'other', 'new@example.com'));
    const secretSaveStub = sandbox.stub(AccountSecretsEntity.prototype, 'save').resolves();
    const accountSaveStub = sandbox.stub(AccountEntity.prototype, 'save').resolves();

    const result = await service.confirmEmailChange(validToken);

    expect(result).toBe(false);
    expect(accountEntity.email).toBe('old@example.com');
    expect(accountSaveStub.called).toBe(false);
    expect(secretSaveStub.called).toBe(true);
    expect(secrets.email_change_code).toBe(null);
    expect(secrets.email_change_expiration).toBe(null);
    expect(secrets.email_change_new_email).toBe(null);
  });

  it('should return false for an unknown token without clearing any row', async () => {
    const findOneStub = sandbox.stub(AccountSecretsEntity, 'findOne').resolves(undefined);
    const secretSaveStub = sandbox.stub(AccountSecretsEntity.prototype, 'save').resolves();

    const result = await service.confirmEmailChange(validToken);

    expect(result).toBe(false);
    expect(findOneStub.calledOnce).toBe(true);
    expect(secretSaveStub.called).toBe(false);
  });

  it('should return false for a malformed token without querying the database', async () => {
    const findOneStub = sandbox.stub(AccountSecretsEntity, 'findOne');

    expect(await service.confirmEmailChange('not-hex')).toBe(false);
    expect(await service.confirmEmailChange('A'.repeat(32))).toBe(false); // uppercase rejected
    expect(await service.confirmEmailChange('a'.repeat(31))).toBe(false); // too short
    expect(findOneStub.called).toBe(false);
  });
});
