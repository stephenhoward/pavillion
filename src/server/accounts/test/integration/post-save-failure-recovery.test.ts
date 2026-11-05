import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';

import { Account } from '@/common/model/account';
import {
  AccountEntity,
  AccountSecretsEntity,
  AccountRoleEntity,
  AccountApplicationEntity,
} from '@/server/common/entity/account';
import AccountInvitationEntity from '@/server/accounts/entity/account_invitation';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import EmailInterface from '@/server/email/interface';
import CalendarInterface from '@/server/calendar/interface';
import { MailData } from '@/server/common/email/types';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

/**
 * Account creation saves the account first and then does more work: granting
 * calendar editor access for invitations, or emailing the applicant for an
 * approved application. A failure in that later work must leave a state the
 * inviter or admin can see and retry, never a stranded account.
 */
describe('Recovery from failures after the account is saved (integration)', () => {
  let env: TestEnvironment;
  let sandbox: sinon.SinonSandbox;
  let accountService: AccountService;
  let sendEmail: sinon.SinonStub;
  let grantEditAccess: sinon.SinonStub;
  let inviter: Account;

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
    const emailInterface = new EmailInterface();
    sendEmail = sandbox.stub(emailInterface, 'sendEmail').resolves();
    sandbox.stub(ConfigurationInterface.prototype, 'getAllSettings')
      .resolves({ registrationMode: 'invitation' });

    grantEditAccess = sandbox.stub().resolves();

    accountService = new AccountService(
      new EventEmitter(),
      new ConfigurationInterface(),
      new SetupInterface(),
      emailInterface,
      { grantEditAccess } as unknown as CalendarInterface,
    );

    inviter = (await accountService._setupAccount('inviter@example.com')).account;
  });

  afterEach(() => {
    sandbox.restore();
  });

  async function createCalendarInvitation(email: string, calendarId: string): Promise<AccountInvitationEntity> {
    return AccountInvitationEntity.create({
      id: uuidv4(),
      email,
      invited_by: inviter.id,
      message: 'edit with us',
      invitation_code: randomBytes(16).toString('hex'),
      calendar_id: calendarId,
    });
  }

  describe('calendar-editor invitation accept', () => {
    const inviteeEmail = 'invitee@example.com';
    const grantedCalendar = uuidv4();
    const failedCalendar = uuidv4();

    beforeEach(() => {
      grantEditAccess
        .withArgs(sinon.match.any, failedCalendar, sinon.match.any)
        .rejects(new Error('grant failed'));
    });

    it('keeps the invitation whose grant failed and removes the one that succeeded', async () => {
      const grantedInvitation = await createCalendarInvitation(inviteeEmail, grantedCalendar);
      const failedInvitation = await createCalendarInvitation(inviteeEmail, failedCalendar);

      const result = await accountService.acceptAccountInvite(grantedInvitation.invitation_code, 'Password!1');

      expect(await AccountEntity.count({ where: { email: inviteeEmail } })).toBe(1);
      expect(result.calendars).toEqual([grantedCalendar]);

      expect(await AccountInvitationEntity.findByPk(grantedInvitation.id)).toBeNull();
      expect(await AccountInvitationEntity.findByPk(failedInvitation.id)).not.toBeNull();
    });

    it('grants access and removes the invitation when the inviter resends it after the account exists', async () => {
      const grantedInvitation = await createCalendarInvitation(inviteeEmail, grantedCalendar);
      const failedInvitation = await createCalendarInvitation(inviteeEmail, failedCalendar);

      const { account } = await accountService.acceptAccountInvite(grantedInvitation.invitation_code, 'Password!1');

      grantEditAccess.resetHistory();
      grantEditAccess
        .withArgs(sinon.match.any, failedCalendar, sinon.match.any)
        .resolves();
      sendEmail.resetHistory();

      await accountService.resendInvite(failedInvitation.id);

      expect(grantEditAccess.calledOnceWith(
        sinon.match({ id: inviter.id }),
        failedCalendar,
        account.id,
      )).toBe(true);
      expect(await AccountInvitationEntity.findByPk(failedInvitation.id)).toBeNull();
      // No invitation email: its link would lead to an accept that cannot
      // create the account again.
      expect(sendEmail.called).toBe(false);
    });
  });

  describe('application approval', () => {
    const applicantEmail = 'applicant@example.com';
    let applicationId: string;

    beforeEach(async () => {
      applicationId = uuidv4();
      await AccountApplicationEntity.create({
        id: applicationId,
        email: applicantEmail,
        message: 'let me in',
        status: 'pending',
        status_timestamp: new Date(),
      });
    });

    it('finishes the approval on a second attempt after the acceptance email failed', async () => {
      sendEmail.onFirstCall().rejects(new Error('smtp down'));

      await expect(accountService.acceptAccountApplication(applicationId)).rejects.toThrow('smtp down');
      expect(await AccountApplicationEntity.findByPk(applicationId)).not.toBeNull();

      const account = await accountService.acceptAccountApplication(applicationId);

      expect(account.email).toBe(applicantEmail);
      expect(await AccountEntity.count({ where: { email: applicantEmail } })).toBe(1);
      expect(await AccountApplicationEntity.findByPk(applicationId)).toBeNull();

      // One failed send, then exactly one delivered acceptance email.
      expect(sendEmail.callCount).toBe(2);
      const mail = sendEmail.secondCall.args[0] as MailData;
      expect(mail.emailAddress).toBe(applicantEmail);

      const secrets = await AccountSecretsEntity.findByPk(account.id);
      const code = secrets!.password_reset_code!;
      expect(mail.textMessage).toContain(code);

      const validated = await accountService.validatePasswordResetCode(code);
      expect(validated.id).toBe(account.id);
    });

    it('removes the application without sending anything when the account already has a password', async () => {
      const existing = (await accountService._setupAccount(applicantEmail, 'Password!1')).account;
      sendEmail.resetHistory();

      const account = await accountService.acceptAccountApplication(applicationId);

      expect(account.id).toBe(existing.id);
      expect(await AccountEntity.count({ where: { email: applicantEmail } })).toBe(1);
      expect(await AccountApplicationEntity.findByPk(applicationId)).toBeNull();
      expect(sendEmail.called).toBe(false);
    });
  });
});
