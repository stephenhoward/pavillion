/**
 * Public-outbox membership (DEC-024), end to end.
 *
 * The case table in test/helper/public-outbox-activity.test.ts pins the rule
 * on hand-built messages. These tests pin what the table cannot show: that the
 * activities the product actually emits come out public, that addToOutbox
 * stores the verdict, and that readOutbox pages and counts the same set.
 *
 * Nothing listens on the event buses here, so every row stays as the test
 * leaves it until the test marks or reads it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import config from 'config';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import EmailInterface from '@/server/email/interface';
import HousekeepingInterface from '@/server/housekeeping/interface';
import ActivityPubInterface from '@/server/activitypub/interface';
import ActivityPubEventHandlers from '@/server/activitypub/events';
import ActivityPubService from '@/server/activitypub/service/server';
import { addToOutbox } from '@/server/activitypub/helper/outbox';
import { ActivityPubActivity, ActivityPubActor } from '@/server/activitypub/model/base';
import CreateActivity from '@/server/activitypub/model/action/create';
import UpdateActivity from '@/server/activitypub/model/action/update';
import { EventObject } from '@/server/activitypub/model/object/event';
import { ActivityPubOutboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { waitFor } from '@/server/common/test/lib/test_polling';

const DOMAIN = config.get<string>('domain');

/** Creates a bare local calendar row; readOutbox needs nothing more. */
async function createBareCalendar(urlName: string): Promise<Calendar> {
  const calendar = new Calendar(uuidv4(), urlName);
  await CalendarEntity.create({ id: calendar.id, url_name: urlName, account_id: uuidv4(), languages: 'en' });
  return calendar;
}

/** An activity by `actor` about `slug`, addressed publicly unless `addressed` is false. */
function eventActivity(type: 'Create' | 'Update', actor: string, slug: string, addressed: boolean = true): ActivityPubActivity {
  const build = type === 'Create' ? CreateActivity : UpdateActivity;
  const activity = build.fromObject({
    actor,
    object: { id: `${actor}/events/${slug}`, type: 'Event', attributedTo: actor },
  });
  if (!activity) {
    throw new Error('fixture: activity did not parse');
  }
  return addressed ? activity.addressPublic(`${actor}/followers`) : activity;
}

/** Writes `activity` through addToOutbox and returns the stored row. */
async function writeRow(calendar: Calendar, activity: ActivityPubActivity): Promise<ActivityPubOutboxMessageEntity> {
  await addToOutbox(new EventEmitter(), calendar, activity);
  const row = await ActivityPubOutboxMessageEntity.findByPk(activity.id);
  if (!row) {
    throw new Error(`fixture: outbox row ${activity.id} was not written`);
  }
  return row;
}

function outboxReader(): ActivityPubService {
  const eventBus = new EventEmitter();
  return new ActivityPubService(eventBus, new CalendarInterface(eventBus), new AccountsInterface());
}

describe('Public-outbox membership', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  describe('real emitters', () => {
    let accountsInterface: AccountsInterface;
    let calendarInterface: CalendarInterface;
    let apInterface: ActivityPubInterface;
    let handlers: ActivityPubEventHandlers;

    beforeAll(async () => {
      const eventBus = new EventEmitter();
      const configurationInterface = new ConfigurationInterface();
      await configurationInterface.setSetting('registrationMode', 'open');
      accountsInterface = new AccountsInterface(eventBus, configurationInterface, new SetupInterface(), new EmailInterface());
      calendarInterface = new CalendarInterface(eventBus, accountsInterface, configurationInterface);
      apInterface = new ActivityPubInterface(eventBus, calendarInterface, accountsInterface);
      // Constructed, not installed: the test calls each handler itself.
      handlers = new ActivityPubEventHandlers(
        apInterface,
        calendarInterface,
        { publishJob: async () => {} } as unknown as HousekeepingInterface,
      );
    });

    it('writes every Create, Update, Delete and share of a local event as public', async () => {
      const owner = await accountsInterface.registerNewAccount('membership-owner@pavillion.dev') as Account;
      const origin = await calendarInterface.createCalendar(owner, 'membershiporigin');
      const sharer = await accountsInterface.registerNewAccount('membership-sharer@pavillion.dev') as Account;
      const reposter = await calendarInterface.createCalendar(sharer, 'membershipreposter');

      const event = await calendarInterface.createEvent(owner, {
        calendarId: origin.id,
        content: { en: { name: 'membership', description: 'emitted through the real handlers' } },
        start_date: '2026-05-08',
        start_time: '18:00',
        end_date: '2026-05-08',
        end_time: '20:00',
      });

      const emit = handlers as unknown as Record<string, (payload: unknown) => Promise<void>>;
      await emit.handleEventCreated({ calendar: origin, event });
      await emit.handleEventUpdated({ calendar: origin, event });
      await apInterface.shareEvent(sharer, reposter, EventObject.eventUrl(origin, event));
      await emit.handleEventDeleted({ calendar: origin, event });

      // shareEvent does not await its outbox write.
      const share = await waitFor(
        async () => ActivityPubOutboxMessageEntity.findOne({ where: { calendar_id: reposter.id, type: 'Announce' } }),
        { label: 'reposter Announce row' },
      );
      const originRows = await ActivityPubOutboxMessageEntity.findAll({ where: { calendar_id: origin.id } });

      // Create, Update and Delete, each paired with its Note twin.
      expect(originRows.map(row => row.type).sort()).toEqual(['Create', 'Create', 'Delete', 'Delete', 'Update', 'Update']);
      for (const row of [...originRows, share]) {
        expect(row.is_public, `${row.type} ${row.id} must be public`).toBe(true);
      }
    });
  });

  describe('addToOutbox', () => {
    it('stores a served type with no addressing as not public', async () => {
      const calendar = await createBareCalendar('membershipunaddressed');
      const actor = ActivityPubActor.actorUrl(calendar);

      const unaddressed = await writeRow(calendar, eventActivity('Create', actor, 'unaddressed', false));
      await unaddressed.update({ processed_time: new Date(), processed_status: 'ok' });

      expect(unaddressed.is_public).toBe(false);
      const { items, totalItems } = await outboxReader().readOutbox(calendar.id);
      expect(items).toEqual([]);
      expect(totalItems).toBe(0);
    });

    it('does not serve another local calendar\'s public activity anchored on this calendar', async () => {
      const calendar = await createBareCalendar('membershipanchor');
      const other = await createBareCalendar('membershipother');
      const ownActor = ActivityPubActor.actorUrl(calendar);
      const otherActor = ActivityPubActor.actorUrl(other);

      const own = eventActivity('Create', ownActor, 'own');
      await (await writeRow(calendar, own)).update({ processed_time: new Date(), processed_status: 'ok' });
      const foreign = await writeRow(calendar, eventActivity('Create', otherActor, 'foreign'));
      await foreign.update({ processed_time: new Date(), processed_status: 'ok' });

      expect(foreign.is_public).toBe(false);
      const { items, totalItems } = await outboxReader().readOutbox(calendar.id);
      expect(items.map(item => item.id)).toEqual([own.id]);
      expect(totalItems).toBe(1);
    });

    it('stores a user actor\'s activity addressed as:Public as not public and does not serve it', async () => {
      const calendar = await createBareCalendar('membershipuserpublic');
      const userActor = `https://${DOMAIN}/users/publiceditor`;

      const row = await writeRow(calendar, eventActivity('Update', userActor, 'user-public'));
      await row.update({ processed_time: new Date(), processed_status: 'ok' });

      expect((row.message as Record<string, unknown>).to, 'fixture: addressed as:Public').toEqual(['https://www.w3.org/ns/activitystreams#Public']);
      expect(row.is_public).toBe(false);
      const { items, totalItems } = await outboxReader().readOutbox(calendar.id);
      expect(items).toEqual([]);
      expect(totalItems).toBe(0);
    });

    it('keeps a user-actor row in ap_outbox while not serving it', async () => {
      const calendar = await createBareCalendar('membershipretained');
      const userActor = `https://${DOMAIN}/users/editor`;
      const update = UpdateActivity.fromObject({
        type: 'Update',
        id: `https://${DOMAIN}/activities/${uuidv4()}`,
        actor: userActor,
        to: ['https://peer.example/calendars/theirs'],
        object: { type: 'Event', id: `https://${DOMAIN}/events/${uuidv4()}`, attributedTo: userActor },
      });
      if (!update) {
        throw new Error('fixture: Update did not parse');
      }
      await (await writeRow(calendar, update)).update({ processed_time: new Date(), processed_status: 'ok' });

      const { totalItems } = await outboxReader().readOutbox(calendar.id);
      expect(totalItems).toBe(0);
      const stored = await ActivityPubOutboxMessageEntity.findByPk(update.id);
      expect(stored).not.toBeNull();
      expect(stored!.is_public).toBe(false);
    });
  });

  describe('readOutbox status filter', () => {
    it('does not serve a processed row whose processed_status is NULL', async () => {
      const calendar = await createBareCalendar('membershipnullstatus');
      const actor = ActivityPubActor.actorUrl(calendar);

      const served = eventActivity('Create', actor, 'served');
      await (await writeRow(calendar, served)).update({ processed_time: new Date(), processed_status: 'ok' });
      const nullStatus = await writeRow(calendar, eventActivity('Create', actor, 'null-status'));
      await nullStatus.update({ processed_time: new Date(), processed_status: null });

      expect(nullStatus.is_public, 'fixture: the row is public').toBe(true);
      const { items, totalItems } = await outboxReader().readOutbox(calendar.id);
      expect(items.map(item => item.id)).toEqual([served.id]);
      expect(totalItems).toBe(1);
    });
  });

  describe('readOutbox paging', () => {
    it('serves the same set it counts, across page boundaries', async () => {
      const calendar = await createBareCalendar('membershippaging');
      const actor = ActivityPubActor.actorUrl(calendar);
      const userActor = `https://${DOMAIN}/users/pager`;
      const served: string[] = [];
      let clock = Date.parse('2026-02-01T00:00:00Z');

      async function row(activity: ActivityPubActivity, status: string | null, expectServed: boolean): Promise<void> {
        const stored = await writeRow(calendar, activity);
        clock += 1000;
        await stored.update({
          message_time: new Date(clock),
          processed_time: status === null ? null : new Date(clock),
          processed_status: status,
        });
        if (expectServed) {
          served.push(activity.id);
        }
      }

      for (let i = 0; i < 9; i++) {
        await row(eventActivity('Create', actor, `ok-${i}`), 'ok', true);
        await row(eventActivity('Update', actor, `partial-${i}`), 'partial: Failed to deliver to https://peer.example/calendars/gone: timeout', true);
        await row(eventActivity('Update', userActor, `user-${i}`), 'ok', false);
      }
      await row(eventActivity('Create', actor, 'skipped'), 'skipped: superseded', true);
      await row(eventActivity('Create', actor, 'errored'), 'error: Failed to parse Create activity', false);
      await row(eventActivity('Create', actor, 'bad-type'), 'bad message type', false);
      await row(eventActivity('Create', actor, 'unprocessed'), null, false);
      await row(eventActivity('Create', actor, 'unaddressed', false), 'ok', false);

      const reader = outboxReader();
      const pageSize = 4;
      const walked: string[] = [];
      const counts = new Set<number>();
      let cursor: Date | undefined;
      for (;;) {
        const { items, totalItems } = await reader.readOutbox(calendar.id, cursor, pageSize);
        counts.add(totalItems);
        walked.push(...items.map(item => item.id));
        if (items.length < pageSize) {
          break;
        }
        cursor = items[items.length - 1].message_time;
      }

      expect(served.length, 'fixture: more served rows than one page').toBeGreaterThan(pageSize);
      expect(walked.sort()).toEqual([...served].sort());
      expect([...counts]).toEqual([served.length]);
    });
  });
});
