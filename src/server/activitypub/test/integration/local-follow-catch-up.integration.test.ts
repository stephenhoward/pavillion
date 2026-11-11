/**
 * A follow of a calendar on the same instance brings in the followed
 * calendar's existing events.
 *
 * The followed calendar's Accept reaches the follower by local dispatch. The
 * follower then replays the followed calendar's served outbox (the set a
 * remote follower's backfill would walk) through the same local-dispatch path
 * that delivers live activities, so auto-repost, category mapping and the
 * dismissal guard apply to existing events exactly as they do to new ones.
 * Auto-repost skips an event that has already ended.
 *
 * Runs the real follow: `followCalendar` writes the Follow to the follower's
 * outbox, the followed calendar accepts it, and the Accept comes back, all in
 * process. Nothing is stubbed between the follow and the reposts.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import { DateTime } from 'luxon';
import config from 'config';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { EventCategory } from '@/common/model/event_category';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import EmailInterface from '@/server/email/interface';
import ActivityPubInterface from '@/server/activitypub/interface';
import ActivityPubEventHandlers from '@/server/activitypub/events';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { CalendarActorEntity } from '@/server/activitypub/entity/calendar_actor';
import {
  ActivityPubOutboxMessageEntity,
  FollowingCalendarEntity,
  RepostDismissalEntity,
  SharedEventEntity,
} from '@/server/activitypub/entity/activitypub';
import { waitFor, waitForStableCount } from '@/server/common/test/lib/test_polling';

describe('Same-instance follow brings in existing events', () => {
  let env: TestEnvironment;
  let eventBus: EventEmitter;
  let accountsInterface: AccountsInterface;
  let calendarInterface: CalendarInterface;
  let apInterface: ActivityPubInterface;
  let publishJob: sinon.SinonStub;

  // A fresh organizer, events and follower per test. Replaying an activity to
  // a calendar that already processed it is a no-op by design, and a second
  // local recipient of one activity collides with the first on the ap_inbox
  // key (see the skipped test below), so shared calendars would carry one
  // test's deliveries into the next.
  let organizerAccount: Account;
  let organizer: Calendar;
  let organizerCategory: EventCategory;
  let pastEvent: CalendarEvent;
  let upcomingEvent: CalendarEvent;
  let weeklyEvent: CalendarEvent;
  let curatorAccount: Account;
  let curator: Calendar;
  let testCount = 0;

  const domain = config.get<string>('domain');

  /** Waits until no outbox row is left unprocessed, so every cascade has run. */
  async function settle(): Promise<void> {
    await waitForStableCount(
      async () => ActivityPubOutboxMessageEntity.count({ where: { processed_time: null } }),
      { stableForMs: 300, label: 'outbox drain' },
    );
  }

  async function sharesOf(calendar: Calendar): Promise<string[]> {
    const rows = await SharedEventEntity.findAll({ where: { calendar_id: calendar.id } });
    return rows.map(row => row.event_id).sort();
  }

  async function follow(autoRepostOriginals: boolean): Promise<void> {
    await apInterface.followCalendar(curatorAccount, curator, `${organizer.urlName}@${domain}`, autoRepostOriginals, false);
    await waitFor(
      async () => FollowingCalendarEntity.findOne({ where: { calendar_id: curator.id } }),
      { label: 'following row' },
    );
    await settle();
  }

  async function unfollow(): Promise<void> {
    await apInterface.unfollowCalendar(curatorAccount, curator, `${organizer.urlName}@${domain}`);
    await settle();
  }

  /** A two-hour event starting at `start`; `recurrence` makes it repeat. */
  function eventParams(start: DateTime, recurrence: Record<string, unknown> = {}) {
    return {
      calendarId: organizer.id,
      content: { en: { name: `Event at ${start.toISO()}`, description: '' } },
      schedules: [{
        start: start.toISO(),
        eventEndTime: start.plus({ hours: 2 }).toISO(),
        timezone: start.zoneName,
        ...recurrence,
      }],
    };
  }

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    await configurationInterface.setSetting('registrationMode', 'open');
    accountsInterface = new AccountsInterface(eventBus, configurationInterface, new SetupInterface(configurationInterface), new EmailInterface());
    calendarInterface = new CalendarInterface(eventBus, accountsInterface);
    apInterface = new ActivityPubInterface(eventBus, calendarInterface, accountsInterface);
    calendarInterface.setActivityPubInterface(apInterface);
    publishJob = sinon.stub().resolves();
    new ActivityPubEventHandlers(apInterface, calendarInterface, { publishJob } as any).install(eventBus);

    organizerAccount = await accountsInterface.registerNewAccount('local-follow-organizer@pavillion.dev') as Account;
    curatorAccount = await accountsInterface.registerNewAccount('local-follow-curator@pavillion.dev') as Account;
  });

  beforeEach(async () => {
    testCount++;
    organizer = await calendarInterface.createCalendar(organizerAccount, `localfolloworganizer${testCount}`);
    curator = await calendarInterface.createCalendar(curatorAccount, `localfollowcurator${testCount}`);
    organizerCategory = await calendarInterface.createCategory(organizerAccount, organizer.id, { name: 'Music', language: 'en' });

    const now = DateTime.now().startOf('minute');
    pastEvent = await calendarInterface.createEvent(organizerAccount, eventParams(now.minus({ months: 2 })));
    upcomingEvent = await calendarInterface.createEvent(organizerAccount, eventParams(now.plus({ months: 2 })));
    await settle();
    await calendarInterface.setCategoriesForEvent(organizerAccount, upcomingEvent.id, [organizerCategory.id]);
    // Began three weeks ago and still has occurrences ahead.
    const weeklyStart = now.minus({ weeks: 3 });
    weeklyEvent = await calendarInterface.createEvent(organizerAccount, eventParams(weeklyStart, {
      end: weeklyStart.plus({ weeks: 10 }).toISO(),
      frequency: 'weekly',
      interval: 1,
    }));
    await settle();
    publishJob.resetHistory();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it('auto-reposts existing events that have not ended, and not past ones', async () => {
    await follow(true);

    expect(await sharesOf(curator)).toEqual([upcomingEvent.id, weeklyEvent.id].sort());
    expect(await sharesOf(curator)).not.toContain(pastEvent.id);
    const upcomingShare = await SharedEventEntity.findOne({ where: { calendar_id: curator.id, event_id: upcomingEvent.id } });
    expect(upcomingShare?.auto_posted).toBe(true);
  });

  it('does not publish an HTTP backfill job for a same-instance follow', async () => {
    await follow(true);

    expect(publishJob.called).toBe(false);
  });

  it('reposts nothing when auto-repost of originals is off', async () => {
    await follow(false);

    expect(await sharesOf(curator)).toEqual([]);
  });

  it('makes no duplicate reposts when the follow is undone and made again', async () => {
    await follow(true);
    await unfollow();
    await follow(true);

    const rows = await SharedEventEntity.findAll({ where: { calendar_id: curator.id } });
    expect(rows.map(row => row.event_id).sort()).toEqual([upcomingEvent.id, weeklyEvent.id].sort());
  });

  it('honours a sticky unpost of an existing event', async () => {
    await RepostDismissalEntity.create({ event_id: upcomingEvent.id, calendar_id: curator.id });

    await follow(true);

    expect(await sharesOf(curator)).toEqual([weeklyEvent.id]);
  });

  it('applies category mappings saved after the follow to the reposted events', async () => {
    const curatorCategory = await calendarInterface.createCategory(curatorAccount, curator.id, { name: 'Concerts', language: 'en' });
    await follow(true);
    const organizerActor = await CalendarActorEntity.findOne({ where: { calendar_id: organizer.id, actor_type: 'local' } });

    await calendarInterface['categoryMappingService'].setMappings(curator.id, organizerActor!.id, [{
      sourceCategoryId: organizerCategory.id,
      sourceCategoryName: 'Music',
      localCategoryId: curatorCategory.id,
    }]);
    await calendarInterface['categoryMappingService'].applyMappingsToAutoReposts(curator.id, organizerActor!.id);

    const upcomingCategories = await calendarInterface.getEventCategories(upcomingEvent.id, curator.id);
    expect(upcomingCategories.map(category => category.id)).toEqual([curatorCategory.id]);
    const weeklyCategories = await calendarInterface.getEventCategories(weeklyEvent.id, curator.id);
    expect(weeklyCategories).toEqual([]);
  });

  // ap_inbox is keyed on the activity id alone, so a second local follower's
  // copy of an activity the first follower already received collides with
  // the first follower's row and is never dispatched, live or caught up.
  // Un-skip when the ap_inbox composite-key change lands.
  it.skip('catches up a second local follower of the same calendar', async () => {
    await follow(true);
    curator = await calendarInterface.createCalendar(curatorAccount, `localfollowcurator${testCount}b`);

    await follow(true);

    expect(await sharesOf(curator)).toEqual([upcomingEvent.id, weeklyEvent.id].sort());
  });
});
