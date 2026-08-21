import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import db from '@/server/common/entity/db';
import { emitAfterTx } from '@/server/common/helper/emit-after-tx';

/**
 * Direct tests of the deferral helper.
 *
 * These run in the integration tier because a stubbed transaction cannot roll
 * back: the whole point of the helper is that `afterCommit` never fires on a
 * rollback, which only a real transaction demonstrates. A probe event name
 * keeps any real domain listener out of the assertions.
 *
 * Helper-level tests are blind to a call site that emits on the bus directly
 * and skips the helper entirely, so each caller keeps its own call-site test —
 * see funding/test/integration/allocation_transactions.test.ts.
 */
describe('emitAfterTx', () => {
  const PROBE_EVENT = 'common:test:probe';
  let eventBus: EventEmitter;

  beforeEach(async () => {
    await db.sync({ force: true });
    eventBus = new EventEmitter();
  });

  it('should not emit when the enclosing transaction rolls back', async () => {
    const received: unknown[] = [];
    eventBus.on(PROBE_EVENT, (payload) => received.push(payload));

    await expect(
      db.transaction(async (tx) => {
        emitAfterTx(eventBus, PROBE_EVENT, { probe: true }, tx);
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');

    // Give a deferred emit the macrotask tick it would have used
    await new Promise((resolve) => setImmediate(resolve));

    expect(received).toHaveLength(0);
  });

  it('should emit after the enclosing transaction commits, not before', async () => {
    const received: unknown[] = [];
    eventBus.on(PROBE_EVENT, (payload) => received.push(payload));

    await db.transaction(async (tx) => {
      emitAfterTx(eventBus, PROBE_EVENT, { probe: true }, tx);
      // Still inside the transaction: nothing may have fired yet
      expect(received).toHaveLength(0);
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(received).toEqual([{ probe: true }]);
  });

  it('should emit synchronously when there is no transaction', async () => {
    const received: unknown[] = [];
    eventBus.on(PROBE_EVENT, (payload) => received.push(payload));

    emitAfterTx(eventBus, PROBE_EVENT, { probe: true });

    expect(received).toEqual([{ probe: true }]);
  });
});
