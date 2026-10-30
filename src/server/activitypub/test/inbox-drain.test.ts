import { EventEmitter } from 'events';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';

const { mockLogError } = vi.hoisted(() => ({ mockLogError: vi.fn() }));

vi.mock('@/server/common/helper/error-logger', () => ({
  logError: mockLogError,
}));

import ActivityPubDomain, {
  INBOX_DRAIN_INTERVAL_MS,
  INBOX_DRAIN_SKIP_NEWER_THAN_MS,
} from '@/server/activitypub';
import ProcessInboxService from '@/server/activitypub/service/inbox';
import { ActivityPubInboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import HousekeepingInterface from '@/server/housekeeping/interface';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { setupActivityPubSchema, teardownActivityPubSchema } from '@/server/common/test/helpers/database';

/**
 * Builds an ActivityPubDomain with its event handlers installed, as the web
 * process does before it starts the drain.
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

/** Settles the drain currently in flight, if any. */
async function settleDrain(domain: ActivityPubDomain): Promise<void> {
  await (domain as any)['inboxDrain'];
}

/** A promise that stays pending until `resolve` or `reject` is called. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('ActivityPubDomain inbox drain', () => {
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
    drainStub = sandbox.stub(domain.interface, 'processInboxMessages').resolves();
    stopDrain = undefined;
  });

  afterEach(() => {
    stopDrain?.();
    sandbox.restore();
    vi.useRealTimers();
  });

  it('drains once at startup with no skip window', async () => {
    stopDrain = domain.startInboxDrain();
    await settleDrain(domain);

    expect(drainStub.calledOnce).toBe(true);
    expect(drainStub.firstCall.args[0]?.skipNewerThanMs).toBeUndefined();
  });

  it('drains on every interval tick with the skip window', async () => {
    stopDrain = domain.startInboxDrain();
    await settleDrain(domain);

    await vi.advanceTimersByTimeAsync(INBOX_DRAIN_INTERVAL_MS);
    await settleDrain(domain);
    await vi.advanceTimersByTimeAsync(INBOX_DRAIN_INTERVAL_MS);
    await settleDrain(domain);

    expect(INBOX_DRAIN_INTERVAL_MS).toBe(5_000);
    expect(drainStub.callCount).toBe(3);
    expect(drainStub.secondCall.args[0]).toEqual({ skipNewerThanMs: INBOX_DRAIN_SKIP_NEWER_THAN_MS });
    expect(drainStub.thirdCall.args[0]).toEqual({ skipNewerThanMs: INBOX_DRAIN_SKIP_NEWER_THAN_MS });
    expect(INBOX_DRAIN_SKIP_NEWER_THAN_MS).toBe(10_000);
  });

  it('skips a tick that fires while a drain is still in flight', async () => {
    const inFlight = deferred();
    drainStub.onFirstCall().returns(inFlight.promise);

    stopDrain = domain.startInboxDrain();
    await vi.advanceTimersByTimeAsync(INBOX_DRAIN_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(INBOX_DRAIN_INTERVAL_MS);
    expect(drainStub.callCount, 'ticks during the in-flight drain start nothing').toBe(1);

    inFlight.resolve();
    await settleDrain(domain);
    await vi.advanceTimersByTimeAsync(INBOX_DRAIN_INTERVAL_MS);
    await settleDrain(domain);
    expect(drainStub.callCount, 'the next tick after it settles drains').toBe(2);
  });

  it('logs a failed drain and still runs the next tick', async () => {
    const failure = new Error('drain failed');
    drainStub.onFirstCall().rejects(failure);

    stopDrain = domain.startInboxDrain();
    await settleDrain(domain);
    expect(mockLogError).toHaveBeenCalledWith(failure, expect.stringContaining('Inbox drain failed'));

    await vi.advanceTimersByTimeAsync(INBOX_DRAIN_INTERVAL_MS);
    await settleDrain(domain);
    expect(drainStub.callCount).toBe(2);
  });

  it('on SQLite, runs a tick behind a domain-event handler already in flight', async () => {
    stopDrain = domain.startInboxDrain();
    await settleDrain(domain);

    // Hold an inboxMessageAdded handler on the serialized dispatch chain.
    let release!: () => void;
    const gate = new Promise<null>((resolve) => { release = () => resolve(null); });
    sandbox.stub(ActivityPubInboxMessageEntity, 'findByPk').returns(gate as any);
    eventBus.emit('inboxMessageAdded', { id: 'in-flight' });

    await vi.advanceTimersByTimeAsync(INBOX_DRAIN_INTERVAL_MS);
    expect(drainStub.callCount, 'the tick waits for the handler').toBe(1);

    release();
    await settleDrain(domain);
    expect(drainStub.callCount).toBe(2);
  });

  it('stops ticking once the stop handle is called', async () => {
    const stop = domain.startInboxDrain();
    await settleDrain(domain);

    stop();
    await vi.advanceTimersByTimeAsync(INBOX_DRAIN_INTERVAL_MS * 3);

    expect(drainStub.callCount).toBe(1);
  });

  it('does not drain from initialize()', async () => {
    const initialized = new ActivityPubDomain(
      eventBus,
      new CalendarInterface(eventBus),
      new AccountsInterface(),
      { publishJob: async () => {} } as unknown as HousekeepingInterface,
    );
    const initializedDrain = sandbox.stub(initialized.interface, 'processInboxMessages').resolves();

    initialized.initialize(express());
    await vi.advanceTimersByTimeAsync(INBOX_DRAIN_INTERVAL_MS * 3);

    expect(initializedDrain.called).toBe(false);
  });
});

describe('ActivityPubDomain inbox drain skip window', () => {
  const calendarId = 'inbox-drain-calendar-id';
  let sandbox: sinon.SinonSandbox;
  let domain: ActivityPubDomain;
  let dispatched: string[];
  let stopDrain: (() => void) | undefined;

  /**
   * Writes an unprocessed ap_inbox row whose write time (createdAt) is
   * `ageMs` in the past.
   */
  const insertInboxRow = async (id: string, ageMs: number): Promise<void> => {
    await ActivityPubInboxMessageEntity.create({
      id,
      type: 'Create',
      message_time: new Date(),
      message: {},
      calendar_id: calendarId,
    });
    const writtenAt = new Date(Date.now() - ageMs);
    await ActivityPubInboxMessageEntity.update(
      { createdAt: writtenAt, updatedAt: writtenAt },
      { where: { id }, silent: true },
    );
  };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await setupActivityPubSchema();
    sandbox = sinon.createSandbox();
    domain = buildDomain(new EventEmitter());
    stopDrain = undefined;

    await CalendarEntity.create({
      id: calendarId,
      url_name: 'inbox-drain-calendar',
      account_id: uuidv4(),
      languages: 'en',
    });

    // The drain goes through the real ActivityPubInterface.processInboxMessages
    // facade and the real query; only the per-row dispatch is replaced, to
    // record which rows were taken and mark them processed so the loop ends.
    dispatched = [];
    const inboxService = (domain.interface as unknown as { inboxService: ProcessInboxService }).inboxService;
    sandbox.stub(inboxService, 'processInboxMessage').callsFake(async (message: ActivityPubInboxMessageEntity) => {
      dispatched.push(message.id);
      await message.update({ processed_time: new Date(), processed_status: 'ok' });
    });
  });

  afterEach(async () => {
    stopDrain?.();
    sandbox.restore();
    vi.useRealTimers();
    await teardownActivityPubSchema();
  });

  it('the startup drain takes a row written inside the window', async () => {
    await insertInboxRow('https://remote.instance/activities/fresh', 0);

    stopDrain = domain.startInboxDrain();
    await settleDrain(domain);

    expect(dispatched).toEqual(['https://remote.instance/activities/fresh']);
  });

  it('an interval tick leaves a row written inside the window and takes an older one', async () => {
    stopDrain = domain.startInboxDrain();
    await settleDrain(domain);

    await insertInboxRow('https://remote.instance/activities/fresh', 0);
    await insertInboxRow('https://remote.instance/activities/old', INBOX_DRAIN_SKIP_NEWER_THAN_MS + 5_000);

    await vi.advanceTimersByTimeAsync(INBOX_DRAIN_INTERVAL_MS);
    await settleDrain(domain);

    expect(dispatched).toEqual(['https://remote.instance/activities/old']);
    const fresh = await ActivityPubInboxMessageEntity.findByPk('https://remote.instance/activities/fresh');
    expect(fresh!.processed_time).toBeNull();
  });
});
