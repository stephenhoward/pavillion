/**
 * Polls a condition function until it returns a truthy value or the
 * timeout is reached. Used by integration tests that need to wait for
 * async event bus cascades to settle without coupling to wall-clock time.
 */
export async function waitFor<T>(
  condition: () => Promise<T | null | false | undefined>,
  options: { maxWaitMs?: number; intervalMs?: number; label?: string } = {},
): Promise<T> {
  const maxWaitMs = options.maxWaitMs ?? 2000;
  const intervalMs = options.intervalMs ?? 25;
  const label = options.label ?? 'condition';
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const result = await condition();
    if (result) return result as T;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitFor(${label}) timed out after ${maxWaitMs}ms`);
}

/**
 * Polls `countFn` until it returns the same value twice in a row, separated
 * by at least `stableForMs` milliseconds — i.e., the count has stopped
 * changing. Used to wait for cascades that are "done" when no more outbox
 * rows are being produced.
 */
export async function waitForStableCount(
  countFn: () => Promise<number>,
  options: { maxWaitMs?: number; stableForMs?: number; intervalMs?: number } = {},
): Promise<number> {
  const maxWaitMs = options.maxWaitMs ?? 2000;
  const stableForMs = options.stableForMs ?? 100;
  const intervalMs = options.intervalMs ?? 25;
  const deadline = Date.now() + maxWaitMs;
  let lastCount = -1;
  let stableSince = 0;
  while (Date.now() < deadline) {
    const current = await countFn();
    if (current === lastCount) {
      if (stableSince === 0) stableSince = Date.now();
      if (Date.now() - stableSince >= stableForMs) return current;
    }
    else {
      lastCount = current;
      stableSince = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return lastCount;
}
