import type { EventEmitter } from 'events';
import type { Transaction } from 'sequelize';

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
