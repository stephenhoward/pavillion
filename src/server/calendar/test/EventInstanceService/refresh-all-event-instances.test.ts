import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import EventInstanceService from '../../service/event_instance';
import { CalendarEntity } from '../../entity/calendar';
import { EventEntity } from '../../entity/event';
import { Op } from 'sequelize';

/**
 * Minimal CalendarEntity stand-in: refreshAllEventInstances only reads the
 * model's id and hands the model to the ActivityPub interface.
 */
function buildMockCalendarEntity(id: string, urlName: string): any {
  return {
    id,
    url_name: urlName,
    toModel: () => ({ id, urlName }),
  };
}

describe('EventInstanceService.refreshAllEventInstances', () => {
  let sandbox: sinon.SinonSandbox;
  let service: EventInstanceService;
  let eventBus: EventEmitter;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    service = new EventInstanceService(eventBus);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('queries events by calendar UUID only, never by ActivityPub actor URL', async () => {
    // event.calendar_id is a uuid column: an actor URL in the Op.in list makes
    // postgres reject the whole statement with 22P02, taking down dev boot.
    sandbox.stub(CalendarEntity, 'findAll').resolves([
      buildMockCalendarEntity('c71f5c9e-7a3d-4e5f-8e1a-66c3612a05f3', 'test_calendar'),
    ]);
    const eventFindAll = sandbox.stub(EventEntity, 'findAll').resolves([]);
    service.setActivityPubInterface({
      actorUrl: sandbox.stub().resolves('https://events.example.org/calendars/test_calendar'),
    } as any);

    await service.refreshAllEventInstances();

    const calendarIds = eventFindAll.firstCall.args[0]!.where!['calendar_id'][Op.in];
    expect(calendarIds).toEqual(['c71f5c9e-7a3d-4e5f-8e1a-66c3612a05f3']);
  });

  it('emits eventUpdated for each event with its owning calendar', async () => {
    const calendarId = 'cbe74815-939e-48b3-af44-1cd4eb3671bb';
    sandbox.stub(CalendarEntity, 'findAll').resolves([
      buildMockCalendarEntity(calendarId, 'testuser_calendar'),
    ]);
    const eventModel = { id: 'evt-1' };
    sandbox.stub(EventEntity, 'findAll').resolves([
      { id: 'evt-1', calendar_id: calendarId, toModel: () => eventModel } as any,
    ]);
    service.setActivityPubInterface({
      actorUrl: sandbox.stub().resolves('https://events.example.org/calendars/testuser_calendar'),
    } as any);

    const updates: any[] = [];
    eventBus.on('eventUpdated', payload => updates.push(payload));

    await service.refreshAllEventInstances();

    expect(updates).toHaveLength(1);
    expect(updates[0].calendar.id).toBe(calendarId);
    expect(updates[0].event).toBe(eventModel);
  });
});
