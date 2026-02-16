import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import request from 'supertest';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import SubscriptionInterface from '@/server/subscription/interface';
import AccountService from '@/server/accounts/service/account';
import { TestEnvironment } from '@/server/test/lib/test_environment';
import { SubscriptionSettingsEntity } from '@/server/subscription/entity/subscription_settings';
import { SubscriptionEntity } from '@/server/subscription/entity/subscription';

/**
 * Integration tests for Subscription Gating in Widget Embedding
 *
 * These tests verify that subscription enforcement works correctly for:
 * - Widget domain configuration (PUT /api/v1/calendars/:calendarId/widget/domain)
 * - Widget data serving (GET /api/widget/v1/calendars/:urlName)
 *
 * Test scenarios:
 * - Subscriptions enabled + no subscription → 402 error
 * - Subscriptions enabled + active subscription → success
 * - Subscriptions enabled + expired subscription → 402 error
 * - Subscriptions disabled → always success (free instance mode)
 * - Security audit scenarios
 * - Edge cases and race conditions
 */
describe('Subscription Gating Integration Tests', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let subscriptionInterface: SubscriptionInterface;
  let eventBus: EventEmitter;

  let subscribedAccount: Account;
  let unsubscribedAccount: Account;
  let subscribedCalendar: Calendar;
  let unsubscribedCalendar: Calendar;
  let subscribedToken: string;
  let unsubscribedToken: string;

  const subscribedEmail = 'subscribed@pavillion.dev';
  const unsubscribedEmail = 'unsubscribed@pavillion.dev';
  const password = 'testpassword';

  /**
   * Helper function to enable subscriptions instance-wide
   */
  async function enableSubscriptions() {
    let settings = await SubscriptionSettingsEntity.findOne();
    if (!settings) {
      settings = SubscriptionSettingsEntity.build({
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
   * Helper function to disable subscriptions instance-wide
   */
  async function disableSubscriptions() {
    let settings = await SubscriptionSettingsEntity.findOne();
    if (!settings) {
      settings = SubscriptionSettingsEntity.build({
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
   * Helper function to create an active subscription for an account
   */
  async function createActiveSubscription(accountId: string) {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1); // 1 year in the future

    const subscription = SubscriptionEntity.build({
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
    await subscription.save();
  }

  /**
   * Helper function to create an expired subscription for an account
   */
  async function createExpiredSubscription(accountId: string) {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 30); // 30 days ago

    const subscription = SubscriptionEntity.build({
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
    await subscription.save();
  }

  /**
   * Helper function to clear all subscriptions for an account
   */
  async function clearSubscriptions(accountId: string) {
    await SubscriptionEntity.destroy({
      where: { account_id: accountId },
    });
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

    // Create test accounts
    let subscribedInfo = await accountService._setupAccount(subscribedEmail, password);
    subscribedAccount = subscribedInfo.account;

    let unsubscribedInfo = await accountService._setupAccount(unsubscribedEmail, password);
    unsubscribedAccount = unsubscribedInfo.account;

    // Login both users to get auth tokens
    subscribedToken = await env.login(subscribedEmail, password);
    unsubscribedToken = await env.login(unsubscribedEmail, password);

    // Create calendars for each user
    subscribedCalendar = await calendarInterface.createCalendar(subscribedAccount, 'subscribed-cal');
    unsubscribedCalendar = await calendarInterface.createCalendar(unsubscribedAccount, 'unsubscribed-cal');

    // Create active subscription for subscribed account
    await createActiveSubscription(subscribedAccount.id);
  });

  afterAll(async () => {
    if (eventBus) {
      eventBus.removeAllListeners();
    }
    await env.cleanup();
  });

  beforeEach(async () => {
    // Reset subscription state before each test
    await disableSubscriptions();
    await clearSubscriptions(subscribedAccount.id);
    await clearSubscriptions(unsubscribedAccount.id);
  });

  describe('Widget Domain Configuration Tests', () => {
    it('should return 402 when subscriptions enabled and user has no subscription', async () => {
      await enableSubscriptions();
      // unsubscribedAccount has no subscription

      const response = await env.authPut(
        unsubscribedToken,
        `/api/v1/calendars/${unsubscribedCalendar.id}/widget/domain`,
        { domain: 'example.com' },
      );

      expect(response.status).toBe(402);
      expect(response.body.errorName).toBe('SubscriptionRequiredError');
      expect(response.body.feature).toBe('widget_embedding');
      expect(response.body).not.toHaveProperty('subscriptionUrl');
    });

    it('should return 200 when subscriptions enabled and user has active subscription', async () => {
      await enableSubscriptions();
      await createActiveSubscription(subscribedAccount.id);

      const response = await env.authPut(
        subscribedToken,
        `/api/v1/calendars/${subscribedCalendar.id}/widget/domain`,
        { domain: 'example.com' },
      );

      expect(response.status).toBe(200);
      expect(response.body.domain).toBe('example.com');
    });

    it('should return 402 when subscriptions enabled and subscription expired', async () => {
      await enableSubscriptions();
      await createExpiredSubscription(unsubscribedAccount.id);

      const response = await env.authPut(
        unsubscribedToken,
        `/api/v1/calendars/${unsubscribedCalendar.id}/widget/domain`,
        { domain: 'example.com' },
      );

      expect(response.status).toBe(402);
      expect(response.body.errorName).toBe('SubscriptionRequiredError');
    });

    it('should return 200 when subscriptions disabled (free instance mode)', async () => {
      await disableSubscriptions();

      const response = await env.authPut(
        unsubscribedToken,
        `/api/v1/calendars/${unsubscribedCalendar.id}/widget/domain`,
        { domain: 'example.com' },
      );

      expect(response.status).toBe(200);
      expect(response.body.domain).toBe('example.com');
    });

    it('should return 400 for invalid UUID calendarId', async () => {
      const response = await env.authPut(
        subscribedToken,
        '/api/v1/calendars/not-a-valid-uuid/widget/domain',
        { domain: 'example.com' },
      );

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
      expect(response.body.error).toContain('invalid calendarId format');
    });

    it('should not include subscriptionUrl in error response', async () => {
      await enableSubscriptions();

      const response = await env.authPut(
        unsubscribedToken,
        `/api/v1/calendars/${unsubscribedCalendar.id}/widget/domain`,
        { domain: 'example.com' },
      );

      expect(response.status).toBe(402);
      expect(response.body).not.toHaveProperty('subscriptionUrl');
      expect(Object.keys(response.body)).not.toContain('subscriptionUrl');
    });

    it.skip('should enforce rate limiting after 100 requests (skipped: rate limiting disabled in test mode)', async () => {
      await disableSubscriptions();

      // Create a fresh calendar for this test to avoid interference
      const rateLimitCal = await calendarInterface.createCalendar(subscribedAccount, 'rate-limit-test');

      // Make 101 rapid requests
      let last429Response = null;
      for (let i = 0; i < 101; i++) {
        const response = await env.authPut(
          subscribedToken,
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
      await disableSubscriptions();

      await env.authPut(
        subscribedToken,
        `/api/v1/calendars/${subscribedCalendar.id}/widget/domain`,
        { domain: 'example.com' },
      );

      await env.authPut(
        unsubscribedToken,
        `/api/v1/calendars/${unsubscribedCalendar.id}/widget/domain`,
        { domain: 'example.com' },
      );
    });

    it('should return 402 when subscriptions enabled and calendar owner has no subscription', async () => {
      await enableSubscriptions();

      const response = await request(env.app)
        .get(`/api/widget/v1/calendars/${unsubscribedCalendar.urlName}`)
        .set('Origin', 'https://example.com');

      expect(response.status).toBe(402);
      expect(response.body.errorName).toBe('SubscriptionRequiredError');
      expect(response.body.feature).toBe('widget_embedding');
    });

    it('should return 200 when subscriptions enabled and calendar owner has subscription', async () => {
      await enableSubscriptions();
      await createActiveSubscription(subscribedAccount.id);

      const response = await request(env.app)
        .get(`/api/widget/v1/calendars/${subscribedCalendar.urlName}`)
        .set('Origin', 'https://example.com');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id');
      expect(response.body.urlName).toBe(subscribedCalendar.urlName);
    });

    it('should return 200 when subscriptions disabled for any calendar', async () => {
      await disableSubscriptions();

      const response = await request(env.app)
        .get(`/api/widget/v1/calendars/${unsubscribedCalendar.urlName}`)
        .set('Origin', 'https://example.com');

      expect(response.status).toBe(200);
      expect(response.body.urlName).toBe(unsubscribedCalendar.urlName);
    });

    it('should include CORS headers in 402 error responses', async () => {
      await enableSubscriptions();

      const response = await request(env.app)
        .get(`/api/widget/v1/calendars/${unsubscribedCalendar.urlName}`)
        .set('Origin', 'https://example.com');

      expect(response.status).toBe(402);
      expect(response.headers['access-control-allow-origin']).toBe('https://example.com');
      expect(response.headers).toHaveProperty('access-control-allow-credentials');
      expect(response.headers).toHaveProperty('access-control-allow-methods');
    });

    it('should include Cache-Control: no-store header on 402 error responses', async () => {
      await enableSubscriptions();

      const response = await request(env.app)
        .get(`/api/widget/v1/calendars/${unsubscribedCalendar.urlName}`)
        .set('Origin', 'https://example.com');

      expect(response.status).toBe(402);
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it.skip('should enforce rate limiting after 300 requests (skipped: rate limiting disabled in test mode)', async () => {
      await disableSubscriptions();

      // Make 301 rapid requests from same IP
      let last429Response = null;
      for (let i = 0; i < 301; i++) {
        const response = await request(env.app)
          .get(`/api/widget/v1/calendars/${subscribedCalendar.urlName}`)
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
    it('should return 402 when calendar exists but owner has no subscription (not calendar existence leak)', async () => {
      // Set domain with subscriptions disabled
      await disableSubscriptions();
      await env.authPut(
        unsubscribedToken,
        `/api/v1/calendars/${unsubscribedCalendar.id}/widget/domain`,
        { domain: 'example.com' },
      );

      // Enable subscriptions
      await enableSubscriptions();

      // This should fail with 402, not reveal calendar existence
      const response = await request(env.app)
        .get(`/api/widget/v1/calendars/${unsubscribedCalendar.urlName}`)
        .set('Origin', 'https://example.com');

      expect(response.status).toBe(402);
      expect(response.body.errorName).toBe('SubscriptionRequiredError');
    });

    it('should return 200 when calendar exists and subscriptions disabled instance-wide', async () => {
      await disableSubscriptions();

      const response = await request(env.app)
        .get(`/api/widget/v1/calendars/${unsubscribedCalendar.urlName}`)
        .set('Origin', 'https://example.com');

      expect(response.status).toBe(200);
      expect(response.body.urlName).toBe(unsubscribedCalendar.urlName);
    });

    it('should return 400 for invalid calendarId UUID format in widget config', async () => {
      const response = await env.authPut(
        subscribedToken,
        '/api/v1/calendars/not-a-uuid/widget/domain',
        { domain: 'example.com' },
      );

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
      expect(response.body.error).toContain('invalid calendarId format');
    });

    it('should check subscription after permission checks (no subscription status leak)', async () => {
      // Create a calendar owned by subscribed user
      const privateCalendar = await calendarInterface.createCalendar(subscribedAccount, 'private-cal');
      await enableSubscriptions();
      await createActiveSubscription(subscribedAccount.id);

      // Unsubscribed user tries to configure widget on private calendar
      const response = await env.authPut(
        unsubscribedToken,
        `/api/v1/calendars/${privateCalendar.id}/widget/domain`,
        { domain: 'example.com' },
      );

      // Should get 403 Permission Denied, NOT 402 Subscription Required
      // This proves permission check happens BEFORE subscription check
      expect(response.status).toBe(403);
      expect(response.body.errorName).toBe('CalendarEditorPermissionError');
    });

    it('should handle consistent behavior when subscription expires during widget config request', async () => {
      await enableSubscriptions();
      await createActiveSubscription(subscribedAccount.id);

      // First call: active subscription
      const response1 = await env.authPut(
        subscribedToken,
        `/api/v1/calendars/${subscribedCalendar.id}/widget/domain`,
        { domain: 'test1.com' },
      );

      expect(response1.status).toBe(200);

      // Subscription expires (simulate by clearing and creating expired)
      await clearSubscriptions(subscribedAccount.id);
      await createExpiredSubscription(subscribedAccount.id);

      const response2 = await env.authPut(
        subscribedToken,
        `/api/v1/calendars/${subscribedCalendar.id}/widget/domain`,
        { domain: 'test2.com' },
      );

      // Should get consistent 402 error after expiration
      expect(response2.status).toBe(402);
      expect(response2.body.errorName).toBe('SubscriptionRequiredError');
    });
  });

  describe('Edge Cases', () => {
    it('should stop serving widget data when calendar owner subscription expires', async () => {
      await enableSubscriptions();
      await createActiveSubscription(subscribedAccount.id);

      // Set widget domain while subscribed
      await env.authPut(
        subscribedToken,
        `/api/v1/calendars/${subscribedCalendar.id}/widget/domain`,
        { domain: 'example.com' },
      );

      // Widget data should work
      const response1 = await request(env.app)
        .get(`/api/widget/v1/calendars/${subscribedCalendar.urlName}`)
        .set('Origin', 'https://example.com');

      expect(response1.status).toBe(200);

      // Subscription expires
      await clearSubscriptions(subscribedAccount.id);
      await createExpiredSubscription(subscribedAccount.id);

      // Widget data should now return 402
      const response2 = await request(env.app)
        .get(`/api/widget/v1/calendars/${subscribedCalendar.urlName}`)
        .set('Origin', 'https://example.com');

      expect(response2.status).toBe(402);
      expect(response2.body.errorName).toBe('SubscriptionRequiredError');
    });

    it('should enforce gating immediately when subscriptions re-enabled after being disabled', async () => {
      // Initial: subscriptions disabled
      await disableSubscriptions();

      const response1 = await env.authPut(
        unsubscribedToken,
        `/api/v1/calendars/${unsubscribedCalendar.id}/widget/domain`,
        { domain: 'example.com' },
      );

      expect(response1.status).toBe(200);

      // Subscriptions re-enabled
      await enableSubscriptions();

      const response2 = await env.authPut(
        unsubscribedToken,
        `/api/v1/calendars/${unsubscribedCalendar.id}/widget/domain`,
        { domain: 'example2.com' },
      );

      // Should immediately enforce subscription requirement
      expect(response2.status).toBe(402);
      expect(response2.body.errorName).toBe('SubscriptionRequiredError');
    });

    it('should check each calendar independently with different subscription states', async () => {
      // Create third calendar with different owner
      const thirdEmail = 'third@pavillion.dev';
      const configurationInterface = new ConfigurationInterface();
      const setupInterface = new SetupInterface();
      const accountService = new AccountService(eventBus, configurationInterface, setupInterface);
      const thirdInfo = await accountService._setupAccount(thirdEmail, password);
      const thirdAccount = thirdInfo.account;
      const thirdToken = await env.login(thirdEmail, password);
      const thirdCalendar = await calendarInterface.createCalendar(thirdAccount, 'third-cal');

      // Enable subscriptions and set up different states
      await enableSubscriptions();
      await createActiveSubscription(subscribedAccount.id);
      // unsubscribedAccount has no subscription
      await createActiveSubscription(thirdAccount.id);

      // Test subscribed calendar (should work)
      const response1 = await env.authPut(
        subscribedToken,
        `/api/v1/calendars/${subscribedCalendar.id}/widget/domain`,
        { domain: 'example.com' },
      );
      expect(response1.status).toBe(200);

      // Test unsubscribed calendar (should fail)
      const response2 = await env.authPut(
        unsubscribedToken,
        `/api/v1/calendars/${unsubscribedCalendar.id}/widget/domain`,
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

    it('should return 402 on data serving when widget domain configured but subscription expires', async () => {
      // Setup: subscriptions disabled, configure widget domain
      await disableSubscriptions();

      await env.authPut(
        unsubscribedToken,
        `/api/v1/calendars/${unsubscribedCalendar.id}/widget/domain`,
        { domain: 'example.com' },
      );

      // Now enable subscriptions (simulating policy change)
      await enableSubscriptions();

      // Widget data serving should now fail even though domain was configured earlier
      const response = await request(env.app)
        .get(`/api/widget/v1/calendars/${unsubscribedCalendar.urlName}`)
        .set('Origin', 'https://example.com');

      expect(response.status).toBe(402);
      expect(response.body.errorName).toBe('SubscriptionRequiredError');
    });
  });
});
