import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import { Account } from '@/common/model/account';
import { AccountApplicationEntity } from '@/server/common/entity/account';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

/**
 * Integration tests for the admin applications list endpoint
 * (`GET /api/v1/applications`).
 *
 * Covers:
 *   - status filter passthrough (`pending_confirmation`, `pending`, `rejected`)
 *   - default-behavior exclusion of `pending_confirmation` rows from the
 *     admin queue
 *   - credential hygiene: response payload never exposes
 *     `confirmation_token` or `confirmation_token_expiration`
 *
 * Bead: pv-l9wv.4.4
 */
describe('Admin GET /api/v1/applications status filter (integration)', () => {
  let env: TestEnvironment;
  let adminAccount: Account;
  let adminToken: string;

  const adminEmail = 'admin-applications@pavillion.dev';
  const adminPassword = 'testpassword!1';

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    // First account in test mode is granted admin role automatically.
    const adminInfo = await accountService._setupAccount(adminEmail, adminPassword);
    adminAccount = adminInfo.account;

    adminToken = await env.login(adminEmail, adminPassword);
  });

  beforeEach(async () => {
    // Clear application rows between tests so each test seeds its own fixture set.
    await AccountApplicationEntity.destroy({ where: {}, truncate: true });
  });

  /**
   * Seed three rows (one per status) with token material on the
   * pending_confirmation row so the credential-hygiene assertions are
   * meaningful (i.e. token columns are populated in the DB but must NOT
   * appear in the response).
   */
  async function seedAllStatuses() {
    await AccountApplicationEntity.create({
      id: uuidv4(),
      email: 'pendingconf@example.com',
      message: 'pending confirmation applicant',
      status: 'pending_confirmation',
      status_timestamp: new Date(),
      confirmation_token: 'a-secret-token-do-not-leak',
      confirmation_token_expiration: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    await AccountApplicationEntity.create({
      id: uuidv4(),
      email: 'pending@example.com',
      message: 'pending applicant',
      status: 'pending',
      status_timestamp: new Date(),
    });
    await AccountApplicationEntity.create({
      id: uuidv4(),
      email: 'rejected@example.com',
      message: 'rejected applicant',
      status: 'rejected',
      status_timestamp: new Date(),
    });
  }

  it('default behavior (no status param) excludes pending_confirmation rows', async () => {
    await seedAllStatuses();

    const response = await env.authGet(adminToken, '/api/v1/applications');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('applications');
    const statuses = response.body.applications.map((a: any) => a.status);
    expect(statuses).toEqual(expect.arrayContaining(['pending', 'rejected']));
    expect(statuses).not.toContain('pending_confirmation');
    expect(response.body.applications).toHaveLength(2);
  });

  it('?status=pending_confirmation returns only pending_confirmation rows', async () => {
    await seedAllStatuses();

    const response = await env.authGet(adminToken, '/api/v1/applications?status=pending_confirmation');

    expect(response.status).toBe(200);
    expect(response.body.applications).toHaveLength(1);
    expect(response.body.applications[0].status).toBe('pending_confirmation');
    expect(response.body.applications[0].email).toBe('pendingconf@example.com');
  });

  it('?status=pending returns only pending rows (regression check)', async () => {
    await seedAllStatuses();

    const response = await env.authGet(adminToken, '/api/v1/applications?status=pending');

    expect(response.status).toBe(200);
    expect(response.body.applications).toHaveLength(1);
    expect(response.body.applications[0].status).toBe('pending');
  });

  it('?status=rejected returns only rejected rows (regression check)', async () => {
    await seedAllStatuses();

    const response = await env.authGet(adminToken, '/api/v1/applications?status=rejected');

    expect(response.status).toBe(200);
    expect(response.body.applications).toHaveLength(1);
    expect(response.body.applications[0].status).toBe('rejected');
  });

  it('unknown status values fall back to default-exclude behavior', async () => {
    await seedAllStatuses();

    // An unrecognized status must not leak the pending_confirmation bucket
    // (allow-list defense).
    const response = await env.authGet(adminToken, '/api/v1/applications?status=garbage');

    expect(response.status).toBe(200);
    const statuses = response.body.applications.map((a: any) => a.status);
    expect(statuses).not.toContain('pending_confirmation');
    expect(response.body.applications).toHaveLength(2);
  });

  it('response payload NEVER includes confirmation_token or confirmation_token_expiration', async () => {
    await seedAllStatuses();

    // Walk every status filter and the default to confirm token fields are
    // absent across the board.
    const urls = [
      '/api/v1/applications',
      '/api/v1/applications?status=pending_confirmation',
      '/api/v1/applications?status=pending',
      '/api/v1/applications?status=rejected',
    ];

    for (const url of urls) {
      const response = await env.authGet(adminToken, url);
      expect(response.status).toBe(200);
      for (const row of response.body.applications) {
        expect(row).not.toHaveProperty('confirmation_token');
        expect(row).not.toHaveProperty('confirmation_token_expiration');
        // Belt and suspenders: also check serialized JSON for any accidental leak.
        const serialized = JSON.stringify(row);
        expect(serialized).not.toContain('a-secret-token-do-not-leak');
      }
    }
  });
});
