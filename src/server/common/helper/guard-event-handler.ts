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
 * The listener resolves a {@link HandlerOutcome} for whoever holds its
 * promise and never rejects. The bus discards the value; a dispatcher that
 * awaits listener return values (such as `dispatchAndAwait` in
 * `common/test/helpers/emit-and-settle.ts`) can count failures without the
 * handler knowing about the operation that emitted the event. A synchronous
 * throw from the handler is caught on the same path as a rejection. The
 * wrapper does not retry a failed handler.
 */

import { logError } from '@/server/common/helper/error-logger';

/** How a guarded handler settled: it resolved, or it threw or rejected. */
export type HandlerOutcome = 'completed' | 'failed';

/**
 * Adapt a domain-event handler for installation on the never-awaited bus.
 *
 * @param handler - The async handler to protect
 * @param context - Log context identifying the domain, e.g. `'[Calendar] Domain-event handler failed'`
 * @returns A listener that never rejects: it resolves `'completed'` when the
 *   handler succeeds and `'failed'` after logging the failure via {@link logError}
 */
export function guardEventHandler<T>(
  handler: (payload: T) => Promise<void> | void,
  context: string,
): (payload: T) => Promise<HandlerOutcome> {
  return (payload: T): Promise<HandlerOutcome> =>
    Promise.resolve()
      .then(() => handler(payload))
      .then(
        (): HandlerOutcome => 'completed',
        (error): HandlerOutcome => {
          logError(error, context);
          return 'failed';
        },
      );
}
