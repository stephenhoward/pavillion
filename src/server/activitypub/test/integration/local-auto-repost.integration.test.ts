/**
 * Integration tests for local auto-repost (same-instance follow chains).
 *
 * When calendars on the same instance follow each other with auto-repost
 * enabled, the AP inbox pipeline is bypassed. Instead, performLocalAutoReposts()
 * uses BFS traversal to directly create SharedEventEntity records for all
 * eligible followers in the chain, and emits eventReposted so that the
 * calendar domain builds event instances for each.
 *
 * Test scenarios:
 * 1. Single-hop: B follows C with auto_repost_originals, C creates event → B gets repost
 * 2. Multi-hop: A follows B (auto_repost_reposts), B follows C (auto_repost_originals) → event cascades C→B→A
 * 3. No repost when policy disabled
 * 4. Duplicate prevention
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
import EmailInterface from '@/server/email/interface';
import ActivityPubInterface from '@/server/activitypub/interface';
import { TestEnvironment } from '@/server/test/lib/test_environment';
import { CalendarActorEntity } from '@/server/activitypub/entity/calendar_actor';
import { FollowingCalendarEntity, SharedEventEntity } from '@/server/activitypub/entity/activitypub';

describe('Local Auto-Repost (same-instance follow chains)', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let apInterface: ActivityPubInterface;
  let eventBus: EventEmitter;

  let accountA: Account;
  let accountB: Account;
  let accountC: Account;
  let calendarA: Calendar;
  let calendarB: Calendar;
  let calendarC: Calendar;
  let actorA: CalendarActorEntity;
  let actorB: CalendarActorEntity;
  let actorC: CalendarActorEntity;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const emailInterface = new EmailInterface();

    await configurationInterface.setSetting('registrationMode', 'open');

    const accountsInterface = new AccountsInterface(eventBus, configurationInterface, setupInterface, emailInterface);
    calendarInterface = new CalendarInterface(eventBus, accountsInterface, configurationInterface);
    apInterface = new ActivityPubInterface(eventBus, calendarInterface, accountsInterface);

    // Create three accounts with calendars
    accountA = await accountsInterface.registerNewAccount('local-repost-a@pavillion.dev') as Account;
    await accountsInterface.setPassword(accountA, 'testpassword');
    calendarA = await calendarInterface.createCalendar(accountA, 'localreposta');

    accountB = await accountsInterface.registerNewAccount('local-repost-b@pavillion.dev') as Account;
    await accountsInterface.setPassword(accountB, 'testpassword');
    calendarB = await calendarInterface.createCalendar(accountB, 'localrepostb');

    accountC = await accountsInterface.registerNewAccount('local-repost-c@pavillion.dev') as Account;
    await accountsInterface.setPassword(accountC, 'testpassword');
    calendarC = await calendarInterface.createCalendar(accountC, 'localrepostc');

    // Create local CalendarActorEntity for each calendar
    actorA = await CalendarActorEntity.create({
      id: uuidv4(),
      actor_type: 'local',
      calendar_id: calendarA.id,
      actor_uri: `https://pavillion.dev/calendars/${calendarA.urlName}`,
    });

    actorB = await CalendarActorEntity.create({
      id: uuidv4(),
      actor_type: 'local',
      calendar_id: calendarB.id,
      actor_uri: `https://pavillion.dev/calendars/${calendarB.urlName}`,
    });

    actorC = await CalendarActorEntity.create({
      id: uuidv4(),
      actor_type: 'local',
      calendar_id: calendarC.id,
      actor_uri: `https://pavillion.dev/calendars/${calendarC.urlName}`,
    });
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it('auto-reposts to a local follower with auto_repost_originals enabled', async () => {
    // B follows C with auto_repost_originals=true
    await FollowingCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: actorC.id,
      calendar_id: calendarB.id,
      auto_repost_originals: true,
      auto_repost_reposts: false,
    });

    // C creates an event
    const event = await calendarInterface.createEvent(accountC, {
      calendarId: calendarC.id,
      content: { en: { name: 'Local Repost Test', description: 'Test event' } },
      start_date: '2026-09-01',
      start_time: '10:00',
      end_date: '2026-09-01',
      end_time: '12:00',
    });

    // Trigger local auto-repost (as if called from handleEventCreated)
    await apInterface.performLocalAutoReposts(calendarC, event, true);

    // B should now have a SharedEventEntity for this event
    const shared = await SharedEventEntity.findOne({
      where: { event_id: event.id, calendar_id: calendarB.id },
    });
    expect(shared).not.toBeNull();
    expect(shared!.auto_posted).toBe(true);
  });

  it('cascades auto-repost through multi-hop local follow chain via BFS', async () => {
    // A follows B with auto_repost_reposts=true
    await FollowingCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: actorB.id,
      calendar_id: calendarA.id,
      auto_repost_originals: false,
      auto_repost_reposts: true,
    });

    // B follows C with auto_repost_originals=true (self-contained setup)
    const existingBFollowsC = await FollowingCalendarEntity.findOne({
      where: { calendar_actor_id: actorC.id, calendar_id: calendarB.id },
    });
    if (!existingBFollowsC) {
      await FollowingCalendarEntity.create({
        id: uuidv4(),
        calendar_actor_id: actorC.id,
        calendar_id: calendarB.id,
        auto_repost_originals: true,
        auto_repost_reposts: false,
      });
    }

    // C creates a new event
    const event = await calendarInterface.createEvent(accountC, {
      calendarId: calendarC.id,
      content: { en: { name: 'Multi-hop Test', description: 'Cascade event' } },
      start_date: '2026-10-01',
      start_time: '14:00',
      end_date: '2026-10-01',
      end_time: '16:00',
    });

    // A single call should cascade C→B→A via the internal BFS loop.
    // The BFS queues B after creating its SharedEventEntity at depth 1,
    // then processes B's followers (including A) at depth 2.
    await apInterface.performLocalAutoReposts(calendarC, event, true);

    // B should have auto-reposted (depth 1: B follows C with auto_repost_originals)
    const sharedByB = await SharedEventEntity.findOne({
      where: { event_id: event.id, calendar_id: calendarB.id },
    });
    expect(sharedByB).not.toBeNull();

    // A should also have auto-reposted via BFS cascade (depth 2: A follows B with auto_repost_reposts)
    const sharedByA = await SharedEventEntity.findOne({
      where: { event_id: event.id, calendar_id: calendarA.id },
    });
    expect(sharedByA).not.toBeNull();
    expect(sharedByA!.auto_posted).toBe(true);
  });

  it('does not auto-repost when policy is disabled', async () => {
    // Create a new calendar D with a follower that has auto-repost disabled
    const accountsForD = new AccountsInterface(
      eventBus, new ConfigurationInterface(), new SetupInterface(), new EmailInterface(),
    );
    const accountD = await accountsForD.registerNewAccount('local-repost-d@pavillion.dev') as Account;
    await accountsForD.setPassword(accountD, 'testpassword');
    const calendarD = await calendarInterface.createCalendar(accountD, 'localrepostd');

    const actorD = await CalendarActorEntity.create({
      id: uuidv4(),
      actor_type: 'local',
      calendar_id: calendarD.id,
      actor_uri: `https://pavillion.dev/calendars/${calendarD.urlName}`,
    });

    // D follows C with auto-repost DISABLED
    await FollowingCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: actorC.id,
      calendar_id: calendarD.id,
      auto_repost_originals: false,
      auto_repost_reposts: false,
    });

    const event = await calendarInterface.createEvent(accountC, {
      calendarId: calendarC.id,
      content: { en: { name: 'No Repost Test', description: 'Should not repost' } },
      start_date: '2026-11-01',
      start_time: '10:00',
      end_date: '2026-11-01',
      end_time: '12:00',
    });

    await apInterface.performLocalAutoReposts(calendarC, event, true);

    // D should NOT have a SharedEventEntity
    const shared = await SharedEventEntity.findOne({
      where: { event_id: event.id, calendar_id: calendarD.id },
    });
    expect(shared).toBeNull();
  });

  it('prevents duplicate auto-reposts', async () => {
    const event = await calendarInterface.createEvent(accountC, {
      calendarId: calendarC.id,
      content: { en: { name: 'Duplicate Test', description: 'Test duplicate prevention' } },
      start_date: '2026-12-01',
      start_time: '10:00',
      end_date: '2026-12-01',
      end_time: '12:00',
    });

    // First call creates the repost
    await apInterface.performLocalAutoReposts(calendarC, event, true);

    const countBefore = await SharedEventEntity.count({
      where: { event_id: event.id, calendar_id: calendarB.id },
    });
    expect(countBefore).toBe(1);

    // Second call should skip (duplicate prevention)
    await apInterface.performLocalAutoReposts(calendarC, event, true);

    const countAfter = await SharedEventEntity.count({
      where: { event_id: event.id, calendar_id: calendarB.id },
    });
    expect(countAfter).toBe(1);
  });

  it('terminates safely with circular follow graphs', async () => {
    // Create a circular follow: B follows A with auto_repost_originals
    // (A already follows B from multi-hop test)
    const existingBFollowsA = await FollowingCalendarEntity.findOne({
      where: { calendar_actor_id: actorA.id, calendar_id: calendarB.id },
    });
    if (!existingBFollowsA) {
      await FollowingCalendarEntity.create({
        id: uuidv4(),
        calendar_actor_id: actorA.id,
        calendar_id: calendarB.id,
        auto_repost_originals: true,
        auto_repost_reposts: true,
      });
    }

    // A creates an event — the cycle A↔B should NOT cause an infinite loop
    const event = await calendarInterface.createEvent(accountA, {
      calendarId: calendarA.id,
      content: { en: { name: 'Cycle Test', description: 'Should not loop' } },
      start_date: '2027-01-01',
      start_time: '10:00',
      end_date: '2027-01-01',
      end_time: '12:00',
    });

    // Should complete without hanging or throwing
    await apInterface.performLocalAutoReposts(calendarA, event, true);

    // B should have the repost (B follows A with auto_repost_originals)
    const sharedByB = await SharedEventEntity.findOne({
      where: { event_id: event.id, calendar_id: calendarB.id },
    });
    expect(sharedByB).not.toBeNull();

    // Exactly 1 share: B gets the repost, but A is already visited (source)
    // so the cycle terminates without creating additional shares
    const totalShares = await SharedEventEntity.count({
      where: { event_id: event.id },
    });
    expect(totalShares).toBe(1);
  });
});
