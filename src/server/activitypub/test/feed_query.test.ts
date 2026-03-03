import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import ActivityPubService from '@/server/activitypub/service/members';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { SharedEventEntity } from '@/server/activitypub/entity/activitypub';
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';
import { CalendarActorEntity } from '@/server/activitypub/entity/calendar_actor';
import { EventEmitter } from 'events';
import CalendarInterface from '@/server/calendar/interface';

describe('ActivityPubService - getFeed with CalendarInterface', () => {
  let sandbox: sinon.SinonSandbox;
  let service: ActivityPubService;
  let calendar: Calendar;
  let calendarInterface: CalendarInterface;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    const eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    service = new ActivityPubService(eventBus, calendarInterface);
    calendar = new Calendar('local-calendar-id', 'localcalendar');
  });

  afterEach(async () => {
    sandbox.restore();
  });

  it('should return events from followed calendars only', async () => {
    const mockEvents = [
      new CalendarEvent('event-uuid-1', null),
      new CalendarEvent('event-uuid-2', null),
    ];

    // Stub via CalendarInterface to avoid domain boundary violation
    const getEventsStub = sandbox.stub(calendarInterface, 'getEventsFromFollowedSources').resolves(mockEvents);
    sandbox.stub(SharedEventEntity, 'findAll').resolves([]);
    sandbox.stub(EventObjectEntity, 'findAll').resolves([]);
    sandbox.stub(CalendarActorEntity, 'findAll').resolves([]);

    const result = await service.getFeed(calendar, 0, 20);

    // Verify the stub was called
    expect(getEventsStub.calledOnce).toBe(true);

    // Verify results include events from followed calendar
    expect(result.length).toBe(2);
    // Remote events have null calendar_id
    expect(result[0].calendar_id).toBeNull();
  });

  it('should return empty array when calendar has no follows', async () => {
    const getEventsStub = sandbox.stub(calendarInterface, 'getEventsFromFollowedSources').resolves([]);
    sandbox.stub(SharedEventEntity, 'findAll').resolves([]);
    sandbox.stub(EventObjectEntity, 'findAll').resolves([]);
    sandbox.stub(CalendarActorEntity, 'findAll').resolves([]);

    const result = await service.getFeed(calendar, 0, 20);

    expect(getEventsStub.calledOnce).toBe(true);
    expect(result).toEqual([]);
  });

  it('should pass page and pageSize to getEventsFromFollowedSources', async () => {
    const getEventsStub = sandbox.stub(calendarInterface, 'getEventsFromFollowedSources').resolves([]);
    sandbox.stub(SharedEventEntity, 'findAll').resolves([]);
    sandbox.stub(EventObjectEntity, 'findAll').resolves([]);
    sandbox.stub(CalendarActorEntity, 'findAll').resolves([]);

    await service.getFeed(calendar, 2, 10);

    expect(getEventsStub.calledOnce).toBe(true);
    const [calendarArg, pageArg, pageSizeArg] = getEventsStub.firstCall.args;
    expect(calendarArg.id).toBe(calendar.id);
    expect(pageArg).toBe(2);
    expect(pageSizeArg).toBe(10);
  });

  it('should order results by preserving the order returned by getEventsFromFollowedSources', async () => {
    const newerEvent = new CalendarEvent('event-uuid-newer', null);
    const olderEvent = new CalendarEvent('event-uuid-older', null);

    sandbox.stub(calendarInterface, 'getEventsFromFollowedSources').resolves([newerEvent, olderEvent]);
    sandbox.stub(SharedEventEntity, 'findAll').resolves([]);
    sandbox.stub(EventObjectEntity, 'findAll').resolves([]);
    sandbox.stub(CalendarActorEntity, 'findAll').resolves([]);

    const result = await service.getFeed(calendar, 0, 20);

    expect(result[0].id).toBe('event-uuid-newer');
    expect(result[1].id).toBe('event-uuid-older');
  });

  it('should not import EventEntity directly — domain boundary is respected', async () => {
    // This test verifies that EventEntity is NOT used in the ActivityPub domain.
    // getFeed() delegates to CalendarInterface, which owns EventEntity access.
    // The stub is on calendarInterface, not on EventEntity.findAll.
    sandbox.stub(calendarInterface, 'getEventsFromFollowedSources').resolves([]);
    sandbox.stub(SharedEventEntity, 'findAll').resolves([]);
    sandbox.stub(EventObjectEntity, 'findAll').resolves([]);
    sandbox.stub(CalendarActorEntity, 'findAll').resolves([]);

    // Should not throw — the implementation no longer uses EventEntity directly
    await expect(service.getFeed(calendar, 0, 20)).resolves.toEqual([]);
  });
});
