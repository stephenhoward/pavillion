/**
 * The unprocessed-activity backlog read by the metrics endpoint, against real
 * inbox and outbox rows: processed rows are excluded, and each direction
 * reports its oldest row by the column its drain orders on.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import ActivityPubInterface from '@/server/activitypub/interface';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import EmailInterface from '@/server/email/interface';
import { ActivityPubInboxMessageEntity, ActivityPubOutboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

describe('ActivityPubInterface.getUnprocessedActivityStats (integration)', () => {
  let env: TestEnvironment;
  let activityPub: ActivityPubInterface;
  let calendarId: string;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    const configuration = new ConfigurationInterface();
    const accounts = new AccountsInterface(eventBus, configuration, new SetupInterface(configuration), new EmailInterface());
    activityPub = new ActivityPubInterface(eventBus, new CalendarInterface(eventBus, accounts), accounts);

    calendarId = uuidv4();
    await CalendarEntity.create({ id: calendarId, url_name: 'backlog_cal', account_id: uuidv4(), languages: 'en' });
  });

  beforeEach(async () => {
    await ActivityPubInboxMessageEntity.destroy({ where: {} });
    await ActivityPubOutboxMessageEntity.destroy({ where: {} });
  });

  afterAll(async () => {
    await env.cleanup();
  });

  function inboxRow(fields: Record<string, unknown>) {
    const id = uuidv4();
    return ActivityPubInboxMessageEntity.create({
      id, type: 'Create', message_time: new Date(), message: { id }, calendar_id: calendarId, ...fields,
    });
  }

  function outboxRow(fields: Record<string, unknown>) {
    const id = uuidv4();
    return ActivityPubOutboxMessageEntity.create({
      id, type: 'Create', message_time: new Date(), message: { id }, calendar_id: calendarId, ...fields,
    });
  }

  it('reports zero and no oldest time when nothing is waiting', async () => {
    expect(await activityPub.getUnprocessedActivityStats()).toEqual([
      { direction: 'inbound', count: 0, oldestStoredAt: null },
      { direction: 'outbound', count: 0, oldestStoredAt: null },
    ]);
  });

  it('counts only unprocessed rows', async () => {
    await inboxRow({});
    await inboxRow({});
    await inboxRow({ processed_time: new Date(), processed_status: 'ok' });
    await outboxRow({});
    await outboxRow({ processed_time: new Date(), processed_status: 'ok' });

    const stats = await activityPub.getUnprocessedActivityStats();

    expect(stats.find((s) => s.direction === 'inbound')!.count).toBe(2);
    expect(stats.find((s) => s.direction === 'outbound')!.count).toBe(1);
  });

  it('dates the oldest inbound row by when it was stored, not its message_time', async () => {
    const storedAt = new Date('2026-11-10T12:00:00.000Z');
    // A sender-supplied time two years back must not read as the backlog age.
    await inboxRow({ message_time: new Date('2024-11-10T12:00:00.000Z'), createdAt: storedAt });
    await inboxRow({ message_time: new Date('2026-11-13T12:00:00.000Z'), createdAt: new Date('2026-11-13T12:00:00.000Z') });

    const inbound = (await activityPub.getUnprocessedActivityStats()).find((s) => s.direction === 'inbound')!;

    expect(inbound.oldestStoredAt?.toISOString()).toBe(storedAt.toISOString());
  });

  it('dates the oldest outbound row by message_time, ignoring processed rows', async () => {
    await outboxRow({ message_time: new Date('2026-11-01T00:00:00.000Z'), processed_time: new Date(), processed_status: 'ok' });
    await outboxRow({ message_time: new Date('2026-11-12T00:00:00.000Z') });
    await outboxRow({ message_time: new Date('2026-11-13T00:00:00.000Z') });

    const outbound = (await activityPub.getUnprocessedActivityStats()).find((s) => s.direction === 'outbound')!;

    expect(outbound.oldestStoredAt?.toISOString()).toBe('2026-11-12T00:00:00.000Z');
  });
});
