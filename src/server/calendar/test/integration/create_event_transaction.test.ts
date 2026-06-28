import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import EventService from '@/server/calendar/service/events';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { EventEntity } from '@/server/calendar/entity/event';
import db from '@/server/common/entity/db';

/**
 * Integration tests for transaction-aware event bus emits in
 * EventService.createEvent (pv-5cur).
 *
 * Background: when EventService.createEvent runs inside a caller-supplied
 * `db.transaction`, emitting `eventCreated` synchronously schedules the
 * async `buildEventInstances` listener inside the still-open transaction's
 * CLS context. The listener's nested `EventInstanceEntity.save()` inherits
 * the (about-to-commit or already-committed) transaction and races/throws
 * "commit has been called on this transaction" once the outer `db.transaction`
 * commits.
 *
 * Fix: when `tx` is supplied, defer the emit via
 * `tx.afterCommit(() => setImmediate(emit))`. The setImmediate hop is
 * required to escape Sequelize's CLS context — without it the listener's
 * async body still binds the just-committed transaction.
 *
 * The identical fix is applied to updateEvent (4 emit sites total across
 * the two methods), so these tests also exercise updateEvent's deferred
 * eventUpdated emit for parity.
 *
 * These tests prove:
 *   1. Inside a successful db.transaction, the eventCreated listener
 *      observes a row that is queryable from a fresh connection (i.e. it
 *      ran AFTER the outer transaction committed).
 *   2. Inside a successful db.transaction, the eventUpdated listener
 *      observes the mutated column from a fresh connection (i.e. it ran
 *      AFTER the outer transaction committed).
 *   3. Inside a db.transaction that throws and rolls back, the
 *      eventCreated listener is NEVER invoked.
 */
describe('EventService create/update — transaction-aware emit (integration)', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let eventService: EventService;
  let testAccount: Account;
  let testCalendar: Calendar;
  let eventBus: EventEmitter;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);

    // Minimal AP interface stub: integration tests here do not wire the AP
    // domain, so we return shapes that keep local-only code paths correct.
    calendarInterface.setActivityPubInterface({
      getSharedEventStatusMap: async () => new Map(),
      findCalendarActorByCalendarId: async () => null,
    } as never);

    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    const info = await accountService._setupAccount('txdefer@pavillion.dev', 'testpassword');
    testAccount = info.account;
    testCalendar = await calendarInterface.createCalendar(testAccount, 'txdefercalendar');

    // The interface keeps EventService private — pierce it for these tests
    // because the bug under test is only reachable when callers supply a
    // transaction to createEvent, and the public CalendarInterface.createEvent
    // does not expose `tx`. This is the same access pattern import_sync.test.ts
    // uses to drive EventService.createEvent in integration scope.
    eventService = (calendarInterface as unknown as {
      eventService: EventService;
    }).eventService;
  });

  afterAll(async () => {
    if (eventBus) {
      eventBus.removeAllListeners();
    }
    await env.cleanup();
  });

  it('defers eventCreated until after commit and the listener observes the persisted row', async () => {
    // Capture every eventCreated payload. We assert the listener fires after
    // db.transaction resolves, AND we re-fetch the row from a fresh entity
    // query inside the listener to prove the transaction has committed.
    const observedRows: { eventId: string; rowVisible: boolean }[] = [];

    const listener = async (payload: { event: { id: string } }) => {
      // Query without passing a transaction. If the outer db.transaction has
      // truly committed, this finds the row. If the emit fired inside the
      // still-open outer transaction (the bug), this sees nothing because
      // the implicit non-transactional read is isolated from the open tx.
      const row = await EventEntity.findOne({ where: { id: payload.event.id } });
      observedRows.push({ eventId: payload.event.id, rowVisible: row !== null });
    };
    eventBus.on('eventCreated', listener);

    let createdEventId: string | null = null;
    try {
      await db.transaction(async (tx) => {
        const event = await eventService.createEvent(
          testAccount,
          {
            calendarId: testCalendar.id,
            content: { en: { name: 'Tx-deferred event', description: 'in tx' } },
          },
          undefined,
          tx,
        );
        createdEventId = event.id;
        // Inside the open transaction the bus must NOT have emitted yet.
        expect(observedRows).toHaveLength(0);
      });

      // After commit, drain the microtask + setImmediate queue so the
      // afterCommit -> setImmediate -> listener chain has a chance to run.
      await new Promise(resolve => setImmediate(resolve));
      // Yield once more for the async listener body to settle.
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(createdEventId).not.toBeNull();
      expect(observedRows).toHaveLength(1);
      expect(observedRows[0].eventId).toBe(createdEventId);
      // The listener saw the row, proving the transaction had committed
      // before the emit reached it.
      expect(observedRows[0].rowVisible).toBe(true);
    }
    finally {
      eventBus.off('eventCreated', listener);
    }
  });

  it('defers eventUpdated until after commit and the listener observes the updated row', async () => {
    // The same tx-deferred emit pattern is applied to updateEvent (pv-5cur).
    // Seed an event outside any transaction, then update it inside a
    // db.transaction and prove the eventUpdated emit fires only AFTER the
    // outer transaction commits — verified by re-reading the row's mutated
    // column from a fresh, non-transactional query inside the listener.
    const seeded = await eventService.createEvent(
      testAccount,
      {
        calendarId: testCalendar.id,
        content: { en: { name: 'Pre-update event', description: 'before update' } },
      },
    );

    // external_url lives directly on the event row, so its committed value is
    // a reliable signal that the outer transaction has landed.
    const NEW_URL = 'https://example.com/tx-deferred-update';

    const observedRows: { eventId: string; externalUrl: string | null }[] = [];

    const listener = async (payload: { event: { id: string } }) => {
      // Non-transactional read. If the outer db.transaction has truly
      // committed, this sees the updated external_url. If the emit fired
      // inside the still-open outer transaction (the bug), this read is
      // isolated from the uncommitted write and sees the old (null) value.
      const row = await EventEntity.findOne({ where: { id: payload.event.id } });
      observedRows.push({ eventId: payload.event.id, externalUrl: row?.external_url ?? null });
    };
    eventBus.on('eventUpdated', listener);

    try {
      await db.transaction(async (tx) => {
        const updated = await eventService.updateEvent(
          testAccount,
          seeded.id,
          { externalUrl: NEW_URL, urlPrompt: 'more_info' },
          undefined,
          tx,
        );
        expect(updated.externalUrl).toBe(NEW_URL);
        // Inside the open transaction the bus must NOT have emitted yet.
        expect(observedRows).toHaveLength(0);
      });

      // After commit, drain the microtask + setImmediate queue so the
      // afterCommit -> setImmediate -> listener chain has a chance to run.
      await new Promise(resolve => setImmediate(resolve));
      // Yield once more for the async listener body to settle.
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(observedRows).toHaveLength(1);
      expect(observedRows[0].eventId).toBe(seeded.id);
      // The listener saw the committed external_url, proving the transaction
      // had committed before the emit reached it.
      expect(observedRows[0].externalUrl).toBe(NEW_URL);
    }
    finally {
      eventBus.off('eventUpdated', listener);
    }
  });

  it('does NOT emit eventCreated when the surrounding transaction rolls back', async () => {
    const observed: string[] = [];
    const listener = (payload: { event: { id: string } }) => {
      observed.push(payload.event.id);
    };
    eventBus.on('eventCreated', listener);

    const ROLLBACK = new Error('intentional rollback');

    try {
      await expect(
        db.transaction(async (tx) => {
          await eventService.createEvent(
            testAccount,
            {
              calendarId: testCalendar.id,
              content: { en: { name: 'Should be rolled back', description: 'never persisted' } },
            },
            undefined,
            tx,
          );
          // Force the outer transaction to roll back. tx.afterCommit must
          // therefore never fire, so the listener must not be invoked.
          throw ROLLBACK;
        }),
      ).rejects.toBe(ROLLBACK);

      // Drain microtask + setImmediate queues to make sure no late callback
      // sneaks in after we observe the count.
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(observed).toHaveLength(0);
    }
    finally {
      eventBus.off('eventCreated', listener);
    }
  });
});
