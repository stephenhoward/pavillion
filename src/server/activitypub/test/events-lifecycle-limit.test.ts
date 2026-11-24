import { EventEmitter } from 'events';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import config from 'config';

const { warnMock, mockLogError } = vi.hoisted(() => ({ warnMock: vi.fn(), mockLogError: vi.fn() }));

// The events module's logger is created at module scope and not exported, so
// its warnings are observed by wrapping the 'activitypub' child logger.
vi.mock('@/server/common/helper/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/common/helper/logger')>();
  return {
    ...actual,
    createLogger: (domain: string) => {
      const real = actual.createLogger(domain);
      if (domain !== 'activitypub') {
        return real;
      }
      const wrapped = Object.create(real);
      wrapped.warn = warnMock;
      return wrapped;
    },
  };
});

vi.mock('@/server/common/helper/error-logger', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/server/common/helper/error-logger')>(),
  logError: mockLogError,
}));

import ActivityPubEventHandlers from '@/server/activitypub/events';
import ActivityPubInterface from '@/server/activitypub/interface';
import CalendarInterface from '@/server/calendar/interface';
import { ActivityPubInboxMessageEntity, ActivityPubOutboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';

const LIFECYCLE_EVENTS = ['eventCreated', 'eventUpdated', 'eventDeleted'] as const;
const BOUND = 4;
const ACTOR_URL = 'https://local.example/calendars/limit_test';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

const lifecyclePayload = (i: number) => ({
  calendar: Calendar.fromObject({ id: 'limit-calendar', urlName: 'limit_test' }),
  event: CalendarEvent.fromObject({ id: `limit-event-${i}` }),
});

describe('event-lifecycle handler concurrency', () => {
  let sandbox: sinon.SinonSandbox;
  let eventBus: EventEmitter;
  let service: ActivityPubInterface;
  let handlers: ActivityPubEventHandlers;
  let actorUrlStub: sinon.SinonStub;
  let addToOutboxStub: sinon.SinonStub;
  /** One release function per lifecycle handler blocked in `actorUrl`, in start order. */
  let gates: Array<() => void>;

  /** Build handlers, optionally as if running on PostgreSQL, and install them. */
  const buildHandlers = (dialect: 'postgres' | 'sqlite'): void => {
    const getStub = sandbox.stub(config, 'get').callThrough();
    getStub.withArgs('database.dialect').returns(dialect);
    handlers = new ActivityPubEventHandlers(service, new CalendarInterface(eventBus), { publishJob: async () => {} } as any);
    getStub.restore();
    handlers.install(eventBus);
  };

  /** Release every handler currently blocked, and keep going until none remain. */
  const releaseAll = async (): Promise<void> => {
    while (gates.length > 0) {
      gates.splice(0).forEach(release => release());
      await flush();
    }
  };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    warnMock.mockClear();
    mockLogError.mockClear();
    gates = [];
    eventBus = new EventEmitter();
    service = new ActivityPubInterface(eventBus);

    // Every lifecycle handler with a calendar awaits actorUrl first, so a
    // call to it marks a handler as started and its gate holds it in flight.
    actorUrlStub = sandbox.stub(service, 'actorUrl').callsFake(
      () => new Promise<string>((resolve) => { gates.push(() => resolve(ACTOR_URL)); }),
    );
    addToOutboxStub = sandbox.stub(service, 'addToOutbox').resolves();
    sandbox.stub(EventObjectEntity, 'findOrCreate').resolves([{ attributed_to: ACTOR_URL } as any, true]);
  });

  afterEach(async () => {
    (handlers as any)?.lifecycleLimit.clearQueue();
    await releaseAll();
    sandbox.restore();
  });

  describe.each(LIFECYCLE_EVENTS)('on PostgreSQL, %s', (eventName) => {
    beforeEach(() => buildHandlers('postgres'));

    it(`has at most ${BOUND} handlers in flight and runs all 20 to completion`, async () => {
      for (let i = 0; i < 20; i++) {
        eventBus.emit(eventName, lifecyclePayload(i));
      }
      await flush();

      expect(actorUrlStub.callCount, 'handlers in flight').toBe(BOUND);
      expect(handlers.pendingDispatchCount, 'handlers queued').toBe(16);

      gates.shift()!();
      await flush();
      expect(actorUrlStub.callCount, 'releasing one handler starts exactly one more').toBe(BOUND + 1);
      expect(handlers.pendingDispatchCount).toBe(15);

      await releaseAll();
      expect(actorUrlStub.callCount).toBe(20);
      // Each handler writes a paired Event and Note activity.
      expect(addToOutboxStub.callCount, 'every handler completed').toBe(40);
      expect(handlers.pendingDispatchCount).toBe(0);
    });
  });

  describe('on PostgreSQL', () => {
    beforeEach(() => buildHandlers('postgres'));

    it('frees the slot of a rejecting handler, logs it, and raises no unhandled rejection', async () => {
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      try {
        const failure = new Error('outbox write failed');
        addToOutboxStub.onFirstCall().rejects(failure);

        for (let i = 0; i <= BOUND; i++) {
          eventBus.emit('eventDeleted', lifecyclePayload(i));
        }
        await flush();
        expect(actorUrlStub.callCount).toBe(BOUND);

        gates.shift()!();
        await flush();

        expect(mockLogError).toHaveBeenCalledWith(failure, '[ActivityPub] Domain-event handler failed');
        expect(actorUrlStub.callCount, 'the queued handler takes the freed slot').toBe(BOUND + 1);
        expect(unhandled).not.toHaveBeenCalled();
      }
      finally {
        process.off('unhandledRejection', unhandled);
      }
    });

    it('leaves outbox, inbox, calendar-created and runSerialized dispatch outside the limiter', async () => {
      for (let i = 0; i < BOUND + 3; i++) {
        eventBus.emit('eventCreated', lifecyclePayload(i));
      }
      await flush();
      expect(actorUrlStub.callCount).toBe(BOUND);
      expect(handlers.pendingDispatchCount).toBe(3);

      const outboxLookup = sandbox.stub(ActivityPubOutboxMessageEntity, 'findByPk').resolves(null);
      const inboxLookup = sandbox.stub(ActivityPubInboxMessageEntity, 'findByPk').resolves(null);
      const createActor = sandbox.stub((handlers as any).calendarActorService, 'createActor').resolves();
      const task = sandbox.stub().resolves();

      eventBus.emit('outboxMessageAdded', { id: 'outbox-row' });
      eventBus.emit('inboxMessageAdded', { id: 'inbox-row' });
      eventBus.emit('calendar.created', { calendarId: 'new-calendar', urlName: 'new_calendar', domain: 'local.example' });
      const run = handlers.runSerialized(task);
      await flush();

      expect(outboxLookup.calledOnce, 'outboxMessageAdded started').toBe(true);
      expect(inboxLookup.calledOnce, 'inboxMessageAdded started').toBe(true);
      expect(createActor.calledOnce, 'calendar.created started').toBe(true);
      expect(task.calledOnce, 'runSerialized task started').toBe(true);
      await run;
      expect(handlers.pendingDispatchCount, 'none of them joined the lifecycle queue').toBe(3);
    });

    it('invalidates the authorization cache on remoteEditorRevoked while the limiter is saturated', async () => {
      for (let i = 0; i < BOUND + 3; i++) {
        eventBus.emit('eventCreated', lifecyclePayload(i));
      }
      await flush();
      expect(actorUrlStub.callCount, 'limiter saturated').toBe(BOUND);
      expect(handlers.pendingDispatchCount).toBe(3);

      const invalidate = sandbox.stub(service, 'invalidateAuthorizationCache');
      eventBus.emit('remoteEditorRevoked', { calendarId: 'limit-calendar', actorUri: 'https://remote.example/users/editor' });
      await flush();

      expect(invalidate.calledOnceWithExactly('limit-calendar', 'https://remote.example/users/editor'), 'ran before any gate was released').toBe(true);
      expect(gates, 'no lifecycle gate was released').toHaveLength(BOUND);
      expect(handlers.pendingDispatchCount, 'did not join the lifecycle queue').toBe(3);
    });

    it('logs one count-only warning when the backlog reaches the threshold', async () => {
      const threshold = 1000;
      for (let i = 0; i < BOUND + threshold + 5; i++) {
        eventBus.emit('eventDeleted', lifecyclePayload(i));
      }

      const backlogWarnings = warnMock.mock.calls.filter(([, message]) => /backlog/.test(String(message)));
      expect(backlogWarnings).toHaveLength(1);
      expect(backlogWarnings[0][0], 'the warning carries the count and nothing from the payload').toEqual({ pendingCount: threshold });
      expect(handlers.pendingDispatchCount).toBe(threshold + 5);
    });
  });

  describe('on SQLite', () => {
    beforeEach(() => buildHandlers('sqlite'));

    it.each(LIFECYCLE_EVENTS)('keeps %s strictly serialized and reports no limiter backlog', async (eventName) => {
      for (let i = 0; i < 20; i++) {
        eventBus.emit(eventName, lifecyclePayload(i));
      }
      await flush();

      expect(actorUrlStub.callCount, 'handlers in flight').toBe(1);
      expect(handlers.pendingDispatchCount).toBe(0);

      await releaseAll();
      await (handlers as any)['dispatchQueue'];
      expect(actorUrlStub.callCount).toBe(20);
    });
  });
});
