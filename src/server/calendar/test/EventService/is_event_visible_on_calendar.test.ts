import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { EventEntity } from '@/server/calendar/entity/event';
import { EventRepostEntity } from '@/server/calendar/entity/event_repost';
import EventService from '@/server/calendar/service/events';

/**
 * Coverage for EventService.isEventVisibleOnCalendar — the per-event form of
 * listEventIdsForCalendar. An event is visible on a calendar when the calendar
 * owns it, links it via event_repost, or shares it via ap_shared_event.
 */
describe('EventService.isEventVisibleOnCalendar', () => {
  const CALENDAR_ID = 'cal-id-1';
  const OTHER_CALENDAR_ID = 'cal-id-2';
  const EVENT_ID = '11111111-1111-4111-8111-111111111111';

  let service: EventService;
  let sandbox: sinon.SinonSandbox;
  let eventCount: sinon.SinonStub;
  let repostCount: sinon.SinonStub;

  function useSharedCalendarIds(calendarIds: string[]): sinon.SinonStub {
    const stub = sinon.stub().resolves(calendarIds);
    service.setActivityPubInterface({ getCalendarIdsForSharedEvent: stub } as any);
    return stub;
  }

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new EventService(new EventEmitter());
    eventCount = sandbox.stub(EventEntity, 'count').resolves(0);
    repostCount = sandbox.stub(EventRepostEntity, 'count').resolves(0);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('is true when the calendar owns the event', async () => {
    eventCount.resolves(1);
    useSharedCalendarIds([]);

    expect(await service.isEventVisibleOnCalendar(EVENT_ID, CALENDAR_ID)).toBe(true);
    expect(eventCount.firstCall.args[0]).toEqual({ where: { id: EVENT_ID, calendar_id: CALENDAR_ID } });
  });

  it('is true when the calendar links the event via event_repost', async () => {
    repostCount.resolves(1);
    useSharedCalendarIds([]);

    expect(await service.isEventVisibleOnCalendar(EVENT_ID, CALENDAR_ID)).toBe(true);
    expect(repostCount.firstCall.args[0]).toEqual({ where: { event_id: EVENT_ID, calendar_id: CALENDAR_ID } });
  });

  it('is true when the calendar shares the event via ap_shared_event', async () => {
    const shared = useSharedCalendarIds([OTHER_CALENDAR_ID, CALENDAR_ID]);

    expect(await service.isEventVisibleOnCalendar(EVENT_ID, CALENDAR_ID)).toBe(true);
    expect(shared.calledOnceWithExactly(EVENT_ID)).toBe(true);
  });

  it('is true for a remote event (no owning local calendar) shared with the calendar', async () => {
    // A remote-origin event has calendar_id null, so the ownership count is 0
    // for every local calendar; only the AP share makes it visible.
    useSharedCalendarIds([CALENDAR_ID]);

    expect(await service.isEventVisibleOnCalendar(EVENT_ID, CALENDAR_ID)).toBe(true);
  });

  it('is false when the calendar neither owns nor reposts the event', async () => {
    useSharedCalendarIds([OTHER_CALENDAR_ID]);

    expect(await service.isEventVisibleOnCalendar(EVENT_ID, CALENDAR_ID)).toBe(false);
  });
});
