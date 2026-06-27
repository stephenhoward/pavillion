/**
 * Integration tests for the listing-with-reposts union (pv-hr72.4).
 *
 * Regression lock for the single-producer model introduced by pv-hr72.3:
 * under Option A only the originating calendar materializes an
 * `event_instance` row per (event_id, start_time). Listing for a different
 * calendar that has reposted (or been federated a share of) the event must
 * return that single canonical instance — without materializing duplicates,
 * and with the resolved repost metadata reflecting the listing-context
 * calendar (B) as the display calendar so the originating calendar (A) is
 * surfaced as the sourceCalendar.
 *
 * Scenarios covered:
 *   1. event_repost (local repost link): event on Calendar A, EventRepostEntity
 *      pointing at Calendar B. Listing B returns the event with isRepost=true
 *      and sourceCalendar pointing at A's url_name.
 *   2. ap_shared_event (federated share link): event on Calendar A,
 *      SharedEventEntity for Calendar B. Listing B returns the event with
 *      isRepost=true and sourceCalendar pointing at A's url_name.
 *   3. Both link types pointing at the same event still yield exactly one
 *      listing row, proving the visible-id union dedupes ids before fetch.
 *   4. Listing the originating calendar (A) shows the event with
 *      isRepost=false — the displayCalendarId tag is correctly derived from
 *      the listing call in every direction.
 *
 * Each scenario asserts that exactly one `event_instance` row exists
 * globally for (event_id, start_time) — proving the row was not duplicated
 * per display calendar and no SequelizeUniqueConstraintError occurred.
 *
 * Pattern reference: src/server/calendar/test/integration/feed_repost.test.ts
 * for fixture conventions; src/server/calendar/test/integration/event_deletion.test.ts
 * for direct EventInstanceEntity row construction (the locally-constructed
 * CalendarInterface in these integration tests does not register the
 * eventCreated handler that runs buildEventInstances under the live server).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { EventInstanceEntity } from '@/server/calendar/entity/event_instance';
import { EventRepostEntity } from '@/server/calendar/entity/event_repost';
import { SharedEventEntity } from '@/server/activitypub/entity/activitypub';

describe('Listing union for reposted events (pv-hr72.4)', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let eventBus: EventEmitter;

  let accountA: Account;
  let accountB: Account;
  let calendarA: Calendar;
  let calendarB: Calendar;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);

    // Minimal AP interface stub. listEventInstancesForCalendar fans into:
    //   - EventService.listEventIdsForCalendar -> getSharedEventStatusMap
    //   - EventInstanceService.fetchRemoteActorUriMap -> getEventSourceActorUris
    // The first must return the live SharedEventEntity rows so the federated
    // share scenario actually exercises the AP-shared link path; the second
    // can return an empty map because all events here have a non-null
    // calendar_id (no remote-origin events under test).
    calendarInterface.setActivityPubInterface({
      getSharedEventStatusMap: async (calendarId: string) => {
        const rows = await SharedEventEntity.findAll({
          where: { calendar_id: calendarId },
          attributes: ['event_id', 'auto_posted'],
        });
        const map = new Map<string, 'auto' | 'manual'>();
        for (const r of rows) {
          map.set(r.event_id, r.auto_posted ? 'auto' : 'manual');
        }
        return map;
      },
      getEventSourceActorUris: async () => new Map<string, string>(),
      findCalendarActorByCalendarId: async () => null,
    } as never);

    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    const infoA = await accountService._setupAccount('listing-repost-a@pavillion.dev', 'testpassword');
    accountA = infoA.account;
    calendarA = await calendarInterface.createCalendar(accountA, 'listingreposta');

    const infoB = await accountService._setupAccount('listing-repost-b@pavillion.dev', 'testpassword');
    accountB = infoB.account;
    calendarB = await calendarInterface.createCalendar(accountB, 'listingrepostb');
  });

  afterAll(async () => {
    await env.cleanup();
  });

  /**
   * Helper: create an event on Calendar A and manually materialize a single
   * canonical event_instance row owned by A. This mirrors what the live
   * server's eventCreated -> buildEventInstances pipeline would produce, but
   * the locally-constructed CalendarInterface in this file does not register
   * those handlers (matching event_deletion.test.ts's pattern).
   */
  async function createEventOnAWithInstance(name: string, startIso: string): Promise<{ eventId: string; startTime: Date }> {
    const event = await calendarInterface.createEvent(accountA, {
      calendarId: calendarA.id,
      content: { en: { name, description: name } },
      start_date: startIso.slice(0, 10),
      start_time: startIso.slice(11, 16),
      end_date: startIso.slice(0, 10),
      end_time: '23:00',
    });
    const startTime = new Date(startIso);
    await EventInstanceEntity.create({
      id: uuidv4(),
      event_id: event.id,
      calendar_id: calendarA.id, // single-producer: row owned by originator
      start_time: startTime,
      end_time: null,
    });
    return { eventId: event.id, startTime };
  }

  it('returns the canonical instance for an event_repost link with isRepost=true and source=A', async () => {
    const { eventId, startTime } = await createEventOnAWithInstance(
      'Repost Listing Event',
      '2026-10-01T10:00:00Z',
    );

    // Calendar B reposts the event via an EventRepostEntity row.
    await EventRepostEntity.create({
      id: uuidv4(),
      event_id: eventId,
      calendar_id: calendarB.id,
    });

    // List instances for Calendar B — under Option A this returns the single
    // canonical instance row (whose entity.calendar_id is A) but the
    // resolveSourceCalendars step uses B as displayCalendarId so the repost
    // metadata reflects A as the source.
    const instances = await calendarInterface.listEventInstancesForCalendar(calendarB);

    const matching = instances.filter(i => i.event.id === eventId);
    expect(matching).toHaveLength(1);

    const listed = matching[0];
    expect(listed.event.isRepost).toBe(true);
    expect(listed.event.sourceCalendar).not.toBeNull();
    expect(listed.event.sourceCalendar!.urlName).toBe(calendarA.urlName);

    // Exactly one event_instance row exists globally for (event_id,
    // start_time) — proves the single-producer invariant: no per-calendar
    // duplicate row was materialized for the reposting calendar.
    const globalCount = await EventInstanceEntity.count({
      where: { event_id: eventId, start_time: startTime },
    });
    expect(globalCount).toBe(1);

    // The lone canonical row's calendar_id is the originating calendar (A),
    // not the listing-context calendar (B). displayCalendarId is derived
    // from the listing call, not from the row.
    const canonicalRow = await EventInstanceEntity.findOne({
      where: { event_id: eventId },
    });
    expect(canonicalRow).not.toBeNull();
    expect(canonicalRow!.calendar_id).toBe(calendarA.id);
  });

  it('returns the canonical instance for an ap_shared_event link with isRepost=true and source=A', async () => {
    const { eventId, startTime } = await createEventOnAWithInstance(
      'Federated Share Listing Event',
      '2026-11-01T14:00:00Z',
    );

    // Calendar B is recorded as having received a federated share of the
    // event (auto-repost path). We insert the ap_shared_event row directly
    // rather than driving the federation pipeline — this matches
    // feed_repost.test.ts and keeps the test focused on the listing union.
    await SharedEventEntity.create({
      id: uuidv4(),
      event_id: eventId,
      calendar_id: calendarB.id,
      auto_posted: true,
    });

    const instances = await calendarInterface.listEventInstancesForCalendar(calendarB);

    const matching = instances.filter(i => i.event.id === eventId);
    expect(matching).toHaveLength(1);

    const listed = matching[0];
    expect(listed.event.isRepost).toBe(true);
    expect(listed.event.sourceCalendar).not.toBeNull();
    expect(listed.event.sourceCalendar!.urlName).toBe(calendarA.urlName);

    // Exactly one event_instance row exists globally for this event — proves
    // no SequelizeUniqueConstraintError occurred and no per-calendar
    // duplicate row was materialized for the share-receiving calendar.
    const globalCount = await EventInstanceEntity.count({
      where: { event_id: eventId, start_time: startTime },
    });
    expect(globalCount).toBe(1);

    const canonicalRow = await EventInstanceEntity.findOne({
      where: { event_id: eventId },
    });
    expect(canonicalRow).not.toBeNull();
    expect(canonicalRow!.calendar_id).toBe(calendarA.id);
  });

  it('keeps a single canonical row even when both link types point at the same event', async () => {
    // Calendar B's perspective on a single event from A that B has BOTH
    // reposted (event_repost row) and received as a federated share
    // (ap_shared_event row). The visible-id union dedupes ids before the
    // instance fetch, so listing must still return exactly one instance row.
    const { eventId, startTime } = await createEventOnAWithInstance(
      'Dual-link Event',
      '2026-12-01T09:00:00Z',
    );

    await EventRepostEntity.create({
      id: uuidv4(),
      event_id: eventId,
      calendar_id: calendarB.id,
    });
    await SharedEventEntity.create({
      id: uuidv4(),
      event_id: eventId,
      calendar_id: calendarB.id,
      auto_posted: false,
    });

    const instances = await calendarInterface.listEventInstancesForCalendar(calendarB);
    const matching = instances.filter(i => i.event.id === eventId);
    expect(matching).toHaveLength(1);

    const globalCount = await EventInstanceEntity.count({
      where: { event_id: eventId, start_time: startTime },
    });
    expect(globalCount).toBe(1);
  });

  it('lists the event on the originating calendar (A) with isRepost=false', async () => {
    // Sanity check that the listing for A (the originating calendar) sees
    // each event without the repost flag inflated by B's link rows. Proves
    // that displayCalendarId is correctly derived from the LISTING call —
    // when listing for A, eventCalendarId == displayCalendarId so the event
    // is not flagged as a repost; when listing for B, the same row IS
    // flagged as a repost (covered by the earlier scenarios). One row,
    // two distinct display surfaces.
    const { eventId } = await createEventOnAWithInstance(
      'Originator Listing Sanity',
      '2027-01-15T13:00:00Z',
    );
    await EventRepostEntity.create({
      id: uuidv4(),
      event_id: eventId,
      calendar_id: calendarB.id,
    });

    const instancesOnA = await calendarInterface.listEventInstancesForCalendar(calendarA);
    const matchingOnA = instancesOnA.filter(i => i.event.id === eventId);
    expect(matchingOnA).toHaveLength(1);
    expect(matchingOnA[0].event.isRepost).toBe(false);
    expect(matchingOnA[0].event.sourceCalendar).toBeNull();

    // And the same row, listed on B, IS flagged as a repost.
    const instancesOnB = await calendarInterface.listEventInstancesForCalendar(calendarB);
    const matchingOnB = instancesOnB.filter(i => i.event.id === eventId);
    expect(matchingOnB).toHaveLength(1);
    expect(matchingOnB[0].event.isRepost).toBe(true);
    expect(matchingOnB[0].event.sourceCalendar!.urlName).toBe(calendarA.urlName);
  });

  /**
   * Regression lock for pv-13xg: a remote-origin event received via
   * EventService.addRemoteEvent must materialize its canonical event_instance
   * row at receive time, so list views on follower calendars surface the
   * event without waiting for an inbound Update or a per-occurrence detail
   * URL hit to lazily materialize.
   *
   * Under the single-producer model (pv-hr72), only the originating calendar
   * materializes a row per (event_id, start_time). For remote-origin events,
   * the originating calendar lives on another server, so the local server is
   * the de-facto producer of the canonical row from the AP payload — driven
   * by addRemoteEvent emitting `eventCreated` with calendar:null, which the
   * existing CalendarEventHandlers eventCreated handler routes through
   * buildEventInstances.
   */
  it('materializes event_instance rows for inbound federated events without manual fixture writes', async () => {
    // Deterministic wait: install a one-shot eventCreated listener that
    // performs the same buildEventInstances call the production handler does
    // and resolves a sentinel Promise on completion. Awaiting the sentinel
    // (instead of polling EventInstanceEntity.findOne) eliminates the
    // flakiness vector pv-hr72.5 removed from the race test elsewhere.
    //
    // We do NOT install the production CalendarEventHandlers here: doing
    // both would race two concurrent buildEventInstances calls against the
    // unique (event_id, start_time) index. The production wire-up
    // (eventCreated -> buildEventInstances) is already exercised by the
    // unit tests for that file; this integration test focuses on the
    // emit-from-addRemoteEvent contract, which is what the once-listener
    // simulates exactly.
    const materialized = new Promise<void>((resolve, reject) => {
      eventBus.once('eventCreated', async (e: { calendar: Calendar | null; event: any }) => {
        try {
          await calendarInterface.buildEventInstances(e.event);
          resolve();
        }
        catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });

    const remoteEventId = uuidv4();
    // Schedule must fall within the rolling GENERATION_HORIZON_MONTHS (6 months)
    // window from "now" so generateInstances includes it. Use a near-future date
    // anchored from the current wall clock; building from now keeps the test
    // stable as the fixed test date drifts forward over time.
    const startDateTime = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // ~30 days out
    const endDateTime = new Date(startDateTime.getTime() + 2 * 60 * 60 * 1000); // +2h
    const startIso = startDateTime.toISOString();
    const endIso = endDateTime.toISOString();

    // Drive addRemoteEvent directly with a parsed-AP-like payload. This
    // mirrors what ProcessInboxService does when handling a Create(Event)
    // from a federated source. The empty calendarId field causes
    // addRemoteEvent to set calendar_id = null on the EventEntity (single-
    // producer canonical row for a remote-origin event).
    await calendarInterface.addRemoteEvent(calendarA, {
      id: remoteEventId,
      content: { en: { name: 'Remote Federated Event', description: 'from remote A' } },
      schedules: [
        {
          start: startIso,
          end: endIso,
        },
      ],
    });

    // Calendar B receives a federated share of this remote event (auto-repost
    // path). We insert the ap_shared_event row directly to keep the test
    // focused on the materialization trigger; the listing union path is
    // already exercised by the earlier scenarios.
    await SharedEventEntity.create({
      id: uuidv4(),
      event_id: remoteEventId,
      calendar_id: calendarB.id,
      auto_posted: true,
    });

    // Await the sentinel — guarantees buildEventInstances has finished
    // before assertions run. No polling, no timeout race.
    await materialized;

    try {
      // Critical assertion: a canonical event_instance row exists for this
      // remote event WITHOUT any test-fixture EventInstanceEntity.create()
      // call. Under the bug being fixed (pv-13xg), no row would exist until
      // an inbound Update arrived.
      const canonicalRow = await EventInstanceEntity.findOne({
        where: { event_id: remoteEventId },
      });
      expect(canonicalRow, 'addRemoteEvent must materialize the canonical event_instance row').not.toBeNull();
      expect(canonicalRow!.calendar_id).toBeNull();

      // Listing for the share-receiving calendar (B) surfaces the event via
      // the ap_shared_event link. This proves the end-to-end happy path:
      // remote Create -> addRemoteEvent -> eventCreated emit ->
      // buildEventInstances -> canonical row -> listing union picks it up.
      const instances = await calendarInterface.listEventInstancesForCalendar(calendarB);
      const matching = instances.filter(i => i.event.id === remoteEventId);
      expect(matching).toHaveLength(1);
      expect(matching[0].event.isRepost).toBe(true);
    }
    finally {
      // Tear down any residual eventCreated listeners so they don't leak
      // into tests that may be added below this scenario.
      eventBus.removeAllListeners('eventCreated');
    }
  });
});
