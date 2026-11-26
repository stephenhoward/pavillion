import { EventEmitter } from 'events';
import type { Transaction } from 'sequelize';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockLogError, mockWarn } = vi.hoisted(() => ({ mockLogError: vi.fn(), mockWarn: vi.fn() }));

vi.mock('@/server/common/helper/error-logger', () => ({
  logError: mockLogError,
}));

vi.mock('@/server/common/helper/logger', () => ({
  default: { warn: mockWarn },
}));

import { emitAfterTx, invokeListeners, trackDispatch } from '@/server/common/helper/emit-after-tx';
import { guardEventHandler } from '@/server/common/helper/guard-event-handler';
import type { HandlerOutcome } from '@/server/common/helper/guard-event-handler';

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

/**
 * Stands in for a Sequelize transaction: records afterCommit callbacks so a
 * test decides when the commit happens.
 */
function fakeTransaction(): { tx: Transaction; commit: () => Promise<void> } {
  const callbacks: Array<() => unknown> = [];
  const tx = { afterCommit: (cb: () => unknown) => { callbacks.push(cb); } } as unknown as Transaction;
  return {
    tx,
    commit: async () => {
      callbacks.forEach(cb => cb());
      // The setImmediate hop emitAfterTx takes after commit
      await new Promise(resolve => setImmediate(resolve));
    },
  };
}

describe('trackDispatch', () => {
  it('returns the same tally for the same transaction', () => {
    const { tx } = fakeTransaction();
    const { tx: otherTx } = fakeTransaction();

    expect(trackDispatch(tx)).toBe(trackDispatch(tx));
    expect(trackDispatch(otherTx)).not.toBe(trackDispatch(tx));
  });
});

describe('emitAfterTx', () => {
  let eventBus: EventEmitter;

  beforeEach(() => {
    mockLogError.mockClear();
    mockWarn.mockClear();
    eventBus = new EventEmitter();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits through eventBus.emit after commit when the transaction has no tally', async () => {
    const { tx, commit } = fakeTransaction();
    const emitSpy = vi.spyOn(eventBus, 'emit');
    const listener = vi.fn();
    eventBus.on('thing', listener);

    emitAfterTx(eventBus, 'thing', { id: 'p1' }, tx);
    expect(listener).not.toHaveBeenCalled();
    await commit();

    expect(emitSpy).toHaveBeenCalledWith('thing', { id: 'p1' });
    expect(listener).toHaveBeenCalledWith({ id: 'p1' });
  });

  it('emits through eventBus.emit at once when there is no transaction', () => {
    const emitSpy = vi.spyOn(eventBus, 'emit');

    emitAfterTx(eventBus, 'thing', { id: 'p1' });

    expect(emitSpy).toHaveBeenCalledWith('thing', { id: 'p1' });
  });

  it('dispatches through the listeners, not eventBus.emit, when the transaction is tallied', async () => {
    const { tx, commit } = fakeTransaction();
    trackDispatch(tx);
    const emitSpy = vi.spyOn(eventBus, 'emit');
    const listener = vi.fn();
    eventBus.on('thing', listener);

    emitAfterTx(eventBus, 'thing', { id: 'p1' }, tx);
    expect(listener).not.toHaveBeenCalled();
    await commit();

    expect(listener).toHaveBeenCalledWith({ id: 'p1' });
    expect(emitSpy).not.toHaveBeenCalled();
  });

  describe('DispatchTally.settled', () => {
    it('resolves 0 at once when nothing was emitted', async () => {
      const { tx } = fakeTransaction();

      await expect(trackDispatch(tx).settled(1000)).resolves.toBe(0);
    });

    it('resolves 0 when every emission completes', async () => {
      const { tx, commit } = fakeTransaction();
      const tally = trackDispatch(tx);
      eventBus.on('thing', vi.fn().mockResolvedValue(undefined));
      eventBus.on('thing', vi.fn().mockResolvedValue(undefined));

      emitAfterTx(eventBus, 'thing', { n: 1 }, tx);
      emitAfterTx(eventBus, 'thing', { n: 2 }, tx);
      await commit();

      await expect(tally.settled(1000)).resolves.toBe(0);
      expect(mockWarn).not.toHaveBeenCalled();
    });

    it('counts an emission once when one of its two listeners fails', async () => {
      const { tx, commit } = fakeTransaction();
      const tally = trackDispatch(tx);
      eventBus.on('thing', vi.fn().mockResolvedValue('failed' satisfies HandlerOutcome));
      eventBus.on('thing', vi.fn().mockResolvedValue(undefined));

      emitAfterTx(eventBus, 'thing', {}, tx);
      await commit();

      await expect(tally.settled(1000)).resolves.toBe(1);
    });

    it('counts an emission once when both of its listeners fail', async () => {
      const { tx, commit } = fakeTransaction();
      const tally = trackDispatch(tx);
      eventBus.on('thing', vi.fn().mockResolvedValue('failed' satisfies HandlerOutcome));
      eventBus.on('thing', vi.fn().mockRejectedValue(new Error('unguarded')));

      emitAfterTx(eventBus, 'thing', {}, tx);
      await commit();

      await expect(tally.settled(1000)).resolves.toBe(1);
    });

    it('waits for emissions still running when settled is called', async () => {
      const { tx, commit } = fakeTransaction();
      const tally = trackDispatch(tx);
      let release!: () => void;
      eventBus.on('thing', () => new Promise<void>(resolve => { release = resolve; }));

      emitAfterTx(eventBus, 'thing', {}, tx);
      await commit();
      const result = tally.settled(1000);
      release();

      await expect(result).resolves.toBe(0);
    });

    it('counts an emission unsettled at the deadline, then logs the final count once it settles', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { tx, commit } = fakeTransaction();
      const tally = trackDispatch(tx);
      let finishLate!: (outcome: HandlerOutcome) => void;
      eventBus.on('thing', () => new Promise<HandlerOutcome>(resolve => { finishLate = resolve; }));
      eventBus.on('thing', vi.fn().mockResolvedValue(undefined));

      emitAfterTx(eventBus, 'thing', { secret: 'payload' }, tx);
      emitAfterTx(eventBus, 'other', {}, tx);
      await commit();
      const result = tally.settled(5000);
      await vi.advanceTimersByTimeAsync(5000);

      await expect(result).resolves.toBe(1);
      expect(mockWarn).not.toHaveBeenCalled();

      finishLate('failed');
      await new Promise(resolve => setImmediate(resolve));

      expect(mockWarn).toHaveBeenCalledOnce();
      expect(mockWarn).toHaveBeenCalledWith({ incomplete: 1 }, 'events.dispatch.late_settled');
    });

    it('clears the deadline timer when every emission settles in time', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { tx, commit } = fakeTransaction();
      const tally = trackDispatch(tx);
      let release!: () => void;
      eventBus.on('thing', () => new Promise<void>(resolve => { release = resolve; }));

      emitAfterTx(eventBus, 'thing', {}, tx);
      await commit();
      const result = tally.settled(5000);
      expect(vi.getTimerCount()).toBe(1);
      release();

      await expect(result).resolves.toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(mockWarn).not.toHaveBeenCalled();
    });
  });
});
