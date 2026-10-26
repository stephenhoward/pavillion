/**
 * Tests for EventService.updateRemoteEvent's calendar-ownership guard.
 *
 * updateRemoteEvent is reached from the inbox Update handler on two paths:
 *
 *   - calendar actor (federation): the event is a remote copy with no owning
 *     calendar (calendar_id null), and `calendar` is whichever local calendar
 *     received the activity.
 *   - Person actor (remote editor): the event is owned by a local calendar,
 *     and `calendar` is the calendar whose editor membership was checked.
 *
 * A locally-owned event must therefore only be written when `calendar` is
 * its owner. The inbox enforces that before calling in; this guard is the
 * service-layer backstop.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Calendar } from '@/common/model/calendar';
import { EventEntity } from '@/server/calendar/entity/event';
import { InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';
import EventService from '@/server/calendar/service/events';

describe('EventService.updateRemoteEvent — calendar ownership', () => {
  const EVENT_ID = '44444444-4444-4444-8444-444444444444';
  const receivingCalendar = new Calendar('cal-a', 'calendara');

  let service: EventService;
  let sandbox: sinon.SinonSandbox;
  let saveStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new EventService(new EventEmitter());
    saveStub = sandbox.stub(EventEntity.prototype, 'save').resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('refuses to write an event owned by a different local calendar', async () => {
    sandbox.stub(EventEntity, 'findByPk').resolves(EventEntity.build({ id: EVENT_ID, calendar_id: 'cal-b' }));

    await expect(service.updateRemoteEvent(receivingCalendar, { id: EVENT_ID }))
      .rejects.toBeInstanceOf(InsufficientCalendarPermissionsError);
    expect(saveStub.called).toBe(false);
  });

  it('writes an event owned by the calendar passed in', async () => {
    sandbox.stub(EventEntity, 'findByPk').resolves(EventEntity.build({ id: EVENT_ID, calendar_id: 'cal-a' }));

    await service.updateRemoteEvent(receivingCalendar, { id: EVENT_ID });

    expect(saveStub.calledOnce).toBe(true);
  });

  it('writes a remote copy with no owning calendar', async () => {
    sandbox.stub(EventEntity, 'findByPk').resolves(EventEntity.build({ id: EVENT_ID, calendar_id: null }));

    await service.updateRemoteEvent(receivingCalendar, { id: EVENT_ID });

    expect(saveStub.calledOnce).toBe(true);
  });
});
