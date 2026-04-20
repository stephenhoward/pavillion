import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import request from 'supertest';

import { TestEnvironment } from '@/server/test/lib/test_environment';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';

/**
 * Integration tests for the cancel / restore event instance API endpoints.
 *
 * Covers:
 *   - POST /api/v1/events/:eventId/instances/:instanceId/cancel for both
 *     modes (hideFromPublic=false → shown, hideFromPublic=true → hidden)
 *   - DELETE /api/v1/events/:eventId/instances/:instanceId/cancel restores
 *     the instance
 *   - 400 on missing / invalid body
 *   - 403 for non-editor accounts
 *   - 404 for unknown instance and cross-event mismatch (IDOR guard)
 *   - Cross-calendar IDOR: editor of calendar A cannot cancel calendar B's
 *     instances
 *   - Public API returns isCancelled=true for shown cancellations and omits
 *     hidden cancellations from the listing
 */
describe('Cancel / Restore Event Instance API', () => {
  let env: TestEnvironment;
  let accountService: AccountService;

  let ownerCalendarId: string;
  let ownerCalendarUrlName: string;
  let attackerCalendarId: string;

  let ownerToken: string;
  let attackerToken: string;

  // A recurring event on the owner's calendar plus one of its materialized
  // instance rows — reused across the happy-path tests.
  let recurringEventId: string;
  let recurringInstanceIds: string[];

  // A recurring event on the attacker's calendar for the cross-calendar
  // IDOR scenario.
  let attackerEventId: string;
  let attackerInstanceId: string;

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

  async function createRecurringEventViaApi(token: string, calendarId: string, startIso: string, endIso: string, eventEndIso: string, name: string): Promise<string> {
    const response = await request(env.app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${token}`)
      .send({
        calendarId,
        content: {
          en: {
            name,
            description: 'Recurring event for cancel tests',
          },
        },
        schedules: [{
          start: startIso,
          end: endIso,
          eventEndTime: eventEndIso,
          frequency: 'weekly',
          interval: 1,
        }],
      });
    if (response.status !== 201) {
      throw new Error(`Failed to create event ${name}: ${response.status} ${JSON.stringify(response.body)}`);
    }
    return response.body.id;
  }

  async function listInstanceIdsViaApi(token: string, calendarUrlName: string, eventId: string): Promise<string[]> {
    // Poll briefly for the async eventCreated -> buildEventInstances handler
    // to materialize instance rows before the test reads them.
    for (let attempt = 0; attempt < 20; attempt++) {
      const response = await request(env.app)
        .get(`/api/public/v1/calendar/${calendarUrlName}/events`);
      if (response.status === 200 && Array.isArray(response.body)) {
        const ids = response.body
          .filter((row: any) => row.event?.id === eventId || row.eventId === eventId)
          .map((row: any) => row.id);
        if (ids.length > 0) {
          return ids;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return [];
  }

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    await accountService._setupAccount('owner-cancel@pavillion.dev', 'testpassword');
    ownerToken = await env.login('owner-cancel@pavillion.dev', 'testpassword');

    await accountService._setupAccount('attacker-cancel@pavillion.dev', 'testpassword');
    attackerToken = await env.login('attacker-cancel@pavillion.dev', 'testpassword');

    const ownerCal = await createCalendarViaApi(ownerToken, 'ownercancel');
    ownerCalendarId = ownerCal.id;
    ownerCalendarUrlName = ownerCal.urlName;
    const attackerCal = await createCalendarViaApi(attackerToken, 'attackercancel');
    attackerCalendarId = attackerCal.id;
  });

  afterAll(async () => {
    if (env) {
      await new Promise(resolve => setTimeout(resolve, 500));
      await env.cleanup();
    }
  });

  /**
   * Each test gets its own recurring event so cancel/restore writes do not
   * bleed across cases. Events are created through the HTTP API so they go
   * through the same interface/eventBus that is wired into the test server,
   * which is what triggers the async buildEventInstances handler.
   */
  beforeEach(async () => {
    recurringEventId = await createRecurringEventViaApi(
      ownerToken,
      ownerCalendarId,
      '2026-05-04T10:00:00',
      '2026-07-13T10:00:00',
      '2026-05-04T11:00:00',
      'Weekly Standup',
    );

    attackerEventId = await createRecurringEventViaApi(
      attackerToken,
      attackerCalendarId,
      '2026-05-05T10:00:00',
      '2026-07-14T10:00:00',
      '2026-05-05T11:00:00',
      'Attacker Series',
    );

    recurringInstanceIds = await listInstanceIdsViaApi(ownerToken, ownerCalendarUrlName, recurringEventId);
    if (recurringInstanceIds.length === 0) {
      throw new Error('Expected recurring event to materialize at least one instance');
    }

    const attackerInstances = await listInstanceIdsViaApi(attackerToken, 'attackercancel', attackerEventId);
    if (attackerInstances.length === 0) {
      throw new Error('Expected attacker recurring event to materialize at least one instance');
    }
    attackerInstanceId = attackerInstances[0];
  });

  describe('POST /events/:eventId/instances/:instanceId/cancel', () => {
    it('rejects requests without a body (400)', async () => {
      const response = await request(env.app)
        .post(`/api/v1/events/${recurringEventId}/instances/${recurringInstanceIds[0]}/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('rejects a non-boolean hideFromPublic value (400)', async () => {
      const response = await request(env.app)
        .post(`/api/v1/events/${recurringEventId}/instances/${recurringInstanceIds[0]}/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ hideFromPublic: 'yes' });

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('rejects an invalid event UUID (400)', async () => {
      const response = await request(env.app)
        .post(`/api/v1/events/not-a-uuid/instances/${recurringInstanceIds[0]}/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ hideFromPublic: false });

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('rejects an invalid instance UUID (400)', async () => {
      const response = await request(env.app)
        .post(`/api/v1/events/${recurringEventId}/instances/not-a-uuid/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ hideFromPublic: false });

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('returns 404 for an unknown instance id', async () => {
      const unknownId = '00000000-0000-4000-8000-000000000000';
      const response = await request(env.app)
        .post(`/api/v1/events/${recurringEventId}/instances/${unknownId}/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ hideFromPublic: false });

      expect(response.status).toBe(404);
    });

    it('returns 404 when the instance belongs to a different event (IDOR guard)', async () => {
      // The attacker's instance exists, but it does not belong to the
      // owner's event — the handler must treat this as a not-found rather
      // than leaking the existence of the cross-event instance.
      const response = await request(env.app)
        .post(`/api/v1/events/${recurringEventId}/instances/${attackerInstanceId}/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ hideFromPublic: false });

      expect(response.status).toBe(404);
    });

    it('returns 403 when a non-editor attempts to cancel', async () => {
      const response = await request(env.app)
        .post(`/api/v1/events/${recurringEventId}/instances/${recurringInstanceIds[0]}/cancel`)
        .set('Authorization', `Bearer ${attackerToken}`)
        .send({ hideFromPublic: false });

      expect(response.status).toBe(403);
    });

    it('returns 404 for cross-calendar IDOR (attacker cancels owner instance using attacker event id)', async () => {
      // Attacker submits their own event id with the owner's instance id.
      // The IDOR guard inside the service fires before any permission
      // check, so this surfaces as a 404 not a 403 — either outcome
      // satisfies the acceptance criterion, but the concrete behaviour
      // here is the 404 path.
      const response = await request(env.app)
        .post(`/api/v1/events/${attackerEventId}/instances/${recurringInstanceIds[0]}/cancel`)
        .set('Authorization', `Bearer ${attackerToken}`)
        .send({ hideFromPublic: false });

      expect([403, 404]).toContain(response.status);
    });

    it('cancels an instance in shown mode and returns the updated instance', async () => {
      const response = await request(env.app)
        .post(`/api/v1/events/${recurringEventId}/instances/${recurringInstanceIds[0]}/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ hideFromPublic: false });

      expect(response.status).toBe(200);
      expect(response.body).not.toBeNull();
      expect(response.body.id).toBe(recurringInstanceIds[0]);
      expect(response.body.isCancelled).toBe(true);
    });

    it('cancels an instance in hidden mode', async () => {
      const response = await request(env.app)
        .post(`/api/v1/events/${recurringEventId}/instances/${recurringInstanceIds[0]}/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ hideFromPublic: true });

      expect(response.status).toBe(200);
    });
  });

  describe('DELETE /events/:eventId/instances/:instanceId/cancel', () => {
    it('restores a previously cancelled instance', async () => {
      // Cancel first (shown mode so the instance row continues to exist).
      const cancelResponse = await request(env.app)
        .post(`/api/v1/events/${recurringEventId}/instances/${recurringInstanceIds[0]}/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ hideFromPublic: false });
      expect(cancelResponse.status).toBe(200);
      expect(cancelResponse.body.isCancelled).toBe(true);

      // The eventInstanceCancelled handler runs buildEventInstances which
      // destroys and recreates instance rows with fresh UUIDs. Wait for the
      // rebuild, then look up the new id of the same occurrence to restore.
      await new Promise(resolve => setTimeout(resolve, 500));
      const refreshedIds = await listInstanceIdsViaApi(ownerToken, ownerCalendarUrlName, recurringEventId);
      expect(refreshedIds.length).toBeGreaterThan(0);
      const restoreTargetId = refreshedIds[0];

      const restoreResponse = await request(env.app)
        .delete(`/api/v1/events/${recurringEventId}/instances/${restoreTargetId}/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(restoreResponse.status).toBe(200);
      if (restoreResponse.body) {
        expect(restoreResponse.body.isCancelled).toBe(false);
      }
    });

    it('returns 403 when a non-editor attempts to restore', async () => {
      const response = await request(env.app)
        .delete(`/api/v1/events/${recurringEventId}/instances/${recurringInstanceIds[0]}/cancel`)
        .set('Authorization', `Bearer ${attackerToken}`);

      expect(response.status).toBe(403);
    });

    it('returns 404 when restoring an unknown instance', async () => {
      const unknownId = '00000000-0000-4000-8000-000000000000';
      const response = await request(env.app)
        .delete(`/api/v1/events/${recurringEventId}/instances/${unknownId}/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(404);
    });
  });

  describe('Public API reflects cancellations', () => {
    it('shows isCancelled=true for shown cancellations and omits hidden cancellations', async () => {
      // Grab the first instance for the shown cancellation. After cancel,
      // the async handler rebuilds the instance set with fresh UUIDs, so we
      // need to refetch to pick a second, distinct occurrence for the
      // hidden cancellation.
      const shownResp = await request(env.app)
        .post(`/api/v1/events/${recurringEventId}/instances/${recurringInstanceIds[0]}/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ hideFromPublic: false });
      expect(shownResp.status).toBe(200);

      // Wait for rebuild then refetch to find both (a) the new id of the
      // shown-cancelled occurrence and (b) a different occurrence we can
      // hide-cancel in the same listing.
      await new Promise(resolve => setTimeout(resolve, 500));
      const publicAfterShown = await request(env.app)
        .get(`/api/public/v1/calendar/${ownerCalendarUrlName}/events`);
      expect(publicAfterShown.status).toBe(200);

      const rowsForEvent = (publicAfterShown.body as any[]).filter(
        (row: any) => row.event?.id === recurringEventId,
      );
      expect(rowsForEvent.length).toBeGreaterThan(0);

      const shownRowAfter = rowsForEvent.find((row: any) => row.isCancelled === true);
      expect(shownRowAfter).toBeDefined();
      const shownIdAfter = shownRowAfter.id;

      const hiddenTargetRow = rowsForEvent.find(
        (row: any) => row.isCancelled !== true && row.id !== shownIdAfter,
      );

      if (hiddenTargetRow) {
        const hiddenResp = await request(env.app)
          .post(`/api/v1/events/${recurringEventId}/instances/${hiddenTargetRow.id}/cancel`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ hideFromPublic: true });
        expect(hiddenResp.status).toBe(200);

        // Let the rebuild finish so hidden cancellations actually disappear.
        await new Promise(resolve => setTimeout(resolve, 500));

        const publicAfterHidden = await request(env.app)
          .get(`/api/public/v1/calendar/${ownerCalendarUrlName}/events`);
        expect(publicAfterHidden.status).toBe(200);

        const finalRows = (publicAfterHidden.body as any[]).filter(
          (row: any) => row.event?.id === recurringEventId,
        );

        // The shown cancellation must still render with isCancelled=true.
        const stillShown = finalRows.find((row: any) => row.isCancelled === true);
        expect(stillShown).toBeDefined();

        // The hidden cancellation's original start time should no longer
        // appear in the listing at all.
        const hiddenStart = hiddenTargetRow.start;
        const hiddenStillPresent = finalRows.find((row: any) => row.start === hiddenStart);
        expect(hiddenStillPresent).toBeUndefined();
      }
    });
  });
});
