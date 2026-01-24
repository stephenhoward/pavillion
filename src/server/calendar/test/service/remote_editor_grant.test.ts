import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import sinon from 'sinon';
import axios from 'axios';

import db from '@/server/common/entity/db';
import CalendarService from '@/server/calendar/service/calendar';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { AccountEntity } from '@/server/common/entity/account';
import { CalendarEditorRemoteEntity } from '@/server/calendar/entity/calendar_editor_remote';
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
    await CalendarEditorRemoteEntity.destroy({ where: {}, force: true });
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

      // Verify entity was created
      const remoteEditor = await CalendarEditorRemoteEntity.findOne({
        where: { calendar_id: testCalendarId },
      });
      expect(remoteEditor).not.toBeNull();
      expect(remoteEditor?.actor_uri).toBe('https://beta.federation.local/users/Admin');
      expect(remoteEditor?.remote_username).toBe('Admin');
      expect(remoteEditor?.remote_domain).toBe('beta.federation.local');
    });

    it('should throw error if remote editor already exists', async () => {
      // Create existing remote editor
      await CalendarEditorRemoteEntity.create({
        id: uuidv4(),
        calendar_id: testCalendarId,
        actor_uri: 'https://beta.federation.local/users/Admin',
        remote_username: 'Admin',
        remote_domain: 'beta.federation.local',
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
      // Create a remote editor first
      await CalendarEditorRemoteEntity.create({
        id: uuidv4(),
        calendar_id: testCalendarId,
        actor_uri: 'https://beta.federation.local/users/Editor',
        remote_username: 'Editor',
        remote_domain: 'beta.federation.local',
        granted_by: testAccountId,
      });

      // Verify it exists
      let count = await CalendarEditorRemoteEntity.count({ where: { calendar_id: testCalendarId } });
      expect(count).toBe(1);

      // Remove the remote editor
      const result = await service.removeRemoteEditor(
        testAccount,
        testCalendarId,
        'https://beta.federation.local/users/Editor',
      );

      expect(result).toBe(true);

      // Verify it was removed
      count = await CalendarEditorRemoteEntity.count({ where: { calendar_id: testCalendarId } });
      expect(count).toBe(0);
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

      // Create a remote editor
      await CalendarEditorRemoteEntity.create({
        id: uuidv4(),
        calendar_id: testCalendarId,
        actor_uri: 'https://beta.federation.local/users/Editor',
        remote_username: 'Editor',
        remote_domain: 'beta.federation.local',
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

      // Create a remote editor
      await CalendarEditorRemoteEntity.create({
        id: uuidv4(),
        calendar_id: testCalendarId,
        actor_uri: 'https://beta.federation.local/users/Editor',
        remote_username: 'Editor',
        remote_domain: 'beta.federation.local',
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
