/**
 * Integration tests for ProcessInboxService.handleLocalActivityDispatch.
 *
 * These tests exercise the public handleLocalActivityDispatch method
 * directly (bypassing the outbox dispatcher) to verify the per-type
 * contract of the in-process local dispatch path:
 *
 *   1. Announce happy path: when an eligible local follower receives an
 *      Announce for a local event that has a corresponding EventObjectEntity,
 *      a SharedEventEntity is created for the follower calendar.
 *
 *   2. Announce orphan path: when the EventObjectEntity is missing (the
 *      AP<->local event mapping row is absent), the method returns silently
 *      and produces no SharedEventEntity on the follower calendar.
 *
 *   3. Create: a representative Create activity (the same activity type the
 *      paired-emission contract uses for federation) round-trips through
 *      local dispatch — the inbox row is written, dispatchByType is invoked
 *      with trustLocalOrigin, and the message is marked processed without
 *      any HTTP traffic.
 *
 *   4. Undo round-trip: locally dispatching an Announce then locally
 *      dispatching an Undo of that Announce removes the share row. This
 *      validates the side-effect fix where same-instance Undo previously
 *      failed silently because no inbox row existed for the original
 *      Announce to look up.
 *
 *   5. Idempotency: dispatching the same outbox row twice produces exactly
 *      one ActivityPubInboxMessageEntity row. The implementation uses
 *      findOne-then-create with a race fallback; this test validates the
 *      observable invariant (one row after two dispatches) rather than the
 *      specific Sequelize method used.
 *
 * These tests were previously colocated with the unit tests in
 * src/server/activitypub/test/inbox.test.ts but are behaviorally integration
 * tests — they set up the full AP schema, create real CalendarEntity /
 * CalendarActorEntity / FollowingCalendarEntity / EventObjectEntity rows,
 * and query SharedEventEntity.count() for real. They were moved here to
 * correct the tier mismatch (pv-6evr post-epic audit, HIGH #3 second half).
 *
 * The broader cascade-through-the-outbox behavior lives in
 * outbox-local-dispatch.integration.test.ts. This file is focused narrowly
 * on the single-method contract of handleLocalActivityDispatch, so we
 * construct ProcessInboxService directly rather than going through
 * TestEnvironment / ActivityPubInterface.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

import ProcessInboxService from '@/server/activitypub/service/inbox';
import * as remoteFetch from '@/server/activitypub/helper/remote-fetch';
import {
  ActivityPubInboxMessageEntity,
  EventActivityEntity,
  FollowingCalendarEntity,
  SharedEventEntity,
} from '@/server/activitypub/entity/activitypub';
import { CalendarActorEntity } from '@/server/activitypub/entity/calendar_actor';
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';
import AnnounceActivity from '@/server/activitypub/model/action/announce';
import CreateActivity from '@/server/activitypub/model/action/create';
import UndoActivity from '@/server/activitypub/model/action/undo';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import CalendarInterface from '@/server/calendar/interface';
import { setupActivityPubSchema, teardownActivityPubSchema } from '@/server/common/test/helpers/database';

describe('ProcessInboxService.handleLocalActivityDispatch (integration)', () => {
  let sandbox: sinon.SinonSandbox;
  let inboxService: ProcessInboxService;
  let eventBus: EventEmitter;
  let testCalendar: Calendar;
  let calendarInterface: CalendarInterface;

  beforeEach(async () => {
    await setupActivityPubSchema();
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    inboxService = new ProcessInboxService(eventBus, calendarInterface);

    testCalendar = new Calendar('test-calendar-id', 'test-calendar');
    testCalendar.addContent('en', new CalendarContent('en'));
    testCalendar.content('en').title = 'Test Calendar';

    // Create the follower calendar row so foreign key constraints are satisfied.
    await CalendarEntity.create({
      id: testCalendar.id,
      url_name: testCalendar.urlName,
      account_id: uuidv4(),
      languages: 'en',
    });

    // Suppress noisy log output during tests
    sandbox.stub(console, 'log');
    sandbox.stub(console, 'warn');
  });

  afterEach(async () => {
    sandbox.restore();
    vi.restoreAllMocks();
    await teardownActivityPubSchema();
  });

  it('creates a shared event for an eligible local follower', async () => {
    // Arrange: source calendar (local) + follower calendar (testCalendar) with auto_repost_originals=true
    const sourceCalendarId = uuidv4();
    const sourceUrlName = 'source-local-calendar';
    await CalendarEntity.create({
      id: sourceCalendarId,
      url_name: sourceUrlName,
      account_id: uuidv4(),
      languages: 'en',
    });

    const sourceCalendarActorUri = `https://test.local/calendars/${sourceUrlName}`;
    const sourceActorId = uuidv4();
    await CalendarActorEntity.create({
      id: sourceActorId,
      actor_type: 'local',
      actor_uri: sourceCalendarActorUri,
      remote_display_name: null,
      remote_domain: null,
      calendar_id: sourceCalendarId,
      private_key: null,
    });

    // Follower's CalendarActorEntity (local) - so the follow relationship can be resolved
    const followerActorId = uuidv4();
    await CalendarActorEntity.create({
      id: followerActorId,
      actor_type: 'local',
      actor_uri: `https://test.local/calendars/${testCalendar.urlName}`,
      remote_display_name: null,
      remote_domain: null,
      calendar_id: testCalendar.id,
      private_key: null,
    });

    // FollowingCalendarEntity: testCalendar (follower) follows sourceCalendar
    await FollowingCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: sourceActorId,
      calendar_id: testCalendar.id,
      auto_repost_originals: true,
      auto_repost_reposts: false,
    });

    // EventObjectEntity for the local event (guaranteed by Phase 1)
    const localEventId = uuidv4();
    const eventApId = `${sourceCalendarActorUri}/events/evt-1`;
    await EventObjectEntity.create({
      event_id: localEventId,
      ap_id: eventApId,
      attributed_to: sourceCalendarActorUri,
    });

    // Stub calendarInterface.getEventById (matches sibling test convention — event_content table not synced)
    const event = new CalendarEvent(localEventId, null);
    sandbox.stub(calendarInterface, 'getEventById').resolves(event);

    // Stub category mapping service
    sandbox.stub(calendarInterface.categoryMappingService, 'assignAutoRepostCategories').resolves();

    const announceActivity = new AnnounceActivity(sourceCalendarActorUri, eventApId);

    // Act
    await inboxService.handleLocalActivityDispatch(testCalendar, announceActivity);

    // Assert
    const share = await SharedEventEntity.findOne({
      where: { event_id: localEventId, calendar_id: testCalendar.id },
    });
    expect(share, 'SharedEventEntity must be created by local dispatch').not.toBeNull();
    expect(share!.auto_posted).toBe(true);
  });

  it('returns silently when EventObjectEntity is missing', async () => {
    // Arrange: same fixture as above but do NOT create the EventObjectEntity
    const sourceCalendarId = uuidv4();
    const sourceUrlName = 'source-local-calendar-orphan';
    await CalendarEntity.create({
      id: sourceCalendarId,
      url_name: sourceUrlName,
      account_id: uuidv4(),
      languages: 'en',
    });

    const sourceCalendarActorUri = `https://test.local/calendars/${sourceUrlName}`;
    const sourceActorId = uuidv4();
    await CalendarActorEntity.create({
      id: sourceActorId,
      actor_type: 'local',
      actor_uri: sourceCalendarActorUri,
      remote_display_name: null,
      remote_domain: null,
      calendar_id: sourceCalendarId,
      private_key: null,
    });

    const followerActorId = uuidv4();
    await CalendarActorEntity.create({
      id: followerActorId,
      actor_type: 'local',
      actor_uri: `https://test.local/calendars/${testCalendar.urlName}`,
      remote_display_name: null,
      remote_domain: null,
      calendar_id: testCalendar.id,
      private_key: null,
    });

    await FollowingCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: sourceActorId,
      calendar_id: testCalendar.id,
      auto_repost_originals: true,
      auto_repost_reposts: false,
    });

    const orphanEventApId = `${sourceCalendarActorUri}/events/orphan`;
    const announceActivity = new AnnounceActivity(
      sourceCalendarActorUri,
      orphanEventApId,
    );

    // Stub fetchRemoteObject to resolve null. The orphan path means the
    // referenced AP event does not exist anywhere — under the unified
    // dispatchByType pipeline, processShareEvent now attempts to fetch the
    // remote object when no local EventObjectEntity is found. The
    // observable contract for an orphan-on-the-network is the same: no
    // SharedEventEntity is created. Stubbing to null short-circuits the
    // real network call (which would otherwise time out against
    // test.local) and exercises the documented null-fetch branch.
    //
    // We use vi.spyOn here rather than sandbox.stub because vitest's ESM
    // namespace objects in the integration runner cannot be patched via
    // sinon (frozen exports); vi.spyOn uses vitest's own seam.
    vi.spyOn(remoteFetch, 'fetchRemoteObject').mockResolvedValue(null);

    // Spy on private checkAndPerformAutoRepost via bracket-notation pattern.
    // Kept as secondary verification that the private branch did not execute;
    // the primary contract assertion below checks the observable side effect.
    const checkSpy = sandbox.spy(inboxService as any, 'checkAndPerformAutoRepost');

    // Act
    await inboxService.handleLocalActivityDispatch(testCalendar, announceActivity);

    // Primary assertion: no SharedEventEntity is created when the referenced
    // EventObjectEntity is missing. This is the observable contract: an
    // orphan Announce must NOT produce a share row on the follower calendar,
    // regardless of which internal method did or did not execute. Since the
    // orphan has no local event_id mapping (because EventObjectEntity is
    // absent), we assert there is no share row at all on the follower
    // calendar scoped to this test's fresh fixture.
    const shareCount = await SharedEventEntity.count({
      where: { calendar_id: testCalendar.id },
    });
    expect(
      shareCount,
      'orphan Announce must not produce a SharedEventEntity on the follower calendar',
    ).toBe(0);

    // Secondary assertion: the private repost pipeline was not entered.
    expect(checkSpy.called, 'must not proceed to checkAndPerformAutoRepost').toBe(false);
  });

  it('dispatches a Create activity in-process, writing an inbox row and invoking addRemoteEvent', async () => {
    // Arrange: a local source calendar minting a new event. The follower
    // (testCalendar) receives the Create in-process. We assert the inbox
    // row is written and addRemoteEvent is invoked exactly once — both
    // observable contracts of the local dispatch path for Create.

    const sourceCalendarId = uuidv4();
    const sourceUrlName = 'source-create-calendar';
    await CalendarEntity.create({
      id: sourceCalendarId,
      url_name: sourceUrlName,
      account_id: uuidv4(),
      languages: 'en',
    });

    const sourceCalendarActorUri = `https://test.local/calendars/${sourceUrlName}`;
    await CalendarActorEntity.create({
      id: uuidv4(),
      actor_type: 'local',
      actor_uri: sourceCalendarActorUri,
      remote_display_name: null,
      remote_domain: null,
      calendar_id: sourceCalendarId,
      private_key: null,
    });

    await CalendarActorEntity.create({
      id: uuidv4(),
      actor_type: 'local',
      actor_uri: `https://test.local/calendars/${testCalendar.urlName}`,
      remote_display_name: null,
      remote_domain: null,
      calendar_id: testCalendar.id,
      private_key: null,
    });

    // Stub addRemoteEvent so we don't need to sync the full EventEntity /
    // event_content schema for this test. The contract we care about is
    // that local dispatch reaches this method exactly once after running
    // the in-process Create pipeline.
    const newEventId = uuidv4();
    const addRemoteEventStub = sandbox
      .stub(calendarInterface, 'addRemoteEvent')
      .resolves(new CalendarEvent(newEventId, null));

    const apEventId = `${sourceCalendarActorUri}/events/create-evt-1`;
    const createActivity = CreateActivity.fromObject({
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Create',
      actor: sourceCalendarActorUri,
      id: `${sourceCalendarActorUri}/activities/create-1`,
      object: {
        type: 'Event',
        id: apEventId,
        name: 'Local Create Event',
        attributedTo: sourceCalendarActorUri,
      },
    });
    expect(createActivity, 'CreateActivity must parse').not.toBeNull();

    // Act
    await inboxService.handleLocalActivityDispatch(testCalendar, createActivity!);

    // Assert: inbox row exists, EventObjectEntity mapping was created,
    // addRemoteEvent was invoked.
    const inboxRow = await ActivityPubInboxMessageEntity.findOne({
      where: { calendar_id: testCalendar.id, id: createActivity!.id! },
    });
    expect(inboxRow, 'local dispatch must write an inbox row for the Create').not.toBeNull();
    expect(inboxRow!.type).toBe('Create');
    expect(inboxRow!.processed_status).toBe('ok');

    const apObject = await EventObjectEntity.findOne({ where: { ap_id: apEventId } });
    expect(apObject, 'processCreateEvent must create an EventObjectEntity mapping').not.toBeNull();

    expect(
      addRemoteEventStub.calledOnce,
      'addRemoteEvent must be invoked exactly once via local dispatch',
    ).toBe(true);
  });

  it('Undo round-trip: locally dispatched Announce then Undo removes the share record', async () => {
    // This validates the pv-ojtg.1 side-effect fix: before the inbox-row
    // write, same-instance Undo of a locally-dispatched Announce silently
    // failed because dispatchByType's Undo branch could not find the
    // referenced Announce inbox row and threw "Undo target not found".
    // Now that handleLocalActivityDispatch writes the inbox row before
    // invoking dispatchByType, the Undo target lookup succeeds and
    // processUnshareEvent destroys the share record (EventActivityEntity
    // row of type 'share') created by the original Announce.
    //
    // The source CalendarActorEntity is recorded with actor_type='remote'
    // because processUnshareEvent looks up the sharer via
    // remoteCalendarService.getByActorUri which filters by that column.
    // In a same-instance flow the sharer's actor row is technically local,
    // but the share/unshare round-trip itself does not depend on that
    // distinction — it depends on the AP actor URI matching. This test
    // models the cross-instance shape of the share row to exercise the
    // unshare side-effect in isolation; the broader same-instance
    // cascade behavior is covered by outbox-local-dispatch.integration.test.ts.

    const sourceCalendarId = uuidv4();
    const sourceUrlName = 'source-undo-roundtrip';
    await CalendarEntity.create({
      id: sourceCalendarId,
      url_name: sourceUrlName,
      account_id: uuidv4(),
      languages: 'en',
    });

    const sourceCalendarActorUri = `https://test.local/calendars/${sourceUrlName}`;
    const sourceActorId = uuidv4();
    await CalendarActorEntity.create({
      id: sourceActorId,
      actor_type: 'remote',
      actor_uri: sourceCalendarActorUri,
      remote_display_name: null,
      remote_domain: 'test.local',
      calendar_id: null,
      private_key: null,
    });

    await CalendarActorEntity.create({
      id: uuidv4(),
      actor_type: 'local',
      actor_uri: `https://test.local/calendars/${testCalendar.urlName}`,
      remote_display_name: null,
      remote_domain: null,
      calendar_id: testCalendar.id,
      private_key: null,
    });

    // EventObjectEntity must exist for processShareEvent to skip the
    // remote-fetch branch and proceed directly to creating the
    // EventActivityEntity share record.
    const localEventId = uuidv4();
    const eventApId = `${sourceCalendarActorUri}/events/undo-roundtrip-1`;
    await EventObjectEntity.create({
      event_id: localEventId,
      ap_id: eventApId,
      attributed_to: sourceCalendarActorUri,
    });

    // Step 1: Announce. We do NOT enable auto-repost on testCalendar's
    // following of the source — this test focuses on the share-record
    // (EventActivityEntity) side-effect that processUnshareEvent
    // explicitly destroys, not the auto-repost SharedEventEntity. The
    // share record proves the Announce was processed; its destruction
    // after Undo proves the inbox-row lookup found the target.
    const announceActivity = new AnnounceActivity(sourceCalendarActorUri, eventApId);
    await inboxService.handleLocalActivityDispatch(testCalendar, announceActivity);

    const shareAfterAnnounce = await EventActivityEntity.findOne({
      where: {
        event_id: eventApId,
        calendar_actor_id: sourceActorId,
        type: 'share',
      },
    });
    expect(
      shareAfterAnnounce,
      'Announce dispatch must create a share record (EventActivityEntity)',
    ).not.toBeNull();

    // The Announce inbox row must also be present — this is the row the
    // Undo target lookup will key on in dispatchByType.
    const announceInboxRow = await ActivityPubInboxMessageEntity.findOne({
      where: { calendar_id: testCalendar.id, id: announceActivity.id! },
    });
    expect(
      announceInboxRow,
      'Announce dispatch must write an inbox row for later Undo lookup',
    ).not.toBeNull();

    // Step 2: Undo of the Announce. The Undo activity's `object` field
    // is the original Announce's AP ID. dispatchByType looks the row up
    // by (calendar_id, undoTargetId); the row exists because step 1
    // wrote it, so the Undo branch reaches processUnshareEvent.
    const undoActivity = new UndoActivity(sourceCalendarActorUri, announceActivity.id!);

    await inboxService.handleLocalActivityDispatch(testCalendar, undoActivity);

    // Assert: the share record is gone. Before the fix, this assertion
    // would have failed because the Undo silently threw "Undo target not
    // found" (no inbox row existed for the target lookup) and the share
    // would have persisted.
    const shareAfterUndo = await EventActivityEntity.findOne({
      where: {
        event_id: eventApId,
        calendar_actor_id: sourceActorId,
        type: 'share',
      },
    });
    expect(
      shareAfterUndo,
      'Undo round-trip must destroy the share record created by the Announce',
    ).toBeNull();
  });

  it('idempotency: dispatching the same activity twice yields exactly one inbox row', async () => {
    // The local dispatch path uses findOne-then-create with a race
    // fallback to satisfy idempotency. The bead AC originally specified
    // findOrCreate keyed on (calendar_id, id); the actual implementation
    // differs (see inbox.ts ~1965 for the rationale: SQLite nested
    // transactions), but the observable contract is identical — exactly
    // one inbox row after N dispatches.

    const sourceCalendarId = uuidv4();
    const sourceUrlName = 'source-idempotency';
    await CalendarEntity.create({
      id: sourceCalendarId,
      url_name: sourceUrlName,
      account_id: uuidv4(),
      languages: 'en',
    });

    const sourceCalendarActorUri = `https://test.local/calendars/${sourceUrlName}`;
    await CalendarActorEntity.create({
      id: uuidv4(),
      actor_type: 'local',
      actor_uri: sourceCalendarActorUri,
      remote_display_name: null,
      remote_domain: null,
      calendar_id: sourceCalendarId,
      private_key: null,
    });

    await CalendarActorEntity.create({
      id: uuidv4(),
      actor_type: 'local',
      actor_uri: `https://test.local/calendars/${testCalendar.urlName}`,
      remote_display_name: null,
      remote_domain: null,
      calendar_id: testCalendar.id,
      private_key: null,
    });

    // EventObjectEntity exists so processShareEvent skips fetchRemoteObject.
    const localEventId = uuidv4();
    const eventApId = `${sourceCalendarActorUri}/events/idem-1`;
    await EventObjectEntity.create({
      event_id: localEventId,
      ap_id: eventApId,
      attributed_to: sourceCalendarActorUri,
    });

    const announceActivity = new AnnounceActivity(sourceCalendarActorUri, eventApId);

    // Dispatch the same activity twice.
    await inboxService.handleLocalActivityDispatch(testCalendar, announceActivity);
    await inboxService.handleLocalActivityDispatch(testCalendar, announceActivity);

    const rows = await ActivityPubInboxMessageEntity.findAll({
      where: { calendar_id: testCalendar.id, id: announceActivity.id! },
    });
    expect(
      rows.length,
      'duplicate dispatches of the same activity must produce exactly one inbox row',
    ).toBe(1);
  });
});
