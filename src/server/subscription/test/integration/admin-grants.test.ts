import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import request from 'supertest';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import SubscriptionInterface from '@/server/subscription/interface';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import AccountService from '@/server/accounts/service/account';
import { TestEnvironment } from '@/server/test/lib/test_environment';
import { SubscriptionSettingsEntity } from '@/server/subscription/entity/subscription_settings';
import { ComplimentaryGrantEntity } from '@/server/subscription/entity/complimentary_grant';

/**
 * Integration tests for Admin Grant CRUD Endpoints
 *
 * Tests cover:
 * - Create grant for valid account → 201 with grant object
 * - Create grant for non-existent account → 404
 * - Create grant with invalid UUID → 400
 * - Create grant with duplicate active grant → 409
 * - Create grant with reason > 500 chars → 400
 * - Create grant with past expiresAt → 400
 * - List grants with includeRevoked=false → only active grants
 * - List grants with includeRevoked=true → all grants
 * - Revoke grant → 204 and grant is revoked
 * - Access widget after revoke → SubscriptionRequiredError
 */
describe('Admin Grant CRUD Integration Tests', () => {
  let env: TestEnvironment;
  let subscriptionInterface: SubscriptionInterface;
  let calendarInterface: CalendarInterface;
  let eventBus: EventEmitter;

  let adminAccount: Account;
  let regularAccount: Account;
  let regularCalendar: Calendar;
  let adminToken: string;
  let regularToken: string;

  const adminEmail = 'admin-grants@pavillion.dev';
  const regularEmail = 'regular-grants@pavillion.dev';
  const password = 'testpassword';

  /**
   * Enable subscriptions so widget access can be tested
   */
  async function enableSubscriptions() {
    let settings = await SubscriptionSettingsEntity.findOne();
    if (!settings) {
      settings = SubscriptionSettingsEntity.build({
        id: uuidv4(),
        enabled: true,
        monthly_price: 1000000,
        yearly_price: 10000000,
        currency: 'USD',
        pay_what_you_can: false,
        grace_period_days: 7,
      });
      await settings.save();
    }
    else {
      settings.enabled = true;
      await settings.save();
    }
  }

  /**
   * Clear all grants from the database
   */
  async function clearGrants() {
    await ComplimentaryGrantEntity.destroy({ where: {} });
  }

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    subscriptionInterface = new SubscriptionInterface(eventBus);
    calendarInterface = new CalendarInterface(eventBus, undefined, undefined, subscriptionInterface);

    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    // First account created → gets admin role
    const adminInfo = await accountService._setupAccount(adminEmail, password);
    adminAccount = adminInfo.account;

    // Second account → no admin role
    const regularInfo = await accountService._setupAccount(regularEmail, password);
    regularAccount = regularInfo.account;

    adminToken = await env.login(adminEmail, password);
    regularToken = await env.login(regularEmail, password);

    // Create a calendar with a widget domain for the regular account
    regularCalendar = await calendarInterface.createCalendar(regularAccount, 'grants-test-cal');

    // Set a widget domain while subscriptions are disabled
    await env.authPut(
      regularToken,
      `/api/v1/calendars/${regularCalendar.id}/widget/domain`,
      { domain: 'example.com' },
    );
  });

  afterAll(async () => {
    if (eventBus) {
      eventBus.removeAllListeners();
    }
    await env.cleanup();
  });

  beforeEach(async () => {
    await clearGrants();
  });

  // ─── POST /admin/grants ────────────────────────────────────────────────────

  describe('POST /api/subscription/v1/admin/grants', () => {
    it('should create a grant for a valid account and return 201 with grant object', async () => {
      const response = await request(env.app)
        .post('/api/subscription/v1/admin/grants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ accountId: regularAccount.id });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.accountId).toBe(regularAccount.id);
      expect(response.body.revokedAt).toBeNull();
    });

    it('should set grantedBy from the authenticated user, not from the request body', async () => {
      const fakeAdminId = uuidv4();

      const response = await request(env.app)
        .post('/api/subscription/v1/admin/grants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ accountId: regularAccount.id, grantedBy: fakeAdminId });

      expect(response.status).toBe(201);
      // grantedBy must be the authenticated user's ID, not fakeAdminId
      expect(response.body.grantedBy).toBe(adminAccount.id);
      expect(response.body.grantedBy).not.toBe(fakeAdminId);
    });

    it('should create a grant with optional reason and expiresAt', async () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);

      const response = await request(env.app)
        .post('/api/subscription/v1/admin/grants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          accountId: regularAccount.id,
          reason: 'Beta tester reward',
          expiresAt: futureDate.toISOString(),
        });

      expect(response.status).toBe(201);
      expect(response.body.reason).toBe('Beta tester reward');
      expect(response.body.expiresAt).not.toBeNull();
    });

    it('should return 404 when account does not exist', async () => {
      const nonExistentId = uuidv4();

      const response = await request(env.app)
        .post('/api/subscription/v1/admin/grants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ accountId: nonExistentId });

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 when accountId is not a valid UUID', async () => {
      const response = await request(env.app)
        .post('/api/subscription/v1/admin/grants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ accountId: 'not-a-valid-uuid' });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 409 when an active grant already exists for the account', async () => {
      // Create first grant
      await request(env.app)
        .post('/api/subscription/v1/admin/grants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ accountId: regularAccount.id });

      // Try to create duplicate
      const response = await request(env.app)
        .post('/api/subscription/v1/admin/grants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ accountId: regularAccount.id });

      expect(response.status).toBe(409);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 when reason exceeds 500 characters', async () => {
      const longReason = 'a'.repeat(501);

      const response = await request(env.app)
        .post('/api/subscription/v1/admin/grants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ accountId: regularAccount.id, reason: longReason });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 when expiresAt is a past date', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      const response = await request(env.app)
        .post('/api/subscription/v1/admin/grants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ accountId: regularAccount.id, expiresAt: pastDate.toISOString() });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 403 for non-admin users', async () => {
      const response = await request(env.app)
        .post('/api/subscription/v1/admin/grants')
        .set('Authorization', `Bearer ${regularToken}`)
        .send({ accountId: regularAccount.id });

      expect(response.status).toBe(403);
    });

    it('should return 401 for unauthenticated requests', async () => {
      const response = await request(env.app)
        .post('/api/subscription/v1/admin/grants')
        .send({ accountId: regularAccount.id });

      expect(response.status).toBe(401);
    });
  });

  // ─── GET /admin/grants ─────────────────────────────────────────────────────

  describe('GET /api/subscription/v1/admin/grants', () => {
    it('should return only active grants when includeRevoked=false (default)', async () => {
      // Create an active grant
      await subscriptionInterface.createGrant(regularAccount.id, adminAccount.id, 'active grant');

      // Create a revoked grant
      const grantToRevoke = await subscriptionInterface.createGrant(adminAccount.id, adminAccount.id, 'to revoke');
      await subscriptionInterface.revokeGrant(grantToRevoke.id, adminAccount.id);

      const response = await request(env.app)
        .get('/api/subscription/v1/admin/grants')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      // Only the active grant should be returned
      expect(response.body.length).toBe(1);
      expect(response.body[0].revokedAt).toBeNull();
    });

    it('should return all grants when includeRevoked=true', async () => {
      // Create an active grant
      await subscriptionInterface.createGrant(regularAccount.id, adminAccount.id, 'active grant');

      // Create a revoked grant
      const grantToRevoke = await subscriptionInterface.createGrant(adminAccount.id, adminAccount.id, 'to revoke');
      await subscriptionInterface.revokeGrant(grantToRevoke.id, adminAccount.id);

      const response = await request(env.app)
        .get('/api/subscription/v1/admin/grants?includeRevoked=true')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(2);
    });

    it('should return an empty array when no grants exist', async () => {
      const response = await request(env.app)
        .get('/api/subscription/v1/admin/grants')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(0);
    });

    it('should return 403 for non-admin users', async () => {
      const response = await request(env.app)
        .get('/api/subscription/v1/admin/grants')
        .set('Authorization', `Bearer ${regularToken}`);

      expect(response.status).toBe(403);
    });
  });

  // ─── DELETE /admin/grants/:id ──────────────────────────────────────────────

  describe('DELETE /api/subscription/v1/admin/grants/:id', () => {
    it('should revoke a grant and return 204 No Content', async () => {
      const grant = await subscriptionInterface.createGrant(regularAccount.id, adminAccount.id);

      const response = await request(env.app)
        .delete(`/api/subscription/v1/admin/grants/${grant.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(204);

      // Verify grant is revoked in the database
      const entity = await ComplimentaryGrantEntity.findByPk(grant.id);
      expect(entity).not.toBeNull();
      expect(entity?.revoked_at).not.toBeNull();
      expect(entity?.revoked_by).toBe(adminAccount.id);
    });

    it('should return 404 when grant does not exist', async () => {
      const nonExistentId = uuidv4();

      const response = await request(env.app)
        .delete(`/api/subscription/v1/admin/grants/${nonExistentId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
    });

    it('should return 400 when grant ID is not a valid UUID', async () => {
      const response = await request(env.app)
        .delete('/api/subscription/v1/admin/grants/not-a-valid-uuid')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 403 for non-admin users', async () => {
      const grant = await subscriptionInterface.createGrant(regularAccount.id, adminAccount.id);

      const response = await request(env.app)
        .delete(`/api/subscription/v1/admin/grants/${grant.id}`)
        .set('Authorization', `Bearer ${regularToken}`);

      expect(response.status).toBe(403);
    });

    it('should set revokedBy from the authenticated user, not from request body', async () => {
      const grant = await subscriptionInterface.createGrant(regularAccount.id, adminAccount.id);

      await request(env.app)
        .delete(`/api/subscription/v1/admin/grants/${grant.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ revokedBy: uuidv4() }); // Attempt to inject revokedBy

      const entity = await ComplimentaryGrantEntity.findByPk(grant.id);
      // revokedBy must be the authenticated user's ID
      expect(entity?.revoked_by).toBe(adminAccount.id);
    });
  });

  // ─── Widget access after revoke ────────────────────────────────────────────

  describe('Widget access after grant revocation', () => {
    it('should block widget access after grant is revoked (SubscriptionRequiredError)', async () => {
      await enableSubscriptions();

      // Create a grant to allow widget access
      const grant = await subscriptionInterface.createGrant(regularAccount.id, adminAccount.id);

      // Verify widget is accessible with the grant
      const accessResponse = await request(env.app)
        .get(`/api/widget/v1/calendars/${regularCalendar.urlName}`)
        .set('Origin', 'https://example.com');

      expect(accessResponse.status).toBe(200);

      // Revoke the grant
      await request(env.app)
        .delete(`/api/subscription/v1/admin/grants/${grant.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Widget access should now be blocked
      const blockedResponse = await request(env.app)
        .get(`/api/widget/v1/calendars/${regularCalendar.urlName}`)
        .set('Origin', 'https://example.com');

      expect(blockedResponse.status).toBe(402);
      expect(blockedResponse.body.errorName).toBe('SubscriptionRequiredError');
    });
  });
});
