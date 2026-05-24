import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import AccountService from '@/server/accounts/service/account';
import CalendarService from '@/server/calendar/service/calendar';
import { CalendarMemberEntity } from '@/server/calendar/entity/calendar_member';
import { UserActorEntity } from '@/server/activitypub/entity/user_actor';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

/**
 * Integration / contract test for CalendarService.getOwnersForCalendar.
 *
 * Seeds a real CalendarEntity with three CalendarMemberEntity rows:
 *   - role='owner' with a local account
 *   - role='editor' with a local account
 *   - role='owner' with account_id=null (remote-only membership via user_actor_id)
 *
 * Asserts the resolver returns ONLY the local owner's account id. This is
 * the contract relied on by the notifications role resolver (pv-89mw.3.3):
 * if anyone removes the `role: 'owner'` or `account_id != null` filters
 * from the underlying query, this test fails.
 */
describe('CalendarService.getOwnersForCalendar - Integration', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let service: CalendarService;
  let ownerAccount: Account;
  let editorAccount: Account;
  let calendar: Calendar;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountsInterface = new AccountsInterface(eventBus, configurationInterface, setupInterface);
    calendarInterface = new CalendarInterface(eventBus, accountsInterface, configurationInterface);
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);
    service = new CalendarService();

    // Owner — createCalendar inserts the owner CalendarMember row.
    const ownerInfo = await accountService._setupAccount('owner@pavillion.dev', 'testpassword');
    ownerAccount = ownerInfo.account;
    calendar = await calendarInterface.createCalendar(ownerAccount, 'ownersresolvercal');

    // Editor — local account, role='editor'. Inserted directly so we can
    // assert this row is filtered out by role, independent of any
    // grantEditAccessByEmail side effects.
    const editorInfo = await accountService._setupAccount('editor@pavillion.dev', 'testpassword');
    editorAccount = editorInfo.account;
    await CalendarMemberEntity.create({
      id: uuidv4(),
      calendar_id: calendar.id,
      account_id: editorAccount.id,
      role: 'editor',
      granted_by: ownerAccount.id,
    });

    // Remote-only owner — account_id=null with a user_actor_id. Tests the
    // `account_id != null` strand of the filter: even a remote member with
    // role='owner' must not surface in a local-accounts result.
    const remoteUserActor = await UserActorEntity.create({
      id: uuidv4(),
      actor_type: 'remote',
      account_id: null,
      actor_uri: 'https://remote.example.com/users/remoteowner',
      remote_domain: 'remote.example.com',
    });
    await CalendarMemberEntity.create({
      id: uuidv4(),
      calendar_id: calendar.id,
      account_id: null,
      user_actor_id: remoteUserActor.id,
      role: 'owner',
      granted_by: ownerAccount.id,
    });
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  it('returns only the local owner account id, excluding editors and remote-only owners', async () => {
    const result = await service.getOwnersForCalendar(calendar.id);

    const returnedIds = result.map(a => a.id);
    expect(returnedIds).toEqual([ownerAccount.id]);
    expect(returnedIds).not.toContain(editorAccount.id);
  });
});
