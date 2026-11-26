import type { EventEmitter } from 'events';
import type { Transaction } from 'sequelize';

import { logError } from '@/server/common/helper/error-logger';
import type { HandlerOutcome } from '@/server/common/helper/guard-event-handler';

/**
 * Calls every listener registered for a domain event, as `emit` would, and
 * resolves once all of them have settled.
 *
 * `emit` discards what a listener returns, so it cannot tell an operation
 * whether its handlers succeeded. This calls the listeners directly and awaits
 * their promises instead. It reads `rawListeners` rather than `listeners` so a
 * `once` wrapper removes itself exactly as it would under `emit`, and calls
 * each with the bus as receiver and the payload as sole argument, as `emit`
 * does.
 *
 * A listener counts as failed when it throws synchronously, rejects, or
 * resolves `'failed'` (the {@link HandlerOutcome} a guarded handler reports
 * after logging its own failure). A throw or rejection means no guard caught
 * it, so it is logged here; a resolved `'failed'` is not logged again. Any
 * other resolved value counts as completed. Every listener runs and settles
 * even when an earlier one fails.
 *
 * @param eventBus - Bus whose listeners to invoke
 * @param event - Domain event name
 * @param payload - Event payload, handed to each listener unchanged
 * @returns true when every listener completed (including when there are none)
 */
export async function invokeListeners<T>(
  eventBus: EventEmitter,
  event: string,
  payload: T,
): Promise<boolean> {
  const settlements = await Promise.allSettled(
    eventBus.rawListeners(event).map((listener) => {
      // Called synchronously, in order, as emit calls them; a synchronous
      // throw becomes a rejection so it is counted rather than escaping.
      try {
        return Promise.resolve(listener.call(eventBus, payload));
      }
      catch (error) {
        return Promise.reject(error);
      }
    }),
  );

  let allCompleted = true;
  for (const settlement of settlements) {
    if (settlement.status === 'rejected') {
      logError(settlement.reason, '[Events] Unguarded domain-event listener failed');
      allCompleted = false;
    }
    else if (settlement.value === ('failed' satisfies HandlerOutcome)) {
      allCompleted = false;
    }
  }
  return allCompleted;
}

/**
 * Emits a domain event, deferring the emit until after the supplied
 * transaction commits when one is present.
 *
 * Listeners must never observe state that a later rollback erases, so an emit
 * raised inside a transaction is queued on `afterCommit`. The setImmediate hop
 * escapes Sequelize's CLS context — without it the listener's async body
 * inherits a scope still bound to the just-committed transaction, and
 * Sequelize's implicit transaction lookup picks it up, causing
 * "commit has been called on this transaction" errors.
 *
 * Without a transaction, the emit fires synchronously.
 *
 * Lives in `common/` rather than in either service because the calendar and
 * funding domains both need it and neither may import the other. It depends on
 * nothing beyond the bus and the transaction, so the bus is passed in rather
 * than captured.
 *
 * @param eventBus - Bus to emit on, supplied by the calling service
 * @param event - Domain event name
 * @param payload - Event payload, handed to listeners unchanged
 * @param tx - Transaction to defer past; omit to emit synchronously
 */
export function emitAfterTx<T>(
  eventBus: EventEmitter,
  event: string,
  payload: T,
  tx?: Transaction,
): void {
  const emit = () => eventBus.emit(event, payload);
  if (tx) {
    // Block body, not a concise one: afterCommit's callback is typed
    // void | Promise<void>, and returning the Immediate handle does not fit.
    tx.afterCommit(() => { setImmediate(emit); });
  }
  else {
    emit();
  }
}
