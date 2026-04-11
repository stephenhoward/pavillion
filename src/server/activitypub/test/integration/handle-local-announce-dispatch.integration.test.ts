/**
 * Integration tests for ProcessInboxService.handleLocalAnnounceDispatch.
 *
 * These tests exercise the private-ish handleLocalAnnounceDispatch method
 * directly (bypassing the outbox dispatcher) to verify two contracts:
 *
 *   1. Happy path: when an eligible local follower receives an Announce for
 *      a local event that has a corresponding EventObjectEntity, a
 *      SharedEventEntity is created for the follower calendar.
 *
 *   2. Orphan path: when the EventObjectEntity is missing (the AP<->local
 *      event mapping row is absent), the method returns silently and
 *      produces no SharedEventEntity on the follower calendar.
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
 * on the single-method contract of handleLocalAnnounceDispatch, so we
 * construct ProcessInboxService directly rather than going through
 * TestEnvironment / ActivityPubInterface.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

import ProcessInboxService from '@/server/activitypub/service/inbox';
import {
  FollowingCalendarEntity,
  SharedEventEntity,
} from '@/server/activitypub/entity/activitypub';
import { CalendarActorEntity } from '@/server/activitypub/entity/calendar_actor';
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';
import AnnounceActivity from '@/server/activitypub/model/action/announce';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import CalendarInterface from '@/server/calendar/interface';
import { setupActivityPubSchema, teardownActivityPubSchema } from '@/server/test/helpers/database';

describe('ProcessInboxService.handleLocalAnnounceDispatch (integration)', () => {
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
    await (inboxService as any).handleLocalAnnounceDispatch(testCalendar, announceActivity);

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

    // Spy on private checkAndPerformAutoRepost via bracket-notation pattern.
    // Kept as secondary verification that the private branch did not execute;
    // the primary contract assertion below checks the observable side effect.
    const checkSpy = sandbox.spy(inboxService as any, 'checkAndPerformAutoRepost');

    // Act
    await (inboxService as any).handleLocalAnnounceDispatch(testCalendar, announceActivity);

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
});
