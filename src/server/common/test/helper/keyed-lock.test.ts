import { describe, it, expect } from 'vitest';

import { withKeyedLock, heldLockCount } from '@/server/common/helper/keyed-lock';

/** A promise with its resolver exposed, so a test controls when work ends. */
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
};

describe('withKeyedLock', () => {
  it('runs work for the same key one at a time, in arrival order', async () => {
    const order: string[] = [];
    const gate = deferred();

    const first = withKeyedLock('k', async () => {
      order.push('first:start');
      await gate.promise;
      order.push('first:end');
    });
    const second = withKeyedLock('k', async () => {
      order.push('second:start');
    });

    await Promise.resolve();
    expect(order).toEqual(['first:start']);

    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('lets work for different keys interleave', async () => {
    const order: string[] = [];
    const gate = deferred();

    const a = withKeyedLock('a', async () => {
      order.push('a:start');
      await gate.promise;
      order.push('a:end');
    });
    const b = withKeyedLock('b', async () => {
      order.push('b:start');
    });

    await b;
    expect(order).toEqual(['a:start', 'b:start']);

    gate.resolve();
    await a;
  });

  it('returns the value of the work', async () => {
    await expect(withKeyedLock('k', async () => 42)).resolves.toBe(42);
  });

  it('releases the key when work rejects', async () => {
    const failing = withKeyedLock('k', async () => {
      throw new Error('boom');
    });
    const next = withKeyedLock('k', async () => 'ran');

    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ran');
  });

  it('holds no entry for a key once its work has settled', async () => {
    await Promise.allSettled([
      withKeyedLock('x', async () => 1),
      withKeyedLock('x', async () => { throw new Error('boom'); }),
      withKeyedLock('y', async () => 2),
    ]);

    expect(heldLockCount()).toBe(0);
  });
});
