import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import type { Transaction } from 'sequelize';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { EventContentEntity, EventEntity, EventScheduleEntity } from '@/server/calendar/entity/event';
import { EventImportOriginEntity } from '@/server/calendar/entity/event_import_origin';
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

  // A minimal stand-in for a Sequelize Transaction — used to assert the exact
  // reference was propagated as options.transaction. afterCommit is a no-op
  // because these tests do not exercise the post-commit emit path.
  const fakeTx = {
    __brand: 'fake-transaction',
    afterCommit: () => {},
  } as unknown as Transaction;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    bus = new EventEmitter();
    service = new EventService(bus);
    getCalendarStub = sandbox.stub(service['calendarService'], 'getCalendar');
    editableCalendarsStub = sandbox.stub(service['calendarService'], 'editableCalendarsForUser');
    getCalendarStub.resolves(calendar);
    editableCalendarsStub.resolves([calendar]);
    // Default: no origin row exists. Individual tests that care about the
    // sibling-table flip path override this stub (via sandbox) with a real
    // origin row.
    sandbox.stub(EventImportOriginEntity, 'findOne').resolves(null);
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

      // The content lookup that decides update-vs-destroy must read inside the
      // caller's transaction snapshot (pv-i7n3).
      expect(contentFindStub.calledOnce).toBe(true);
      expect(contentFindStub.firstCall.args[0]).toMatchObject({ transaction: fakeTx });

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

    it('threads transaction into reconcileSchedules update of a matching existing schedule', async () => {
      // reconcileSchedules branch (A): an incoming schedule carrying an id that
      // matches an existing positive row is updated in place via
      // scheduleEntity.update(values, { transaction: tx }). The sibling B/C
      // branches (create new / destroy absent) are covered above; this asserts
      // the update branch threads the caller's transaction (events.ts:1360).
      const findStub = sandbox.stub(EventEntity, 'findByPk');
      sandbox.stub(EventEntity.prototype, 'save').resolves();
      const entity = EventEntity.build({
        id: EVENT_ID,
        calendar_id: CALENDAR_ID,
      });
      findStub.resolves(entity);

      // Existing positive schedule whose id is also present in the payload →
      // update branch (so it is not destroyed and not re-created).
      const existingSchedule = EventScheduleEntity.build({
        id: 'existing-schedule-id',
        event_id: EVENT_ID,
        is_exclusion: false,
      });
      sandbox.stub(EventScheduleEntity, 'findAll').resolves([existingSchedule]);
      const scheduleUpdateStub = sandbox
        .stub(existingSchedule, 'update')
        .resolves(existingSchedule as any);

      await service.updateEvent(
        account,
        EVENT_ID,
        {
          schedules: [
            { id: 'existing-schedule-id', start: '2026-05-01T10:00:00Z', end: '2026-05-01T11:00:00Z' },
          ],
        },
        { source: 'user' },
        fakeTx,
      );

      // The matched row's in-place update participates in the caller's tx.
      expect(scheduleUpdateStub.calledOnce).toBe(true);
      // .update(values, options) — options is the 2nd positional arg.
      expect(scheduleUpdateStub.firstCall.args[1]).toEqual({ transaction: fakeTx });
    });

    it('omits transaction when no tx is supplied (backwards compatible)', async () => {
      const findStub = sandbox.stub(EventEntity, 'findByPk');
      const eventSaveStub = sandbox.stub(EventEntity.prototype, 'save').resolves();
      const entity = EventEntity.build({
        id: EVENT_ID,
        calendar_id: CALENDAR_ID,
      });
      findStub.resolves(entity);

      await service.updateEvent(account, EVENT_ID, {});

      expect(eventSaveStub.firstCall.args[0]).toEqual({ transaction: undefined });
    });

    it('threads transaction into the origin-row save when flipping locally_edited', async () => {
      // pv-picz invariant: the locally_edited flip lives on the sibling
      // EventImportOriginEntity row. When a tx is supplied, the origin
      // save() must carry it so the flip participates in the same
      // transaction as the EventEntity save — otherwise a rollback would
      // leave a dangling true on the origin row.
      const findStub = sandbox.stub(EventEntity, 'findByPk');
      sandbox.stub(EventEntity.prototype, 'save').resolves();
      const entity = EventEntity.build({
        id: EVENT_ID,
        calendar_id: CALENDAR_ID,
      });
      findStub.resolves(entity);

      // Override the default null-origin stub with a real origin row so the
      // flip path is exercised.
      (EventImportOriginEntity.findOne as sinon.SinonStub).restore();
      const originSave = sinon.stub().resolves();
      const origin = {
        event_id: EVENT_ID,
        import_source_id: '22222222-2222-4222-8222-222222222222',
        save: originSave,
      } as unknown as EventImportOriginEntity;
      const originFindStub = sandbox.stub(EventImportOriginEntity, 'findOne').resolves(origin);

      await service.updateEvent(account, EVENT_ID, {}, { source: 'user' }, fakeTx);

      // Lookup participates in the caller's transaction.
      expect(originFindStub.firstCall.args[0]).toMatchObject({ transaction: fakeTx });
      // Save participates in the caller's transaction.
      expect(originSave.calledOnce).toBe(true);
      expect(originSave.firstCall.args[0]).toEqual({ transaction: fakeTx });
    });
  });
});
