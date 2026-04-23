import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { EventEntity } from '@/server/calendar/entity/event';
import EventService from '@/server/calendar/service/events';

/**
 * Coverage for pv-1qcp.2.3 — EventService originator context.
 *
 * Distinguishes user-driven mutations (default) from import-driven
 * mutations (ICS sync orchestrator). The service layer owns the
 * locally_edited flip rule; entity hooks cannot distinguish caller intent.
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
    it('flips locally_edited to true on user update of an imported event', async () => {
      const findStub = sandbox.stub(EventEntity, 'findByPk');
      const saveStub = sandbox.stub(EventEntity.prototype, 'save');
      const entity = EventEntity.build({
        id: EVENT_ID,
        calendar_id: CALENDAR_ID,
        import_source_id: IMPORT_SOURCE_ID,
        locally_edited: false,
      });
      findStub.resolves(entity);

      // Default context is 'user'
      await service.updateEvent(account, EVENT_ID, {});

      expect(saveStub.called).toBe(true);
      expect(entity.locally_edited).toBe(true);
    });

    it('explicit user context flips locally_edited on imported event', async () => {
      const findStub = sandbox.stub(EventEntity, 'findByPk');
      const saveStub = sandbox.stub(EventEntity.prototype, 'save');
      const entity = EventEntity.build({
        id: EVENT_ID,
        calendar_id: CALENDAR_ID,
        import_source_id: IMPORT_SOURCE_ID,
        locally_edited: false,
      });
      findStub.resolves(entity);

      await service.updateEvent(account, EVENT_ID, {}, { source: 'user' });

      expect(saveStub.called).toBe(true);
      expect(entity.locally_edited).toBe(true);
    });

    it('leaves locally_edited unchanged on import update of an imported event', async () => {
      const findStub = sandbox.stub(EventEntity, 'findByPk');
      const saveStub = sandbox.stub(EventEntity.prototype, 'save');
      const entity = EventEntity.build({
        id: EVENT_ID,
        calendar_id: CALENDAR_ID,
        import_source_id: IMPORT_SOURCE_ID,
        locally_edited: false,
      });
      findStub.resolves(entity);

      await service.updateEvent(account, EVENT_ID, {}, { source: 'import' });

      expect(saveStub.called).toBe(true);
      expect(entity.locally_edited).toBe(false);
    });

    it('does not set locally_edited on user update of a non-imported event', async () => {
      const findStub = sandbox.stub(EventEntity, 'findByPk');
      const saveStub = sandbox.stub(EventEntity.prototype, 'save');
      const entity = EventEntity.build({
        id: EVENT_ID,
        calendar_id: CALENDAR_ID,
        import_source_id: null,
        locally_edited: false,
      });
      findStub.resolves(entity);

      await service.updateEvent(account, EVENT_ID, {});

      expect(saveStub.called).toBe(true);
      expect(entity.locally_edited).toBe(false);
    });

    it('emits eventUpdated on user path', async () => {
      const findStub = sandbox.stub(EventEntity, 'findByPk');
      sandbox.stub(EventEntity.prototype, 'save');
      const entity = EventEntity.build({
        id: EVENT_ID,
        calendar_id: CALENDAR_ID,
        import_source_id: IMPORT_SOURCE_ID,
        locally_edited: false,
      });
      findStub.resolves(entity);

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
        import_source_id: IMPORT_SOURCE_ID,
        locally_edited: false,
      });
      findStub.resolves(entity);

      const listener = sandbox.spy();
      bus.on('eventUpdated', listener);

      await service.updateEvent(account, EVENT_ID, {}, { source: 'import' });

      expect(listener.calledOnce).toBe(true);
    });
  });

  describe('createEvent', () => {
    it('import context stamps source_last_seen_at and locally_edited=false', async () => {
      sandbox.stub(EventEntity.prototype, 'save');
      const fromModelSpy = sandbox.spy(EventEntity, 'fromModel');

      const before = Date.now();
      await service.createEvent(
        account,
        { calendarId: CALENDAR_ID },
        { source: 'import' },
      );
      const after = Date.now();

      // The entity returned from fromModel is the instance that gets
      // stamped with originator fields before save().
      const entity = fromModelSpy.returnValues[0];
      expect(entity.locally_edited).toBe(false);
      expect(entity.source_last_seen_at).toBeInstanceOf(Date);
      const stampedAt = (entity.source_last_seen_at as Date).getTime();
      expect(stampedAt).toBeGreaterThanOrEqual(before);
      expect(stampedAt).toBeLessThanOrEqual(after);
    });

    it('user context (default) does not stamp source_last_seen_at', async () => {
      sandbox.stub(EventEntity.prototype, 'save');
      const fromModelSpy = sandbox.spy(EventEntity, 'fromModel');

      await service.createEvent(account, { calendarId: CALENDAR_ID });

      const entity = fromModelSpy.returnValues[0];
      // User-path creates do not touch these columns; they default to
      // null / false at the entity level.
      expect(entity.source_last_seen_at ?? null).toBe(null);
      expect(entity.locally_edited ?? false).toBe(false);
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
