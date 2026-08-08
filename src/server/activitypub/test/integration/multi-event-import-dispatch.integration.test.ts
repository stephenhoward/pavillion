/**
 * Regression gate: a multi-event ICS file import must not overlap the
 * post-commit ActivityPub domain-event handlers' transactions.
 *
 * `createSourceFromFile` imports every VEVENT inside ONE transaction and
 * emits one `eventCreated` per created event from that transaction's
 * `afterCommit`. Each `eventCreated` handler in ActivityPubEventHandlers
 * opens its own DB transaction (EventObjectEntity findOrCreate, then
 * addToOutbox → processOutboxMessage). On SQLite the process holds a single
 * shared connection that cannot BEGIN a second transaction while one is
 * open, so before the dispatch-serialization fix a file with ≥2 events fanned
 * out to overlapping handler transactions and crashed the process with an
 * unhandled `SQLITE_ERROR: cannot start a transaction within a transaction`.
 *
 * This test installs the real handlers and imports a two-event file, then
 * asserts BOTH events were fully dispatched — an EventObjectEntity row and an
 * outbox message per event. With the overlap bug one of each is missing (the
 * losing handler throws before writing); with serialized dispatch both land.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import axios from 'axios';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import EmailInterface from '@/server/email/interface';
import ActivityPubInterface from '@/server/activitypub/interface';
import ActivityPubEventHandlers from '@/server/activitypub/events';
import CalendarActorService from '@/server/activitypub/service/calendar_actor';
import { EventEntity } from '@/server/calendar/entity/event';
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';
import { ActivityPubOutboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { waitFor } from '@/server/common/test/lib/test_polling';

describe('Multi-event file import → ActivityPub dispatch (concurrent-transaction regression)', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let account: Account;
  let calendar: Calendar;
  let eventBus: EventEmitter;
  let sandbox: sinon.SinonSandbox;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const emailInterface = new EmailInterface();

    await configurationInterface.setSetting('registrationMode', 'open');

    const accountsInterface = new AccountsInterface(
      eventBus, configurationInterface, setupInterface, emailInterface,
    );
    calendarInterface = new CalendarInterface(eventBus, accountsInterface, configurationInterface);
    const apInterface = new ActivityPubInterface(eventBus, calendarInterface, accountsInterface);
    calendarInterface.setActivityPubInterface(apInterface);

    account = await accountsInterface.registerNewAccount('multi-import@pavillion.dev') as Account;
    await accountsInterface.setPassword(account, 'testpassword');
    calendar = await calendarInterface.createCalendar(account, 'multiimportcal');

    // Install the real ActivityPub handlers so imported events drive the
    // outbound dispatch path (the code that opens the overlapping transactions).
    new ActivityPubEventHandlers(
      apInterface, calendarInterface, { publishJob: async () => {} } as never,
    ).install(eventBus);
  });

  afterAll(async () => {
    if (eventBus) {
      eventBus.removeAllListeners();
    }
    await env.cleanup();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    // No remote followers here, so no HTTP delivery should occur — but stub the
    // network and signing defensively so a stray delivery can never reach out
    // or fail the run.
    sandbox.stub(CalendarActorService.prototype, 'signActivity').resolves({
      keyId: 'mock#main-key',
      signature: 'mock-signature',
      algorithm: 'rsa-sha256',
      headers: '(request-target) host date digest',
      date: new Date().toUTCString(),
    } as never);
    sandbox.stub(axios, 'post').resolves({ status: 202, data: {} } as never);
    sandbox.stub(axios, 'get').rejects(new Error('Stubbed: no network in test'));
  });

  afterEach(() => {
    sandbox.restore();
  });

  /** A single VCALENDAR carrying two distinct VEVENTs. */
  function twoEventIcs(): Buffer {
    const vevent = (uid: string, summary: string): string =>
      'BEGIN:VEVENT\r\n'
      + `UID:${uid}\r\n`
      + 'DTSTAMP:20260422T100000Z\r\n'
      + 'DTSTART:20260422T100000Z\r\n'
      + 'DTEND:20260422T110000Z\r\n'
      + `SUMMARY:${summary}\r\n`
      + 'END:VEVENT\r\n';
    return Buffer.from(
      'BEGIN:VCALENDAR\r\n'
      + 'VERSION:2.0\r\n'
      + 'PRODID:-//pavillion//test//EN\r\n'
      + vevent('multi-a@example.test', 'Multi Import Event A')
      + vevent('multi-b@example.test', 'Multi Import Event B')
      + 'END:VCALENDAR\r\n',
    );
  }

  it('dispatches every event of a two-event import without overlapping transactions', async () => {
    const { run } = await calendarInterface.createImportSourceFromFile(
      account, calendar.id, twoEventIcs(), 'multi.ics',
    );

    // The import transaction itself always commits both events regardless of the
    // dispatch bug — the crash happens afterwards, in the fan-out.
    expect(run.eventsCreated).toBe(2);

    const eventIds = (await EventEntity.findAll({ where: { calendar_id: calendar.id } }))
      .map(e => e.id);
    expect(eventIds).toHaveLength(2);

    // Both events' post-commit handlers must run to completion. Poll until both
    // AP objects AND both outbox messages exist: with the concurrent-transaction
    // crash one handler throws before writing its rows, so a count stays at 1.
    const objectCount = await waitFor(
      async () => {
        const c = await EventObjectEntity.count({ where: { event_id: eventIds } });
        return c === 2 ? c : null;
      },
      { maxWaitMs: 4000, label: 'both EventObjectEntity rows' },
    );
    expect(objectCount).toBe(2);

    const outboxCount = await waitFor(
      async () => {
        const c = await ActivityPubOutboxMessageEntity.count({ where: { calendar_id: calendar.id } });
        return c >= 2 ? c : null;
      },
      { maxWaitMs: 4000, label: 'both outbox messages' },
    );
    expect(outboxCount).toBeGreaterThanOrEqual(2);
  });
});
