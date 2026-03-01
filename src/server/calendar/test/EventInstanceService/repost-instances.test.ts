import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import EventInstanceService from '../../service/event_instance';
import { CalendarEvent, CalendarEventSchedule } from '@/common/model/events';
import { EventScheduleEntity } from '../../entity/event';
import { EventInstanceEntity } from '../../entity/event_instance';
import { EventRepostEntity } from '../../entity/event_repost';
import { SharedEventEntity } from '@/server/activitypub/entity/activitypub';
import { CalendarEntity } from '../../entity/calendar';
import { DateTime } from 'luxon';

describe('EventInstanceService repost instance methods', () => {
  let sandbox: sinon.SinonSandbox;
  let service: EventInstanceService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new EventInstanceService(new EventEmitter());
  });

  afterEach(() => {
    sandbox.restore();
  });

  /**
   * Helper to create a CalendarEvent with a single-date schedule.
   */
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

  describe('removeRepostInstances', () => {
    it('should delete all instances for the given event and calendar pair', async () => {
      const destroyStub = sandbox.stub(EventInstanceEntity, 'destroy').resolves(3);

      await service.removeRepostInstances('event-123', 'calendar-456');

      expect(destroyStub.calledOnce).toBe(true);
      expect(destroyStub.firstCall.args[0]).toEqual({
        where: {
          event_id: 'event-123',
          calendar_id: 'calendar-456',
        },
      });
    });

    it('should guard against empty eventId', async () => {
      const destroyStub = sandbox.stub(EventInstanceEntity, 'destroy').resolves(0);

      await service.removeRepostInstances('', 'calendar-456');

      expect(destroyStub.called).toBe(false);
    });

    it('should guard against empty calendarId', async () => {
      const destroyStub = sandbox.stub(EventInstanceEntity, 'destroy').resolves(0);

      await service.removeRepostInstances('event-123', '');

      expect(destroyStub.called).toBe(false);
    });
  });

  describe('buildRepostInstances', () => {
    it('should remove existing instances then create new ones (idempotent)', async () => {
      const event = createTestEvent('event-123', 'original-calendar');
      const repostCalendarId = 'repost-calendar-456';

      const destroyStub = sandbox.stub(EventInstanceEntity, 'destroy').resolves(0);
      const saveStub = sandbox.stub(EventInstanceEntity.prototype, 'save').resolves();
      sandbox.stub(EventInstanceEntity, 'build').returns({
        save: saveStub,
        calendar_id: '',
      } as any);

      await service.buildRepostInstances(event, repostCalendarId);

      // Should have called destroy for the removal step
      expect(destroyStub.calledOnce).toBe(true);
      expect(destroyStub.firstCall.args[0]).toEqual({
        where: {
          event_id: 'event-123',
          calendar_id: repostCalendarId,
        },
      });
    });

    it('should load schedules from DB if not populated on event', async () => {
      const event = new CalendarEvent('event-123', 'original-calendar');
      event.schedules = [];
      const repostCalendarId = 'repost-calendar-456';

      sandbox.stub(EventInstanceEntity, 'destroy').resolves(0);

      const mockSchedule = {
        toModel: sandbox.stub().returns({
          startDate: DateTime.fromISO('2026-04-01T10:00:00.000Z'),
          endDate: DateTime.fromISO('2026-04-01T12:00:00.000Z'),
          frequency: null,
          interval: 1,
          count: null,
          isExclusion: false,
          byDay: [],
        }),
      };
      sandbox.stub(EventScheduleEntity, 'findAll').resolves([mockSchedule as any]);

      const saveStub = sandbox.stub(EventInstanceEntity.prototype, 'save').resolves();
      sandbox.stub(EventInstanceEntity, 'build').returns({
        save: saveStub,
        calendar_id: '',
      } as any);

      await service.buildRepostInstances(event, repostCalendarId);

      expect((EventScheduleEntity.findAll as sinon.SinonStub).calledOnce).toBe(true);
      expect((EventScheduleEntity.findAll as sinon.SinonStub).firstCall.args[0]).toEqual({
        where: { event_id: event.id },
        order: [['start_date', 'ASC']],
      });
    });

    it('should create instances with the repost calendar_id, not the original', async () => {
      const event = createTestEvent('event-123', 'original-calendar');
      const repostCalendarId = 'repost-calendar-456';

      sandbox.stub(EventInstanceEntity, 'destroy').resolves(0);

      const savedEntities: any[] = [];
      sandbox.stub(EventInstanceEntity, 'build').callsFake((data: any) => {
        const entity = { ...data, save: sandbox.stub().resolves() };
        savedEntities.push(entity);
        return entity as any;
      });

      await service.buildRepostInstances(event, repostCalendarId);

      expect(savedEntities.length).toBeGreaterThan(0);
      for (const entity of savedEntities) {
        expect(entity.calendar_id).toBe(repostCalendarId);
      }
    });
  });

  describe('rebuildAllRepostInstances', () => {
    it('should query both EventRepostEntity and SharedEventEntity', async () => {
      const event = createTestEvent('event-123', 'original-calendar');

      const repostFindAllStub = sandbox.stub(EventRepostEntity, 'findAll').resolves([]);
      const sharedFindAllStub = sandbox.stub(SharedEventEntity, 'findAll').resolves([]);

      await service.rebuildAllRepostInstances(event);

      expect(repostFindAllStub.calledOnce).toBe(true);
      expect(repostFindAllStub.firstCall.args[0]).toEqual({
        where: { event_id: event.id },
      });
      expect(sharedFindAllStub.calledOnce).toBe(true);
      expect(sharedFindAllStub.firstCall.args[0]).toEqual({
        where: { event_id: event.id },
      });
    });

    it('should filter out the original calendar', async () => {
      const event = createTestEvent('event-123', 'original-calendar');

      sandbox.stub(EventRepostEntity, 'findAll').resolves([
        { calendar_id: 'original-calendar' } as any,
        { calendar_id: 'repost-calendar-1' } as any,
      ]);
      sandbox.stub(SharedEventEntity, 'findAll').resolves([]);

      sandbox.stub(CalendarEntity, 'findByPk').resolves({ id: 'repost-calendar-1' } as any);

      const destroyStub = sandbox.stub(EventInstanceEntity, 'destroy').resolves(0);
      const saveStub = sandbox.stub(EventInstanceEntity.prototype, 'save').resolves();
      sandbox.stub(EventInstanceEntity, 'build').returns({
        save: saveStub,
        calendar_id: '',
      } as any);

      await service.rebuildAllRepostInstances(event);

      // destroy should only be called for 'repost-calendar-1', not 'original-calendar'
      const destroyCalls = destroyStub.getCalls();
      const calendarIds = destroyCalls.map(c => c.args[0]?.where?.calendar_id);
      expect(calendarIds).not.toContain('original-calendar');
      expect(calendarIds).toContain('repost-calendar-1');
    });

    it('should deduplicate calendars across EventRepostEntity and SharedEventEntity', async () => {
      const event = createTestEvent('event-123', 'original-calendar');

      sandbox.stub(EventRepostEntity, 'findAll').resolves([
        { calendar_id: 'repost-calendar-1' } as any,
      ]);
      sandbox.stub(SharedEventEntity, 'findAll').resolves([
        { calendar_id: 'repost-calendar-1' } as any,
      ]);

      sandbox.stub(CalendarEntity, 'findByPk').resolves({ id: 'repost-calendar-1' } as any);

      const destroyStub = sandbox.stub(EventInstanceEntity, 'destroy').resolves(0);
      const saveStub = sandbox.stub(EventInstanceEntity.prototype, 'save').resolves();
      sandbox.stub(EventInstanceEntity, 'build').returns({
        save: saveStub,
        calendar_id: '',
      } as any);

      await service.rebuildAllRepostInstances(event);

      // Should only rebuild once despite appearing in both tables
      const destroyCalls = destroyStub.getCalls().filter(
        c => c.args[0]?.where?.calendar_id === 'repost-calendar-1',
      );
      expect(destroyCalls.length).toBe(1);
    });

    it('should skip calendars that no longer exist', async () => {
      const event = createTestEvent('event-123', 'original-calendar');

      sandbox.stub(EventRepostEntity, 'findAll').resolves([
        { calendar_id: 'deleted-calendar' } as any,
        { calendar_id: 'existing-calendar' } as any,
      ]);
      sandbox.stub(SharedEventEntity, 'findAll').resolves([]);

      const findByPkStub = sandbox.stub(CalendarEntity, 'findByPk');
      findByPkStub.withArgs('deleted-calendar').resolves(null);
      findByPkStub.withArgs('existing-calendar').resolves({ id: 'existing-calendar' } as any);

      const destroyStub = sandbox.stub(EventInstanceEntity, 'destroy').resolves(0);
      const saveStub = sandbox.stub(EventInstanceEntity.prototype, 'save').resolves();
      sandbox.stub(EventInstanceEntity, 'build').returns({
        save: saveStub,
        calendar_id: '',
      } as any);

      await service.rebuildAllRepostInstances(event);

      // Should only build for existing-calendar, not deleted-calendar
      const destroyCalls = destroyStub.getCalls();
      const calendarIds = destroyCalls.map(c => c.args[0]?.where?.calendar_id);
      expect(calendarIds).not.toContain('deleted-calendar');
      expect(calendarIds).toContain('existing-calendar');
    });

    it('should handle events with no reposts gracefully', async () => {
      const event = createTestEvent('event-123', 'original-calendar');

      sandbox.stub(EventRepostEntity, 'findAll').resolves([]);
      sandbox.stub(SharedEventEntity, 'findAll').resolves([]);

      const destroyStub = sandbox.stub(EventInstanceEntity, 'destroy').resolves(0);

      await service.rebuildAllRepostInstances(event);

      expect(destroyStub.called).toBe(false);
    });
  });
});
