/**
 * Failure-catching wrapper for domain-event handlers installed on the
 * shared event bus.
 *
 * `EventEmitter.emit` never awaits a listener, so an async handler that
 * rejects becomes an unhandled promise rejection — which terminates the
 * process on Node 24. Every handler registered in a domain's
 * `events/index.ts` goes through this wrapper so a failed background
 * dispatch is logged and isolated instead of taking the server down.
 *
 * The wrapper returns the settled promise rather than `void`: the bus
 * discards it either way, but `dispatchAndAwait` (the deterministic test
 * helper in `common/test/helpers/emit-and-settle.ts`) awaits listener
 * return values, so returning the never-rejecting promise keeps handler
 * tests deterministic. A synchronous throw from the handler is caught on
 * the same path as a rejection.
 *
 * Failure reporting back to the emitter (retry, surfacing to the caller)
 * is deliberately not this wrapper's job.
 */

import { logError } from '@/server/common/helper/error-logger';

/**
 * Adapt a domain-event handler for installation on the never-awaited bus.
 *
 * @param handler - The async handler to protect
 * @param context - Log context identifying the domain, e.g. `'[Calendar] Domain-event handler failed'`
 * @returns A listener that always resolves; handler failures are logged via {@link logError}
 */
export function guardEventHandler<T>(
  handler: (payload: T) => Promise<void> | void,
  context: string,
): (payload: T) => Promise<void> {
  return (payload: T): Promise<void> =>
    Promise.resolve()
      .then(() => handler(payload))
      .catch((error) => logError(error, context));
}
