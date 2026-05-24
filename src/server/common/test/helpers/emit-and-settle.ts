/**
 * Test helper: drain async event-bus listeners.
 *
 * `EventEmitter.emit` is synchronous and does not await async listeners, so
 * tests that rely on a listener's DB writes (or any deferred work) must drain
 * the microtask + macrotask queues before asserting on the resulting state.
 *
 * This drain loop is the standard mitigation across this codebase — keep all
 * call sites pointing at one implementation so the strategy (round count,
 * inter-round gap) can be tuned in a single place.
 */

import type { EventEmitter } from 'events';

export interface SettleOptions {
  /** Number of macrotask/microtask drain rounds. Default: 5. */
  rounds?: number;
  /** Millisecond gap between rounds (via setTimeout). Default: 5. */
  gapMs?: number;
}

const DEFAULT_ROUNDS = 5;
const DEFAULT_GAP_MS = 5;

/**
 * Drain pending async work without emitting an event.
 *
 * Use this when the event you need to settle has already been emitted (or is
 * emitted deep inside a call you've already awaited).
 */
export async function settleAsyncHandlers(opts: SettleOptions = {}): Promise<void> {
  const rounds = opts.rounds ?? DEFAULT_ROUNDS;
  const gapMs = opts.gapMs ?? DEFAULT_GAP_MS;
  for (let i = 0; i < rounds; i += 1) {
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setTimeout(resolve, gapMs));
  }
}

/**
 * Emit a bus event and drain async listeners before returning.
 *
 * Use this when the test owns the emitter directly and is emitting the event
 * inline (the common case in unit tests). Prefer {@link settleAsyncHandlers}
 * when the emit is wrapped inside another awaited call.
 */
export async function emitAndSettle(
  emitter: EventEmitter,
  event: string,
  payload: unknown,
  opts: SettleOptions = {},
): Promise<void> {
  emitter.emit(event, payload);
  await settleAsyncHandlers(opts);
}
