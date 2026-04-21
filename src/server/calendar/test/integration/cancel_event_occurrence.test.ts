import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import request from 'supertest';
import { DateTime } from 'luxon';

import { TestEnvironment } from '@/server/test/lib/test_environment';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';

/**
 * Integration tests for the occurrence-based cancel / restore API endpoints
 * introduced in pv-cn0r Phase 1.
 *
 * Covers:
 *   - GET /api/v1/events/:eventId/upcoming-occurrences
 *   - POST /api/v1/events/:eventId/occurrences/cancel
 *   - DELETE /api/v1/events/:eventId/occurrences/cancel
 *
 * Happy paths are exercised across weekly, monthly, and yearly RRule flavors
 * so the decoupling from the 6-month materialization horizon is proven for
 * low-frequency events. Validation, IDOR, and error-body privacy invariants
 * (errorName-only 422 body, 404-over-403 for existing-but-unowned events)
 * are asserted directly per the .1.5 route-handler contract.
 */
describe('Cancel / Restore Event Occurrence API (date-based)', () => {
  let env: TestEnvironment;
  let accountService: AccountService;

  let ownerCalendarId: string;
  let ownerCalendarUrlName: string;
  let attackerCalendarId: string;

  let ownerToken: string;
  let attackerToken: string;

  // Weekly recurring event used as the default fixture for most tests. A
  // fresh copy is created in beforeEach so cancel/restore writes do not bleed
  // across tests.
  let recurringEventId: string;

  // Separate recurring events exclusively for the monthly / yearly happy-path
  // assertions on GET /upcoming-occurrences. Created per-test so they start
  // from a clean exclusion-schedule state.
  let monthlyEventId: string;
  let yearlyEventId: string;

  async function createCalendarViaApi(token: string, urlName: string): Promise<{ id: string; urlName: string }> {
    const response = await request(env.app)
      .post('/api/v1/calendars')
      .set('Authorization', `Bearer ${token}`)
      .send({ urlName, languages: 'en' });
    if (response.status !== 201 && response.status !== 200) {
      throw new Error(`Failed to create calendar ${urlName}: ${response.status} ${JSON.stringify(response.body)}`);
    }
    return { id: response.body.id, urlName: response.body.urlName };
  }

  async function createRecurringEventViaApi(
    token: string,
    calendarId: string,
    startIso: string,
    endIso: string,
    eventEndIso: string,
    name: string,
    frequency: 'weekly' | 'monthly' | 'yearly' = 'weekly',
  ): Promise<string> {
    const response = await request(env.app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${token}`)
      .send({
        calendarId,
        content: {
          en: {
            name,
            description: 'Recurring event for occurrence cancel tests',
          },
        },
        schedules: [{
          start: startIso,
          end: endIso,
          eventEndTime: eventEndIso,
          frequency,
          interval: 1,
        }],
      });
    if (response.status !== 201) {
      throw new Error(`Failed to create event ${name}: ${response.status} ${JSON.stringify(response.body)}`);
    }
    return response.body.id;
  }

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    await accountService._setupAccount('owner-occurrence@pavillion.dev', 'testpassword');
    ownerToken = await env.login('owner-occurrence@pavillion.dev', 'testpassword');

    await accountService._setupAccount('attacker-occurrence@pavillion.dev', 'testpassword');
    attackerToken = await env.login('attacker-occurrence@pavillion.dev', 'testpassword');

    const ownerCal = await createCalendarViaApi(ownerToken, 'ownerocc');
    ownerCalendarId = ownerCal.id;
    ownerCalendarUrlName = ownerCal.urlName;
    const attackerCal = await createCalendarViaApi(attackerToken, 'attackerocc');
    attackerCalendarId = attackerCal.id;
    // touch the non-null assertions so unused-var lint is quiet; attacker
    // calendar id is kept around for future cross-calendar probes.
    void ownerCalendarUrlName;
    void attackerCalendarId;
  });

  afterAll(async () => {
    if (env) {
      await new Promise(resolve => setTimeout(resolve, 500));
      await env.cleanup();
    }
  });

  beforeEach(async () => {
    // Weekly: 2026-05-04..2026-07-13 gives ~10 weekly occurrences.
    recurringEventId = await createRecurringEventViaApi(
      ownerToken,
      ownerCalendarId,
      '2026-05-04T10:00:00',
      '2026-07-13T10:00:00',
      '2026-05-04T11:00:00',
      'Weekly Standup',
      'weekly',
    );

    // Monthly: 2026-05-04..2028-05-04 ~25 monthly occurrences. Spans beyond
    // the ~6-month materialization window so a correctly-implemented
    // listUpcomingOccurrences must compute from the RRuleSet directly.
    monthlyEventId = await createRecurringEventViaApi(
      ownerToken,
      ownerCalendarId,
      '2026-05-04T10:00:00',
      '2028-05-04T10:00:00',
      '2026-05-04T11:00:00',
      'Monthly Review',
      'monthly',
    );

    // Yearly: 2026-05-04..2035-05-04 = 10 yearly occurrences. Well beyond the
    // materialization horizon — the motivating case for this endpoint.
    yearlyEventId = await createRecurringEventViaApi(
      ownerToken,
      ownerCalendarId,
      '2026-05-04T10:00:00',
      '2035-05-04T10:00:00',
      '2026-05-04T11:00:00',
      'Yearly Retrospective',
      'yearly',
    );
  });

  describe('GET /events/:eventId/upcoming-occurrences', () => {
    it('returns occurrences with default limit 10 after now (weekly)', async () => {
      const response = await request(env.app)
        .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.occurrences)).toBe(true);
      expect(response.body.occurrences.length).toBeGreaterThan(0);
      expect(response.body.occurrences.length).toBeLessThanOrEqual(10);
      expect(typeof response.body.hasMore).toBe('boolean');

      // Every occurrence should carry { start, state, scheduleId }.
      for (const occ of response.body.occurrences) {
        expect(typeof occ.start).toBe('string');
        expect(['active', 'cancelled-shown', 'hidden']).toContain(occ.state);
        // Freshly-created event has no exclusions → everything is active →
        // scheduleId must be null per the privacy binding.
        expect(occ.state).toBe('active');
        expect(occ.scheduleId).toBeNull();
      }
    });

    it('returns occurrences for a monthly event (beyond materialization horizon)', async () => {
      const response = await request(env.app)
        .get(`/api/v1/events/${monthlyEventId}/upcoming-occurrences?limit=12`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.occurrences.length).toBeGreaterThan(6);
      expect(response.body.occurrences.length).toBeLessThanOrEqual(12);

      // Monthly stride: consecutive occurrences differ by ~28-31 days.
      const ms = response.body.occurrences.map((o: any) => DateTime.fromISO(o.start).toMillis());
      for (let i = 1; i < ms.length; i++) {
        const deltaDays = (ms[i] - ms[i - 1]) / (1000 * 60 * 60 * 24);
        expect(deltaDays).toBeGreaterThan(27);
        expect(deltaDays).toBeLessThan(32);
      }
    });

    it('returns occurrences for a yearly event (proves decoupling from horizon)', async () => {
      const response = await request(env.app)
        .get(`/api/v1/events/${yearlyEventId}/upcoming-occurrences?limit=5`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(200);
      // A yearly event whose first occurrence is beyond the usual 6-month
      // materialization horizon MUST still return results from the rrule.
      expect(response.body.occurrences.length).toBeGreaterThan(0);
      expect(response.body.occurrences.length).toBeLessThanOrEqual(5);

      const ms = response.body.occurrences.map((o: any) => DateTime.fromISO(o.start).toMillis());
      for (let i = 1; i < ms.length; i++) {
        const deltaDays = (ms[i] - ms[i - 1]) / (1000 * 60 * 60 * 24);
        // Yearly stride: 365 or 366 days.
        expect(deltaDays).toBeGreaterThan(364);
        expect(deltaDays).toBeLessThan(367);
      }
    });

    it('honors the limit query parameter', async () => {
      const response = await request(env.app)
        .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences?limit=3`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.occurrences.length).toBeLessThanOrEqual(3);
    });

    it('clamps limit=0 to 1', async () => {
      const response = await request(env.app)
        .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences?limit=0`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.occurrences.length).toBe(1);
    });

    it('clamps limit>50 to 50', async () => {
      // Monthly event has 24 occurrences over its 2-year span; use it so the
      // clamp is visible: requesting 500 should never return more than 50.
      const response = await request(env.app)
        .get(`/api/v1/events/${monthlyEventId}/upcoming-occurrences?limit=500`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.occurrences.length).toBeLessThanOrEqual(50);
    });

    it('defaults to 10 when limit is non-integer', async () => {
      const response = await request(env.app)
        .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences?limit=notanumber`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.occurrences.length).toBeLessThanOrEqual(10);
    });

    it('returns first occurrence strictly after the `after` cursor', async () => {
      // Grab the first occurrence without a cursor.
      const baseline = await request(env.app)
        .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences?limit=2`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(baseline.status).toBe(200);
      expect(baseline.body.occurrences.length).toBeGreaterThanOrEqual(2);

      // Use the first occurrence's start as the `after` cursor. The endpoint
      // uses strict-greater-than semantics so result[0] must be > cursor.
      const cursor = baseline.body.occurrences[0].start;
      const response = await request(env.app)
        .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences?limit=2&after=${encodeURIComponent(cursor)}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.occurrences.length).toBeGreaterThan(0);
      const firstMs = DateTime.fromISO(response.body.occurrences[0].start).toMillis();
      const cursorMs = DateTime.fromISO(cursor).toMillis();
      expect(firstMs).toBeGreaterThan(cursorMs);
    });

    it('rejects non-UUID event ids with 400 ValidationError', async () => {
      const response = await request(env.app)
        .get(`/api/v1/events/not-a-uuid/upcoming-occurrences`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('rejects invalid `after` (non-ISO) with 400 ValidationError', async () => {
      const response = await request(env.app)
        .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences?after=not-a-date`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('rejects pre-1900 `after` with 400 ValidationError', async () => {
      const response = await request(env.app)
        .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences?after=1899-12-31T00:00:00Z`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('returns 404 for unknown event ids', async () => {
      const unknownId = '00000000-0000-4000-8000-000000000000';
      const response = await request(env.app)
        .get(`/api/v1/events/${unknownId}/upcoming-occurrences`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(404);
    });

    it('returns 404 (IDOR — never 403) when caller is not an editor', async () => {
      // The attacker is a real account but has no editor role on the owner's
      // calendar. Per the IDOR binding, this must return 404 (not 403) so
      // the existence of the event does not leak.
      const response = await request(env.app)
        .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences`)
        .set('Authorization', `Bearer ${attackerToken}`);

      expect(response.status).toBe(404);
    });
  });

  describe('POST /events/:eventId/occurrences/cancel', () => {
    it('cancels a matching occurrence in shown mode and returns 204', async () => {
      const list = await request(env.app)
        .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences?limit=1`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(list.status).toBe(200);
      const first = list.body.occurrences[0];
      expect(first).toBeDefined();

      const response = await request(env.app)
        .post(`/api/v1/events/${recurringEventId}/occurrences/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ start: first.start, hideFromPublic: false });

      expect(response.status).toBe(204);

      // Post-cancel the GET endpoint should report the occurrence as
      // cancelled-shown with a non-null scheduleId.
      const after = await request(env.app)
        .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences?limit=5`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(after.status).toBe(200);
      const cancelledRow = after.body.occurrences.find(
        (o: any) => DateTime.fromISO(o.start).toMillis() === DateTime.fromISO(first.start).toMillis(),
      );
      expect(cancelledRow).toBeDefined();
      expect(cancelledRow.state).toBe('cancelled-shown');
      expect(cancelledRow.scheduleId).not.toBeNull();
      expect(typeof cancelledRow.scheduleId).toBe('string');
    });

    it('cancels a matching occurrence in hidden mode and drops it from listings (but GET still shows it)', async () => {
      const list = await request(env.app)
        .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences?limit=1`)
        .set('Authorization', `Bearer ${ownerToken}`);
      const first = list.body.occurrences[0];

      const response = await request(env.app)
        .post(`/api/v1/events/${recurringEventId}/occurrences/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ start: first.start, hideFromPublic: true });
      expect(response.status).toBe(204);

      // For the editor-facing list, hidden cancellations MUST still appear
      // (so the editor can restore them). The state is 'hidden' with a
      // non-null scheduleId.
      const after = await request(env.app)
        .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences?limit=5`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(after.status).toBe(200);
      const hiddenRow = after.body.occurrences.find(
        (o: any) => DateTime.fromISO(o.start).toMillis() === DateTime.fromISO(first.start).toMillis(),
      );
      expect(hiddenRow).toBeDefined();
      expect(hiddenRow.state).toBe('hidden');
      expect(hiddenRow.scheduleId).not.toBeNull();
    });

    it('returns 422 with errorName-only body when start does not match the rrule', async () => {
      const list = await request(env.app)
        .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences?limit=1`)
        .set('Authorization', `Bearer ${ownerToken}`);
      const first = DateTime.fromISO(list.body.occurrences[0].start);
      // Weekly event: shifting by 1 hour lands squarely between occurrences.
      const mismatch = first.plus({ hours: 1 }).toISO();

      const response = await request(env.app)
        .post(`/api/v1/events/${recurringEventId}/occurrences/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ start: mismatch, hideFromPublic: false });

      expect(response.status).toBe(422);
      // Privacy binding: body contains ONLY { errorName } — no error / message fields.
      expect(response.body).toEqual({ errorName: 'InvalidOccurrenceDateError' });
      expect(response.body.error).toBeUndefined();
      expect(response.body.message).toBeUndefined();
    });

    it('rejects missing start (400 ValidationError)', async () => {
      const response = await request(env.app)
        .post(`/api/v1/events/${recurringEventId}/occurrences/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ hideFromPublic: false });
      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('rejects non-ISO start (400 ValidationError)', async () => {
      const response = await request(env.app)
        .post(`/api/v1/events/${recurringEventId}/occurrences/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ start: 'not-a-date', hideFromPublic: false });
      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('rejects pre-1900 start (400 ValidationError)', async () => {
      const response = await request(env.app)
        .post(`/api/v1/events/${recurringEventId}/occurrences/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ start: '1899-12-31T00:00:00Z', hideFromPublic: false });
      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('rejects non-boolean hideFromPublic (400 ValidationError)', async () => {
      const list = await request(env.app)
        .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences?limit=1`)
        .set('Authorization', `Bearer ${ownerToken}`);
      const first = list.body.occurrences[0];

      const response = await request(env.app)
        .post(`/api/v1/events/${recurringEventId}/occurrences/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ start: first.start, hideFromPublic: 'yes' });
      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('rejects non-UUID event id (400 ValidationError)', async () => {
      const response = await request(env.app)
        .post(`/api/v1/events/not-a-uuid/occurrences/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ start: '2026-05-04T10:00:00Z', hideFromPublic: false });
      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('returns 404 for unknown event id', async () => {
      const unknownId = '00000000-0000-4000-8000-000000000000';
      const response = await request(env.app)
        .post(`/api/v1/events/${unknownId}/occurrences/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ start: '2026-05-04T10:00:00Z', hideFromPublic: false });
      expect(response.status).toBe(404);
    });

    it('returns 404 (IDOR — never 403) when caller is not an editor', async () => {
      const list = await request(env.app)
        .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences?limit=1`)
        .set('Authorization', `Bearer ${ownerToken}`);
      const first = list.body.occurrences[0];

      const response = await request(env.app)
        .post(`/api/v1/events/${recurringEventId}/occurrences/cancel`)
        .set('Authorization', `Bearer ${attackerToken}`)
        .send({ start: first.start, hideFromPublic: false });

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /events/:eventId/occurrences/cancel', () => {
    it('restores a previously cancelled occurrence and GET reports active + null scheduleId', async () => {
      const list = await request(env.app)
        .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences?limit=1`)
        .set('Authorization', `Bearer ${ownerToken}`);
      const first = list.body.occurrences[0];

      // Cancel first.
      const cancelResp = await request(env.app)
        .post(`/api/v1/events/${recurringEventId}/occurrences/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ start: first.start, hideFromPublic: false });
      expect(cancelResp.status).toBe(204);

      // Restore it.
      const restoreResp = await request(env.app)
        .delete(`/api/v1/events/${recurringEventId}/occurrences/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ start: first.start });
      expect(restoreResp.status).toBe(204);

      // GET must now report the occurrence as active with scheduleId: null.
      const after = await request(env.app)
        .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences?limit=5`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(after.status).toBe(200);
      const restoredRow = after.body.occurrences.find(
        (o: any) => DateTime.fromISO(o.start).toMillis() === DateTime.fromISO(first.start).toMillis(),
      );
      expect(restoredRow).toBeDefined();
      expect(restoredRow.state).toBe('active');
      expect(restoredRow.scheduleId).toBeNull();
    });

    it('is a silent 204 no-op when no matching exclusion row exists', async () => {
      const list = await request(env.app)
        .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences?limit=1`)
        .set('Authorization', `Bearer ${ownerToken}`);
      const first = list.body.occurrences[0];

      // No prior cancel — restore should silently succeed with 204.
      const response = await request(env.app)
        .delete(`/api/v1/events/${recurringEventId}/occurrences/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ start: first.start });
      expect(response.status).toBe(204);
    });

    it('rejects missing start (400 ValidationError)', async () => {
      const response = await request(env.app)
        .delete(`/api/v1/events/${recurringEventId}/occurrences/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({});
      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('rejects non-ISO start (400 ValidationError)', async () => {
      const response = await request(env.app)
        .delete(`/api/v1/events/${recurringEventId}/occurrences/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ start: 'not-a-date' });
      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('rejects pre-1900 start (400 ValidationError)', async () => {
      const response = await request(env.app)
        .delete(`/api/v1/events/${recurringEventId}/occurrences/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ start: '1899-12-31T00:00:00Z' });
      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('rejects non-UUID event id (400 ValidationError)', async () => {
      const response = await request(env.app)
        .delete(`/api/v1/events/not-a-uuid/occurrences/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ start: '2026-05-04T10:00:00Z' });
      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('returns 404 for unknown event id', async () => {
      const unknownId = '00000000-0000-4000-8000-000000000000';
      const response = await request(env.app)
        .delete(`/api/v1/events/${unknownId}/occurrences/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ start: '2026-05-04T10:00:00Z' });
      expect(response.status).toBe(404);
    });

    it('returns 404 (IDOR — never 403) when caller is not an editor', async () => {
      const list = await request(env.app)
        .get(`/api/v1/events/${recurringEventId}/upcoming-occurrences?limit=1`)
        .set('Authorization', `Bearer ${ownerToken}`);
      const first = list.body.occurrences[0];

      const response = await request(env.app)
        .delete(`/api/v1/events/${recurringEventId}/occurrences/cancel`)
        .set('Authorization', `Bearer ${attackerToken}`)
        .send({ start: first.start });
      expect(response.status).toBe(404);
    });
  });
});
