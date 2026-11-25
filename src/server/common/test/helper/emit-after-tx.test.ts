import { EventEmitter } from 'events';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLogError } = vi.hoisted(() => ({ mockLogError: vi.fn() }));

vi.mock('@/server/common/helper/error-logger', () => ({
  logError: mockLogError,
}));

import { invokeListeners } from '@/server/common/helper/emit-after-tx';
import { guardEventHandler } from '@/server/common/helper/guard-event-handler';

const UNGUARDED_CONTEXT = '[Events] Unguarded domain-event listener failed';

describe('invokeListeners', () => {
  let eventBus: EventEmitter;

  beforeEach(() => {
    mockLogError.mockClear();
    eventBus = new EventEmitter();
  });

  it('resolves true when every listener completes', async () => {
    const first = vi.fn().mockResolvedValue(undefined);
    const second = vi.fn().mockReturnValue('anything');
    eventBus.on('thing', first);
    eventBus.on('thing', second);

    await expect(invokeListeners(eventBus, 'thing', { id: 'p1' })).resolves.toBe(true);

    expect(first).toHaveBeenCalledWith({ id: 'p1' });
    expect(second).toHaveBeenCalledWith({ id: 'p1' });
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it('resolves false when one of two guarded listeners fails, logging it only once', async () => {
    const failure = new Error('guarded failure');
    const completed = vi.fn().mockResolvedValue(undefined);
    eventBus.on('thing', guardEventHandler(async () => { throw failure; }, 'guard context'));
    eventBus.on('thing', guardEventHandler(completed, 'guard context'));

    await expect(invokeListeners(eventBus, 'thing', {})).resolves.toBe(false);

    expect(completed).toHaveBeenCalledOnce();
    expect(mockLogError).toHaveBeenCalledOnce();
    expect(mockLogError).toHaveBeenCalledWith(failure, 'guard context');
  });

  it('counts a synchronous throw as a failure, logs it, and still runs later listeners', async () => {
    const failure = new Error('sync throw');
    const later = vi.fn();
    eventBus.on('thing', () => { throw failure; });
    eventBus.on('thing', later);

    await expect(invokeListeners(eventBus, 'thing', {})).resolves.toBe(false);

    expect(later).toHaveBeenCalledOnce();
    expect(mockLogError).toHaveBeenCalledOnce();
    expect(mockLogError).toHaveBeenCalledWith(failure, UNGUARDED_CONTEXT);
  });

  it('counts an unguarded rejection as a failure and logs it without hiding the other listener', async () => {
    const failure = new Error('unguarded rejection');
    let otherSettled = false;
    eventBus.on('thing', async () => { throw failure; });
    eventBus.on('thing', async () => {
      await new Promise(resolve => setImmediate(resolve));
      otherSettled = true;
    });

    await expect(invokeListeners(eventBus, 'thing', {})).resolves.toBe(false);

    expect(otherSettled).toBe(true);
    expect(mockLogError).toHaveBeenCalledOnce();
    expect(mockLogError).toHaveBeenCalledWith(failure, UNGUARDED_CONTEXT);
  });

  it('resolves true at once when nothing listens', async () => {
    await expect(invokeListeners(eventBus, 'nobody-listens', {})).resolves.toBe(true);

    expect(mockLogError).not.toHaveBeenCalled();
  });

  it('removes a once listener after invoking it, as emit does', async () => {
    const listener = vi.fn();
    eventBus.once('thing', listener);

    await invokeListeners(eventBus, 'thing', { n: 1 });
    await invokeListeners(eventBus, 'thing', { n: 2 });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({ n: 1 });
    expect(eventBus.listenerCount('thing')).toBe(0);
  });

  it('calls listeners with the same arguments and receiver as emit', async () => {
    const seen: Array<{ args: unknown[]; receiver: unknown }> = [];
    eventBus.on('thing', function (this: unknown, ...args: unknown[]) {
      seen.push({ args, receiver: this });
    });
    const payload = { id: 'p1' };

    eventBus.emit('thing', payload);
    await invokeListeners(eventBus, 'thing', payload);

    expect(seen).toHaveLength(2);
    expect(seen[1].args).toEqual(seen[0].args);
    expect(seen[1].args[0]).toBe(payload);
    expect(seen[1].receiver).toBe(seen[0].receiver);
  });
});
