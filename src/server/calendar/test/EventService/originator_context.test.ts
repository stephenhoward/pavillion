import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import type { Transaction } from 'sequelize';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { EventEntity } from '@/server/calendar/entity/event';
import { EventImportOriginEntity } from '@/server/calendar/entity/event_import_origin';
import EventService from '@/server/calendar/service/events';

/**
 * Coverage for EventService originator context after the pv-picz origin-refactor.
 *
 * The locally_edited flip now lives on the sibling EventImportOriginEntity
 * row, not on EventEntity. A user-driven update to an imported event calls
 * EventImportOriginEntity.findOne({ event_id }) and — if a row exists —
 * sets origin.locally_edited = true and saves it. Non-imported events have
 * no origin row; the SELECT returns null and the flip is a no-op.
 *
 * createEvent is now a thin pass-through with respect to provenance: the
 * service never stamps import_source_id / source_last_seen_at /
 * locally_edited on the EventEntity regardless of context. Origin-provenance
 * is stamped by the sync orchestrator (SyncService.stampImportOrigin) after
 * createEvent returns.
 */
describe('EventService originator context', () => {
  const EVENT_ID = '11111111-1111-4111-8111-111111111111';
  const IMPORT_SOURCE_ID = '22222222-2222-4222-8222-222222222222';
  const CALENDAR_ID = 'testCalendarId';

  let service: EventService;
  let bus: EventEmitter;
  let sandbox: sinon.SinonSandbox;
  let getCalendarStub: sinon.SinonStub;
  let editableCalendarsStub: sinon.SinonStub;

  const account = new Account('testAccountId', 'testme', 'testme');
  const calendar = new Calendar(CALENDAR_ID, 'testme');

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

  describe('updateEvent', () => {
    it('flips locally_edited=true on the origin row when a user updates an imported event', async () => {
      const findStub = sandbox.stub(EventEntity, 'findByPk');
      sandbox.stub(EventEntity.prototype, 'save');
      const entity = EventEntity.build({
        id: EVENT_ID,
        calendar_id: CALENDAR_ID,
      });
      findStub.resolves(entity);

      // Fake origin row on the sibling table. `save` is a spy so we can
      // assert the flip was persisted.
      const originSave = sinon.stub().resolves();
      const origin = {
        event_id: EVENT_ID,
        import_source_id: IMPORT_SOURCE_ID,
        locally_edited: false,
        save: originSave,
      } as unknown as EventImportOriginEntity;
      const originFindStub = sandbox.stub(EventImportOriginEntity, 'findOne').resolves(origin);

      await service.updateEvent(account, EVENT_ID, {});

      expect(originFindStub.calledOnce).toBe(true);
      expect(originFindStub.firstCall.args[0]).toMatchObject({ where: { event_id: EVENT_ID } });
      expect(origin.locally_edited).toBe(true);
      expect(originSave.calledOnce).toBe(true);
    });

    it('explicit user context flips locally_edited on the origin row', async () => {
      const findStub = sandbox.stub(EventEntity, 'findByPk');
      sandbox.stub(EventEntity.prototype, 'save');
      const entity = EventEntity.build({
        id: EVENT_ID,
        calendar_id: CALENDAR_ID,
      });
      findStub.resolves(entity);

      const originSave = sinon.stub().resolves();
      const origin = {
        event_id: EVENT_ID,
        import_source_id: IMPORT_SOURCE_ID,
        locally_edited: false,
        save: originSave,
      } as unknown as EventImportOriginEntity;
      sandbox.stub(EventImportOriginEntity, 'findOne').resolves(origin);

      await service.updateEvent(account, EVENT_ID, {}, { source: 'user' });

      expect(origin.locally_edited).toBe(true);
      expect(originSave.calledOnce).toBe(true);
    });

    it('import-context updateEvent never queries or saves the origin row', async () => {
      const findStub = sandbox.stub(EventEntity, 'findByPk');
      sandbox.stub(EventEntity.prototype, 'save');
      const entity = EventEntity.build({
        id: EVENT_ID,
        calendar_id: CALENDAR_ID,
      });
      findStub.resolves(entity);

      const originFindStub = sandbox.stub(EventImportOriginEntity, 'findOne');
      // Even though we stub it, the assertion below verifies findOne was
      // never called — the 'import' branch skips the entire flip block.

      await service.updateEvent(account, EVENT_ID, {}, { source: 'import' });

      expect(originFindStub.called).toBe(false);
    });

    it('user update on a non-imported event: findOne returns null, no throw', async () => {
      const findStub = sandbox.stub(EventEntity, 'findByPk');
      sandbox.stub(EventEntity.prototype, 'save');
      const entity = EventEntity.build({
        id: EVENT_ID,
        calendar_id: CALENDAR_ID,
      });
      findStub.resolves(entity);

      // No origin row exists for this event.
      const originFindStub = sandbox.stub(EventImportOriginEntity, 'findOne').resolves(null);

      // Should not throw; nothing to flip, and save was never called on a
      // non-existent origin row.
      await expect(service.updateEvent(account, EVENT_ID, {})).resolves.toBeDefined();
      expect(originFindStub.calledOnce).toBe(true);
    });

    it('threads tx into origin.save when a transaction is supplied by the caller', async () => {
      const fakeTx = { __brand: 'fake-transaction' } as unknown as Transaction;
      const findStub = sandbox.stub(EventEntity, 'findByPk');
      sandbox.stub(EventEntity.prototype, 'save');
      const entity = EventEntity.build({
        id: EVENT_ID,
        calendar_id: CALENDAR_ID,
      });
      findStub.resolves(entity);

      const originSave = sinon.stub().resolves();
      const origin = {
        event_id: EVENT_ID,
        import_source_id: IMPORT_SOURCE_ID,
        locally_edited: false,
        save: originSave,
      } as unknown as EventImportOriginEntity;
      const originFindStub = sandbox.stub(EventImportOriginEntity, 'findOne').resolves(origin);

      await service.updateEvent(account, EVENT_ID, {}, { source: 'user' }, fakeTx);

      // findOne must carry the tx so the lookup participates in the caller's
      // transaction.
      expect(originFindStub.firstCall.args[0]).toMatchObject({ transaction: fakeTx });
      // save must carry the tx so the flip is persisted inside the same tx.
      expect(originSave.firstCall.args[0]).toEqual({ transaction: fakeTx });
    });

    it('emits eventUpdated on user path', async () => {
      const findStub = sandbox.stub(EventEntity, 'findByPk');
      sandbox.stub(EventEntity.prototype, 'save');
      const entity = EventEntity.build({
        id: EVENT_ID,
        calendar_id: CALENDAR_ID,
      });
      findStub.resolves(entity);
      sandbox.stub(EventImportOriginEntity, 'findOne').resolves(null);

      const listener = sandbox.spy();
      bus.on('eventUpdated', listener);

      await service.updateEvent(account, EVENT_ID, {}, { source: 'user' });

      expect(listener.calledOnce).toBe(true);
    });

    it('emits eventUpdated on import path (required for AP federation)', async () => {
      const findStub = sandbox.stub(EventEntity, 'findByPk');
      sandbox.stub(EventEntity.prototype, 'save');
      const entity = EventEntity.build({
        id: EVENT_ID,
        calendar_id: CALENDAR_ID,
      });
      findStub.resolves(entity);

      const listener = sandbox.spy();
      bus.on('eventUpdated', listener);

      await service.updateEvent(account, EVENT_ID, {}, { source: 'import' });

      expect(listener.calledOnce).toBe(true);
    });
  });

  describe('createEvent', () => {
    it('import context: createEvent does not stamp origin fields on the EventEntity', async () => {
      sandbox.stub(EventEntity.prototype, 'save');
      const fromModelSpy = sandbox.spy(EventEntity, 'fromModel');
      const originFindStub = sandbox.stub(EventImportOriginEntity, 'findOne');

      await service.createEvent(
        account,
        { calendarId: CALENDAR_ID },
        { source: 'import' },
      );

      // The entity returned by fromModel is what will be persisted. After
      // pv-picz the 7 origin-provenance fields no longer exist on
      // EventEntity at all — confirm none of them are present.
      const entity = fromModelSpy.returnValues[0] as unknown as Record<string, unknown>;
      expect(entity).not.toHaveProperty('import_source_id');
      expect(entity).not.toHaveProperty('external_uid');
      expect(entity).not.toHaveProperty('external_recurrence_id');
      expect(entity).not.toHaveProperty('source_last_modified');
      expect(entity).not.toHaveProperty('source_last_seen_at');
      expect(entity).not.toHaveProperty('locally_edited');
      expect(entity).not.toHaveProperty('x_props');

      // createEvent must not touch the origin sibling — stampImportOrigin in
      // SyncService owns that write.
      expect(originFindStub.called).toBe(false);
    });

    it('user context (default): createEvent does not stamp origin fields on the EventEntity', async () => {
      sandbox.stub(EventEntity.prototype, 'save');
      const fromModelSpy = sandbox.spy(EventEntity, 'fromModel');
      const originFindStub = sandbox.stub(EventImportOriginEntity, 'findOne');

      await service.createEvent(account, { calendarId: CALENDAR_ID });

      const entity = fromModelSpy.returnValues[0] as unknown as Record<string, unknown>;
      expect(entity).not.toHaveProperty('import_source_id');
      expect(entity).not.toHaveProperty('source_last_seen_at');
      expect(entity).not.toHaveProperty('locally_edited');

      expect(originFindStub.called).toBe(false);
    });

    it('emits eventCreated on user path', async () => {
      sandbox.stub(EventEntity.prototype, 'save');

      const listener = sandbox.spy();
      bus.on('eventCreated', listener);

      await service.createEvent(account, { calendarId: CALENDAR_ID });

      expect(listener.calledOnce).toBe(true);
    });

    it('emits eventCreated on import path', async () => {
      sandbox.stub(EventEntity.prototype, 'save');

      const listener = sandbox.spy();
      bus.on('eventCreated', listener);

      await service.createEvent(
        account,
        { calendarId: CALENDAR_ID },
        { source: 'import' },
      );

      expect(listener.calledOnce).toBe(true);
    });
  });
});
