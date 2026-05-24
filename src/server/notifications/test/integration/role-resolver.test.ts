import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import AccountService from '@/server/accounts/service/account';
import { AccountRoleEntity } from '@/server/common/entity/account';
import { CalendarMemberEntity } from '@/server/calendar/entity/calendar_member';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { resolveRoleAudience } from '@/server/notifications/service/role-resolver';

/**
 * Integration test for the notifications role resolver (pv-89mw.3.3).
 *
 * This MUST be an integration test (not unit) and
 * doubles as a contract test for
 * `CalendarInterface.getOwnersForCalendar` (pv-89mw.1.1) and
 * `AccountsInterface.getInstanceAdmins` (pv-89mw.1.2): seed the three
 * role pools, call the resolver per role, and assert on actual returned
 * `account_id` values — never stub call counts.
 */
describe('resolveRoleAudience (integration)', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let accountsInterface: AccountsInterface;
  let ownerAccount: Account;
  let editorAccount: Account;
  let adminAccount: Account;
  let unrelatedAccount: Account;
  let calendar: Calendar;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    accountsInterface = new AccountsInterface(
      eventBus,
      configurationInterface,
      setupInterface,
    );
    calendarInterface = new CalendarInterface(
      eventBus,
      accountsInterface,
    );
    const accountService = new AccountService(
      eventBus,
      configurationInterface,
      setupInterface,
    );

    // Owner — createCalendar inserts the owner CalendarMember row.
    const ownerInfo = await accountService._setupAccount('role-resolver-owner@pavillion.dev', 'testpassword');
    ownerAccount = ownerInfo.account;
    calendar = await calendarInterface.createCalendar(ownerAccount, 'roleresolvercal');

    // Editor — local account with role='editor' on the calendar.
    const editorInfo = await accountService._setupAccount('role-resolver-editor@pavillion.dev', 'testpassword');
    editorAccount = editorInfo.account;
    await CalendarMemberEntity.create({
      id: uuidv4(),
      calendar_id: calendar.id,
      account_id: editorAccount.id,
      role: 'editor',
      granted_by: ownerAccount.id,
    });

    // Admin — local account with global admin role; no calendar membership.
    const adminInfo = await accountService._setupAccount('role-resolver-admin@pavillion.dev', 'testpassword');
    adminAccount = adminInfo.account;
    await AccountRoleEntity.create({ account_id: adminAccount.id, role: 'admin' });

    // No calendar role, no admin role — must never appear in any resolver result.
    const unrelatedInfo = await accountService._setupAccount('role-resolver-unrelated@pavillion.dev', 'testpassword');
    unrelatedAccount = unrelatedInfo.account;

    // `_setupAccount` auto-grants the first account in the test DB the
    // admin role (it bootstraps an instance admin so setup-mode
    // middleware doesn't block other tests). Normalize the admin pool
    // so this suite asserts on a single, explicit admin.
    await AccountRoleEntity.destroy({ where: { role: 'admin' } });
    await AccountRoleEntity.create({ account_id: adminAccount.id, role: 'admin' });
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  describe('calendar-editors', () => {
    it('returns owner + editor account IDs for the calendar', async () => {
      const result = await resolveRoleAudience(
        'calendar-editors',
        { type: 'calendar', id: calendar.id },
        { calendarInterface, accountsInterface },
      );

      // Owner has edit access (membership row), as does the editor.
      expect(result).toEqual(expect.arrayContaining([ownerAccount.id, editorAccount.id]));
      expect(result).toHaveLength(2);
      expect(result).not.toContain(adminAccount.id);
      expect(result).not.toContain(unrelatedAccount.id);
    });

    it('throws when objectRef is missing', async () => {
      await expect(
        resolveRoleAudience(
          'calendar-editors',
          undefined,
          { calendarInterface, accountsInterface },
        ),
      ).rejects.toThrow(/object/i);
    });

    it('throws when objectRef.type is not calendar', async () => {
      await expect(
        resolveRoleAudience(
          'calendar-editors',
          { type: 'event', id: calendar.id },
          { calendarInterface, accountsInterface },
        ),
      ).rejects.toThrow(/calendar/i);
    });
  });

  describe('calendar-owners', () => {
    it('returns only the local owner account ID for the calendar', async () => {
      const result = await resolveRoleAudience(
        'calendar-owners',
        { type: 'calendar', id: calendar.id },
        { calendarInterface, accountsInterface },
      );

      expect(result).toEqual([ownerAccount.id]);
      expect(result).not.toContain(editorAccount.id);
      expect(result).not.toContain(adminAccount.id);
    });

    it('throws when objectRef is missing', async () => {
      await expect(
        resolveRoleAudience(
          'calendar-owners',
          undefined,
          { calendarInterface, accountsInterface },
        ),
      ).rejects.toThrow(/object/i);
    });

    it('throws when objectRef.type is not calendar', async () => {
      await expect(
        resolveRoleAudience(
          'calendar-owners',
          { type: 'report', id: calendar.id },
          { calendarInterface, accountsInterface },
        ),
      ).rejects.toThrow(/calendar/i);
    });
  });

  describe('instance-admins', () => {
    it('returns admin account IDs and excludes non-admins', async () => {
      const result = await resolveRoleAudience(
        'instance-admins',
        undefined,
        { calendarInterface, accountsInterface },
      );

      expect(result).toHaveLength(1);
      expect(result).toContain(adminAccount.id);
      expect(result).not.toContain(ownerAccount.id);
      expect(result).not.toContain(editorAccount.id);
      expect(result).not.toContain(unrelatedAccount.id);
    });

    it('throws when an objectRef is supplied', async () => {
      await expect(
        resolveRoleAudience(
          'instance-admins',
          { type: 'calendar', id: calendar.id },
          { calendarInterface, accountsInterface },
        ),
      ).rejects.toThrow(/no object/i);
    });
  });
});
