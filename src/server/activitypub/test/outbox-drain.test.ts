import { EventEmitter } from 'events';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import express from 'express';
import config from 'config';

const { mockLogError } = vi.hoisted(() => ({ mockLogError: vi.fn() }));

vi.mock('@/server/common/helper/error-logger', () => ({
  logError: mockLogError,
}));

import ActivityPubDomain, { OUTBOX_DRAIN_SKIP_NEWER_THAN_MS } from '@/server/activitypub';
import { ActivityPubOutboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import HousekeepingInterface from '@/server/housekeeping/interface';

/**
 * Builds an ActivityPubDomain with its event handlers installed, as the web
 * process does before it starts the drain. No moderation interface: the
 * outbox drain does not need one.
 */
function buildDomain(eventBus: EventEmitter): ActivityPubDomain {
  const domain = new ActivityPubDomain(
    eventBus,
    new CalendarInterface(eventBus),
    new AccountsInterface(),
    { publishJob: async () => {} } as unknown as HousekeepingInterface,
  );
  domain.installEventHandlers();
  return domain;
}

/** Settles the outbox drain currently in flight, if any. */
async function settleDrain(domain: ActivityPubDomain): Promise<void> {
  await (domain as any)['outboxDrain'];
}

/** A promise that stays pending until `resolve` or `reject` is called. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const OUTBOX_DRAIN_INTERVAL_MS = config.get<number>('activitypub.outboxDrain.intervalMs');

describe('ActivityPubDomain outbox drain', () => {
  let sandbox: sinon.SinonSandbox;
  let eventBus: EventEmitter;
  let domain: ActivityPubDomain;
  let drainStub: sinon.SinonStub;
  let stopDrain: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    mockLogError.mockClear();
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    domain = buildDomain(eventBus);
    drainStub = sandbox.stub(domain.interface, 'processOutboxMessages').resolves();
    stopDrain = undefined;
  });

  afterEach(() => {
    stopDrain?.();
    sandbox.restore();
    vi.useRealTimers();
  });

  it('drains once at startup with no skip window', async () => {
    stopDrain = domain.startOutboxDrain();
    await settleDrain(domain);

    expect(drainStub.calledOnce).toBe(true);
    expect(drainStub.firstCall.args[0]?.skipNewerThanMs).toBeUndefined();
  });

  it('does not block its caller on the startup drain', () => {
    drainStub.returns(new Promise<void>(() => {}));

    stopDrain = domain.startOutboxDrain();

    expect((domain as any)['outboxDrain'], 'the startup drain is still in flight').not.toBeNull();
  });

  it('drains on every interval tick with the 15-minute skip window', async () => {
    stopDrain = domain.startOutboxDrain();
    await settleDrain(domain);

    await vi.advanceTimersByTimeAsync(OUTBOX_DRAIN_INTERVAL_MS - 1);
    await settleDrain(domain);
    expect(drainStub.callCount, 'no tick before the interval elapses').toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    await settleDrain(domain);
    await vi.advanceTimersByTimeAsync(OUTBOX_DRAIN_INTERVAL_MS);
    await settleDrain(domain);

    expect(OUTBOX_DRAIN_INTERVAL_MS).toBe(60_000);
    expect(OUTBOX_DRAIN_SKIP_NEWER_THAN_MS).toBe(900_000);
    expect(drainStub.callCount).toBe(3);
    expect(drainStub.secondCall.args[0]).toEqual({ skipNewerThanMs: OUTBOX_DRAIN_SKIP_NEWER_THAN_MS });
    expect(drainStub.thirdCall.args[0]).toEqual({ skipNewerThanMs: OUTBOX_DRAIN_SKIP_NEWER_THAN_MS });
  });

  it('starts no second drain when a tick fires while one is in flight', async () => {
    const inFlight = deferred();
    drainStub.onFirstCall().returns(inFlight.promise);

    stopDrain = domain.startOutboxDrain();
    const startupDrain = (domain as any)['outboxDrain'];
    await vi.advanceTimersByTimeAsync(OUTBOX_DRAIN_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(OUTBOX_DRAIN_INTERVAL_MS);
    // On SQLite a second drain would queue on the chain rather than call the
    // stub, so the call count alone cannot show it; the in-flight promise can.
    expect((domain as any)['outboxDrain'], 'ticks during the in-flight drain start nothing').toBe(startupDrain);
    expect(drainStub.callCount).toBe(1);

    inFlight.resolve();
    await settleDrain(domain);
    await vi.advanceTimersByTimeAsync(OUTBOX_DRAIN_INTERVAL_MS);
    await settleDrain(domain);
    expect(drainStub.callCount, 'the next tick after it settles drains').toBe(2);
  });

  it('logs a failed drain and still runs the next tick', async () => {
    const failure = new Error('database unavailable');
    drainStub.onFirstCall().rejects(failure);

    stopDrain = domain.startOutboxDrain();
    await settleDrain(domain);
    expect(mockLogError).toHaveBeenCalledWith(failure, expect.stringContaining('Outbox drain failed'));
    expect((domain as any)['outboxDrain'], 'a rejected drain clears the in-flight slot').toBeNull();

    await vi.advanceTimersByTimeAsync(OUTBOX_DRAIN_INTERVAL_MS);
    await settleDrain(domain);
    expect(drainStub.callCount).toBe(2);
  });

  it('on SQLite, runs a tick behind a domain-event handler already in flight', async () => {
    stopDrain = domain.startOutboxDrain();
    await settleDrain(domain);

    // Hold an outboxMessageAdded handler on the serialized dispatch chain.
    let release!: () => void;
    const gate = new Promise<null>((resolve) => { release = () => resolve(null); });
    sandbox.stub(ActivityPubOutboxMessageEntity, 'findByPk').returns(gate as any);
    eventBus.emit('outboxMessageAdded', { id: 'in-flight' });

    await vi.advanceTimersByTimeAsync(OUTBOX_DRAIN_INTERVAL_MS);
    expect(drainStub.callCount, 'the tick waits for the handler').toBe(1);

    release();
    await settleDrain(domain);
    expect(drainStub.callCount).toBe(2);
  });

  it('stops ticking once the stop handle is called', async () => {
    const stop = domain.startOutboxDrain();
    await settleDrain(domain);

    stop();
    await vi.advanceTimersByTimeAsync(OUTBOX_DRAIN_INTERVAL_MS * 3);

    expect(drainStub.callCount).toBe(1);
  });

  it('refuses to start before the event handlers are installed', () => {
    const bare = new ActivityPubDomain(
      eventBus,
      new CalendarInterface(eventBus),
      new AccountsInterface(),
      { publishJob: async () => {} } as unknown as HousekeepingInterface,
    );
    const bareDrain = sandbox.stub(bare.interface, 'processOutboxMessages').resolves();

    expect(() => { stopDrain = bare.startOutboxDrain(); }).toThrow(/installEventHandlers/);
    expect(bareDrain.called).toBe(false);
  });

  it('does not drain from initialize()', async () => {
    const initialized = new ActivityPubDomain(
      eventBus,
      new CalendarInterface(eventBus),
      new AccountsInterface(),
      { publishJob: async () => {} } as unknown as HousekeepingInterface,
    );
    const initializedDrain = sandbox.stub(initialized.interface, 'processOutboxMessages').resolves();

    initialized.initialize(express());
    await vi.advanceTimersByTimeAsync(OUTBOX_DRAIN_INTERVAL_MS * 3);

    expect(initializedDrain.called).toBe(false);
  });
});
