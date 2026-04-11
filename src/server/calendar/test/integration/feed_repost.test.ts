/**
 * Integration tests for feed inclusion of reposted events.
 *
 * Regression: pv-ru1j — Feed was missing events reposted by followed local
 * calendars because the query only matched events directly owned by the
 * followed calendar (event.calendar_id = followed calendar). Reposts are
 * tracked in EventRepostEntity, and the fix adds a 4th OR condition that
 * joins event_repost to find these events.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import AccountService from '@/server/accounts/service/account';
import { TestEnvironment } from '@/server/test/lib/test_environment';
import { CalendarActorEntity } from '@/server/activitypub/entity/calendar_actor';
import { FollowingCalendarEntity, EventActivityEntity } from '@/server/activitypub/entity/activitypub';
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';
import { EventRepostEntity } from '@/server/calendar/entity/event_repost';
import { SharedEventEntity } from '@/server/activitypub/entity/activitypub';
import EventService from '@/server/calendar/service/events';

describe('Feed includes reposts from followed local calendars (pv-ru1j)', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let eventService: EventService;
  let eventBus: EventEmitter;

  // Three accounts with calendars: A follows B, B reposts from C
  let accountA: Account;
  let accountB: Account;
  let accountC: Account;
  let calendarA: Calendar;
  let calendarB: Calendar;
  let calendarC: Calendar;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountsInterface = new AccountsInterface(eventBus, configurationInterface, setupInterface);
    calendarInterface = new CalendarInterface(eventBus, accountsInterface, configurationInterface);
    eventService = new EventService(eventBus);
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    // Create three accounts with calendars
    const infoA = await accountService._setupAccount('feedrepost-a@pavillion.dev', 'testpassword');
    accountA = infoA.account;
    calendarA = await calendarInterface.createCalendar(accountA, 'feedreposta');

    const infoB = await accountService._setupAccount('feedrepost-b@pavillion.dev', 'testpassword');
    accountB = infoB.account;
    calendarB = await calendarInterface.createCalendar(accountB, 'feedrepostb');

    const infoC = await accountService._setupAccount('feedrepost-c@pavillion.dev', 'testpassword');
    accountC = infoC.account;
    calendarC = await calendarInterface.createCalendar(accountC, 'feedrepostc');
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it('includes a local-origin event reposted by a followed local calendar', async () => {
    // Calendar C owns an event
    const eventFromC = await calendarInterface.createEvent(accountC, {
      calendarId: calendarC.id,
      content: { en: { name: 'Community Fair', description: 'Annual fair' } },
      start_date: '2026-06-01',
      start_time: '10:00',
      end_date: '2026-06-01',
      end_time: '18:00',
    });

    // Create CalendarActor for Calendar B (local)
    const actorB = await CalendarActorEntity.create({
      id: uuidv4(),
      actor_type: 'local',
      calendar_id: calendarB.id,
      actor_uri: `https://pavillion.dev/actor/${calendarB.urlName}`,
    });

    // Calendar A follows Calendar B via ap_following
    await FollowingCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: actorB.id,
      calendar_id: calendarA.id,
      auto_repost_originals: false,
      auto_repost_reposts: false,
    });

    // Calendar B reposts the event from Calendar C
    await EventRepostEntity.create({
      id: uuidv4(),
      event_id: eventFromC.id,
      calendar_id: calendarB.id,
    });

    // Fetch Calendar A's feed
    const feed = await eventService.getEventsFromFollowedSources(calendarA);

    const feedEventIds = feed.map(e => e.id);
    expect(feedEventIds).toContain(eventFromC.id);
  });

  it('excludes events reposted by an unfollowed calendar', async () => {
    // Self-contained: create own follow relationship so this test is meaningful in isolation
    // Calendar A follows Calendar B (may already exist from test 1, but ensure it)
    const existingActorB = await CalendarActorEntity.findOne({
      where: { calendar_id: calendarB.id },
    });
    const actorBId = existingActorB?.id || uuidv4();
    if (!existingActorB) {
      await CalendarActorEntity.create({
        id: actorBId,
        actor_type: 'local',
        calendar_id: calendarB.id,
        actor_uri: `https://pavillion.dev/actor/${calendarB.urlName}`,
      });
    }
    const existingFollow = await FollowingCalendarEntity.findOne({
      where: { calendar_id: calendarA.id, calendar_actor_id: actorBId },
    });
    if (!existingFollow) {
      await FollowingCalendarEntity.create({
        id: uuidv4(),
        calendar_actor_id: actorBId,
        calendar_id: calendarA.id,
        auto_repost_originals: false,
        auto_repost_reposts: false,
      });
    }

    // Calendar C owns a second event
    const privateEvent = await calendarInterface.createEvent(accountC, {
      calendarId: calendarC.id,
      content: { en: { name: 'Private Meetup', description: 'Invite only' } },
      start_date: '2026-07-01',
      start_time: '19:00',
      end_date: '2026-07-01',
      end_time: '21:00',
    });

    // Ensure CalendarActor for Calendar C (local) exists — A does NOT follow C
    const actorCExists = await CalendarActorEntity.findOne({
      where: { calendar_id: calendarC.id },
    });
    if (!actorCExists) {
      await CalendarActorEntity.create({
        id: uuidv4(),
        actor_type: 'local',
        calendar_id: calendarC.id,
        actor_uri: `https://pavillion.dev/actor/${calendarC.urlName}`,
      });
    }

    // Calendar C reposts the event (but A doesn't follow C)
    await EventRepostEntity.create({
      id: uuidv4(),
      event_id: privateEvent.id,
      calendar_id: calendarC.id,
    });

    // Fetch Calendar A's feed — should NOT include the event reposted only by C
    const feed = await eventService.getEventsFromFollowedSources(calendarA);

    const feedEventIds = feed.map(e => e.id);
    expect(feedEventIds).not.toContain(privateEvent.id);
  });

  // Regression: pv-ru1j — the 4th condition must include remote-origin events
  // (calendar_id = null) reposted by followed local calendars
  it('includes a remote-origin event reposted by a followed local calendar', async () => {
    // Self-contained: ensure A follows B
    const existingActorB = await CalendarActorEntity.findOne({
      where: { calendar_id: calendarB.id },
    });
    const actorBId = existingActorB?.id || uuidv4();
    if (!existingActorB) {
      await CalendarActorEntity.create({
        id: actorBId,
        actor_type: 'local',
        calendar_id: calendarB.id,
        actor_uri: `https://pavillion.dev/actor/${calendarB.urlName}`,
      });
    }
    const existingFollow = await FollowingCalendarEntity.findOne({
      where: { calendar_id: calendarA.id, calendar_actor_id: actorBId },
    });
    if (!existingFollow) {
      await FollowingCalendarEntity.create({
        id: uuidv4(),
        calendar_actor_id: actorBId,
        calendar_id: calendarA.id,
        auto_repost_originals: false,
        auto_repost_reposts: false,
      });
    }

    // Create a remote-origin event (calendar_id = null, as if received via AP)
    const { EventEntity } = await import('@/server/calendar/entity/event');
    const remoteEventId = uuidv4();
    await EventEntity.create({
      id: remoteEventId,
      calendar_id: null,
    });

    // Calendar B reposts the remote-origin event
    await EventRepostEntity.create({
      id: uuidv4(),
      event_id: remoteEventId,
      calendar_id: calendarB.id,
    });

    // Fetch Calendar A's feed — should include the remote-origin repost
    const feed = await eventService.getEventsFromFollowedSources(calendarA);

    const feedEventIds = feed.map(e => e.id);
    expect(feedEventIds).toContain(remoteEventId);
  });

  // Regression: Scenario 5 of auto-repost federation e2e (self-origin loop, cross-instance).
  //
  // When a followed REMOTE calendar announces an event that originated on this
  // instance, the local owner should see it in their feed (that's how a feed
  // surfaces reposts of one's own events via a followed actor). The share is
  // tracked on this instance as an EventActivityEntity(type='share') linked to
  // the remote actor, and the EventObjectEntity maps the AP id back to the
  // local event row (which has a non-null calendar_id).
  it('includes a local-origin event shared back by a followed remote calendar', async () => {
    // Calendar A owns an event on this instance (local origin, non-null calendar_id)
    const localEvent = await calendarInterface.createEvent(accountA, {
      calendarId: calendarA.id,
      content: { en: { name: 'Local Event Shared Back', description: 'Originated here' } },
      start_date: '2026-09-01',
      start_time: '10:00',
      end_date: '2026-09-01',
      end_time: '12:00',
    });

    // Track the AP identity for the local event (mirrors handleEventCreated's findOrCreate)
    const localEventApId = `https://pavillion.dev/${calendarA.urlName}/events/${localEvent.id}`;
    const localActorUri = `https://pavillion.dev/actor/${calendarA.urlName}`;
    await EventObjectEntity.create({
      event_id: localEvent.id,
      ap_id: localEventApId,
      attributed_to: localActorUri,
    });

    // Remote calendar that A follows
    const remoteActor = await CalendarActorEntity.create({
      id: uuidv4(),
      actor_type: 'remote',
      calendar_id: null,
      actor_uri: 'https://remote.example.com/actor/peer',
      remote_domain: 'remote.example.com',
      private_key: null,
    });
    await FollowingCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: remoteActor.id,
      calendar_id: calendarA.id,
      auto_repost_originals: false,
      auto_repost_reposts: false,
    });

    // Remote peer announces (shares) A's local event back to us — mirrors what
    // processShareEvent records when an Announce arrives from a followed remote
    // for an event whose EventObjectEntity already exists locally.
    await EventActivityEntity.create({
      event_id: localEventApId,
      calendar_actor_id: remoteActor.id,
      type: 'share',
    });

    // Fetch Calendar A's feed — should include A's own event surfaced via the
    // remote peer's share, even though calendar_id is non-null.
    const feed = await eventService.getEventsFromFollowedSources(calendarA);

    const feedEventIds = feed.map(e => e.id);
    expect(feedEventIds).toContain(localEvent.id);
  });

  it('includes an event auto-reposted (SharedEventEntity) by a followed local calendar', async () => {
    // Self-contained: ensure A follows B
    const existingActorB = await CalendarActorEntity.findOne({
      where: { calendar_id: calendarB.id },
    });
    const actorBId = existingActorB?.id || uuidv4();
    if (!existingActorB) {
      await CalendarActorEntity.create({
        id: actorBId,
        actor_type: 'local',
        calendar_id: calendarB.id,
        actor_uri: `https://pavillion.dev/actor/${calendarB.urlName}`,
      });
    }
    const existingFollow = await FollowingCalendarEntity.findOne({
      where: { calendar_id: calendarA.id, calendar_actor_id: actorBId },
    });
    if (!existingFollow) {
      await FollowingCalendarEntity.create({
        id: uuidv4(),
        calendar_actor_id: actorBId,
        calendar_id: calendarA.id,
        auto_repost_originals: false,
        auto_repost_reposts: false,
      });
    }

    // Calendar C owns an event
    const sharedEvent = await calendarInterface.createEvent(accountC, {
      calendarId: calendarC.id,
      content: { en: { name: 'Auto-Reposted Event', description: 'Shared via AP' } },
      start_date: '2026-08-01',
      start_time: '10:00',
      end_date: '2026-08-01',
      end_time: '12:00',
    });

    // Calendar B auto-reposts the event (via AP auto-repost, stored in SharedEventEntity)
    await SharedEventEntity.create({
      id: uuidv4(),
      event_id: sharedEvent.id,
      calendar_id: calendarB.id,
      auto_posted: true,
    });

    // Fetch Calendar A's feed — should include the auto-reposted event
    const feed = await eventService.getEventsFromFollowedSources(calendarA);

    const feedEventIds = feed.map(e => e.id);
    expect(feedEventIds).toContain(sharedEvent.id);
  });
});
