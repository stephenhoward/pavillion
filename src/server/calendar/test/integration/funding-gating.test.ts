import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import request from 'supertest';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import FundingInterface from '@/server/funding/interface';
import AccountsInterface from '@/server/accounts/interface';
import AccountService from '@/server/accounts/service/account';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { AccountRoleEntity } from '@/server/common/entity/account';
import { FundingSettingsEntity } from '@/server/funding/entity/funding_settings';
import { FundingPlanEntity } from '@/server/funding/entity/funding_plan';
import { CalendarFundingPlanEntity } from '@/server/funding/entity/calendar_funding_plan';

/**
 * Integration tests for Funding Gating in Widget Embedding
 *
 * These tests verify that funding-gate enforcement works correctly for:
 * - Widget domain configuration (PUT /api/v1/calendars/:calendarId/widget/domain)
 * - Widget data serving (GET /api/widget/v1/calendars/:urlName)
 *
 * Test scenarios:
 * - Funding enabled + no funding plan → 402 error
 * - Funding enabled + active funding plan → success
 * - Funding enabled + expired funding plan → 402 error
 * - Funding disabled → always success (free instance mode)
 * - Admin-owned calendars exempt regardless of plan
 * - Security audit scenarios
 * - Edge cases and race conditions
 *
 * Fixture contract: exactly one account here holds the 'admin' role —
 * adminAccount — and beforeAll asserts it. Admin-owned calendars are exempt
 * from the funding gate (checkFundingAccess invariant 2), so any test that
 * means to observe gating or check ordering must use a calendar owned by one
 * of the non-admin accounts. See the note in beforeAll.
 */
describe('Funding Gating Integration Tests', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let fundingInterface: FundingInterface;
  let eventBus: EventEmitter;

  // The instance admin. Deliberately the first account this file creates —
  // see the note in beforeAll — so the implicit test-mode admin grant lands
  // somewhere named, and every other account below is non-admin by
  // construction rather than by accident of creation order.
  let adminAccount: Account;
  let adminCalendar: Calendar;
  let adminToken: string;

  let supporterAccount: Account;
  let nonSupporterAccount: Account;
  let coveredCalendar: Calendar;
  let uncoveredCalendar: Calendar;
  let supporterToken: string;
  let nonSupporterToken: string;

  // A third non-admin party: owns a calendar that no other test account may
  // edit and that never receives a funding plan or grant. Needed to test
  // check ordering, which is unobservable on an admin-owned calendar because
  // the admin exemption opens the gate before ordering can matter.
  let outsiderCalendar: Calendar;

  const adminEmail = 'instance-admin@pavillion.dev';
  const supporterEmail = 'supporter@pavillion.dev';
  const nonSupporterEmail = 'non-supporter@pavillion.dev';
  const outsiderEmail = 'outsider@pavillion.dev';
  const password = 'testpassword';

  /**
   * Helper function to enable funding instance-wide
   */
  async function enableFunding() {
    let settings = await FundingSettingsEntity.findOne();
    if (!settings) {
      settings = FundingSettingsEntity.build({
        id: uuidv4(),
        enabled: true,
        monthly_price: 5.00,
        yearly_price: 50.00,
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
   * Helper function to disable funding instance-wide
   */
  async function disableFunding() {
    let settings = await FundingSettingsEntity.findOne();
    if (!settings) {
      settings = FundingSettingsEntity.build({
        id: uuidv4(),
        enabled: false,
        monthly_price: 0,
        yearly_price: 0,
        currency: 'USD',
        pay_what_you_can: false,
        grace_period_days: 7,
      });
      await settings.save();
    }
    else {
      settings.enabled = false;
      await settings.save();
    }
  }

  /**
   * Helper function to create an active funding plan for an account and link it to a calendar.
   * checkFundingAccess looks for a live CalendarFundingPlanEntity allocation on an active
   * plan, so both a FundingPlanEntity and a CalendarFundingPlanEntity are required.
   */
  async function createActiveFundingPlan(accountId: string, calendarId?: string) {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1); // 1 year in the future

    const plan = FundingPlanEntity.build({
      id: uuidv4(),
      account_id: accountId,
      provider_type: 'stripe',
      provider_subscription_id: `sub_${uuidv4()}`,
      status: 'active',
      billing_cycle: 'monthly',
      amount: 5.00,
      currency: 'USD',
      current_period_start: new Date(),
      current_period_end: futureDate,
      created_at: new Date(),
      updated_at: new Date(),
    });
    await plan.save();

    // Link the plan to the calendar so the gate opens for that calendar
    if (calendarId) {
      const calendarSub = CalendarFundingPlanEntity.build({
        id: uuidv4(),
        funding_plan_id: plan.id,
        calendar_id: calendarId,
        amount: 5.00,
        end_time: null,
      });
      await calendarSub.save();
    }

    return plan;
  }

  /**
   * Helper function to create an expired funding plan for an account
   */
  async function createExpiredFundingPlan(accountId: string) {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 30); // 30 days ago

    const plan = FundingPlanEntity.build({
      id: uuidv4(),
      account_id: accountId,
      provider_type: 'stripe',
      provider_subscription_id: `sub_${uuidv4()}`,
      status: 'expired',
      billing_cycle: 'monthly',
      amount: 5.00,
      currency: 'USD',
      current_period_start: new Date(pastDate.getTime() - 30 * 24 * 60 * 60 * 1000),
      current_period_end: pastDate,
      created_at: pastDate,
      updated_at: new Date(),
    });
    await plan.save();
  }

  /**
   * Helper function to clear all funding plans for an account (and their calendar links)
   */
  async function clearFundingPlans(accountId: string) {
    // Find all funding plans for this account first
    const subs = await FundingPlanEntity.findAll({ where: { account_id: accountId } });
    const subIds = subs.map((s) => s.id);

    // Remove calendar coverage links before removing funding plans
    if (subIds.length > 0) {
      await CalendarFundingPlanEntity.destroy({ where: { funding_plan_id: subIds } });
    }

    await FundingPlanEntity.destroy({
      where: { account_id: accountId },
    });
  }

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    fundingInterface = new FundingInterface(eventBus);
    calendarInterface = new CalendarInterface(eventBus, undefined, undefined, fundingInterface);
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    // Mirror server.ts: the admin exemption is a two-hop cross-domain read —
    // CalendarInterface resolves the calendar's owner, AccountsInterface says
    // whether that owner holds the admin role. Both back-references have to be
    // wired for checkFundingAccess to answer from a complete picture.
    fundingInterface.setCalendarInterface(calendarInterface);
    fundingInterface.setAccountsInterface(
      new AccountsInterface(eventBus, configurationInterface, setupInterface),
    );
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    // AccountService._setupAccount grants the 'admin' role to the FIRST
    // account created under NODE_ENV=test, so that the setup-mode middleware
    // lets the suite run. That grant is implicit and creation-order dependent:
    // whichever account happens to be created first becomes exempt from the
    // funding gate by invariant 2, which silently makes any gating assertion
    // about that account's calendars vacuous.
    //
    // So this file claims the grant deliberately. The admin fixture is created
    // first, named, and pinned by the assertion below; every account created
    // afterwards is guaranteed non-admin. Anyone reordering these lines gets a
    // failing beforeAll rather than a quietly meaningless test.
    const adminInfo = await accountService._setupAccount(adminEmail, password);
    adminAccount = adminInfo.account;

    const adminRoleRows = await AccountRoleEntity.findAll({ where: { role: 'admin' } });
    expect(adminRoleRows.map((row) => row.account_id)).toEqual([adminAccount.id]);

    // Create test accounts — all non-admin, the admin grant is already spent
    let supporterInfo = await accountService._setupAccount(supporterEmail, password);
    supporterAccount = supporterInfo.account;

    let nonSupporterInfo = await accountService._setupAccount(nonSupporterEmail, password);
    nonSupporterAccount = nonSupporterInfo.account;

    const outsiderInfo = await accountService._setupAccount(outsiderEmail, password);
    const outsiderAccount = outsiderInfo.account;

    // Login users to get auth tokens
    adminToken = await env.login(adminEmail, password);
    supporterToken = await env.login(supporterEmail, password);
    nonSupporterToken = await env.login(nonSupporterEmail, password);

    // Create calendars for each user
    adminCalendar = await calendarInterface.createCalendar(adminAccount, 'admin-cal');
    coveredCalendar = await calendarInterface.createCalendar(supporterAccount, 'covered-cal');
    uncoveredCalendar = await calendarInterface.createCalendar(nonSupporterAccount, 'uncovered-cal');
    outsiderCalendar = await calendarInterface.createCalendar(outsiderAccount, 'outsider-cal');

    // Create active funding plan for the supporter account linked to their calendar
    await createActiveFundingPlan(supporterAccount.id, coveredCalendar.id);
  });

  afterAll(async () => {
    if (eventBus) {
      eventBus.removeAllListeners();
    }
    await env.cleanup();
  });

  beforeEach(async () => {
    // Reset funding-plan state before each test
    await disableFunding();
    await clearFundingPlans(supporterAccount.id);
    await clearFundingPlans(nonSupporterAccount.id);
  });

  describe('Widget Domain Configuration Tests', () => {
    it('should return 402 when funding enabled and user has no funding plan', async () => {
      await enableFunding();
      // nonSupporterAccount has no funding plan

      const response = await env.authPut(
        nonSupporterToken,
        `/api/v1/calendars/${uncoveredCalendar.id}/widget/domain`,
        { domain: 'example.com' },
      );

      expect(response.status).toBe(402);
      expect(response.body.errorName).toBe('SubscriptionRequiredError');
      expect(response.body.feature).toBe('widget_embedding');
      expect(response.body).not.toHaveProperty('subscriptionUrl');
    });

    it('should return 200 when funding enabled and user has active funding plan', async () => {
      await enableFunding();
      await createActiveFundingPlan(supporterAccount.id, coveredCalendar.id);

      const response = await env.authPut(
        supporterToken,
        `/api/v1/calendars/${coveredCalendar.id}/widget/domain`,
        { domain: 'example.com' },
      );

      expect(response.status).toBe(200);
      expect(response.body.domain).toBe('example.com');
    });

    it('should return 402 when funding enabled and funding plan expired', async () => {
      await enableFunding();
      await createExpiredFundingPlan(nonSupporterAccount.id);

      const response = await env.authPut(
        nonSupporterToken,
        `/api/v1/calendars/${uncoveredCalendar.id}/widget/domain`,
        { domain: 'example.com' },
      );

      expect(response.status).toBe(402);
      expect(response.body.errorName).toBe('SubscriptionRequiredError');
    });

    it('should return 200 when funding disabled (free instance mode)', async () => {
      await disableFunding();

      const response = await env.authPut(
        nonSupporterToken,
        `/api/v1/calendars/${uncoveredCalendar.id}/widget/domain`,
        { domain: 'example.com' },
      );

      expect(response.status).toBe(200);
      expect(response.body.domain).toBe('example.com');
    });

    it('should return 400 for invalid UUID calendarId', async () => {
      const response = await env.authPut(
        supporterToken,
        '/api/v1/calendars/not-a-valid-uuid/widget/domain',
        { domain: 'example.com' },
      );

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
      expect(response.body.error).toContain('invalid calendarId format');
    });

    it('should not include subscriptionUrl in error response', async () => {
      await enableFunding();

      const response = await env.authPut(
        nonSupporterToken,
        `/api/v1/calendars/${uncoveredCalendar.id}/widget/domain`,
        { domain: 'example.com' },
      );

      expect(response.status).toBe(402);
      expect(response.body).not.toHaveProperty('subscriptionUrl');
      expect(Object.keys(response.body)).not.toContain('subscriptionUrl');
    });

    it.skip('should enforce rate limiting after 100 requests (skipped: rate limiting disabled in test mode)', async () => {
      await disableFunding();

      // Create a fresh calendar for this test to avoid interference
      const rateLimitCal = await calendarInterface.createCalendar(supporterAccount, 'rate-limit-test');

      // Make 101 rapid requests
      let last429Response = null;
      for (let i = 0; i < 101; i++) {
        const response = await env.authPut(
          supporterToken,
          `/api/v1/calendars/${rateLimitCal.id}/widget/domain`,
          { domain: `example${i}.com` },
        );

        if (response.status === 429) {
          last429Response = response;
          break;
        }
      }

      // Should receive 429 Too Many Requests eventually
      expect(last429Response).not.toBeNull();
      expect(last429Response?.status).toBe(429);
    });
  });

  describe('Widget Data Serving Tests', () => {
    beforeEach(async () => {
      // Set widget domains for both calendars before testing data serving
      await disableFunding();

      await env.authPut(
        supporterToken,
        `/api/v1/calendars/${coveredCalendar.id}/widget/domain`,
        { domain: 'example.com' },
      );

      await env.authPut(
        nonSupporterToken,
        `/api/v1/calendars/${uncoveredCalendar.id}/widget/domain`,
        { domain: 'example.com' },
      );
    });

    it('should return 402 when funding enabled and calendar owner has no funding plan', async () => {
      await enableFunding();

      const response = await request(env.app)
        .get(`/api/widget/v1/calendars/${uncoveredCalendar.urlName}`)
        .set('Origin', 'https://example.com');

      expect(response.status).toBe(402);
      expect(response.body.errorName).toBe('SubscriptionRequiredError');
      expect(response.body.feature).toBe('widget_embedding');
    });

    it('should return 200 when funding enabled and calendar owner has a funding plan', async () => {
      await enableFunding();
      await createActiveFundingPlan(supporterAccount.id, coveredCalendar.id);

      const response = await request(env.app)
        .get(`/api/widget/v1/calendars/${coveredCalendar.urlName}`)
        .set('Origin', 'https://example.com');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id');
      expect(response.body.urlName).toBe(coveredCalendar.urlName);
    });

    it('should return 200 when funding disabled for any calendar', async () => {
      await disableFunding();

      const response = await request(env.app)
        .get(`/api/widget/v1/calendars/${uncoveredCalendar.urlName}`)
        .set('Origin', 'https://example.com');

      expect(response.status).toBe(200);
      expect(response.body.urlName).toBe(uncoveredCalendar.urlName);
    });

    it('should include CORS headers in 402 error responses', async () => {
      await enableFunding();

      const response = await request(env.app)
        .get(`/api/widget/v1/calendars/${uncoveredCalendar.urlName}`)
        .set('Origin', 'https://example.com');

      expect(response.status).toBe(402);
      expect(response.headers['access-control-allow-origin']).toBe('https://example.com');
      expect(response.headers).toHaveProperty('access-control-allow-credentials');
      expect(response.headers).toHaveProperty('access-control-allow-methods');
    });

    it('should include Cache-Control: no-store header on 402 error responses', async () => {
      await enableFunding();

      const response = await request(env.app)
        .get(`/api/widget/v1/calendars/${uncoveredCalendar.urlName}`)
        .set('Origin', 'https://example.com');

      expect(response.status).toBe(402);
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it('should refuse a non-allowlisted origin without consulting the funding gate', async () => {
      await enableFunding();

      // uncoveredCalendar is unfunded, so if the gate ran ahead of origin
      // validation this request would answer 402 — telling an arbitrary site
      // that has no business embedding this calendar whether it pays.
      const gateSpy = vi.spyOn(FundingInterface.prototype, 'checkFundingAccess');

      try {
        const response = await request(env.app)
          .get(`/api/widget/v1/calendars/${uncoveredCalendar.urlName}`)
          .set('Origin', 'https://not-allowlisted.example');

        expect(response.status).toBe(403);
        expect(response.body.errorName).toBe('ForbiddenError');
        expect(gateSpy).not.toHaveBeenCalled();
      }
      finally {
        gateSpy.mockRestore();
      }
    });

    it('should answer 404 for a nonexistent calendar on the widget read path', async () => {
      await enableFunding();

      const response = await request(env.app)
        .get('/api/widget/v1/calendars/no-such-calendar-here')
        .set('Origin', 'https://example.com');

      expect(response.status).toBe(404);
      expect(response.body.errorName).toBe('CalendarNotFoundError');
    });

    it.skip('should enforce rate limiting after 300 requests (skipped: rate limiting disabled in test mode)', async () => {
      await disableFunding();

      // Make 301 rapid requests from same IP
      let last429Response = null;
      for (let i = 0; i < 301; i++) {
        const response = await request(env.app)
          .get(`/api/widget/v1/calendars/${coveredCalendar.urlName}`)
          .set('Origin', 'https://example.com');

        if (response.status === 429) {
          last429Response = response;
          break;
        }
      }

      // Should receive 429 Too Many Requests eventually
      expect(last429Response).not.toBeNull();
      expect(last429Response?.status).toBe(429);
    });
  });

  describe('Security Audit Test Scenarios', () => {
    it('should return 402 when calendar exists but owner has no funding plan (not calendar existence leak)', async () => {
      // Set domain with funding disabled
      await disableFunding();
      await env.authPut(
        nonSupporterToken,
        `/api/v1/calendars/${uncoveredCalendar.id}/widget/domain`,
        { domain: 'example.com' },
      );

      // Enable funding
      await enableFunding();

      // This should fail with 402, not reveal calendar existence
      const response = await request(env.app)
        .get(`/api/widget/v1/calendars/${uncoveredCalendar.urlName}`)
        .set('Origin', 'https://example.com');

      expect(response.status).toBe(402);
      expect(response.body.errorName).toBe('SubscriptionRequiredError');
    });

    it('should return 200 when calendar exists and funding disabled instance-wide', async () => {
      await disableFunding();

      const response = await request(env.app)
        .get(`/api/widget/v1/calendars/${uncoveredCalendar.urlName}`)
        .set('Origin', 'https://example.com');

      expect(response.status).toBe(200);
      expect(response.body.urlName).toBe(uncoveredCalendar.urlName);
    });

    it('should return 400 for invalid calendarId UUID format in widget config', async () => {
      const response = await env.authPut(
        supporterToken,
        '/api/v1/calendars/not-a-uuid/widget/domain',
        { domain: 'example.com' },
      );

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
      expect(response.body.error).toContain('invalid calendarId format');
    });

    it('should check funding access after permission checks (no funding plan status leak)', async () => {
      await enableFunding();

      // The target must be a calendar the funding gate would concretely
      // REFUSE: outsiderCalendar is owned by a non-admin account with no
      // funding plan and no complimentary grant. On an admin-owned calendar
      // the gate opens by exemption, so a 403 there would be satisfied by the
      // permission check alone and prove nothing about ordering.
      await expect(
        fundingInterface.checkFundingAccess(outsiderCalendar.id, 'widget_embedding'),
      ).resolves.toBe(false);

      // Spied on the prototype rather than on this file's own instance: the
      // request below runs through the Express app, which constructs its own
      // domain interfaces in server.ts.
      const gateSpy = vi.spyOn(FundingInterface.prototype, 'checkFundingAccess');

      try {
        // A user with no edit rights tries to configure the widget
        const response = await env.authPut(
          nonSupporterToken,
          `/api/v1/calendars/${outsiderCalendar.id}/widget/domain`,
          { domain: 'example.com' },
        );

        // 403 Permission Denied, NOT 402 SubscriptionRequiredError
        expect(response.status).toBe(403);
        expect(response.body.errorName).toBe('CalendarEditorPermissionError');

        // The stronger claim, and the one that does not depend on which
        // invariant happened to answer: the funding domain was never asked
        // about a calendar this caller may not touch, so its funding state
        // cannot have leaked.
        expect(gateSpy).not.toHaveBeenCalled();
      }
      finally {
        gateSpy.mockRestore();
      }
    });

    it('should answer 404 for a nonexistent calendar without consulting the funding gate', async () => {
      await enableFunding();

      const gateSpy = vi.spyOn(FundingInterface.prototype, 'checkFundingAccess');

      try {
        const response = await env.authPut(
          nonSupporterToken,
          `/api/v1/calendars/${uuidv4()}/widget/domain`,
          { domain: 'example.com' },
        );

        // checkFundingAccess returns a determinate "unfunded" for an unknown
        // calendar id, so a gate that ran first would answer 402 here.
        expect(response.status).toBe(404);
        expect(response.body.errorName).toBe('CalendarNotFoundError');
        expect(gateSpy).not.toHaveBeenCalled();
      }
      finally {
        gateSpy.mockRestore();
      }
    });

    it('should handle consistent behavior when funding plan expires during widget config request', async () => {
      await enableFunding();
      await createActiveFundingPlan(nonSupporterAccount.id, uncoveredCalendar.id);

      // First call: active funding plan
      const response1 = await env.authPut(
        nonSupporterToken,
        `/api/v1/calendars/${uncoveredCalendar.id}/widget/domain`,
        { domain: 'test1.com' },
      );

      expect(response1.status).toBe(200);

      // Funding plan expires (simulate by clearing and creating expired)
      await clearFundingPlans(nonSupporterAccount.id);
      await createExpiredFundingPlan(nonSupporterAccount.id);

      const response2 = await env.authPut(
        nonSupporterToken,
        `/api/v1/calendars/${uncoveredCalendar.id}/widget/domain`,
        { domain: 'test2.com' },
      );

      // Should get consistent 402 error after expiration
      expect(response2.status).toBe(402);
      expect(response2.body.errorName).toBe('SubscriptionRequiredError');
    });
  });

  /**
   * Admin exemption (checkFundingAccess invariant 2) is the only invariant in
   * this file that needs the funding domain to reach back out of itself:
   * FundingService.isCalendarOwnerAdmin resolves the owner through the
   * injected CalendarInterface, then asks the injected AccountsInterface
   * whether that owner is an admin. Every other scenario here is decided by
   * the calendar's own plan and grant rows, which is why removing either
   * injection used to leave the whole suite green.
   */
  describe('Admin Exemption', () => {
    it('should allow an unfunded admin-owned calendar to configure a widget domain', async () => {
      await enableFunding();

      // adminCalendar has no funding plan and no complimentary grant on an
      // instance that charges, so nothing but the owner's admin role can open
      // this gate.
      const response = await env.authPut(
        adminToken,
        `/api/v1/calendars/${adminCalendar.id}/widget/domain`,
        { domain: 'admin.example.com' },
      );

      expect(response.status).toBe(200);
      expect(response.body.domain).toBe('admin.example.com');
    });

    it('should resolve the owner admin role through the injected domain interfaces', async () => {
      await enableFunding();

      // Asked of this file's own domain interfaces rather than over HTTP,
      // because the wiring under test is the pair of back-references
      // established in beforeAll (setCalendarInterface and
      // setAccountsInterface); the Express app wires its own interfaces in
      // server.ts. Drop either one and isCalendarOwnerAdmin stops resolving,
      // so this unfunded calendar is refused.
      await expect(
        fundingInterface.checkFundingAccess(adminCalendar.id, 'widget_embedding'),
      ).resolves.toBe(true);

      await calendarInterface.setWidgetDomain(adminAccount, adminCalendar.id, 'wired.example.com');

      expect(await calendarInterface.getWidgetDomain(adminAccount, adminCalendar.id))
        .toBe('wired.example.com');
    });
  });

  describe('Edge Cases', () => {
    it('should stop serving widget data when calendar owner funding plan expires', async () => {
      await enableFunding();
      await createActiveFundingPlan(nonSupporterAccount.id, uncoveredCalendar.id);

      // Set widget domain while the owner has an active plan
      await env.authPut(
        nonSupporterToken,
        `/api/v1/calendars/${uncoveredCalendar.id}/widget/domain`,
        { domain: 'example.com' },
      );

      // Widget data should work
      const response1 = await request(env.app)
        .get(`/api/widget/v1/calendars/${uncoveredCalendar.urlName}`)
        .set('Origin', 'https://example.com');

      expect(response1.status).toBe(200);

      // Funding plan expires
      await clearFundingPlans(nonSupporterAccount.id);
      await createExpiredFundingPlan(nonSupporterAccount.id);

      // Widget data should now return 402
      const response2 = await request(env.app)
        .get(`/api/widget/v1/calendars/${uncoveredCalendar.urlName}`)
        .set('Origin', 'https://example.com');

      expect(response2.status).toBe(402);
      expect(response2.body.errorName).toBe('SubscriptionRequiredError');
    });

    it('should enforce gating immediately when funding re-enabled after being disabled', async () => {
      // Initial: funding disabled
      await disableFunding();

      const response1 = await env.authPut(
        nonSupporterToken,
        `/api/v1/calendars/${uncoveredCalendar.id}/widget/domain`,
        { domain: 'example.com' },
      );

      expect(response1.status).toBe(200);

      // Funding re-enabled
      await enableFunding();

      const response2 = await env.authPut(
        nonSupporterToken,
        `/api/v1/calendars/${uncoveredCalendar.id}/widget/domain`,
        { domain: 'example2.com' },
      );

      // Should immediately enforce the funding requirement
      expect(response2.status).toBe(402);
      expect(response2.body.errorName).toBe('SubscriptionRequiredError');
    });

    it('should check each calendar independently with different coverage states', async () => {
      // Create third calendar with different owner
      const thirdEmail = 'third@pavillion.dev';
      const configurationInterface = new ConfigurationInterface();
      const setupInterface = new SetupInterface();
      const accountService = new AccountService(eventBus, configurationInterface, setupInterface);
      const thirdInfo = await accountService._setupAccount(thirdEmail, password);
      const thirdAccount = thirdInfo.account;
      const thirdToken = await env.login(thirdEmail, password);
      const thirdCalendar = await calendarInterface.createCalendar(thirdAccount, 'third-cal');

      // Enable funding and set up different states
      await enableFunding();
      await createActiveFundingPlan(supporterAccount.id, coveredCalendar.id);
      // nonSupporterAccount has no funding plan
      await createActiveFundingPlan(thirdAccount.id, thirdCalendar.id);

      // Test covered calendar (should work)
      const response1 = await env.authPut(
        supporterToken,
        `/api/v1/calendars/${coveredCalendar.id}/widget/domain`,
        { domain: 'example.com' },
      );
      expect(response1.status).toBe(200);

      // Test uncovered calendar (should fail)
      const response2 = await env.authPut(
        nonSupporterToken,
        `/api/v1/calendars/${uncoveredCalendar.id}/widget/domain`,
        { domain: 'example.com' },
      );
      expect(response2.status).toBe(402);

      // Test third calendar (should work)
      const response3 = await env.authPut(
        thirdToken,
        `/api/v1/calendars/${thirdCalendar.id}/widget/domain`,
        { domain: 'example.com' },
      );
      expect(response3.status).toBe(200);
    });

    it('should return 402 on data serving when widget domain configured but funding plan expires', async () => {
      // Setup: funding disabled, configure widget domain
      await disableFunding();

      await env.authPut(
        nonSupporterToken,
        `/api/v1/calendars/${uncoveredCalendar.id}/widget/domain`,
        { domain: 'example.com' },
      );

      // Now enable funding (simulating policy change)
      await enableFunding();

      // Widget data serving should now fail even though domain was configured earlier
      const response = await request(env.app)
        .get(`/api/widget/v1/calendars/${uncoveredCalendar.urlName}`)
        .set('Origin', 'https://example.com');

      expect(response.status).toBe(402);
      expect(response.body.errorName).toBe('SubscriptionRequiredError');
    });
  });
});
