import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import request from 'supertest';

import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { AccountRoleEntity } from '@/server/common/entity/account';
import { FundingSettingsEntity } from '@/server/funding/entity/funding_settings';
import { FundingPlanEntity } from '@/server/funding/entity/funding_plan';
import { CalendarFundingPlanEntity } from '@/server/funding/entity/calendar_funding_plan';
import { ComplimentaryGrantEntity } from '@/server/funding/entity/complimentary_grant';

/**
 * DEC-004 invariant: anonymous access to public event and calendar
 * information is never funding-gated.
 *
 * Full anonymous access to public event information is a product commitment,
 * not an implementation detail — a visitor reading a community's calendar is
 * not a customer and cannot be asked to pay, nor can their view of a
 * community be withheld because that community stopped paying us.
 *
 * ## Why this is a behavioural test and not a route-shape test
 *
 * The obvious way to check this invariant is structural: tag every gate,
 * then walk the public router tree and assert no tagged handler is mounted on
 * it. That is cheap and it reads well, but it only sees gates built by the
 * one tagged mechanism. A public handler that gates by calling a *service*
 * method which internally consults FundingInterface.checkFundingAccess would
 * withhold a community's calendar from anonymous readers and pass a
 * route-shape check in silence.
 *
 * That is not a hypothetical arrangement. CalendarInterface already exposes a
 * funding-gated read (`getCalendarForWidget`), and PublicCalendarInterface
 * wraps CalendarInterface — the public surface is one delegation away from a
 * method that can refuse on funding grounds. So the invariant is asserted
 * where it is actually promised: at the wire, against a running instance,
 * through anonymous HTTP. A gate introduced by any mechanism — middleware,
 * handler branch, or a service call several layers down — fails these tests,
 * because they assert the response the visitor gets rather than the shape of
 * the code that produced it.
 *
 * ## The fixture, and why it needs a guard
 *
 * These assertions are only worth anything if the calendar under test would
 * actually be refused by a funding gate. Three ways this fixture could
 * silently become vacuous, each guarded by a test below:
 *
 *  1. Funding is not enabled on the instance — then checkFundingAccess
 *     invariant 1 opens every gate and nothing was proved.
 *  2. The calendar's owner is an instance admin — invariant 2 exempts them.
 *     This is the easy one to get wrong: AccountService._setupAccount grants
 *     the admin role to the FIRST account created when NODE_ENV === 'test',
 *     so a fixture that creates one account and uses it has an admin-exempt
 *     calendar. The organizer here is deliberately the second account.
 *  3. The calendar has a plan or a grant — invariant 3 opens the gate.
 *
 * The strongest guard is the third test: the same calendar, asked for over a
 * surface that IS funding-gated, is refused with 402. That is this suite's
 * negative control. It proves the gate is closed and observable through HTTP
 * before the rest of the suite asserts that the public surface does not close
 * it — the same instinct as the router-walk's "prove the walk can find a gate
 * first", carried over to behaviour.
 *
 * Scope note: this is about the public API (`/api/public/v1`), the surface
 * that serves the anonymous `/view/` site. The widget API used as the control
 * is a different surface — DEC-011 classes embedding a calendar into a
 * non-federated web property as an outbound platform bridge, so the widget's
 * 402 to an anonymous embedder is deliberate and stays as it is.
 */
describe('DEC-004: anonymous public reads are never funding-gated', () => {
  let env: TestEnvironment;

  let organizerAccountId: string;
  let calendarId: string;
  let listedEventId: string;
  let upcomingEventId: string;
  let categoryId: string;

  const urlName = 'riversidemutualaid';
  const calendarName = 'Riverside Mutual Aid';

  // Two events, because the public surface reaches them by different paths and
  // both paths need covering. A past occurrence is materialized 1:1 at creation
  // so it appears in the calendar's instance list; a far-future occurrence is
  // outside the pre-generation horizon, so its detail page exercises the
  // materialize-on-first-read path. Both dates are fixed so neither assertion
  // drifts with the wall clock.
  const listedEventName = 'Tool Library Open Hours';
  const listedEventStart = '2020-03-18T17:00:00Z';
  const upcomingEventName = 'Seed Swap and Repair Cafe';
  const upcomingEventStart = '2033-05-18T17:00:00Z';
  const upcomingEventSlug = '20330518-1700';

  const instanceAdminEmail = 'dec004-instance-admin@pavillion.dev';
  const organizerEmail = 'dec004-organizer@pavillion.dev';
  const password = 'testpassword';

  /**
   * POST/PUT/PATCH helper that fails loudly on an unexpected status so a
   * broken fixture surfaces as a setup error rather than as a confusing
   * assertion failure several tests later.
   */
  function expectStatus(response: { status: number; body: unknown }, expected: number[], what: string): void {
    if (!expected.includes(response.status)) {
      throw new Error(`${what}: expected ${expected.join('/')}, got ${response.status} ${JSON.stringify(response.body)}`);
    }
  }

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    const accountService = new AccountService(eventBus, new ConfigurationInterface(), new SetupInterface());

    // The first account absorbs the test-mode auto-admin grant. Nothing else
    // uses it; it exists so the organizer below is genuinely not an admin.
    await accountService._setupAccount(instanceAdminEmail, password);

    const organizerInfo = await accountService._setupAccount(organizerEmail, password);
    organizerAccountId = organizerInfo.account.id;
    const organizerToken = await env.login(organizerEmail, password);

    const calendarResponse = await env.authPost(organizerToken, '/api/v1/calendars', {
      urlName,
      languages: 'en',
    });
    expectStatus(calendarResponse, [200, 201], 'create calendar');
    calendarId = calendarResponse.body.id;

    // Give the calendar and its event real content, so the assertions below
    // can check that the anonymous reader receives the community's actual
    // information and not merely a 200 with an empty shell.
    const settingsResponse = await request(env.app)
      .patch(`/api/v1/calendars/${calendarId}/settings`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ content: { en: { name: calendarName, description: 'Neighbours sharing tools and time.' } } });
    expectStatus(settingsResponse, [200], 'set calendar content');

    const categoryResponse = await env.authPost(
      organizerToken,
      `/api/v1/calendars/${calendarId}/categories`,
      { name: 'Skill Shares', language: 'en' },
    );
    expectStatus(categoryResponse, [200, 201], 'create category');
    categoryId = categoryResponse.body.id;

    const listedEventResponse = await env.authPost(organizerToken, '/api/v1/events', {
      calendarId,
      content: { en: { name: listedEventName, description: 'Borrow a drill, bring it back.' } },
      schedules: [{ start: listedEventStart, end: listedEventStart, eventEndTime: '2020-03-18T19:00:00Z' }],
      categories: [categoryId],
    });
    expectStatus(listedEventResponse, [200, 201], 'create listed event');
    listedEventId = listedEventResponse.body.id;

    const upcomingEventResponse = await env.authPost(organizerToken, '/api/v1/events', {
      calendarId,
      content: { en: { name: upcomingEventName, description: 'Bring seeds, bring something broken.' } },
      schedules: [{ start: upcomingEventStart, end: upcomingEventStart, eventEndTime: '2033-05-18T19:00:00Z' }],
      categories: [categoryId],
    });
    expectStatus(upcomingEventResponse, [200, 201], 'create upcoming event');
    upcomingEventId = upcomingEventResponse.body.id;

    // Authorize an embedding domain while funding is still off, so the widget
    // control below is refused on funding grounds and not on Origin grounds.
    const domainResponse = await env.authPut(
      organizerToken,
      `/api/v1/calendars/${calendarId}/widget/domain`,
      { domain: 'example.com' },
    );
    expectStatus(domainResponse, [200], 'authorize widget domain');

    // Now switch the instance to charging. No plan and no grant are created
    // for this calendar, so its funding gate is closed from here on.
    await FundingSettingsEntity.create({
      id: uuidv4(),
      enabled: true,
      monthly_price: 500000,
      yearly_price: 5000000,
      currency: 'USD',
      pay_what_you_can: false,
      grace_period_days: 7,
    });

    eventBus.removeAllListeners();
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  describe('fixture guard: this calendar\'s funding gate is genuinely closed', () => {
    it('runs on an instance that charges', async () => {
      const settings = await FundingSettingsEntity.findOne();

      expect(settings).not.toBeNull();
      expect(settings!.enabled).toBe(true);
    });

    it('is owned by an account with no admin role', async () => {
      // checkFundingAccess invariant 2 exempts admin-owned calendars. An
      // admin owner here would open the gate and make every assertion below
      // vacuous.
      const roles = await AccountRoleEntity.findAll({ where: { account_id: organizerAccountId } });

      expect(roles.map((row) => row.role)).not.toContain('admin');
    });

    it('has neither a funding plan allocation nor a complimentary grant', async () => {
      const allocations = await CalendarFundingPlanEntity.findAll({ where: { calendar_id: calendarId } });
      const grants = await ComplimentaryGrantEntity.findAll({ where: { calendar_id: calendarId } });
      const plans = await FundingPlanEntity.findAll({ where: { account_id: organizerAccountId } });

      expect(allocations).toHaveLength(0);
      expect(grants).toHaveLength(0);
      expect(plans).toHaveLength(0);
    });

    it('is refused over a funding-gated surface, proving the gate closes and is visible at the wire', async () => {
      // Negative control. Without this, the suite could pass by asserting
      // that an open gate failed to close — it would be looking at a calendar
      // nothing would have refused anyway.
      const response = await request(env.app)
        .get(`/api/widget/v1/calendars/${urlName}`)
        .set('Origin', 'https://example.com');

      expect(response.status).toBe(402);
      expect(response.body.errorName).toBe('SubscriptionRequiredError');
    });
  });

  describe('the same calendar, read anonymously over the public API', () => {
    it('serves the calendar with its content', async () => {
      const response = await request(env.app).get(`/api/public/v1/calendar/${urlName}`);

      expect(response.status).toBe(200);
      expect(response.body.urlName).toBe(urlName);
      expect(response.body.content.en.name).toBe(calendarName);
    });

    it('lists the calendar on the anonymous discovery index', async () => {
      const response = await request(env.app).get('/api/public/v1/calendars');

      expect(response.status).toBe(200);
      const row = response.body.find((c: any) => c.urlName === urlName);
      expect(row).toBeDefined();
      expect(row.content.some((c: any) => c.name === calendarName)).toBe(true);
    });

    it('lists the calendar\'s event instances', async () => {
      const response = await request(env.app).get(`/api/public/v1/calendar/${urlName}/events`);

      expect(response.status).toBe(200);
      const instance = response.body.find((i: any) => i.event?.id === listedEventId);
      expect(instance).toBeDefined();
      expect(instance.event.content.en.name).toBe(listedEventName);
    });

    it('serves an event\'s detail', async () => {
      const response = await request(env.app).get(`/api/public/v1/events/${upcomingEventId}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(upcomingEventId);
      expect(response.body.content.en.name).toBe(upcomingEventName);
    });

    it('serves a single event instance', async () => {
      const response = await request(env.app)
        .get(`/api/public/v1/events/${upcomingEventId}/instances/${upcomingEventSlug}`);

      expect(response.status).toBe(200);
      expect(response.body.event.id).toBe(upcomingEventId);
      expect(response.body.event.content.en.name).toBe(upcomingEventName);
    });

    it('lists the calendar\'s categories', async () => {
      const response = await request(env.app).get(`/api/public/v1/calendar/${urlName}/categories`);

      expect(response.status).toBe(200);
      expect(response.body.map((c: any) => c.id)).toContain(categoryId);
    });

    it('lists the calendar\'s series', async () => {
      const response = await request(env.app).get(`/api/public/v1/calendar/${urlName}/series`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('answers every public read without a payment-required status', async () => {
      // A blanket sweep over the public surface, so an endpoint added to the
      // router later is covered by this suite even if nobody adds a case for
      // it above. 402 is the funding refusal; 404 would also be a refusal
      // this suite should not tolerate on a calendar that exists.
      const paths = [
        '/api/public/v1/calendars',
        `/api/public/v1/calendar/${urlName}`,
        `/api/public/v1/calendar/${urlName}/categories`,
        `/api/public/v1/calendar/${urlName}/series`,
        `/api/public/v1/calendar/${urlName}/events`,
        `/api/public/v1/events/${listedEventId}`,
        `/api/public/v1/events/${upcomingEventId}`,
        `/api/public/v1/events/${upcomingEventId}/instances/${upcomingEventSlug}`,
      ];

      const statuses = await Promise.all(
        paths.map(async (path) => [path, (await request(env.app).get(path)).status] as const),
      );

      expect(Object.fromEntries(statuses)).toEqual(
        Object.fromEntries(paths.map((path) => [path, 200])),
      );
    });
  });
});
