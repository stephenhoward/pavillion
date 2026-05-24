import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import {
  AccountEntity,
  AccountRoleEntity,
} from '@/server/common/entity/account';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import EmailInterface from '@/server/email/interface';
import AccountsInterface from '@/server/accounts/interface';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

/**
 * Integration tests for `AccountService.getInstanceAdmins` (and its
 * facade `AccountsInterface.getInstanceAdmins`).
 *
 * Used by the notifications role resolver to fan out activities with
 * audience `{ kind: 'role', role: 'instance-admins' }`. The contract is
 * narrow: returns the account IDs of every account that has the `admin`
 * role; empty array when no admins exist.
 *
 * Bead: pv-89mw.1.2
 */
describe('getInstanceAdmins (integration)', () => {
  let env: TestEnvironment;
  let accountService: AccountService;
  let accountsInterface: AccountsInterface;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const emailInterface = new EmailInterface();
    accountService = new AccountService(
      eventBus,
      configurationInterface,
      setupInterface,
      emailInterface,
    );
    accountsInterface = new AccountsInterface(
      eventBus,
      configurationInterface,
      setupInterface,
      emailInterface,
    );
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  beforeEach(async () => {
    // Clear all roles; account rows are preserved across tests so the FK
    // chain via account_secrets stays intact. Each test re-seeds the role
    // assignments it needs.
    await AccountRoleEntity.destroy({ where: {}, truncate: true });
  });

  /** Create an account row with an optional role. */
  async function seedAccount(
    overrides: { role?: string; email?: string } = {},
  ): Promise<AccountEntity> {
    const id = uuidv4();
    const account = await AccountEntity.create({
      id,
      username: `user-${id}`,
      email: overrides.email ?? `acct-${id}@example.com`,
    });
    if (overrides.role) {
      await AccountRoleEntity.create({ account_id: id, role: overrides.role });
    }
    return account;
  }

  it('returns only admin account IDs, excluding non-admins', async () => {
    const admin1 = await seedAccount({ role: 'admin', email: 'admin1@example.com' });
    const admin2 = await seedAccount({ role: 'admin', email: 'admin2@example.com' });
    const nonAdmin = await seedAccount({ email: 'regular@example.com' });

    const result = await accountService.getInstanceAdmins();

    // Argument-level assertions: the returned set must equal the admin IDs
    // and must not include the non-admin.
    expect(result).toHaveLength(2);
    expect(result).toContain(admin1.id);
    expect(result).toContain(admin2.id);
    expect(result).not.toContain(nonAdmin.id);
  });

  it('returns an empty array when no admins exist (no error)', async () => {
    await seedAccount({ email: 'regular@example.com' });

    const result = await accountService.getInstanceAdmins();

    expect(result).toEqual([]);
  });

  it('is exposed via AccountsInterface and delegates to the service', async () => {
    const admin = await seedAccount({ role: 'admin', email: 'admin@example.com' });

    const result = await accountsInterface.getInstanceAdmins();

    expect(result).toEqual([admin.id]);
  });
});
