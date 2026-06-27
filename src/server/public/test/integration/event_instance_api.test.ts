import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { EventEmitter } from 'events';
import { DateTime } from 'luxon';

import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { EventInstanceEntity } from '@/server/calendar/entity/event_instance';

/**
 * Integration tests for GET /api/public/v1/events/:eventId/instances/:startTime
 *
 * Covers the timestamp-slug public instance route:
 *   - Happy path (one-shot event, cached row)
 *   - Miss-then-materialize for a recurring event (row created on first hit)
 *   - Concurrent-miss race (two parallel requests → exactly one DB row)
 *   - Rejection paths: invalid UUID, invalid slug, non-existent event id,
 *     non-matching slug
 *
 * The rate-limit enforcement test (429) is not included here because the
 * default test config disables rate limiting globally. Route-level wiring
 * is verified structurally in the unit tests; 429 behavior is covered by
 * the dedicated rate-limit test suite that enables the feature.
 */
describe('GET /api/public/v1/events/:eventId/instances/:startTime', () => {
  let env: TestEnvironment;
  let ownerToken: string;
  let calendarId: string;
  let locationId: string;
  let spaceId: string;

  /**
   * Create a one-shot (non-recurring) event. Its single materialized
   * EventInstance row is persisted at event-creation time.
   */
  async function createOneShotEvent(startIso: string, endIso: string, name: string, opts: { locationId?: string; spaceId?: string } = {}): Promise<string> {
    const response = await request(env.app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        calendarId,
        content: { en: { name, description: 'one-shot' } },
        schedules: [{
          start: startIso,
          end: startIso,
          eventEndTime: endIso,
        }],
        ...(opts.locationId ? { locationId: opts.locationId } : {}),
        ...(opts.spaceId ? { spaceId: opts.spaceId } : {}),
      });
    if (response.status !== 201) {
      throw new Error(`Failed to create event ${name}: ${response.status} ${JSON.stringify(response.body)}`);
    }
    return response.body.id;
  }

  /**
   * Create a weekly recurring event that spans far enough into the future
   * that not every occurrence is pre-materialized. Later occurrences need
   * lazy materialization on first public hit.
   */
  async function createRecurringEvent(firstStartIso: string, firstEndIso: string, seriesEndIso: string, name: string): Promise<string> {
    const response = await request(env.app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        calendarId,
        content: { en: { name, description: 'recurring' } },
        schedules: [{
          start: firstStartIso,
          end: seriesEndIso,
          eventEndTime: firstEndIso,
          frequency: 'weekly',
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
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    await accountService._setupAccount('owner-instance@pavillion.dev', 'testpassword');
    ownerToken = await env.login('owner-instance@pavillion.dev', 'testpassword');

    // Create a calendar owned by this account.
    const calResponse = await request(env.app)
      .post('/api/v1/calendars')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ urlName: 'instancecal', languages: 'en' });
    if (calResponse.status !== 201 && calResponse.status !== 200) {
      throw new Error(`Failed to create calendar: ${calResponse.status} ${JSON.stringify(calResponse.body)}`);
    }
    calendarId = calResponse.body.id;

    // Create a Place (Location) for space-scoped event tests.
    const locResponse = await request(env.app)
      .post(`/api/v1/calendars/${calendarId}/locations`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Test Venue', address: '1 Main St', city: 'Testville' });
    if (locResponse.status !== 201) {
      throw new Error(`Failed to create location: ${locResponse.status} ${JSON.stringify(locResponse.body)}`);
    }
    locationId = locResponse.body.id;

    // Add a Space under that Place via the nested-snapshot PUT endpoint.
    // Per-Space CRUD routes are not used; the Place's `spaces[]` is the
    // single write surface.
    const placeUpdate = await request(env.app)
      .put(`/api/v1/calendars/${calendarId}/locations/${locationId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Test Venue',
        address: '1 Main St',
        city: 'Testville',
        spaces: [
          { content: { en: { name: 'Main Hall', accessibilityInfo: 'Step-free entry; hearing loop installed.' } } },
        ],
      });
    if (placeUpdate.status !== 200) {
      throw new Error(`Failed to add space via Place PUT: ${placeUpdate.status} ${JSON.stringify(placeUpdate.body)}`);
    }
    if (!Array.isArray(placeUpdate.body.spaces) || placeUpdate.body.spaces.length === 0) {
      throw new Error(`Place PUT did not return spaces[]: ${JSON.stringify(placeUpdate.body)}`);
    }
    spaceId = placeUpdate.body.spaces[0].id;
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  it('returns 200 with allow-listed fields for a one-shot event (cache hit)', async () => {
    // One-shot event at 2030-06-15T18:00Z. A row is persisted when the
    // event is created, so the handler hits the cached path.
    const eventId = await createOneShotEvent(
      '2030-06-15T18:00:00Z',
      '2030-06-15T19:00:00Z',
      'One-Shot Cached',
    );

    const response = await request(env.app)
      .get(`/api/public/v1/events/${eventId}/instances/20300615-1800`);

    expect(response.status).toBe(200);
    // Allow-list invariant: top-level keys are a subset of the allow-list.
    const allowed = new Set(['id', 'start', 'end', 'isCancelled', 'event']);
    for (const key of Object.keys(response.body)) {
      expect(allowed.has(key)).toBe(true);
    }
    expect(response.body.isCancelled).toBe(false);
    expect(response.body.event.id).toBe(eventId);
    // Internal schedules[] must never leak.
    expect(response.body.event.schedules).toBeUndefined();
    // Start time must match the slug.
    expect(DateTime.fromISO(response.body.start).toUTC().toISO())
      .toBe('2030-06-15T18:00:00.000Z');
    // No space on this event — toPublicEventObject collapses absent space to null.
    expect(response.body.event.space).toBeNull();
  });

  it('materializes a row on first hit for an uncached occurrence', async () => {
    // Weekly event starting 2030-07-04 running for a year. The far-future
    // occurrences are not pre-materialized — the first public hit should
    // create the row via findOrMaterializeInstanceWithDetails.
    const eventId = await createRecurringEvent(
      '2030-07-04T18:00:00Z',
      '2030-07-04T19:00:00Z',
      '2031-07-04T18:00:00Z',
      'Weekly Far-Future',
    );

    // Pick an occurrence ~6 months in: 2030-10-31 is a Thursday... stride is
    // weekly from 2030-07-04 (a Thursday). 2030-10-31 is 17 weeks later.
    const slug = '20301031-1800';

    // Confirm no row exists yet for this specific start_time.
    const before = await EventInstanceEntity.findOne({
      where: {
        event_id: eventId,
        start_time: new Date('2030-10-31T18:00:00Z'),
      },
    });
    expect(before).toBeNull();

    const response = await request(env.app)
      .get(`/api/public/v1/events/${eventId}/instances/${slug}`);

    expect(response.status).toBe(200);
    expect(response.body.event.id).toBe(eventId);

    // Row must now exist.
    const after = await EventInstanceEntity.findOne({
      where: {
        event_id: eventId,
        start_time: new Date('2030-10-31T18:00:00Z'),
      },
    });
    expect(after).not.toBeNull();
  });

  it('concurrent misses for the same slug produce exactly one DB row', async () => {
    // Fresh recurring event so we can target an unmaterialized occurrence.
    const eventId = await createRecurringEvent(
      '2030-08-01T18:00:00Z',
      '2030-08-01T19:00:00Z',
      '2031-08-01T18:00:00Z',
      'Weekly Race',
    );

    // 2030-11-07 is 14 weeks after 2030-08-01 (Thursday → Thursday).
    const slug = '20301107-1800';
    const url = `/api/public/v1/events/${eventId}/instances/${slug}`;

    // Fire both requests in parallel. The unique-constraint catch in the
    // service must ensure exactly one row; both responses 200 with the
    // same instance id.
    const [resA, resB] = await Promise.all([
      request(env.app).get(url),
      request(env.app).get(url),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(resA.body.id).toBe(resB.body.id);

    const rows = await EventInstanceEntity.findAll({
      where: {
        event_id: eventId,
        start_time: new Date('2030-11-07T18:00:00Z'),
      },
    });
    expect(rows).toHaveLength(1);
  });

  it('returns 404 for a non-UUID eventId (path traversal attempt)', async () => {
    const response = await request(env.app)
      .get('/api/public/v1/events/not-a-uuid/instances/20300615-1800');

    expect(response.status).toBe(404);
    expect(response.body.errorName).toBe('NotFoundError');
  });

  it('returns 404 for an unparseable slug', async () => {
    const eventId = await createOneShotEvent(
      '2030-09-01T18:00:00Z',
      '2030-09-01T19:00:00Z',
      'Slug Shape Test',
    );

    const response = await request(env.app)
      .get(`/api/public/v1/events/${eventId}/instances/not-a-slug`);

    expect(response.status).toBe(404);
    expect(response.body.errorName).toBe('NotFoundError');
  });

  it('returns 404 for a legacy UUID-shaped slug (DEC-006 migration guard)', async () => {
    const eventId = await createOneShotEvent(
      '2030-09-15T18:00:00Z',
      '2030-09-15T19:00:00Z',
      'Legacy UUID Guard',
    );

    const response = await request(env.app)
      .get(`/api/public/v1/events/${eventId}/instances/00000000-0000-0000-0000-000000000000`);

    expect(response.status).toBe(404);
    expect(response.body.errorName).toBe('NotFoundError');
  });

  it('returns 404 when the slug is structurally valid but no such occurrence exists', async () => {
    const eventId = await createOneShotEvent(
      '2030-10-05T18:00:00Z',
      '2030-10-05T19:00:00Z',
      'No Such Occurrence',
    );

    // A one-shot event has exactly one occurrence. Probe a different day.
    const response = await request(env.app)
      .get(`/api/public/v1/events/${eventId}/instances/20301006-1800`);

    expect(response.status).toBe(404);
    expect(response.body.errorName).toBe('NotFoundError');
  });

  it('returns 404 for a valid-UUID eventId that does not exist', async () => {
    const response = await request(env.app)
      .get('/api/public/v1/events/00000000-0000-4000-8000-000000000000/instances/20300615-1800');

    expect(response.status).toBe(404);
    expect(response.body.errorName).toBe('NotFoundError');
  });

  it('returns space with content for a Space-scoped event (cache-hit path)', async () => {
    // One-shot event attached to a Place+Space. The instance row is
    // pre-materialized on creation, so the handler takes the cache-hit branch.
    const eventId = await createOneShotEvent(
      '2031-03-10T18:00:00Z',
      '2031-03-10T19:00:00Z',
      'Space Scoped Cache Hit',
      { locationId, spaceId },
    );

    const response = await request(env.app)
      .get(`/api/public/v1/events/${eventId}/instances/20310310-1800`);

    expect(response.status).toBe(200);
    expect(response.body.event.space).not.toBeNull();
    expect(response.body.event.space).not.toBeUndefined();
    expect(response.body.event.space.content.en.name).toBe('Main Hall');
    expect(response.body.event.space.content.en.accessibilityInfo).toBe('Step-free entry; hearing loop installed.');
    // Internal identifiers must not leak through toPublicEventObject projection.
    expect(response.body.event.space.id).toBeUndefined();
    expect(response.body.event.space.placeId).toBeUndefined();
    expect(response.body.event.space.originUri).toBeUndefined();
  });

  /**
   * Single-event cancellation (epic pv-ibke): cancelling a non-recurring
   * event's lone occurrence (show-as-cancelled, hideFromPublic=false) must
   * surface isCancelled:true on every public surface that carries instance
   * state. Cancellation is instance-scoped — markShownCancellations() flips
   * the materialized instance row; the event entity itself has no cancelled
   * state (epic decision: "do NOT add an event-level cancelled state").
   *
   * Uses the existing recurring-occurrence cancel path verbatim — a single
   * event already materializes exactly one rdate occurrence, so the path is
   * recurrence-agnostic and needs no code change.
   */
  describe('cancelled single event reports isCancelled across public surfaces', () => {
    /**
     * Cancel a single event's lone occurrence via the authenticated owner
     * endpoint with hideFromPublic=false (show-as-cancelled). Returns once the
     * exclusion schedule row is written (204).
     */
    async function cancelSingleOccurrence(eventId: string, startIso: string): Promise<void> {
      const res = await request(env.app)
        .post(`/api/v1/events/${eventId}/occurrences/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ start: startIso, hideFromPublic: false });
      if (res.status !== 204) {
        throw new Error(`Failed to cancel occurrence: ${res.status} ${JSON.stringify(res.body)}`);
      }
    }

    it('lists the cancelled single event with isCancelled:true', async () => {
      // Past-dated single event: its lone rdate is materialized 1:1 at creation
      // (generateInstances always persists past rdates, regardless of the
      // [now, now+horizon] window), so it appears in the calendar list without
      // a prior detail hit. Cancelling a past-dated single event is an
      // explicitly supported epic-pv-ibke scenario. A fixed past date keeps the
      // test independent of wall-clock drift.
      const startIso = '2020-03-15T18:00:00Z';
      const eventId = await createOneShotEvent(startIso, '2020-03-15T19:00:00Z', 'Cancelled Single (List)');
      await cancelSingleOccurrence(eventId, startIso);

      const response = await request(env.app)
        .get('/api/public/v1/calendar/instancecal/events');

      expect(response.status).toBe(200);
      // The list spans the whole calendar; find this event's lone instance and
      // assert it is flagged cancelled (shown, not hidden).
      const row = response.body.find((i: any) => i.event?.id === eventId);
      expect(row).toBeDefined();
      expect(row.isCancelled).toBe(true);
    });

    it('reports isCancelled:true on the instance detail endpoint', async () => {
      const startIso = '2032-06-20T18:00:00Z';
      const eventId = await createOneShotEvent(startIso, '2032-06-20T19:00:00Z', 'Cancelled Single (Instance)');
      await cancelSingleOccurrence(eventId, startIso);

      const response = await request(env.app)
        .get(`/api/public/v1/events/${eventId}/instances/20320620-1800`);

      expect(response.status).toBe(200);
      expect(response.body.isCancelled).toBe(true);
      expect(response.body.event.id).toBe(eventId);
    });

    it('does not surface an event-level isCancelled on the /events/:id detail endpoint', async () => {
      // Cancellation is instance-scoped: the badge on the public detail page is
      // driven by the instance endpoint above, not by /events/:id. The event
      // entity has no cancelled state (epic pv-ibke: "do NOT add an event-level
      // cancelled state"; serialization needs no change). This test pins that
      // contract so a future change can't silently start leaking a cancelled
      // flag onto the event projection.
      const startIso = '2032-07-20T18:00:00Z';
      const eventId = await createOneShotEvent(startIso, '2032-07-20T19:00:00Z', 'Cancelled Single (Event)');
      await cancelSingleOccurrence(eventId, startIso);

      const response = await request(env.app)
        .get(`/api/public/v1/events/${eventId}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(eventId);
      expect(response.body.isCancelled).toBeUndefined();
    });
  });

  it('returns space with content for a Space-scoped event (cache-miss / materialize path)', async () => {
    // Weekly recurring event; probe a far-future occurrence that has no
    // pre-materialized row — exercises the findByPk (cache-miss) branch.
    const response = await request(env.app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        calendarId,
        content: { en: { name: 'Space Scoped Cache Miss', description: 'recurring' } },
        schedules: [{
          start: '2031-04-04T18:00:00Z',
          end: '2032-04-04T18:00:00Z',
          eventEndTime: '2031-04-04T19:00:00Z',
          frequency: 'weekly',
          interval: 1,
        }],
        locationId,
        spaceId,
      });
    if (response.status !== 201) {
      throw new Error(`Failed to create recurring event: ${response.status} ${JSON.stringify(response.body)}`);
    }
    const eventId = response.body.id;

    // Probe an occurrence ~8 months out (33 weeks from 2031-04-04 Thursday →
    // 2031-11-28 Thursday). Should not be pre-materialized.
    const slug = '20311128-1800';

    const instanceResponse = await request(env.app)
      .get(`/api/public/v1/events/${eventId}/instances/${slug}`);

    expect(instanceResponse.status).toBe(200);
    expect(instanceResponse.body.event.space).not.toBeNull();
    expect(instanceResponse.body.event.space).not.toBeUndefined();
    expect(instanceResponse.body.event.space.content.en.name).toBe('Main Hall');
    expect(instanceResponse.body.event.space.content.en.accessibilityInfo).toBe('Step-free entry; hearing loop installed.');
    // Internal identifiers must not leak through toPublicEventObject projection.
    expect(instanceResponse.body.event.space.id).toBeUndefined();
    expect(instanceResponse.body.event.space.placeId).toBeUndefined();
    expect(instanceResponse.body.event.space.originUri).toBeUndefined();
  });
});
