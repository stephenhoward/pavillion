/**
 * The web process drains rows left unprocessed by an earlier run.
 *
 * A row the worker wrote (backfill), or one whose live dispatch was cut off by
 * a restart, has `processed_time: null` and no `inboxMessageAdded` emit left
 * to deliver it. The startup drain is what dispatches it. The row here is
 * written before the domain exists, then a fresh ActivityPubDomain is wired
 * as the web process wires it and its drain is started.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

import ActivityPubDomain from '@/server/activitypub';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import HousekeepingInterface from '@/server/housekeeping/interface';
import { ActivityPubInboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { waitFor } from '@/server/common/test/helpers/emit-and-settle';

describe('ActivityPubDomain startup inbox drain (integration)', () => {
  let env: TestEnvironment;
  let stopDrain: (() => void) | undefined;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();
  });

  afterEach(() => {
    stopDrain?.();
    stopDrain = undefined;
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it('dispatches a row left unprocessed before the web process started', async () => {
    const calendarId = uuidv4();
    await CalendarEntity.create({
      id: calendarId,
      url_name: 'drainstartup',
      account_id: uuidv4(),
      languages: 'en',
    });

    // Left over from before the start: no live emit will ever deliver it.
    const rowId = 'https://remote.example/activities/left-over-ignore';
    await ActivityPubInboxMessageEntity.create({
      id: rowId,
      type: 'Ignore',
      message_time: new Date(),
      message: {
        id: rowId,
        type: 'Ignore',
        actor: 'https://remote.example/calendars/remote',
        object: 'https://pavillion.dev/activities/some-join',
      },
      calendar_id: calendarId,
    });

    const eventBus = new EventEmitter();
    const domain = new ActivityPubDomain(
      eventBus,
      new CalendarInterface(eventBus),
      new AccountsInterface(),
      { publishJob: async () => {} } as unknown as HousekeepingInterface,
    );
    domain.installEventHandlers();
    stopDrain = domain.startInboxDrain();

    const row = await waitFor(async () => {
      const found = await ActivityPubInboxMessageEntity.findByPk(rowId);
      return found?.processed_time ? found : null;
    });

    expect(row.processed_status).toBe('ok');
  });
});
