import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import {
  AccountEntity,
  AccountSecretsEntity,
  AccountRoleEntity,
} from '@/server/common/entity/account';
import AccountInvitationEntity from '@/server/accounts/entity/account_invitation';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import EmailInterface from '@/server/email/interface';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

/**
 * Accepting an invitation creates the account, its secrets row and any role
 * rows in one transaction with the password write. A failed password write
 * must surface as an error to the caller and roll every one of those rows
 * back, so the invitee can retry instead of hitting "account already exists"
 * on an account that has no usable password.
 */
describe('Invitation accept is atomic with the password write (integration)', () => {
  let env: TestEnvironment;
  let sandbox: sinon.SinonSandbox;
  let accountService: AccountService;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  beforeEach(async () => {
    await AccountInvitationEntity.destroy({ where: {}, truncate: true });
    await AccountRoleEntity.destroy({ where: {}, truncate: true });
    await AccountSecretsEntity.destroy({ where: {}, truncate: true });
    await AccountEntity.destroy({ where: {}, truncate: true });

    sandbox = sinon.createSandbox();
    const emailInterface = new EmailInterface();
    sandbox.stub(emailInterface, 'sendEmail').resolves();
    sandbox.stub(ConfigurationInterface.prototype, 'getAllSettings')
      .resolves({ registrationMode: 'invitation' });

    accountService = new AccountService(
      new EventEmitter(),
      new ConfigurationInterface(),
      new SetupInterface(),
      emailInterface,
    );
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('returns an error and leaves no account, secrets or role rows when the password write fails', async () => {
    const inviterInfo = await accountService._setupAccount('inviter@example.com');
    const inviter = inviterInfo.account;
    inviter.roles = ['admin'];

    await accountService.inviteNewAccount(inviter, 'invitee@example.com', 'join');
    const invitation = await AccountInvitationEntity.findOne({ where: { email: 'invitee@example.com' } });
    expect(invitation).not.toBeNull();

    const secretsBefore = await AccountSecretsEntity.count();
    const rolesBefore = await AccountRoleEntity.count();

    sandbox.stub(accountService, 'setPassword').rejects(new Error('password write failed'));

    await expect(
      accountService.acceptAccountInvite(invitation!.invitation_code, 'Password!1'),
    ).rejects.toThrow('password write failed');

    expect(await AccountEntity.count({ where: { email: 'invitee@example.com' } })).toBe(0);
    expect(await AccountSecretsEntity.count()).toBe(secretsBefore);
    expect(await AccountRoleEntity.count()).toBe(rolesBefore);

    // The invitation survives, so the invitee can retry with the same code.
    expect(await AccountInvitationEntity.count({ where: { email: 'invitee@example.com' } })).toBe(1);
  });
});
