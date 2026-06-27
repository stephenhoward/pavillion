import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import {
  AccountEntity,
  AccountSecretsEntity,
  AccountRoleEntity,
  AccountApplicationEntity,
} from '@/server/common/entity/account';
import AccountInvitationEntity from '@/server/accounts/entity/account_invitation';
import AccountService from '@/server/accounts/service/account';
import AuthenticationService from '@/server/authentication/service/auth';
import AccountsInterface from '@/server/accounts/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import EmailInterface from '@/server/email/interface';
import { AccountAlreadyExistsError, AccountInviteAlreadyExistsError } from '@/server/accounts/exceptions';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

/**
 * Integration tests for case-insensitive email handling against a real SQLite
 * database. SQLite's default `=` comparison on TEXT is case-SENSITIVE, so a
 * stubbed unit test cannot prove that a mixed-case lookup finds a normalized
 * row — only a real DB round-trip can. These tests exercise the
 * normalize-at-boundary contract end to end: every read and write funnels the
 * address through `normalizeEmail`, so case variants collapse to one account.
 *
 * Bead: pv-j5mw
 */
describe('Email normalization (integration, real SQLite DB)', () => {
  let env: TestEnvironment;
  let sandbox: sinon.SinonSandbox;
  let accountService: AccountService;
  let authService: AuthenticationService;
  let emailInterface: EmailInterface;

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
    await AccountApplicationEntity.destroy({ where: {}, truncate: true });
    await AccountRoleEntity.destroy({ where: {}, truncate: true });
    await AccountSecretsEntity.destroy({ where: {}, truncate: true });
    await AccountEntity.destroy({ where: {}, truncate: true });

    sandbox = sinon.createSandbox();
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    emailInterface = new EmailInterface();
    sandbox.stub(emailInterface, 'sendEmail').resolves();

    accountService = new AccountService(eventBus, configurationInterface, setupInterface, emailInterface);
    authService = new AuthenticationService(
      eventBus,
      accountService as unknown as AccountsInterface,
      emailInterface,
    );
  });

  afterEach(() => {
    sandbox.restore();
  });

  async function countAccounts(): Promise<number> {
    return AccountEntity.count();
  }

  describe('getAccountByEmail', () => {
    it('finds a verbatim-lowercased account when queried with mixed case', async () => {
      await accountService._setupAccount('Victim@X.com');

      const lower = await accountService.getAccountByEmail('victim@x.com');
      const upper = await accountService.getAccountByEmail('VICTIM@X.COM');
      const spaced = await accountService.getAccountByEmail('  Victim@X.com  ');

      expect(lower).toBeDefined();
      expect(lower!.email).toBe('victim@x.com');
      expect(upper).toBeDefined();
      expect(upper!.id).toBe(lower!.id);
      expect(spaced).toBeDefined();
      expect(spaced!.id).toBe(lower!.id);
    });

    it('treats a case-variant registration as already taken (no duplicate)', async () => {
      await accountService._setupAccount('victim@x.com');

      await expect(accountService._setupAccount('Victim@X.com')).rejects
        .toThrow(AccountAlreadyExistsError);
      expect(await countAccounts()).toBe(1);
    });
  });

  describe('email change (two-step confirm-by-token)', () => {
    it('recognizes a case-variant of an existing address as taken and stores no pending change', async () => {
      await accountService._setupAccount('victim@x.com');
      const moverInfo = await accountService._setupAccount('user@x.com');

      // Password verification is exercised elsewhere; isolate the taken-check.
      sandbox.stub(authService, 'checkPassword').resolves(true);

      // The taken path returns the same uniform (void) response as the available
      // path — it never throws (anti-enumeration). The normalization contract is
      // what's under test: `VICTIM@x.com` must collapse to the existing
      // `victim@x.com` row so the taken path is taken and nothing is stored.
      await expect(authService.initiateEmailChange(moverInfo.account, 'VICTIM@x.com', 'pw'))
        .resolves.toBeUndefined();

      // No pending change was written for the mover, and no row was added.
      const secret = await AccountSecretsEntity.findByPk(moverInfo.account.id);
      expect(secret?.email_change_new_email ?? null).toBeNull();
      expect(secret?.email_change_code ?? null).toBeNull();

      // The mover's address is unchanged.
      const mover = await AccountEntity.findByPk(moverInfo.account.id);
      expect(mover!.email).toBe('user@x.com');
      expect(await countAccounts()).toBe(2);
    });

    it('persists a normalized email after the change is confirmed', async () => {
      const moverInfo = await accountService._setupAccount('user@x.com');
      sandbox.stub(authService, 'checkPassword').resolves(true);

      // Initiate stores a pending, normalized address plus a confirmation token;
      // it does not write the new address to the account yet.
      await authService.initiateEmailChange(moverInfo.account, 'New@X.COM', 'pw');

      const pending = await AccountSecretsEntity.findByPk(moverInfo.account.id);
      expect(pending!.email_change_new_email).toBe('new@x.com');
      const beforeConfirm = await AccountEntity.findByPk(moverInfo.account.id);
      expect(beforeConfirm!.email).toBe('user@x.com');

      // Confirming the token commits the normalized address.
      const committed = await authService.confirmEmailChange(pending!.email_change_code!);
      expect(committed).toBe(true);

      const stored = await AccountEntity.findByPk(moverInfo.account.id);
      expect(stored!.email).toBe('new@x.com');
    });
  });

  describe('registerNewAccount', () => {
    it('persists a normalized email regardless of input casing', async () => {
      sandbox.stub(ConfigurationInterface.prototype, 'getAllSettings')
        .resolves({ registrationMode: 'open' });

      await accountService.registerNewAccount('New@User.COM');

      const stored = await AccountEntity.findOne({ where: { email: 'new@user.com' } });
      expect(stored).toBeDefined();
      expect(stored!.email).toBe('new@user.com');
    });
  });

  describe('applyForNewAccount', () => {
    beforeEach(() => {
      sandbox.stub(ConfigurationInterface.prototype, 'getAllSettings')
        .resolves({ registrationMode: 'apply' });
    });

    it('does not create a second application row for a case-variant of a pending application', async () => {
      await accountService.applyForNewAccount('Applicant@X.com', 'first');
      await accountService.applyForNewAccount('APPLICANT@x.com', 'second');

      expect(await AccountApplicationEntity.count()).toBe(1);
      const stored = await AccountApplicationEntity.findOne({});
      expect(stored!.email).toBe('applicant@x.com');
    });

    it('hits the account-exists branch (no application row) for a case-variant of an existing account', async () => {
      await accountService._setupAccount('owner@x.com');

      const result = await accountService.applyForNewAccount('OWNER@X.com', 'let me in');

      expect(result).toBe(true);
      expect(await AccountApplicationEntity.count()).toBe(0);
    });
  });

  describe('inviteNewAccount', () => {
    let inviter: Account;

    beforeEach(async () => {
      sandbox.stub(ConfigurationInterface.prototype, 'getAllSettings')
        .resolves({ registrationMode: 'invitation' });
      // The invitation row has a foreign key on invited_by; the inviter must
      // be a real account.
      const inviterInfo = await accountService._setupAccount('inviter@x.com');
      inviter = inviterInfo.account;
      inviter.roles = ['admin'];
    });

    it('treats a case-variant of an existing account as taken', async () => {
      await accountService._setupAccount('owner@x.com');

      await expect(accountService.inviteNewAccount(inviter, 'OWNER@X.com', 'hi')).rejects
        .toThrow(AccountAlreadyExistsError);
    });

    it('treats a case-variant of an existing invitation as taken', async () => {
      await accountService.inviteNewAccount(inviter, 'invitee@x.com', 'hi');

      await expect(accountService.inviteNewAccount(inviter, 'INVITEE@X.com', 'again')).rejects
        .toThrow(AccountInviteAlreadyExistsError);
      expect(await AccountInvitationEntity.count()).toBe(1);
    });
  });

  describe('account creation funnels persist normalized email', () => {
    it('invite-accept creates an account with the normalized invitation email', async () => {
      sandbox.stub(ConfigurationInterface.prototype, 'getAllSettings')
        .resolves({ registrationMode: 'invitation' });
      const inviterInfo = await accountService._setupAccount('inviter@x.com');
      const inviter = inviterInfo.account;
      inviter.roles = ['admin'];

      await accountService.inviteNewAccount(inviter, 'Accept@X.com', 'join');
      const invitation = await AccountInvitationEntity.findOne({ where: { email: 'accept@x.com' } });
      expect(invitation).toBeDefined();

      const { account } = await accountService.acceptAccountInvite(invitation!.invitation_code, 'Password!1');
      expect(account.email).toBe('accept@x.com');

      const stored = await AccountEntity.findByPk(account.id);
      expect(stored!.email).toBe('accept@x.com');
    });

    it('application-accept creates an account with the normalized application email', async () => {
      sandbox.stub(ConfigurationInterface.prototype, 'getAllSettings')
        .resolves({ registrationMode: 'apply' });

      await accountService.applyForNewAccount('Applicant@X.com', 'please');
      const application = await AccountApplicationEntity.findOne({ where: { email: 'applicant@x.com' } });
      expect(application).toBeDefined();

      const account = await accountService.acceptAccountApplication(application!.id);
      expect(account.email).toBe('applicant@x.com');

      const stored = await AccountEntity.findByPk(account.id);
      expect(stored!.email).toBe('applicant@x.com');
    });
  });
});
