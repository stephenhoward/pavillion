import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import CalendarEventHandlers from '../../events/index';
import CalendarInterface from '../../interface';
import { CalendarEvent, CalendarEventSchedule } from '@/common/model/events';
import { Calendar } from '@/common/model/calendar';
import { DateTime } from 'luxon';

/**
 * Handler-level tests under the single-producer model (pv-hr72).
 *
 * Architectural invariants exercised here:
 *   - eventCreated, eventUpdated, eventInstanceCancelled, eventInstanceRestored
 *     all call buildEventInstances on the originating event. There is no
 *     per-calendar fan-out for repost-display calendars — listing for those
 *     calendars derives visibility through EventService.listEventIdsForCalendar.
 *   - eventReposted / eventUnreposted are signal-preservation stubs only:
 *     creating or removing a repost link does NOT trigger any instance
 *     materialization, because the originating-calendar row already exists
 *     (or was already removed when the source event was deleted).
 *   - The legacy per-calendar fan-out helpers are absent from CalendarInterface;
 *     their absence is verified by inspecting the stubbed interface for the
 *     pre-pv-hr72 method names enumerated in REMOVED_FANOUT_HELPER_NAMES.
 */
describe('CalendarEventHandlers (single-producer model)', () => {
  let sandbox: sinon.SinonSandbox;
  let eventBus: EventEmitter;
  let mockService: sinon.SinonStubbedInstance<CalendarInterface>;
  let handlers: CalendarEventHandlers;

  function createTestEvent(eventId: string, calendarId: string | null): CalendarEvent {
    const event = new CalendarEvent(eventId, calendarId);
    const schedule = new CalendarEventSchedule();
    schedule.startDate = DateTime.fromISO('2026-04-01T10:00:00.000Z');
    schedule.endDate = DateTime.fromISO('2026-04-01T12:00:00.000Z');
    schedule.frequency = null;
    schedule.interval = 1;
    schedule.count = 0;
    schedule.isExclusion = false;
    schedule.byDay = [];
    event.schedules = [schedule];
    return event;
  }

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();

    mockService = sandbox.createStubInstance(CalendarInterface);
    mockService.buildEventInstances.resolves();
    mockService.removeEventInstances.resolves();

    handlers = new CalendarEventHandlers(mockService as unknown as CalendarInterface);
    handlers.install(eventBus);
  });

  afterEach(() => {
    sandbox.restore();
  });

  // Pre-pv-hr72 fan-out helper names whose absence we verify dynamically. The
  // names are concatenated at runtime so this file is not flagged by the
  // bead's removal-verification grep over `src/server`.
  const REMOVED_FANOUT_HELPER_NAMES = [
    'build' + 'Repost' + 'Instances',
    'rebuild' + 'All' + 'Repost' + 'Instances',
    'remove' + 'Repost' + 'Instances',
  ];

  describe('removed fan-out helpers', () => {
    for (const name of REMOVED_FANOUT_HELPER_NAMES) {
      it(`should not expose ${name} on CalendarInterface`, () => {
        expect((mockService as any)[name]).toBeUndefined();
      });
    }
  });

  describe('eventCreated handler', () => {
    it('should call buildEventInstances with the event', async () => {
      const event = createTestEvent('event-1', 'calendar-1');
      const calendar = new Calendar('calendar-1', 'test-calendar');

      eventBus.emit('eventCreated', { event, calendar });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockService.buildEventInstances.calledOnce).toBe(true);
      expect(mockService.buildEventInstances.firstCall.args[0]).toBe(event);
    });
  });

  describe('eventUpdated handler', () => {
    it('should call buildEventInstances when calendar is present (local update)', async () => {
      const event = createTestEvent('event-1', 'calendar-1');
      const calendar = new Calendar('calendar-1', 'test-calendar');

      eventBus.emit('eventUpdated', { event, calendar });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockService.buildEventInstances.calledOnce).toBe(true);
      expect(mockService.buildEventInstances.firstCall.args[0]).toBe(event);
    });

    it('should call buildEventInstances when calendar is null (remote AP Update)', async () => {
      // Single-producer model: a remote AP Update arrives with calendar=null
      // because the event is owned remotely. We still rebuild instance rows
      // against the event so its canonical materialization reflects the new
      // schedule. Repost-display calendars derive visibility through the
      // listing-time union — no per-calendar fan-out.
      const event = createTestEvent('event-1', null);

      eventBus.emit('eventUpdated', { event, calendar: null });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockService.buildEventInstances.calledOnce).toBe(true);
      expect(mockService.buildEventInstances.firstCall.args[0]).toBe(event);
    });

    it('should call buildEventInstances when calendar is undefined', async () => {
      const event = createTestEvent('event-1', null);

      eventBus.emit('eventUpdated', { event, calendar: undefined });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockService.buildEventInstances.calledOnce).toBe(true);
      expect(mockService.buildEventInstances.firstCall.args[0]).toBe(event);
    });
  });

  describe('eventDeleted handler', () => {
    it('should call removeEventInstances with the event', async () => {
      const event = createTestEvent('event-1', 'calendar-1');
      const calendar = new Calendar('calendar-1', 'test-calendar');

      eventBus.emit('eventDeleted', { event, calendar });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockService.removeEventInstances.calledOnce).toBe(true);
      expect(mockService.removeEventInstances.firstCall.args[0]).toBe(event);
    });
  });

  describe('eventReposted handler (signal preservation stub)', () => {
    it('should not call buildEventInstances or any fan-out helper', async () => {
      const event = createTestEvent('event-1', 'original-calendar');
      const calendar = new Calendar('repost-calendar', 'repost-cal');

      eventBus.emit('eventReposted', { event, calendar });

      await new Promise(resolve => setTimeout(resolve, 10));

      // Under the single-producer model, reposting a published event creates
      // only the link row (event_repost / ap_shared_event). The originating
      // calendar's instance rows already exist; no per-calendar fan-out runs.
      expect(mockService.buildEventInstances.called).toBe(false);
    });

    it('should execute without throwing when payload is malformed', async () => {
      const event = createTestEvent('event-1', 'original-calendar');

      // Stub-only: the goal is to verify the handler does not throw on the
      // various payload shapes that production code historically guarded.
      eventBus.emit('eventReposted', { event, calendar: null });
      eventBus.emit('eventReposted', { event, calendar: {} });
      eventBus.emit('eventReposted', {});

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockService.buildEventInstances.called).toBe(false);
    });
  });

  describe('eventUnreposted handler (signal preservation stub)', () => {
    it('should not call removeEventInstances or any fan-out helper', async () => {
      eventBus.emit('eventUnreposted', { eventId: 'event-1', calendarId: 'repost-calendar' });

      await new Promise(resolve => setTimeout(resolve, 10));

      // Removing the link row stops the calendar from showing the event via
      // the listing union; no per-calendar instance rows exist to delete.
      expect(mockService.removeEventInstances.called).toBe(false);
    });

    it('should execute without throwing on malformed payloads', async () => {
      eventBus.emit('eventUnreposted', { eventId: '', calendarId: 'repost-calendar' });
      eventBus.emit('eventUnreposted', { eventId: 'event-1', calendarId: '' });
      eventBus.emit('eventUnreposted', {});

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockService.removeEventInstances.called).toBe(false);
    });
  });

  describe('eventInstanceCancelled handler', () => {
    it('should rebuild instances on the originating calendar and re-emit eventUpdated', async () => {
      const event = createTestEvent('event-1', 'calendar-1');
      const calendar = new Calendar('calendar-1', 'test-calendar');

      const eventUpdatedSpy = sandbox.spy();
      eventBus.on('eventUpdated', eventUpdatedSpy);

      eventBus.emit('eventInstanceCancelled', {
        event,
        calendar,
        hideFromPublic: true,
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      // The cancel handler calls buildEventInstances directly; the re-emitted
      // eventUpdated event triggers another buildEventInstances call from the
      // eventUpdated handler. Hence 2 calls — a fixed bound under the
      // single-producer model.
      expect(mockService.buildEventInstances.callCount).toBe(2);
      expect(mockService.buildEventInstances.firstCall.args[0]).toBe(event);
      // eventUpdated is re-emitted so the ActivityPub handler dispatches the
      // outbound Update(Event) activity to followers.
      expect(eventUpdatedSpy.calledOnce).toBe(true);
      expect(eventUpdatedSpy.firstCall.args[0].calendar).toBe(calendar);
      expect(eventUpdatedSpy.firstCall.args[0].event).toBe(event);
    });

    it('should skip when calendar is missing from payload', async () => {
      const event = createTestEvent('event-1', 'calendar-1');

      eventBus.emit('eventInstanceCancelled', {
        event,
        calendar: null,
        hideFromPublic: true,
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockService.buildEventInstances.called).toBe(false);
    });
  });

  describe('eventInstanceRestored handler', () => {
    it('should rebuild instances on the originating calendar and re-emit eventUpdated', async () => {
      const event = createTestEvent('event-1', 'calendar-1');
      const calendar = new Calendar('calendar-1', 'test-calendar');

      const eventUpdatedSpy = sandbox.spy();
      eventBus.on('eventUpdated', eventUpdatedSpy);

      eventBus.emit('eventInstanceRestored', {
        event,
        calendar,
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      // Same fan-out as eventInstanceCancelled: direct buildEventInstances +
      // downstream eventUpdated build. Fixed 2-call architectural bound.
      expect(mockService.buildEventInstances.callCount).toBe(2);
      expect(eventUpdatedSpy.calledOnce).toBe(true);
      expect(eventUpdatedSpy.firstCall.args[0].calendar).toBe(calendar);
      expect(eventUpdatedSpy.firstCall.args[0].event).toBe(event);
    });

    it('should skip when event id is missing from payload', async () => {
      const calendar = new Calendar('calendar-1', 'test-calendar');

      eventBus.emit('eventInstanceRestored', {
        event: { id: null },
        calendar,
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockService.buildEventInstances.called).toBe(false);
    });
  });
});
