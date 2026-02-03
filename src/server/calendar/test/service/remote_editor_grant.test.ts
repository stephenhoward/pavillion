import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import sinon from 'sinon';
import axios from 'axios';

import db from '@/server/common/entity/db';
import CalendarService from '@/server/calendar/service/calendar';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { AccountEntity } from '@/server/common/entity/account';
import { CalendarMemberEntity } from '@/server/calendar/entity/calendar_member';
import { UserActorEntity } from '@/server/activitypub/entity/user_actor';
import { Account } from '@/common/model/account';
import AccountsInterface from '@/server/accounts/interface';
import { EventEmitter } from 'events';

/**
 * Tests for remote (federated) editor functionality in CalendarService.
 *
 * Note: The test config has domain "pavillion.dev", so federated emails
 * must use a different domain like "beta.federation.local" to be detected
 * as federated.
 */
describe('CalendarService.grantEditAccessByEmail - Remote Editors', () => {
  let sandbox: sinon.SinonSandbox;
  let service: CalendarService;
  let mockAccountsInterface: Partial<AccountsInterface>;
  let testAccountId: string;
  let testCalendarId: string;
  let testAccount: Account;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    await db.sync({ force: true });

    // Create test account
    testAccountId = uuidv4();
    await AccountEntity.create({
      id: testAccountId,
      email: 'owner@pavillion.dev',
      is_activated: true,
    });
    testAccount = new Account(testAccountId, 'owner@pavillion.dev');

    // Create test calendar
    testCalendarId = uuidv4();
    await CalendarEntity.create({
      id: testCalendarId,
      account_id: testAccountId,
      url_name: 'test_calendar',
      languages: 'en',
    });

    // Create CalendarMemberEntity owner row (needed for isCalendarOwner reads)
    await CalendarMemberEntity.create({
      id: uuidv4(),
      calendar_id: testCalendarId,
      account_id: testAccountId,
      role: 'owner',
      granted_by: null,
    });

    // Mock accounts interface
    mockAccountsInterface = {
      getAccountByEmail: sandbox.stub().resolves(null),
      inviteNewAccount: sandbox.stub().resolves({ id: 'invitation-123' }),
    };

    service = new CalendarService(
      mockAccountsInterface as AccountsInterface,
      new EventEmitter(),
    );
  });

  afterEach(async () => {
    sandbox.restore();
    await CalendarMemberEntity.destroy({ where: {}, force: true });
    await UserActorEntity.destroy({ where: {}, force: true });
    await CalendarEntity.destroy({ where: {}, force: true });
    await AccountEntity.destroy({ where: {}, force: true });
  });

  describe('parseFederatedEmail (via integration)', () => {
    it('should detect federated email format for .local domains', async () => {
      // Mock WebFinger and Person actor responses
      const axiosStub = sandbox.stub(axios, 'get');

      // WebFinger lookup
      axiosStub.onFirstCall().resolves({
        data: {
          subject: 'acct:@Admin@beta.federation.local',
          links: [
            {
              rel: 'self',
              type: 'application/activity+json',
              href: 'https://beta.federation.local/users/Admin',
            },
          ],
        },
      });

      // Person actor fetch
      axiosStub.onSecondCall().resolves({
        data: {
          type: 'Person',
          preferredUsername: 'Admin',
          inbox: 'https://beta.federation.local/users/Admin/inbox',
          publicKey: {
            publicKeyPem: '-----BEGIN PUBLIC KEY-----...',
          },
        },
      });

      // Federated email (beta.federation.local is different from pavillion.dev)
      const result = await service.grantEditAccessByEmail(
        testAccount,
        testCalendarId,
        'Admin@beta.federation.local',
      );

      expect(result.type).toBe('remote_editor');
      expect((result.data as any).actorUri).toBe('https://beta.federation.local/users/Admin');
    });

    it('should not treat standard email domains as federated', async () => {
      // Standard email should fall through to invitation
      const result = await service.grantEditAccessByEmail(
        testAccount,
        testCalendarId,
        'newuser@gmail.com',
      );

      expect(result.type).toBe('invitation');
      expect((mockAccountsInterface.inviteNewAccount as sinon.SinonStub).calledOnce).toBe(true);
    });

    it('should not treat local domain as federated', async () => {
      // Email on local domain should fall through to invitation (user not found locally)
      const result = await service.grantEditAccessByEmail(
        testAccount,
        testCalendarId,
        'newuser@pavillion.dev',
      );

      expect(result.type).toBe('invitation');
    });
  });

  describe('grantRemoteEditorAccess', () => {
    it('should grant remote editor access via WebFinger lookup', async () => {
      // Mock WebFinger response
      const axiosStub = sandbox.stub(axios, 'get');

      // WebFinger lookup
      axiosStub.onFirstCall().resolves({
        data: {
          subject: 'acct:@Admin@beta.federation.local',
          links: [
            {
              rel: 'self',
              type: 'application/activity+json',
              href: 'https://beta.federation.local/users/Admin',
            },
          ],
        },
      });

      // Person actor fetch
      axiosStub.onSecondCall().resolves({
        data: {
          type: 'Person',
          preferredUsername: 'Admin',
          inbox: 'https://beta.federation.local/users/Admin/inbox',
          publicKey: {
            publicKeyPem: '-----BEGIN PUBLIC KEY-----...',
          },
        },
      });

      const result = await service.grantEditAccessByEmail(
        testAccount,
        testCalendarId,
        'Admin@beta.federation.local',
      );

      expect(result.type).toBe('remote_editor');
      expect((result.data as any).actorUri).toBe('https://beta.federation.local/users/Admin');

      // Verify UserActorEntity was created
      const userActor = await UserActorEntity.findOne({
        where: { actor_uri: 'https://beta.federation.local/users/Admin' },
      });
      expect(userActor).not.toBeNull();
      expect(userActor?.remote_username).toBe('Admin');
      expect(userActor?.remote_domain).toBe('beta.federation.local');

      // Verify CalendarMemberEntity was created with user_actor_id
      const membership = await CalendarMemberEntity.findOne({
        where: {
          calendar_id: testCalendarId,
          user_actor_id: userActor!.id,
          role: 'editor',
        },
      });
      expect(membership).not.toBeNull();
    });

    it('should throw error if remote editor already exists', async () => {
      // Create existing UserActorEntity for the remote user
      const userActorId = uuidv4();
      await UserActorEntity.create({
        id: userActorId,
        actor_type: 'remote',
        account_id: null,
        actor_uri: 'https://beta.federation.local/users/Admin',
        remote_username: 'Admin',
        remote_domain: 'beta.federation.local',
        public_key: null,
        private_key: null,
      });

      // Create existing CalendarMemberEntity for the remote editor
      await CalendarMemberEntity.create({
        id: uuidv4(),
        calendar_id: testCalendarId,
        user_actor_id: userActorId,
        role: 'editor',
        granted_by: testAccountId,
      });

      // Mock WebFinger response
      const axiosStub = sandbox.stub(axios, 'get');
      axiosStub.onFirstCall().resolves({
        data: {
          subject: 'acct:@Admin@beta.federation.local',
          links: [
            {
              rel: 'self',
              type: 'application/activity+json',
              href: 'https://beta.federation.local/users/Admin',
            },
          ],
        },
      });
      axiosStub.onSecondCall().resolves({
        data: {
          type: 'Person',
          preferredUsername: 'Admin',
          inbox: 'https://beta.federation.local/users/Admin/inbox',
        },
      });

      await expect(
        service.grantEditAccessByEmail(testAccount, testCalendarId, 'Admin@beta.federation.local'),
      ).rejects.toThrow('already an editor');
    });

    it('should throw error if WebFinger lookup fails', async () => {
      const axiosStub = sandbox.stub(axios, 'get');
      axiosStub.rejects({ code: 'ENOTFOUND' });

      await expect(
        service.grantEditAccessByEmail(testAccount, testCalendarId, 'Admin@nonexistent.federation.local'),
      ).rejects.toThrow('Could not connect');
    });

    it('should throw error if Person actor type is wrong', async () => {
      const axiosStub = sandbox.stub(axios, 'get');

      // WebFinger lookup returns a service actor
      axiosStub.onFirstCall().resolves({
        data: {
          subject: 'acct:@service@beta.federation.local',
          links: [
            {
              rel: 'self',
              type: 'application/activity+json',
              href: 'https://beta.federation.local/service',
            },
          ],
        },
      });

      // Actor is a Service, not a Person
      axiosStub.onSecondCall().resolves({
        data: {
          type: 'Service',
          preferredUsername: 'service',
        },
      });

      await expect(
        service.grantEditAccessByEmail(testAccount, testCalendarId, 'service@beta.federation.local'),
      ).rejects.toThrow('Expected Person actor');
    });
  });

  describe('removeRemoteEditor', () => {
    it('should remove remote editor by actor URI', async () => {
      // Create UserActorEntity for the remote editor
      const userActorId = uuidv4();
      await UserActorEntity.create({
        id: userActorId,
        actor_type: 'remote',
        account_id: null,
        actor_uri: 'https://beta.federation.local/users/Editor',
        remote_username: 'Editor',
        remote_domain: 'beta.federation.local',
        public_key: null,
        private_key: null,
      });

      // Create CalendarMemberEntity for the remote editor
      await CalendarMemberEntity.create({
        id: uuidv4(),
        calendar_id: testCalendarId,
        user_actor_id: userActorId,
        role: 'editor',
        granted_by: testAccountId,
      });

      // Verify membership exists
      let membership = await CalendarMemberEntity.findOne({
        where: { calendar_id: testCalendarId, user_actor_id: userActorId },
      });
      expect(membership).not.toBeNull();

      // Remove the remote editor
      const result = await service.removeRemoteEditor(
        testAccount,
        testCalendarId,
        'https://beta.federation.local/users/Editor',
      );

      expect(result).toBe(true);

      // Verify membership was removed
      membership = await CalendarMemberEntity.findOne({
        where: { calendar_id: testCalendarId, user_actor_id: userActorId },
      });
      expect(membership).toBeNull();

      // UserActorEntity should still exist (we don't delete actors)
      const userActor = await UserActorEntity.findByPk(userActorId);
      expect(userActor).not.toBeNull();
    });

    it('should throw EditorNotFoundError if remote editor does not exist', async () => {
      await expect(
        service.removeRemoteEditor(
          testAccount,
          testCalendarId,
          'https://beta.federation.local/users/NonExistent',
        ),
      ).rejects.toThrow('Editor relationship not found');
    });

    it('should throw CalendarNotFoundError if calendar does not exist', async () => {
      await expect(
        service.removeRemoteEditor(
          testAccount,
          'non-existent-calendar-id',
          'https://beta.federation.local/users/Editor',
        ),
      ).rejects.toThrow('Calendar not found');
    });

    it('should allow admin to remove remote editor from any calendar', async () => {
      // Create admin account
      const adminAccountId = uuidv4();
      await AccountEntity.create({
        id: adminAccountId,
        email: 'admin@pavillion.dev',
        is_activated: true,
      });
      const adminAccount = new Account(adminAccountId, 'admin@pavillion.dev');
      adminAccount.roles = ['admin'];

      // Create UserActorEntity for the remote editor
      const userActorId = uuidv4();
      await UserActorEntity.create({
        id: userActorId,
        actor_type: 'remote',
        account_id: null,
        actor_uri: 'https://beta.federation.local/users/Editor',
        remote_username: 'Editor',
        remote_domain: 'beta.federation.local',
        public_key: null,
        private_key: null,
      });

      // Create CalendarMemberEntity for the remote editor
      await CalendarMemberEntity.create({
        id: uuidv4(),
        calendar_id: testCalendarId,
        user_actor_id: userActorId,
        role: 'editor',
        granted_by: testAccountId,
      });

      // Admin should be able to remove
      const result = await service.removeRemoteEditor(
        adminAccount,
        testCalendarId,
        'https://beta.federation.local/users/Editor',
      );

      expect(result).toBe(true);
    });

    it('should throw CalendarEditorPermissionError for non-owner non-admin', async () => {
      // Create another account that is not the owner
      const otherAccountId = uuidv4();
      await AccountEntity.create({
        id: otherAccountId,
        email: 'other@pavillion.dev',
        is_activated: true,
      });
      const otherAccount = new Account(otherAccountId, 'other@pavillion.dev');

      // Create UserActorEntity for the remote editor
      const userActorId = uuidv4();
      await UserActorEntity.create({
        id: userActorId,
        actor_type: 'remote',
        account_id: null,
        actor_uri: 'https://beta.federation.local/users/Editor',
        remote_username: 'Editor',
        remote_domain: 'beta.federation.local',
        public_key: null,
        private_key: null,
      });

      // Create CalendarMemberEntity for the remote editor
      await CalendarMemberEntity.create({
        id: uuidv4(),
        calendar_id: testCalendarId,
        user_actor_id: userActorId,
        role: 'editor',
        granted_by: testAccountId,
      });

      // Non-owner should not be able to remove
      await expect(
        service.removeRemoteEditor(
          otherAccount,
          testCalendarId,
          'https://beta.federation.local/users/Editor',
        ),
      ).rejects.toThrow('Permission denied');
    });
  });
});
