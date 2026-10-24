/**
 * Tests for EventService.deleteRemoteEvent's calendar-ownership guard.
 *
 * deleteRemoteEvent is reached from the inbox Delete handler on two paths:
 *
 *   - calendar actor (federation): the event is a remote copy with no owning
 *     calendar (calendar_id null), and `calendar` is whichever local calendar
 *     received the activity.
 *   - Person actor (remote editor): the event is owned by a local calendar,
 *     and `calendar` is the calendar whose editor membership was checked.
 *
 * A locally-owned event must therefore only be deleted when `calendar` is
 * its owner. The inbox enforces that before calling in; this guard is the
 * service-layer backstop.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Calendar } from '@/common/model/calendar';
import { EventEntity, EventContentEntity, EventScheduleEntity } from '@/server/calendar/entity/event';
import { EventInstanceEntity } from '@/server/calendar/entity/event_instance';
import { EventCategoryAssignmentEntity } from '@/server/calendar/entity/event_category_assignment';
import { InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';
import EventService from '@/server/calendar/service/events';
import db from '@/server/common/entity/db';

describe('EventService.deleteRemoteEvent — calendar ownership', () => {
  const EVENT_ID = '55555555-5555-4555-8555-555555555555';
  const receivingCalendar = new Calendar('cal-a', 'calendara');

  let service: EventService;
  let sandbox: sinon.SinonSandbox;
  let transactionStub: sinon.SinonStub;
  let destroyStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new EventService(new EventEmitter());

    transactionStub = sandbox.stub(db, 'transaction');
    transactionStub.callsFake(async (callback: any) => callback({}));

    sandbox.stub(EventInstanceEntity, 'destroy').resolves();
    sandbox.stub(EventCategoryAssignmentEntity, 'destroy').resolves();
    sandbox.stub(EventScheduleEntity, 'destroy').resolves();
    sandbox.stub(EventContentEntity, 'destroy').resolves();
    destroyStub = sandbox.stub(EventEntity.prototype, 'destroy').resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('refuses to delete an event owned by a different local calendar', async () => {
    sandbox.stub(EventEntity, 'findByPk').resolves(EventEntity.build({ id: EVENT_ID, calendar_id: 'cal-b' }));

    await expect(service.deleteRemoteEvent(receivingCalendar, EVENT_ID))
      .rejects.toBeInstanceOf(InsufficientCalendarPermissionsError);
    expect(transactionStub.called).toBe(false);
    expect(destroyStub.called).toBe(false);
  });

  it('deletes an event owned by the calendar passed in', async () => {
    sandbox.stub(EventEntity, 'findByPk').resolves(EventEntity.build({ id: EVENT_ID, calendar_id: 'cal-a' }));

    await service.deleteRemoteEvent(receivingCalendar, EVENT_ID);

    expect(transactionStub.calledOnce).toBe(true);
    expect(destroyStub.calledOnce).toBe(true);
  });

  it('deletes a remote copy with no owning calendar', async () => {
    sandbox.stub(EventEntity, 'findByPk').resolves(EventEntity.build({ id: EVENT_ID, calendar_id: null }));

    await service.deleteRemoteEvent(receivingCalendar, EVENT_ID);

    expect(transactionStub.calledOnce).toBe(true);
    expect(destroyStub.calledOnce).toBe(true);
  });
});
