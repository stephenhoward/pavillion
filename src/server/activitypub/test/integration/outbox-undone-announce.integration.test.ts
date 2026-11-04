/**
 * The public outbox must not keep serving a repost the calendar withdrew.
 * Undo itself is not a public outbox type, so without a filter an undone
 * Announce stays in the collection and a backfilling peer shows it.
 * The rows are written the way shareEvent / unshareEvent write them: an
 * Announce, then an Undo whose `object` is the Announce's AP id.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import EmailInterface from '@/server/email/interface';
import ActivityPubService from '@/server/activitypub/service/server';
import { ActivityPubActor, ActivityPubActivity } from '@/server/activitypub/model/base';
import AnnounceActivity from '@/server/activitypub/model/action/announce';
import UndoActivity from '@/server/activitypub/model/action/undo';
import { ActivityPubOutboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

describe('readOutbox and undone reposts', () => {
  let env: TestEnvironment;
  let calendar: Calendar;
  let service: ActivityPubService;
  let undoneAnnounce: AnnounceActivity;
  let keptAnnounce: AnnounceActivity;

  let clock = Date.parse('2026-01-01T00:00:00Z');

  async function writeOutboxRow(activity: ActivityPubActivity) {
    clock += 60_000;
    await ActivityPubOutboxMessageEntity.create({
      id: activity.id,
      type: activity.type,
      calendar_id: calendar.id,
      message_time: new Date(clock),
      message: activity.toObject(),
      processed_status: 'ok',
    });
  }

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    await configurationInterface.setSetting('registrationMode', 'open');
    const accountsInterface = new AccountsInterface(
      eventBus, configurationInterface, new SetupInterface(), new EmailInterface(),
    );
    const calendarInterface = new CalendarInterface(eventBus, accountsInterface, configurationInterface);

    const account = await accountsInterface.registerNewAccount('outbox-undo@pavillion.dev') as Account;
    calendar = await calendarInterface.createCalendar(account, 'outboxundocal');
    service = new ActivityPubService(eventBus, calendarInterface, accountsInterface);

    const actorUrl = ActivityPubActor.actorUrl(calendar);
    undoneAnnounce = new AnnounceActivity(actorUrl, 'https://remote.example/events/undone');
    keptAnnounce = new AnnounceActivity(actorUrl, 'https://remote.example/events/kept');

    await writeOutboxRow(keptAnnounce);
    await writeOutboxRow(undoneAnnounce);
    await writeOutboxRow(new UndoActivity(actorUrl, undoneAnnounce.id));
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it('omits an Announce that has a local Undo and keeps one that does not', async () => {
    const { items, totalItems } = await service.readOutbox(calendar.id);

    const ids = items.map(item => item.id);
    expect(ids).toEqual([keptAnnounce.id]);
    expect(totalItems).toBe(1);
  });

  it('keeps totalItems consistent with the served items across pages', async () => {
    const first = await service.readOutbox(calendar.id, undefined, 1);
    expect(first.items.map(item => item.id)).toEqual([keptAnnounce.id]);
    expect(first.totalItems).toBe(1);

    const next = await service.readOutbox(calendar.id, first.items[0].message_time, 1);
    expect(next.items).toEqual([]);
    expect(next.totalItems).toBe(1);
  });
});
