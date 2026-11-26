import type { EventEmitter } from 'events';
import type { Transaction } from 'sequelize';

import { logError } from '@/server/common/helper/error-logger';
import type { HandlerOutcome } from '@/server/common/helper/guard-event-handler';
import logger from '@/server/common/helper/logger';

/**
 * Calls every listener registered for a domain event, with the receiver and
 * argument `emit` would pass, and resolves once all of them have settled.
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
 * Counts the domain events emitted under one transaction, so the operation
 * that ran the transaction can wait, for a bounded time, for their listeners
 * after commit and learn how many did not complete.
 *
 * An emission is counted when {@link emitAfterTx} is called, before commit,
 * and settles when every listener it reached has settled. The tally holds
 * counts only — never an event name, payload or listener — so nothing about
 * the operation leaves it but a number.
 *
 * Obtain one through {@link trackDispatch}, not the constructor.
 */
export class DispatchTally {
  private pending = 0;
  private failed = 0;
  private onIdle: (() => void) | undefined;

  /** Counts one emission as pending; the returned callback settles it. */
  begin(): (completed: boolean) => void {
    this.pending++;
    return (completed) => {
      if (!completed) {
        this.failed++;
      }
      this.pending--;
      if (this.pending === 0 && this.onIdle) {
        const onIdle = this.onIdle;
        this.onIdle = undefined;
        onIdle();
      }
    };
  }

  /**
   * Waits for every counted emission to settle, or for the deadline.
   *
   * Resolves the number of incomplete emissions: those with at least one failed
   * listener, plus those still unsettled at the deadline. An emission counts
   * once however many of its listeners failed. With nothing pending it resolves
   * at once. The deadline timer is cleared when everything settles in time.
   * When the deadline passes first, the listeners keep running, and once the
   * last of them settles the tally logs one line with the final incomplete
   * count, so a late failure is still recorded. Call it once, after commit.
   *
   * @param timeoutMs - How long to wait before reporting unsettled emissions
   * @returns Count of incomplete emissions
   */
  settled(timeoutMs: number): Promise<number> {
    if (this.pending === 0) {
      return Promise.resolve(this.failed);
    }
    return new Promise((resolve) => {
      const deadline = setTimeout(() => {
        resolve(this.failed + this.pending);
        this.onIdle = () => {
          logger.warn({ incomplete: this.failed }, 'events.dispatch.late_settled');
        };
      }, timeoutMs);
      this.onIdle = () => {
        clearTimeout(deadline);
        resolve(this.failed);
      };
    });
  }
}

const tallies = new WeakMap<Transaction, DispatchTally>();

/**
 * Opts a transaction into dispatch tallying and returns its tally.
 *
 * Idempotent: the same transaction always yields the same tally. The registry
 * is keyed by transaction identity, which holds because transactions are
 * passed explicitly rather than looked up through CLS, and is weakly held, so
 * a tally lives no longer than its transaction.
 *
 * @param tx - Transaction whose emissions to count
 * @returns The transaction's tally
 */
export function trackDispatch(tx: Transaction): DispatchTally {
  let tally = tallies.get(tx);
  if (!tally) {
    tally = new DispatchTally();
    tallies.set(tx, tally);
  }
  return tally;
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
 * When the transaction has a tally ({@link trackDispatch}), the emission is
 * counted on it at call time, and after commit the listeners are called through
 * {@link invokeListeners} instead of `eventBus.emit`, so their outcome settles
 * the count. Without a tally, the event goes through `eventBus.emit`.
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
  const tally = tx ? tallies.get(tx) : undefined;
  let dispatch = () => { eventBus.emit(event, payload); };
  if (tally) {
    const settle = tally.begin();
    dispatch = () => {
      invokeListeners(eventBus, event, payload).then(settle, () => settle(false));
    };
  }

  if (tx) {
    // Block body, not a concise one: afterCommit's callback is typed
    // void | Promise<void>, and returning the Immediate handle does not fit.
    tx.afterCommit(() => { setImmediate(dispatch); });
  }
  else {
    dispatch();
  }
}
