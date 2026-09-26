/**
 * Default deadline for `waitFor` and `waitForStableCount`, shared by every
 * call site that does not pass `maxWaitMs`.
 *
 * The deadline is deliberately generous and asymmetric: polling returns as
 * soon as the condition holds, so a long deadline costs nothing on the happy
 * path and only decides how long a genuine failure takes to report. Call sites
 * should inherit this value rather than tune their own — a per-site budget
 * races runner contention (parallel forks, cold module graphs) instead of
 * measuring the invariant under test.
 *
 * `vitest.integration.config.ts` sets `testTimeout` and `hookTimeout` above
 * this value so the helper's labelled error reports first, not vitest's
 * anonymous "Test timed out".
 */
export const DEFAULT_MAX_WAIT_MS = 15000;

/**
 * Polls a condition function until it returns a truthy value, with a
 * wall-clock deadline as a backstop. Used by integration tests that need to
 * wait for async event bus cascades to settle: the invariant is what ends the
 * wait on the happy path, and the deadline only bounds how long a failure
 * takes to surface.
 */
export async function waitFor<T>(
  condition: () => Promise<T | null | false | undefined>,
  options: { maxWaitMs?: number; intervalMs?: number; label?: string } = {},
): Promise<T> {
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
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
 *
 * `stableForMs` is legitimately per-call-site: it expresses how long a count
 * must hold still to count as settled, which is a property of the cascade
 * under test. `maxWaitMs` is not — leave it on the shared default.
 *
 * Throws on timeout (deadline reached without the count stabilizing). A silent
 * return on timeout would mask tests where a cascade is still running — the
 * count returned could be transient and later assertions would be unreliable.
 */
export async function waitForStableCount(
  countFn: () => Promise<number>,
  options: { maxWaitMs?: number; stableForMs?: number; intervalMs?: number; label?: string } = {},
): Promise<number> {
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const stableForMs = options.stableForMs ?? 100;
  const intervalMs = options.intervalMs ?? 25;
  const label = options.label ?? 'count';
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
  throw new Error(
    `waitForStableCount(${label}) timed out after ${maxWaitMs}ms (last observed: ${lastCount})`,
  );
}
