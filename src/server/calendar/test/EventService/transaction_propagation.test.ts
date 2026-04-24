import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import type { Transaction } from 'sequelize';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { EventContentEntity, EventEntity, EventScheduleEntity } from '@/server/calendar/entity/event';
import EventService from '@/server/calendar/service/events';

/**
 * Coverage for pv-1qcp.14 — EventService transaction threading.
 *
 * When callers pass an optional `tx: Transaction` handle to createEvent /
 * updateEvent, every EventEntity / EventContentEntity / EventScheduleEntity
 * write issued by those methods must participate in that transaction so the
 * sync orchestrator's db.transaction rollback is atomic. When no tx is
 * passed, behavior is byte-identical to pre-pv-1qcp.14 (auto-commit per
 * write).
 */
describe('EventService transaction propagation', () => {
  const EVENT_ID = '33333333-3333-4333-8333-333333333333';
  const CALENDAR_ID = 'testCalendarId';

  let service: EventService;
  let bus: EventEmitter;
  let sandbox: sinon.SinonSandbox;
  let getCalendarStub: sinon.SinonStub;
  let editableCalendarsStub: sinon.SinonStub;

  const account = new Account('testAccountId', 'testme', 'testme');
  const calendar = new Calendar(CALENDAR_ID, 'testme');

  // A minimal stand-in for a Sequelize Transaction — the service should never
  // introspect it, only pass it through as options.transaction. Using a
  // branded sentinel object lets us assert the exact reference was propagated.
  const fakeTx = { __brand: 'fake-transaction' } as unknown as Transaction;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    bus = new EventEmitter();
    service = new EventService(bus);
    getCalendarStub = sandbox.stub(service['calendarService'], 'getCalendar');
    editableCalendarsStub = sandbox.stub(service['calendarService'], 'editableCalendarsForUser');
    getCalendarStub.resolves(calendar);
    editableCalendarsStub.resolves([calendar]);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('createEvent', () => {
    it('threads transaction into EventEntity.save, EventContent.save, and EventSchedule.save', async () => {
      const eventSaveStub = sandbox.stub(EventEntity.prototype, 'save').resolves();
      const contentSaveStub = sandbox.stub(EventContentEntity.prototype, 'save').resolves();
      const scheduleSaveStub = sandbox.stub(EventScheduleEntity.prototype, 'save').resolves();

      await service.createEvent(
        account,
        {
          calendarId: CALENDAR_ID,
          content: { en: { name: 'Test Event', description: 'd' } },
          schedules: [{ start: '2026-05-01T10:00:00Z', end: '2026-05-01T11:00:00Z' }],
        },
        { source: 'user' },
        fakeTx,
      );

      expect(eventSaveStub.calledOnce).toBe(true);
      expect(eventSaveStub.firstCall.args[0]).toEqual({ transaction: fakeTx });

      expect(contentSaveStub.calledOnce).toBe(true);
      expect(contentSaveStub.firstCall.args[0]).toEqual({ transaction: fakeTx });

      expect(scheduleSaveStub.calledOnce).toBe(true);
      expect(scheduleSaveStub.firstCall.args[0]).toEqual({ transaction: fakeTx });
    });

    it('omits transaction when no tx is supplied (backwards compatible)', async () => {
      const eventSaveStub = sandbox.stub(EventEntity.prototype, 'save').resolves();
      const contentSaveStub = sandbox.stub(EventContentEntity.prototype, 'save').resolves();
      const scheduleSaveStub = sandbox.stub(EventScheduleEntity.prototype, 'save').resolves();

      await service.createEvent(
        account,
        {
          calendarId: CALENDAR_ID,
          content: { en: { name: 'Test Event', description: 'd' } },
          schedules: [{ start: '2026-05-01T10:00:00Z', end: '2026-05-01T11:00:00Z' }],
        },
      );

      // When tx is undefined, Sequelize treats `{ transaction: undefined }` as
      // equivalent to no options. Assert the per-call options carry
      // transaction: undefined so the contract (pass-through) is exact.
      expect(eventSaveStub.firstCall.args[0]).toEqual({ transaction: undefined });
      expect(contentSaveStub.firstCall.args[0]).toEqual({ transaction: undefined });
      expect(scheduleSaveStub.firstCall.args[0]).toEqual({ transaction: undefined });
    });
  });

  describe('updateEvent', () => {
    it('threads transaction into eventEntity.save and reconcile destroys/updates', async () => {
      const findStub = sandbox.stub(EventEntity, 'findByPk');
      const eventSaveStub = sandbox.stub(EventEntity.prototype, 'save').resolves();
      const entity = EventEntity.build({
        id: EVENT_ID,
        calendar_id: CALENDAR_ID,
        import_source_id: null,
        locally_edited: false,
      });
      findStub.resolves(entity);

      await service.updateEvent(
        account,
        EVENT_ID,
        {},
        { source: 'user' },
        fakeTx,
      );

      expect(eventSaveStub.calledOnce).toBe(true);
      expect(eventSaveStub.firstCall.args[0]).toEqual({ transaction: fakeTx });
    });

    it('threads transaction into content update path', async () => {
      const findStub = sandbox.stub(EventEntity, 'findByPk');
      sandbox.stub(EventEntity.prototype, 'save').resolves();
      const entity = EventEntity.build({
        id: EVENT_ID,
        calendar_id: CALENDAR_ID,
        import_source_id: null,
        locally_edited: false,
      });
      findStub.resolves(entity);

      const contentEntity = EventContentEntity.build({
        event_id: EVENT_ID,
        language: 'en',
        name: 'Old',
      });
      const contentFindStub = sandbox.stub(EventContentEntity, 'findOne');
      contentFindStub.resolves(contentEntity);
      const contentUpdateStub = sandbox.stub(contentEntity, 'update').resolves(contentEntity as any);

      await service.updateEvent(
        account,
        EVENT_ID,
        { content: { en: { name: 'New' } } },
        { source: 'user' },
        fakeTx,
      );

      expect(contentUpdateStub.calledOnce).toBe(true);
      // .update(values, options) — options is the 2nd positional arg.
      expect(contentUpdateStub.firstCall.args[1]).toEqual({ transaction: fakeTx });
    });

    it('threads transaction into reconcileSchedules findAll and destroy', async () => {
      const findStub = sandbox.stub(EventEntity, 'findByPk');
      sandbox.stub(EventEntity.prototype, 'save').resolves();
      const entity = EventEntity.build({
        id: EVENT_ID,
        calendar_id: CALENDAR_ID,
        import_source_id: null,
        locally_edited: false,
      });
      findStub.resolves(entity);

      // Existing positive schedule that will be absent from the payload → destroyed
      const existingSchedule = EventScheduleEntity.build({
        id: 'existing-schedule-id',
        event_id: EVENT_ID,
        is_exclusion: false,
      });
      const findAllStub = sandbox.stub(EventScheduleEntity, 'findAll').resolves([existingSchedule]);
      const destroyStub = sandbox.stub(EventScheduleEntity, 'destroy').resolves(1);
      // New schedule in payload → createEventSchedule path → EventScheduleEntity.save
      const scheduleSaveStub = sandbox.stub(EventScheduleEntity.prototype, 'save').resolves();

      await service.updateEvent(
        account,
        EVENT_ID,
        {
          schedules: [{ start: '2026-05-01T10:00:00Z', end: '2026-05-01T11:00:00Z' }],
        },
        { source: 'user' },
        fakeTx,
      );

      // findAll receives transaction in its options
      expect(findAllStub.calledOnce).toBe(true);
      expect(findAllStub.firstCall.args[0]).toMatchObject({ transaction: fakeTx });

      // destroy receives transaction
      expect(destroyStub.calledOnce).toBe(true);
      expect(destroyStub.firstCall.args[0]).toMatchObject({ transaction: fakeTx });

      // new schedule's save receives transaction
      expect(scheduleSaveStub.calledOnce).toBe(true);
      expect(scheduleSaveStub.firstCall.args[0]).toEqual({ transaction: fakeTx });
    });

    it('omits transaction when no tx is supplied (backwards compatible)', async () => {
      const findStub = sandbox.stub(EventEntity, 'findByPk');
      const eventSaveStub = sandbox.stub(EventEntity.prototype, 'save').resolves();
      const entity = EventEntity.build({
        id: EVENT_ID,
        calendar_id: CALENDAR_ID,
        import_source_id: null,
        locally_edited: false,
      });
      findStub.resolves(entity);

      await service.updateEvent(account, EVENT_ID, {});

      expect(eventSaveStub.firstCall.args[0]).toEqual({ transaction: undefined });
    });
  });
});
