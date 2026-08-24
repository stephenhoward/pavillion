/**
 * Test helpers: settle async event-bus listeners deterministically.
 *
 * `EventEmitter.emit` is synchronous and does not await async listeners, so
 * tests that rely on a listener's DB writes (or any deferred work) must wait
 * for that work before asserting on the resulting state.
 *
 * This file used to export fixed-budget drain helpers (`emitAndSettle` /
 * `settleAsyncHandlers`: N rounds × M ms, then return regardless). Those were
 * the root cause of a three-month CI flake cluster: a contended
 * runner overruns any fixed budget, the handler chain has not committed, and
 * the assertion reads null. They are deliberately gone — do not reintroduce a
 * fixed-duration drain; a bigger budget only moves the cliff.
 *
 * Two deterministic replacements:
 *  - {@link dispatchAndAwait} when the test owns the emitter and emits
 *    inline — awaits the listener promises themselves.
 *  - {@link waitFor} when the emit happens deep inside an awaited call —
 *    polls for the actual end-state the test needs.
 */

import type { EventEmitter } from 'events';

/**
 * Invoke every listener registered for `event` directly and await the
 * promises they return.
 *
 * Deterministic replacement for "emit, then drain for a while": async
 * listeners return promises that `EventEmitter.emit` discards, so calling
 * the listeners ourselves is the only way to await the full handler chain —
 * including handlers whose end state is invisible (error swallowed, write
 * skipped) and negative assertions ("no row was written"), which condition
 * polling cannot express.
 *
 * Only valid when the test owns the emitter and would otherwise emit
 * inline. When the emit is buried inside an awaited service call, use
 * {@link waitFor} on the end-state instead.
 */
export async function dispatchAndAwait(
  emitter: EventEmitter,
  event: string,
  payload: unknown,
): Promise<void> {
  await Promise.all(
    emitter.listeners(event).map(listener => listener(payload)),
  );
}

export interface WaitForOptions {
  /** Total time budget before giving up. Default: 2000ms. */
  timeoutMs?: number;
  /** Poll interval between attempts. Default: 10ms. */
  intervalMs?: number;
}

/**
 * Poll an async predicate until it returns truthy, or throw on timeout.
 *
 * Prefer this when the emit happens inside an awaited call and the test can
 * express exactly what end-state it's waiting for (e.g. "the notification
 * row exists"). Fixed-budget drains race the chain length; condition
 * polling races the actual invariant and stays fast in the happy path.
 */
export async function waitFor<T>(
  predicate: () => Promise<T> | T,
  opts: WaitForOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 2000;
  const intervalMs = opts.intervalMs ?? 10;
  const deadline = Date.now() + timeoutMs;
  let lastResult: T | undefined;
  while (Date.now() < deadline) {
    lastResult = await predicate();
    if (lastResult) return lastResult;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
}
