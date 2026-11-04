/**
 * Tail of the work chain for each key with work in flight. An idle key has no
 * entry, so the map is bounded by concurrent work rather than distinct keys.
 */
const tails = new Map<string, Promise<unknown>>();

/**
 * Runs `fn` once every earlier call for the same key has settled, so work for
 * one key never overlaps while work for different keys runs freely.
 *
 * In-process only: this serializes callers within one Node process and gives
 * no guarantee across processes or hosts.
 *
 * @param key - Identifies the resource the work must hold exclusively
 * @param fn - The work to run while holding the key
 * @returns The result of `fn`; a rejection from `fn` is passed through and
 *   does not block later callers
 */
export async function withKeyedLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.then(fn);
  // Later callers wait on a copy that never rejects, so one failure does not
  // poison the chain.
  const tail = run.catch(() => undefined);
  tails.set(key, tail);
  try {
    return await run;
  }
  finally {
    if (tails.get(key) === tail) {
      tails.delete(key);
    }
  }
}

/**
 * Number of keys with work in flight. Exposed for tests asserting that idle
 * keys are released.
 */
export function heldLockCount(): number {
  return tails.size;
}
