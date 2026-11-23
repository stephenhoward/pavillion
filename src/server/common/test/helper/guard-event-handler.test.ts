import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLogError } = vi.hoisted(() => ({ mockLogError: vi.fn() }));

vi.mock('@/server/common/helper/error-logger', () => ({
  logError: mockLogError,
}));

import { guardEventHandler } from '@/server/common/helper/guard-event-handler';

describe('guardEventHandler', () => {
  beforeEach(() => {
    mockLogError.mockClear();
  });

  it('passes the payload through to the handler and resolves completed on success', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const guarded = guardEventHandler(handler, 'test context');

    await expect(guarded({ id: 'p1' })).resolves.toBe('completed');

    expect(handler).toHaveBeenCalledWith({ id: 'p1' });
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it('resolves completed for a synchronous handler that returns normally', async () => {
    const guarded = guardEventHandler(() => {}, 'test context');

    await expect(guarded({})).resolves.toBe('completed');

    expect(mockLogError).not.toHaveBeenCalled();
  });

  it('logs a rejected handler and resolves failed instead of rejecting', async () => {
    const failure = new Error('handler rejected');
    const guarded = guardEventHandler(async () => { throw failure; }, 'test context');

    await expect(guarded({})).resolves.toBe('failed');

    expect(mockLogError).toHaveBeenCalledOnce();
    expect(mockLogError).toHaveBeenCalledWith(failure, 'test context');
  });

  it('logs a synchronous throw from the handler and resolves failed', async () => {
    const failure = new Error('sync throw');
    const guarded = guardEventHandler(() => { throw failure; }, 'test context');

    await expect(guarded({})).resolves.toBe('failed');

    expect(mockLogError).toHaveBeenCalledOnce();
    expect(mockLogError).toHaveBeenCalledWith(failure, 'test context');
  });
});
