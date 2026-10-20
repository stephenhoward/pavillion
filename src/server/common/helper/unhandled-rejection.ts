import logger from '@/server/common/helper/logger';

/**
 * Process-level backstop for promise rejections nothing awaited.
 *
 * Node's default (`--unhandled-rejections=throw`) turns an unhandled
 * rejection into an uncaught exception and exits the process, so one
 * dropped promise in a route handler or job takes the whole web or worker
 * container down. Registering this listener replaces that default with an
 * error-level log entry carrying the reason and its stack.
 *
 * This is a safety net, not an error-handling strategy: route handlers,
 * event handlers and job handlers still own their own errors and must
 * catch and respond to them. A rejection reaching this listener is a bug
 * worth fixing, which is why it logs at error level.
 *
 * `uncaughtException` is deliberately left at Node's default. A synchronous
 * throw that escapes every frame leaves the process in an unknown state
 * (half-written responses, dangling transactions); exiting and letting the
 * container restart is safer than continuing from that state. A rejected
 * promise, by contrast, is a value nobody consumed, and the rest of the
 * process is unaffected.
 */
export function logUnhandledRejection(reason: unknown): void {
  if (reason instanceof Error) {
    logger.error({ err: reason }, 'Unhandled promise rejection');
  }
  else {
    logger.error({ reason }, 'Unhandled promise rejection');
  }
}

/**
 * Installs the unhandled-rejection backstop on the current process.
 * Safe to call more than once: the listener is only ever registered once.
 */
export function installUnhandledRejectionHandler(): void {
  if (process.listeners('unhandledRejection').includes(logUnhandledRejection)) {
    return;
  }
  process.on('unhandledRejection', logUnhandledRejection);
}
