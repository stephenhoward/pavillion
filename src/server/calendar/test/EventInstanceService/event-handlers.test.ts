import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import CalendarEventHandlers from '../../events/index';
import CalendarInterface from '../../interface';
import { CalendarEvent, CalendarEventSchedule } from '@/common/model/events';
import { Calendar } from '@/common/model/calendar';
import { DateTime } from 'luxon';

describe('CalendarEventHandlers', () => {
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
    schedule.count = null;
    schedule.isExclusion = false;
    schedule.byDay = [];
    event.schedules = [schedule];
    return event;
  }

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();

    // Create a stubbed CalendarInterface
    mockService = sandbox.createStubInstance(CalendarInterface);
    mockService.buildEventInstances.resolves();
    mockService.removeEventInstances.resolves();
    mockService.buildRepostInstances.resolves();
    mockService.rebuildAllRepostInstances.resolves();

    handlers = new CalendarEventHandlers(mockService as unknown as CalendarInterface);
    handlers.install(eventBus);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('eventCreated handler', () => {
    it('should call buildEventInstances with the event', async () => {
      const event = createTestEvent('event-1', 'calendar-1');
      const calendar = new Calendar('calendar-1', 'test-calendar');

      eventBus.emit('eventCreated', { event, calendar });

      // Allow async handler to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockService.buildEventInstances.calledOnce).toBe(true);
      expect(mockService.buildEventInstances.firstCall.args[0]).toBe(event);
    });
  });

  describe('eventUpdated handler', () => {
    it('should call buildEventInstances when calendar is present', async () => {
      const event = createTestEvent('event-1', 'calendar-1');
      const calendar = new Calendar('calendar-1', 'test-calendar');

      eventBus.emit('eventUpdated', { event, calendar });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockService.buildEventInstances.calledOnce).toBe(true);
      expect(mockService.buildEventInstances.firstCall.args[0]).toBe(event);
    });

    it('should skip buildEventInstances when calendar is null (remote event)', async () => {
      const event = createTestEvent('event-1', 'calendar-1');

      eventBus.emit('eventUpdated', { event, calendar: null });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockService.buildEventInstances.called).toBe(false);
    });

    it('should skip buildEventInstances when calendar is undefined', async () => {
      const event = createTestEvent('event-1', 'calendar-1');

      eventBus.emit('eventUpdated', { event, calendar: undefined });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockService.buildEventInstances.called).toBe(false);
    });

    it('should always call rebuildAllRepostInstances regardless of calendar presence', async () => {
      const event = createTestEvent('event-1', 'calendar-1');
      const calendar = new Calendar('calendar-1', 'test-calendar');

      eventBus.emit('eventUpdated', { event, calendar });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockService.rebuildAllRepostInstances.calledOnce).toBe(true);
      expect(mockService.rebuildAllRepostInstances.firstCall.args[0]).toBe(event);
    });

    it('should call rebuildAllRepostInstances even when calendar is null', async () => {
      const event = createTestEvent('event-1', 'calendar-1');

      eventBus.emit('eventUpdated', { event, calendar: null });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockService.rebuildAllRepostInstances.calledOnce).toBe(true);
      expect(mockService.rebuildAllRepostInstances.firstCall.args[0]).toBe(event);
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

  describe('eventReposted handler', () => {
    it('should call buildRepostInstances with the event and reposting calendar ID', async () => {
      const event = createTestEvent('event-1', 'original-calendar');
      const calendar = new Calendar('repost-calendar', 'repost-cal');

      eventBus.emit('eventReposted', { event, calendar });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockService.buildRepostInstances.calledOnce).toBe(true);
      expect(mockService.buildRepostInstances.firstCall.args[0]).toBe(event);
      expect(mockService.buildRepostInstances.firstCall.args[1]).toBe('repost-calendar');
    });

    it('should not call buildRepostInstances when calendar is missing', async () => {
      const event = createTestEvent('event-1', 'original-calendar');

      // Payload asymmetry: eventReposted should have { event, calendar } but
      // runtime guard protects against malformed payloads
      eventBus.emit('eventReposted', { event, calendar: null });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockService.buildRepostInstances.called).toBe(false);
    });

    it('should not call buildRepostInstances when calendar has no id', async () => {
      const event = createTestEvent('event-1', 'original-calendar');

      eventBus.emit('eventReposted', { event, calendar: {} });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockService.buildRepostInstances.called).toBe(false);
    });
  });

  describe('eventUnreposted handler', () => {
    it('should call removeRepostInstances with eventId and calendarId', async () => {
      // Note: eventUnreposted payload is intentionally asymmetric with eventReposted.
      // eventReposted sends { event: CalendarEvent, calendar: Calendar } because the
      // full event is needed to generate instances. eventUnreposted sends primitive IDs
      // { eventId, calendarId } because only deletion (by compound key) is needed.
      mockService.removeRepostInstances = sandbox.stub().resolves();

      // Re-install handlers to pick up the new stub
      const freshHandlers = new CalendarEventHandlers(mockService as unknown as CalendarInterface);
      const freshBus = new EventEmitter();
      freshHandlers.install(freshBus);

      freshBus.emit('eventUnreposted', { eventId: 'event-1', calendarId: 'repost-calendar' });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockService.removeRepostInstances.calledOnce).toBe(true);
      expect(mockService.removeRepostInstances.firstCall.args[0]).toBe('event-1');
      expect(mockService.removeRepostInstances.firstCall.args[1]).toBe('repost-calendar');
    });

    it('should not call removeRepostInstances when eventId is missing', async () => {
      mockService.removeRepostInstances = sandbox.stub().resolves();

      const freshHandlers = new CalendarEventHandlers(mockService as unknown as CalendarInterface);
      const freshBus = new EventEmitter();
      freshHandlers.install(freshBus);

      freshBus.emit('eventUnreposted', { eventId: '', calendarId: 'repost-calendar' });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockService.removeRepostInstances.called).toBe(false);
    });

    it('should not call removeRepostInstances when calendarId is missing', async () => {
      mockService.removeRepostInstances = sandbox.stub().resolves();

      const freshHandlers = new CalendarEventHandlers(mockService as unknown as CalendarInterface);
      const freshBus = new EventEmitter();
      freshHandlers.install(freshBus);

      freshBus.emit('eventUnreposted', { eventId: 'event-1', calendarId: '' });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockService.removeRepostInstances.called).toBe(false);
    });
  });
});
