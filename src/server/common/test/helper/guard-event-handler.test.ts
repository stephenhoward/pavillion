import { describe, it, expect, vi } from 'vitest';

const { mockLogError } = vi.hoisted(() => ({ mockLogError: vi.fn() }));

vi.mock('@/server/common/helper/error-logger', () => ({
  logError: mockLogError,
}));

import { guardEventHandler } from '@/server/common/helper/guard-event-handler';

describe('guardEventHandler', () => {
  it('passes the payload through to the handler and resolves on success', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const guarded = guardEventHandler(handler, 'test context');

    await expect(guarded({ id: 'p1' })).resolves.toBeUndefined();

    expect(handler).toHaveBeenCalledWith({ id: 'p1' });
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it('logs a rejected handler and resolves instead of rejecting', async () => {
    const failure = new Error('handler rejected');
    const guarded = guardEventHandler(async () => { throw failure; }, 'test context');

    await expect(guarded({})).resolves.toBeUndefined();

    expect(mockLogError).toHaveBeenCalledWith(failure, 'test context');
  });

  it('catches a synchronous throw from the handler', async () => {
    const failure = new Error('sync throw');
    const guarded = guardEventHandler(() => { throw failure; }, 'test context');

    await expect(guarded({})).resolves.toBeUndefined();

    expect(mockLogError).toHaveBeenCalledWith(failure, 'test context');
  });
});
