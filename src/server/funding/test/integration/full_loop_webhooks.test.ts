import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import Stripe from 'stripe';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import { Calendar } from '@/common/model/calendar';
import { ProviderConfig } from '@/common/model/funding-plan';
import FundingInterface from '@/server/funding/interface';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import EmailInterface from '@/server/email/interface';
import AccountService from '@/server/accounts/service/account';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { FundingSettingsEntity } from '@/server/funding/entity/funding_settings';
import { ProviderConfigEntity } from '@/server/funding/entity/provider_config';
import { FundingPlanEntity } from '@/server/funding/entity/funding_plan';
import { FundingEventEntity } from '@/server/funding/entity/funding_event';
import { CalendarFundingPlanEntity } from '@/server/funding/entity/calendar_funding_plan';
import { ProviderFactory } from '@/server/funding/service/provider/factory';
import { StripeAdapter } from '@/server/funding/service/provider/stripe';
import { capturedStripeEventPayload } from '@/server/funding/test/fixtures/stripe';

/**
 * Full-loop funding test: a calendar's funding gate opens and closes with the
 * plan lifecycle, driven only by signed Stripe webhooks.
 *
 * Nothing between the HTTP request and the gate is stubbed. Each payload is a
 * captured Stripe event (fixtures/stripe), signed here with the instance's own
 * webhook secret exactly as Stripe signs a delivery, and POSTed through the
 * running app — every domain mounted in boot order, so a parser that consumed
 * the raw body ahead of the webhook route (pv-ufag) would fail the signature
 * check and the gate would never open. The real StripeAdapter verifies each
 * signature: an API key is configured, so ProviderFactory does not fall back
 * to the unverifying mock adapter.
 *
 * The one Stripe API call on this path — checkout completion retrieving the
 * subscription for its amount and period — is stubbed on the adapter. No
 * request leaves the process.
 */
describe('Funding full loop through signed webhooks', () => {
  const WEBHOOK_SECRET = 'whsec_full_loop_test_secret';
  const SUBSCRIPTION_ID = 'sub_full_loop_001';
  const CUSTOMER_ID = 'cus_full_loop_001';

  let env: TestEnvironment;
  let eventBus: EventEmitter;
  let fundingInterface: FundingInterface;
  let sandbox: sinon.SinonSandbox;
  let getSubscription: sinon.SinonStub;

  let ownerAccountId: string;
  let calendar: Calendar;

  // Exact bodies and headers of the accepted deliveries, kept so the
  // redelivery step can replay them byte for byte.
  const accepted: Record<'checkout' | 'deleted', { payload: string; signature: string }> = {
    checkout: { payload: '', signature: '' },
    deleted: { payload: '', signature: '' },
  };

  /**
   * Sign a payload with the instance's webhook secret, producing the
   * stripe-signature header Stripe would send with it.
   *
   * @param payload - Raw JSON body to sign
   * @param secret - Signing secret; defaults to the configured one
   * @returns stripe-signature header value
   */
  function sign(payload: string, secret: string = WEBHOOK_SECRET): string {
    return Stripe.webhooks.generateTestHeaderString({ payload, secret });
  }

  /**
   * POST a signed payload to the Stripe webhook route of the running app.
   *
   * @param payload - Raw JSON body
   * @param signature - stripe-signature header value
   * @returns The supertest response
   */
  async function deliver(payload: string, signature: string) {
    return request(env.app)
      .post('/api/funding/webhooks/stripe')
      .set('stripe-signature', signature)
      .set('Content-Type', 'application/json')
      .send(payload);
  }

  /**
   * Read the gate the way every funding-gated consumer does.
   *
   * @returns Whether the calendar may use widget embedding
   */
  async function widgetAccess(): Promise<boolean> {
    return fundingInterface.checkFundingAccess(calendar.id, 'widget_embedding');
  }

  /**
   * Snapshot of the funding state the webhooks move, for comparing before and
   * after a redelivery.
   *
   * @returns Plan, allocation and event-log state
   */
  async function fundingState() {
    const plans = await FundingPlanEntity.findAll({ order: [['id', 'ASC']] });
    const allocations = await CalendarFundingPlanEntity.findAll({ order: [['id', 'ASC']] });
    const events = await FundingEventEntity.findAll({ order: [['id', 'ASC']] });

    return {
      plans: plans.map((p) => ({
        id: p.id,
        status: p.status,
        cancelledAt: p.cancelled_at,
        cancelAt: p.cancel_at,
        currentPeriodEnd: p.current_period_end,
      })),
      allocations: allocations.map((a) => ({ id: a.id, endTime: a.end_time })),
      events: events.map((e) => ({ id: e.id, providerEventId: e.provider_event_id })),
    };
  }

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    fundingInterface = new FundingInterface(eventBus);
    const calendarInterface = new CalendarInterface(eventBus, undefined, undefined, fundingInterface);
    fundingInterface.setCalendarInterface(calendarInterface);

    // A non-admin owner: admin-owned calendars are exempt from the gate.
    const configurationInterface = new ConfigurationInterface();
    const accountService = new AccountService(
      eventBus,
      configurationInterface,
      new SetupInterface(configurationInterface),
      new EmailInterface(),
    );
    const { account } = await accountService._setupAccount('full-loop-owner@pavillion.dev', 'testpassword');
    ownerAccountId = account.id;
    calendar = await calendarInterface.createCalendar(account, 'full-loop-cal');

    // Funding switched on, so the gate consults coverage instead of opening.
    let settings = await FundingSettingsEntity.findOne();
    if (!settings) {
      settings = FundingSettingsEntity.build({
        id: uuidv4(),
        monthly_price: 1000000,
        yearly_price: 10000000,
        currency: 'USD',
        pay_what_you_can: false,
        grace_period_days: 7,
      });
    }
    settings.enabled = true;
    await settings.save();

    const stripeModel = new ProviderConfig(uuidv4(), 'stripe');
    stripeModel.enabled = true;
    stripeModel.displayName = 'Credit Card';
    // Plaintext goes through the entity's encrypt-on-create hook, so the
    // webhook path decrypts the secret it verifies against exactly as it does
    // for a configured instance.
    const stripeConfig = ProviderConfigEntity.fromModel(stripeModel);
    stripeConfig._decryptedCredentials = JSON.stringify({ apiKey: 'sk_test_full_loop' });
    stripeConfig._decryptedWebhookSecret = WEBHOOK_SECRET;
    await stripeConfig.save();

    sandbox = sinon.createSandbox();
    const now = new Date();
    getSubscription = sandbox.stub(StripeAdapter.prototype, 'getSubscription').resolves({
      providerSubscriptionId: SUBSCRIPTION_ID,
      providerCustomerId: CUSTOMER_ID,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      amount: 1000000,
      currency: 'USD',
    });
  });

  afterAll(async () => {
    sandbox.restore();
    ProviderFactory.clearAllCaches();
    eventBus.removeAllListeners();
    await env.cleanup();
  });

  // The steps below are one lifecycle and run in order, each starting from
  // the state the previous one left.

  it('starts with the gate closed for an uncovered calendar', async () => {
    expect(await widgetAccess()).toBe(false);
  });

  it('rejects a checkout completion signed with the wrong secret and leaves the gate closed', async () => {
    const payload = capturedStripeEventPayload('checkout.session.completed', {
      eventId: 'evt_full_loop_forged',
      subscriptionId: SUBSCRIPTION_ID,
      customerId: CUSTOMER_ID,
      accountId: ownerAccountId,
      calendarIds: [calendar.id],
    });

    const response = await deliver(payload, sign(payload, 'whsec_not_the_instance_secret'));

    expect(response.status).toBe(400);
    expect(await FundingPlanEntity.count()).toBe(0);
    expect(await widgetAccess()).toBe(false);
  });

  it('opens the gate when a signed checkout.session.completed arrives', async () => {
    const payload = capturedStripeEventPayload('checkout.session.completed', {
      eventId: 'evt_full_loop_checkout',
      subscriptionId: SUBSCRIPTION_ID,
      customerId: CUSTOMER_ID,
      accountId: ownerAccountId,
      calendarIds: [calendar.id],
    });
    accepted.checkout = { payload, signature: sign(payload) };

    const response = await deliver(accepted.checkout.payload, accepted.checkout.signature);

    expect(response.status).toBe(200);
    expect(getSubscription.calledOnceWithExactly(SUBSCRIPTION_ID)).toBe(true);

    const plan = await FundingPlanEntity.findOne({ where: { provider_subscription_id: SUBSCRIPTION_ID } });
    expect(plan?.status).toBe('active');
    expect(plan?.account_id).toBe(ownerAccountId);

    expect(await widgetAccess()).toBe(true);
  });

  it('closes the gate when a signed customer.subscription.deleted arrives', async () => {
    const payload = capturedStripeEventPayload('customer.subscription.deleted', {
      eventId: 'evt_full_loop_deleted',
      subscriptionId: SUBSCRIPTION_ID,
      customerId: CUSTOMER_ID,
    });
    accepted.deleted = { payload, signature: sign(payload) };

    const response = await deliver(accepted.deleted.payload, accepted.deleted.signature);

    expect(response.status).toBe(200);

    const plan = await FundingPlanEntity.findOne({ where: { provider_subscription_id: SUBSCRIPTION_ID } });
    expect(plan?.status).toBe('cancelled');
    expect(plan?.cancelled_at).not.toBeNull();

    const allocation = await CalendarFundingPlanEntity.findOne({ where: { calendar_id: calendar.id } });
    expect(allocation?.end_time).not.toBeNull();

    expect(await widgetAccess()).toBe(false);
  });

  it('leaves state unchanged when Stripe redelivers the same signed events', async () => {
    const before = await fundingState();

    // Byte-identical redeliveries, signature included: Stripe retries a
    // delivery it did not see acknowledged. The replayed checkout must not
    // mint a second plan or reopen coverage on the cancelled one.
    expect((await deliver(accepted.deleted.payload, accepted.deleted.signature)).status).toBe(200);
    expect((await deliver(accepted.checkout.payload, accepted.checkout.signature)).status).toBe(200);

    expect(await fundingState()).toEqual(before);
    expect(getSubscription.callCount).toBe(1);
    expect(await widgetAccess()).toBe(false);
  });
});
