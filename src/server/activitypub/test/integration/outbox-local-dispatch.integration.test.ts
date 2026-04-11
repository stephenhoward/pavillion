/**
 * Regression gate: unified outbox dispatch for local cascades with remote followers.
 *
 * Scenario (A → B → D):
 *   - A is a local calendar
 *   - B is a local calendar that auto-reposts A's events (auto_repost_originals=true)
 *   - D is a REMOTE calendar actor that follows B
 *
 * When A creates an event, the original BFS cascade in performLocalAutoReposts
 * created a SharedEventEntity for B but never queued an Announce in B's outbox.
 * As a result, D (a remote follower of B) never received the event, even though
 * federation was otherwise working correctly.
 *
 * The fix (pv-6evr Phase 3/4) routes local dispatch through the unified outbox
 * pipeline: A's outbox Announce is processed, its recipient list (from
 * FollowerCalendarEntity) is walked, and each local recipient is handed to
 * ProcessInboxService.handleLocalAnnounceDispatch which runs the same
 * checkAndPerformAutoRepost path used for remote-originated shares. That path
 * both creates the SharedEventEntity AND queues an Announce in B's outbox,
 * which in turn cascades to D via HTTP delivery.
 *
 * This test is the regression gate for that fix. The legacy BFS path
 * (performLocalAutoReposts) has been removed from handleEventCreated, so the
 * unified dispatcher is now the sole producer of B's SharedEventEntity and
 * outbox Announce when A creates an event.
 *
 * Additional coverage (pv-6evr.6.1):
 *   - Single-hop: B auto-reposts A's event with auto_posted=true
 *   - Multi-hop A → B → C: C auto-reposts B's repost (auto_repost_reposts=true)
 *   - Policy-disabled: B does not auto-repost when auto_repost_originals=false
 *
 * Cycle-termination coverage (pv-6evr.6.2):
 *   - 2-node cycle A ↔ B: mutual follow does not loop via the attribution loop guard
 *   - 3-node cycle X → Y → Z → X: longer cycles terminate with exactly 2 shares
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import axios from 'axios';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import EmailInterface from '@/server/email/interface';
import ActivityPubInterface from '@/server/activitypub/interface';
import ActivityPubEventHandlers from '@/server/activitypub/events';
import { TestEnvironment } from '@/server/test/lib/test_environment';
import { CalendarActorEntity } from '@/server/activitypub/entity/calendar_actor';
import { ActivityPubActor } from '@/server/activitypub/model/base';
import {
  FollowingCalendarEntity,
  FollowerCalendarEntity,
  SharedEventEntity,
  ActivityPubOutboxMessageEntity,
} from '@/server/activitypub/entity/activitypub';
import { waitFor, waitForStableCount } from '@/server/test/lib/drain-event-bus';

describe('Outbox Local Dispatch (cross-hop remote follower regression)', () => {
  let env: TestEnvironment;
  let accountsInterface: AccountsInterface;
  let calendarInterface: CalendarInterface;
  let apInterface: ActivityPubInterface;
  let eventBus: EventEmitter;
  let sandbox: sinon.SinonSandbox;

  let accountA: Account;
  let calendarA: Calendar;
  let calendarB: Calendar;
  let calendarC: Calendar;
  let actorA: CalendarActorEntity;
  let actorB: CalendarActorEntity;
  let actorC: CalendarActorEntity;
  let actorD_remote: CalendarActorEntity;
  let axiosPostStub: sinon.SinonStub;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const emailInterface = new EmailInterface();

    await configurationInterface.setSetting('registrationMode', 'open');

    accountsInterface = new AccountsInterface(
      eventBus, configurationInterface, setupInterface, emailInterface,
    );
    calendarInterface = new CalendarInterface(eventBus, accountsInterface, configurationInterface);
    apInterface = new ActivityPubInterface(eventBus, calendarInterface, accountsInterface);

    // Create accounts and calendars BEFORE installing the event handler so the
    // auto-created CalendarActorEntity rows are not duplicated. We manually
    // create the local actor rows below to match the local-auto-repost test
    // pattern — this keeps the test self-contained and predictable.
    accountA = await accountsInterface.registerNewAccount('outbox-dispatch-a@pavillion.dev') as Account;
    await accountsInterface.setPassword(accountA, 'testpassword');
    calendarA = await calendarInterface.createCalendar(accountA, 'outboxdispatcha');

    const accountB = await accountsInterface.registerNewAccount('outbox-dispatch-b@pavillion.dev') as Account;
    await accountsInterface.setPassword(accountB, 'testpassword');
    calendarB = await calendarInterface.createCalendar(accountB, 'outboxdispatchb');

    const accountC = await accountsInterface.registerNewAccount('outbox-dispatch-c@pavillion.dev') as Account;
    await accountsInterface.setPassword(accountC, 'testpassword');
    calendarC = await calendarInterface.createCalendar(accountC, 'outboxdispatchc');

    // Local CalendarActorEntity rows for A, B, and C. IMPORTANT: the actor_uri
    // must match whatever ActivityPubActor.actorUrl(calendar) generates at
    // runtime (driven by the config `domain` setting). checkAndPerformAutoRepost
    // looks up the source actor by URI and the FollowingCalendarEntity join
    // key is that CalendarActorEntity's id — if these URIs don't match the
    // runtime-generated ones, findOrCreateByActorUri creates a new "remote"
    // row and the follow lookup fails silently.
    const actorAUri = ActivityPubActor.actorUrl(calendarA);
    const actorBUri = ActivityPubActor.actorUrl(calendarB);
    const actorCUri = ActivityPubActor.actorUrl(calendarC);

    actorA = await CalendarActorEntity.create({
      id: uuidv4(),
      actor_type: 'local',
      calendar_id: calendarA.id,
      actor_uri: actorAUri,
    });

    actorB = await CalendarActorEntity.create({
      id: uuidv4(),
      actor_type: 'local',
      calendar_id: calendarB.id,
      actor_uri: actorBUri,
    });

    actorC = await CalendarActorEntity.create({
      id: uuidv4(),
      actor_type: 'local',
      calendar_id: calendarC.id,
      actor_uri: actorCUri,
    });

    // Remote actor D — has no local calendar. Just a CalendarActorEntity row
    // pointing at a remote inbox URL.
    actorD_remote = await CalendarActorEntity.create({
      id: uuidv4(),
      actor_type: 'remote',
      calendar_id: null,
      actor_uri: 'https://remote.example/calendars/d',
      inbox_url: 'https://remote.example/calendars/d/inbox',
      remote_domain: 'remote.example',
    });

    // B follows A locally with auto_repost_originals=true.
    // This is the authorization side that checkAndPerformAutoRepost consults
    // when B receives A's Announce via local dispatch.
    await FollowingCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: actorA.id,
      calendar_id: calendarB.id,
      auto_repost_originals: true,
      auto_repost_reposts: false,
    });

    // C follows B locally with auto_repost_reposts=true. When B auto-reposts
    // A's event, the unified dispatcher walks B's followers (FollowerCalendarEntity
    // rows pointing at B) and hands the Announce to C. Because C's following
    // record on B has auto_repost_reposts=true, checkAndPerformAutoRepost will
    // create a SharedEventEntity for C and queue an Announce in C's outbox.
    await FollowingCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: actorB.id,
      calendar_id: calendarC.id,
      auto_repost_originals: false,
      auto_repost_reposts: true,
    });

    // A's follower side: B follows A, so from A's perspective B is a follower.
    // ProcessOutboxService.getRecipients() reads FollowerCalendarEntity with
    // calendar_id: A.id to decide who should receive A's Announce. Without
    // this row, A's outbox dispatch walks an empty recipient list and the
    // cascade never reaches B.
    await FollowerCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: actorB.id,
      calendar_id: calendarA.id,
    });

    // B's follower side: C follows B, so from B's perspective C is a follower.
    // When B dispatches its outbox Announce, getRecipients(B) must find C via
    // this row so the cascade reaches the third hop.
    await FollowerCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: actorC.id,
      calendar_id: calendarB.id,
    });

    // D (remote) follows B locally — FollowerCalendarEntity row pointing at D's
    // CalendarActorEntity, from the perspective of calendar B. This is how
    // ProcessOutboxService.getRecipients(B, ...) finds D when B's Announce
    // is dispatched downstream.
    await FollowerCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: actorD_remote.id,
      calendar_id: calendarB.id,
    });

    // Now install the ActivityPub event handlers so that a subsequent
    // calendarInterface.createEvent triggers handleEventCreated, which in turn
    // runs the unified outbox dispatch path against the fixtures we just built.
    new ActivityPubEventHandlers(apInterface, calendarInterface).install(eventBus);
  });

  afterAll(async () => {
    await env.cleanup();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Prevent real HTTP delivery to remote.example. Both axios.post (inbox
    // delivery) and axios.get (actor profile fetch inside resolveInboxUrl)
    // would otherwise attempt real network I/O and slow the test down or
    // fail unpredictably. We capture the post stub so the regression test
    // can assert that delivery was actually dispatched to D's inbox URL.
    axiosPostStub = sandbox.stub(axios, 'post').resolves({ status: 202, data: {} } as any);

    // resolveInboxUrl() in outbox.ts calls axios.get on the actor profile URL
    // to discover its inbox endpoint. For the remote actor D we return a
    // minimal actor document pointing at D's inbox_url so that delivery
    // actually reaches the axios.post branch. Unknown URLs reject, matching
    // the previous "no network in test" safety net.
    sandbox.stub(axios, 'get').callsFake(async (url: string) => {
      if (url === actorD_remote.actor_uri) {
        return { status: 200, data: { inbox: actorD_remote.inbox_url } } as any;
      }
      throw new Error(`Stubbed: no network in test (unexpected GET: ${url})`);
    });
  });

  afterEach(async () => {
    // Drain pending cascades BEFORE restoring sinon. Earlier tests in this
    // file often return as soon as their specific assertion is satisfied
    // (e.g. waitFor B's share) while the A→B→C→D cascade is still processing
    // in the background via the event bus. If we restore sinon immediately,
    // those background cascades hit unstubbed axios and raise errors, and
    // their still-in-flight SQLite transactions race the next test's
    // transactions — on slower CI runners this backs up far enough that the
    // multi-hop test's 3s wait for C's share expires before the cascade has
    // finished processing. Waiting for the outbox queue to fully drain
    // before tearing down sinon keeps each test isolated.
    await waitForStableCount(
      async () => ActivityPubOutboxMessageEntity.count({
        where: { processed_time: null },
      }),
      { maxWaitMs: 5000, stableForMs: 150, label: 'afterEach outbox drain' },
    ).catch(() => {
      // Swallow drain timeouts — we still want sandbox.restore to run so
      // subsequent tests get a clean stub set. A lingering cascade will
      // surface as a later test failure, which is more informative than
      // failing the drain itself.
    });
    sandbox.restore();
  });

  it('REGRESSION: B announces to its remote follower D when A creates an event', async () => {
    const event = await calendarInterface.createEvent(accountA, {
      calendarId: calendarA.id,
      content: { en: { name: 'Unified dispatch test', description: 'Cross-hop remote follower regression' } },
      start_date: '2026-05-01',
      start_time: '18:00',
      end_date: '2026-05-01',
      end_time: '20:00',
    });

    // Deterministic wait for the eventCreated → outbox dispatch cascade
    // to settle. The unified dispatcher writes B's SharedEventEntity inside
    // checkAndPerformAutoRepost immediately before queuing B's outbox
    // Announce, so polling for the share row is a sufficient lower bound.
    await waitFor(
      async () => SharedEventEntity.findOne({
        where: { event_id: event.id, calendar_id: calendarB.id },
      }),
      { maxWaitMs: 2000, label: 'SharedEventEntity for B' },
    );

    // Assertion 1: B has a SharedEventEntity for the event.
    // With the legacy BFS path removed, this row can only come from the
    // unified dispatcher path (checkAndPerformAutoRepost during local
    // dispatch of A's outbox Announce).
    const share = await SharedEventEntity.findOne({
      where: { event_id: event.id, calendar_id: calendarB.id },
    });
    expect(share, 'B should have auto-reposted the event via unified dispatch').not.toBeNull();

    // The outbox Announce row is written immediately after SharedEvent in
    // checkAndPerformAutoRepost but through a separate await chain; poll
    // for it to ensure the addToOutbox call has resolved before we assert.
    await waitFor(
      async () => {
        const messages = await ActivityPubOutboxMessageEntity.findAll({
          where: { calendar_id: calendarB.id, type: 'Announce' },
        });
        return messages.length > 0 ? messages : null;
      },
      { maxWaitMs: 2000, label: 'ActivityPubOutboxMessageEntity Announce for B' },
    );

    // Assertion 2: B has a queued outbox Announce — this is the regression gate.
    // Before the refactor, the BFS cascade created SharedEventEntity rows for
    // intermediate local calendars but never queued Announce activities in
    // their outboxes, so remote followers of those intermediate calendars
    // silently missed the event. The unified dispatcher fixes this.
    const bOutboxMessages = await ActivityPubOutboxMessageEntity.findAll({
      where: { calendar_id: calendarB.id, type: 'Announce' },
    });
    expect(
      bOutboxMessages.length,
      'B must queue an Announce in its outbox so D (remote) receives it',
    ).toBeGreaterThan(0);

    // Assertion 3: the queued Announce's recipient list must include D's actor URI.
    const outboxService = (apInterface as any).outboxService;
    const { default: AnnounceActivity } = await import('@/server/activitypub/model/action/announce');
    const parsedActivity = AnnounceActivity.fromObject(bOutboxMessages[0].message);
    expect(parsedActivity, 'outbox Announce must parse cleanly').not.toBeNull();
    const recipients = await outboxService.getRecipients(calendarB, parsedActivity!.object);
    expect(
      recipients,
      'Recipient list for B Announce must include D actor URI',
    ).toContain(actorD_remote.actor_uri);

    // Assertion 4: HTTP delivery is the actual regression signal. The
    // entire point of the refactor is that D (a remote follower of the
    // intermediate calendar B) receives the event. Prior assertions prove
    // that B queues an Announce and that D is in the recipient list, but
    // the observable contract is that axios.post must be called with D's
    // inbox URL as the first argument. We poll because delivery happens
    // asynchronously after B queues the outbox Announce.
    await waitFor(
      async () => axiosPostStub.getCalls().some(
        (call) => call.args[0] === actorD_remote.inbox_url,
      ) || null,
      { maxWaitMs: 3000, label: 'HTTP delivery to D inbox_url' },
    );
    const deliveredToD = axiosPostStub.getCalls().some(
      (call) => call.args[0] === actorD_remote.inbox_url,
    );
    expect(
      deliveredToD,
      'axios.post must be called with D inbox_url so the event actually reaches D',
    ).toBe(true);
  });

  it('single-hop: B auto-reposts A event when B follows A with originals enabled', async () => {
    const event = await calendarInterface.createEvent(accountA, {
      calendarId: calendarA.id,
      content: { en: { name: 'single hop', description: 'single-hop cascade' } },
      start_date: '2026-05-02',
      start_time: '18:00',
      end_date: '2026-05-02',
      end_time: '20:00',
    });

    const share = await waitFor(
      async () => SharedEventEntity.findOne({
        where: { event_id: event.id, calendar_id: calendarB.id },
      }),
      { maxWaitMs: 2000, label: 'single-hop share' },
    );
    expect(share).not.toBeNull();
    expect(share!.auto_posted).toBe(true);
  });

  it('multi-hop: A → B → C cascade propagates via sequential outbox dispatches', async () => {
    const event = await calendarInterface.createEvent(accountA, {
      calendarId: calendarA.id,
      content: { en: { name: 'multi hop', description: 'multi-hop cascade' } },
      start_date: '2026-05-03',
      start_time: '18:00',
      end_date: '2026-05-03',
      end_time: '20:00',
    });

    const shareC = await waitFor(
      async () => SharedEventEntity.findOne({
        where: { event_id: event.id, calendar_id: calendarC.id },
      }),
      { maxWaitMs: 3000, label: 'multi-hop share at C' },
    );

    const shareB = await SharedEventEntity.findOne({
      where: { event_id: event.id, calendar_id: calendarB.id },
    });
    expect(shareB, 'B must auto-repost (originals policy)').not.toBeNull();
    expect(shareB!.auto_posted).toBe(true);
    expect(shareC, 'C must auto-repost B repost (reposts policy)').not.toBeNull();
    expect(shareC!.auto_posted).toBe(true);
  });

  it('no repost when auto_repost_originals is false', async () => {
    // Flip B's follow of A to policy-off. Restore at the end so later tests
    // (and re-runs of this file) aren't affected by leftover state.
    await FollowingCalendarEntity.update(
      { auto_repost_originals: false },
      { where: { calendar_id: calendarB.id, calendar_actor_id: actorA.id } },
    );

    try {
      const event = await calendarInterface.createEvent(accountA, {
        calendarId: calendarA.id,
        content: { en: { name: 'policy off', description: 'policy-disabled cascade' } },
        start_date: '2026-05-05',
        start_time: '18:00',
        end_date: '2026-05-05',
        end_time: '20:00',
      });

      // Let the cascade settle. With the policy off, B should never create a
      // share; we use waitForStableCount to avoid a brittle fixed wait.
      await waitForStableCount(
        async () => SharedEventEntity.count({ where: { event_id: event.id } }),
        { maxWaitMs: 1500, stableForMs: 200, label: 'policy-off cascade settlement' },
      );

      const share = await SharedEventEntity.findOne({
        where: { event_id: event.id, calendar_id: calendarB.id },
      });
      expect(share, 'B must not repost when policy is disabled').toBeNull();
    }
    finally {
      await FollowingCalendarEntity.update(
        { auto_repost_originals: true },
        { where: { calendar_id: calendarB.id, calendar_actor_id: actorA.id } },
      );
    }
  });

  it('2-node cycle: A ↔ B mutual follow terminates via attribution loop guard', async () => {
    // Extend the A/B fixture with the reciprocal edge A → B so the cycle
    // is closed. A follows B with auto_repost_reposts=true, meaning that
    // when B's outbox dispatches the repost of A's event, A is a follower
    // and is authorized to repost reposts. The attribution loop guard must
    // prevent A from reposting an event it originally authored.
    //
    // We create these rows inside the test body (not beforeAll) so that
    // earlier tests run against the plain A→B→C fixture, and we clean them
    // up in a finally block to avoid interfering with any later tests.
    const followingAtoB = await FollowingCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: actorB.id,
      calendar_id: calendarA.id,
      auto_repost_originals: false,
      auto_repost_reposts: true,
    });
    const followerAonB = await FollowerCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: actorA.id,
      calendar_id: calendarB.id,
    });

    try {
      const event = await calendarInterface.createEvent(accountA, {
        calendarId: calendarA.id,
        content: { en: { name: 'cycle test', description: '2-node cycle termination' } },
        start_date: '2026-05-04',
        start_time: '18:00',
        end_date: '2026-05-04',
        end_time: '20:00',
      });

      // Wait for B to get its share (proves cascade ran) then wait for the
      // total share count to stabilize (proves any reposting of reposts
      // has finished propagating and the cascade has truly terminated).
      await waitFor(
        async () => SharedEventEntity.findOne({
          where: { event_id: event.id, calendar_id: calendarB.id },
        }),
        { maxWaitMs: 2000, label: '2-cycle B share' },
      );
      await waitForStableCount(
        async () => SharedEventEntity.count({ where: { event_id: event.id } }),
        { maxWaitMs: 2000, stableForMs: 200, label: '2-cycle total share count' },
      );

      // The loop guard assertion: A must NOT have a share for its own event,
      // even though the Z→A (here B→A) edge authorizes reposting reposts.
      const shareA = await SharedEventEntity.findOne({
        where: { event_id: event.id, calendar_id: calendarA.id },
      });
      expect(shareA, 'loop guard must prevent A from reposting its own event').toBeNull();
    }
    finally {
      await followingAtoB.destroy();
      await followerAonB.destroy();
    }
  });

  it('3-node cycle: X → Y → Z → X terminates via attribution loop guard', async () => {
    // Fresh accounts, calendars, and actors for a clean triangle. We do NOT
    // reuse A/B/C because those have accumulated follow relationships from
    // earlier tests that would muddy the assertion on total share count.
    const accountX = await accountsInterface.registerNewAccount('outbox-dispatch-x@pavillion.dev') as Account;
    await accountsInterface.setPassword(accountX, 'testpassword');
    const calendarX = await calendarInterface.createCalendar(accountX, 'outboxdispatchx');

    const accountY = await accountsInterface.registerNewAccount('outbox-dispatch-y@pavillion.dev') as Account;
    await accountsInterface.setPassword(accountY, 'testpassword');
    const calendarY = await calendarInterface.createCalendar(accountY, 'outboxdispatchy');

    const accountZ = await accountsInterface.registerNewAccount('outbox-dispatch-z@pavillion.dev') as Account;
    await accountsInterface.setPassword(accountZ, 'testpassword');
    const calendarZ = await calendarInterface.createCalendar(accountZ, 'outboxdispatchz');

    // Because handlers are installed in beforeAll, the 'calendar.created'
    // event auto-creates CalendarActorEntity rows. Wait for them to appear
    // and look them up rather than creating duplicates (which would
    // violate the unique constraint on actor_uri).
    const actorX = await waitFor(
      async () => CalendarActorEntity.findOne({
        where: { actor_uri: ActivityPubActor.actorUrl(calendarX) },
      }),
      { maxWaitMs: 2000, label: 'actorX auto-created' },
    );
    const actorY = await waitFor(
      async () => CalendarActorEntity.findOne({
        where: { actor_uri: ActivityPubActor.actorUrl(calendarY) },
      }),
      { maxWaitMs: 2000, label: 'actorY auto-created' },
    );
    const actorZ = await waitFor(
      async () => CalendarActorEntity.findOne({
        where: { actor_uri: ActivityPubActor.actorUrl(calendarZ) },
      }),
      { maxWaitMs: 2000, label: 'actorZ auto-created' },
    );

    // Following edges (authorization side consulted by checkAndPerformAutoRepost):
    //   Y follows X with auto_repost_originals=true (Y reposts X's originals)
    //   Z follows Y with auto_repost_reposts=true   (Z reposts Y's reposts)
    //   X follows Z with auto_repost_reposts=true   (closes the cycle back to X)
    await FollowingCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: actorX.id,
      calendar_id: calendarY.id,
      auto_repost_originals: true,
      auto_repost_reposts: false,
    });
    await FollowingCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: actorY.id,
      calendar_id: calendarZ.id,
      auto_repost_originals: false,
      auto_repost_reposts: true,
    });
    await FollowingCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: actorZ.id,
      calendar_id: calendarX.id,
      auto_repost_originals: false,
      auto_repost_reposts: true,
    });

    // Follower edges (recipient side consulted by ProcessOutboxService.getRecipients):
    //   X's followers must include Y so X's outbox reaches Y
    //   Y's followers must include Z so Y's outbox reaches Z
    //   Z's followers must include X so Z's outbox reaches X (and triggers the loop guard)
    await FollowerCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: actorY.id,
      calendar_id: calendarX.id,
    });
    await FollowerCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: actorZ.id,
      calendar_id: calendarY.id,
    });
    await FollowerCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: actorX.id,
      calendar_id: calendarZ.id,
    });

    const event = await calendarInterface.createEvent(accountX, {
      calendarId: calendarX.id,
      content: { en: { name: '3-cycle test', description: '3-node cycle termination' } },
      start_date: '2026-05-06',
      start_time: '18:00',
      end_date: '2026-05-06',
      end_time: '20:00',
    });

    // Wait for Z to get its share (deepest point of the cascade) then wait
    // for the total count to stabilize — proves the cascade has fully
    // propagated and the loop guard has prevented further reposts.
    await waitFor(
      async () => SharedEventEntity.findOne({
        where: { event_id: event.id, calendar_id: calendarZ.id },
      }),
      { maxWaitMs: 3000, label: '3-cycle Z share' },
    );
    await waitForStableCount(
      async () => SharedEventEntity.count({ where: { event_id: event.id } }),
      { maxWaitMs: 2000, stableForMs: 200, label: '3-cycle total share count' },
    );

    const shareY = await SharedEventEntity.findOne({
      where: { event_id: event.id, calendar_id: calendarY.id },
    });
    const shareZ = await SharedEventEntity.findOne({
      where: { event_id: event.id, calendar_id: calendarZ.id },
    });
    const shareX = await SharedEventEntity.findOne({
      where: { event_id: event.id, calendar_id: calendarX.id },
    });
    expect(shareY, 'Y must repost X original').not.toBeNull();
    expect(shareZ, 'Z must repost Y repost').not.toBeNull();
    expect(shareX, 'X must NOT repost its own event via the Z→X edge').toBeNull();

    // Exactly 2 shares total: Y and Z. Any value other than 2 means either
    // the cascade did not fully propagate (less than 2) or the loop guard
    // failed and extra reposts leaked in (greater than 2).
    const total = await SharedEventEntity.count({ where: { event_id: event.id } });
    expect(total).toBe(2);
  });

  it('dedup: two outbox Announces for the same event produce exactly one SharedEventEntity on B', async () => {
    const event = await calendarInterface.createEvent(accountA, {
      calendarId: calendarA.id,
      content: { en: { name: 'dedup test', description: 'dedup regression' } },
      start_date: '2026-05-07',
      start_time: '18:00',
      end_date: '2026-05-07',
      end_time: '20:00',
    });
    await waitFor(
      async () => SharedEventEntity.findOne({
        where: { event_id: event.id, calendar_id: calendarB.id },
      }),
      { maxWaitMs: 2000, label: 'first dedup share' },
    );

    // Second dispatch: synthesize a second Announce from A on the same event
    // and push it through the outbox, then wait for settlement. The unique
    // (event_id, calendar_id) constraint on SharedEventEntity must keep the
    // row count at exactly one on B regardless of how many Announces A emits.
    const actorUrl = await apInterface.actorUrl(calendarA);
    const { EventObject } = await import('@/server/activitypub/model/object/event');
    const eventUrl = EventObject.eventUrl(calendarA, event);
    const { default: AnnounceActivity } = await import('@/server/activitypub/model/action/announce');
    await apInterface.addToOutbox(calendarA, new AnnounceActivity(actorUrl, eventUrl));
    await waitForStableCount(
      async () => SharedEventEntity.count({ where: { event_id: event.id, calendar_id: calendarB.id } }),
      { maxWaitMs: 2000, stableForMs: 200, label: 'dedup share count on B' },
    );

    const count = await SharedEventEntity.count({
      where: { event_id: event.id, calendar_id: calendarB.id },
    });
    expect(count, 'dedup must produce exactly one share').toBe(1);
  });
});
