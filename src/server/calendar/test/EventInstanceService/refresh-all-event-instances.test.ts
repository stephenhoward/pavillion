import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import { DateTime } from 'luxon';
import { v4 as uuidv4 } from 'uuid';
import { CalendarEvent, CalendarEventSchedule, EventFrequency } from '@/common/model/events';
import EventInstanceService, { GENERATION_HORIZON_MONTHS } from '@/server/calendar/service/event_instance';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { EventEntity, EventScheduleEntity } from '@/server/calendar/entity/event';
import { EventInstanceEntity } from '@/server/calendar/entity/event_instance';
import db from '@/server/common/entity/db';

/**
 * DB-backed coverage for EventInstanceService.refreshAllEventInstances, the
 * body of the weekly `instances:refresh` worker job.
 *
 * Instance rows are materialised up to a rolling horizon at build time, so an
 * event nobody edits stops gaining rows once `now` approaches that horizon.
 * A refresh rebuilds every event — local and remote-origin — against the
 * current `now` so each one's rows reach the horizon again.
 */
describe('EventInstanceService.refreshAllEventInstances', () => {
  let service: EventInstanceService;
  let eventBus: EventEmitter;
  let calendarId: string;

  // Weekly on Mondays from 2026-01-05 at 10:00 UTC.
  const SERIES_START = DateTime.fromISO('2026-01-05T10:00:00.000Z', { zone: 'utc' });
  const FIRST_BUILD_AT = new Date('2026-01-01T00:00:00.000Z');
  const REFRESH_AT = new Date('2026-06-01T00:00:00.000Z');
  const REFRESH_HORIZON = DateTime.fromJSDate(REFRESH_AT, { zone: 'utc' })
    .plus({ months: GENERATION_HORIZON_MONTHS }).toJSDate();
  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  /**
   * Persists a weekly recurring event (event row plus schedule row) and
   * materialises its instances as of FIRST_BUILD_AT, so its rows stop
   * well short of the horizon measured from REFRESH_AT.
   */
  async function createStaleWeeklyEvent(eventCalendarId: string | null): Promise<string> {
    const eventId = uuidv4();
    await EventEntity.create({ id: eventId, calendar_id: eventCalendarId });

    const schedule = new CalendarEventSchedule(uuidv4(), SERIES_START);
    schedule.frequency = EventFrequency.WEEKLY;
    schedule.interval = 1;
    schedule.count = 0;
    schedule.isExclusion = false;
    schedule.byDay = [];
    const scheduleEntity = EventScheduleEntity.fromModel(schedule);
    scheduleEntity.event_id = eventId;
    await scheduleEntity.save();

    const event = new CalendarEvent(eventId, eventCalendarId);
    event.schedules = [schedule];
    await service.buildEventInstances(event, FIRST_BUILD_AT);
    return eventId;
  }

  async function lastStartFor(eventId: string): Promise<Date> {
    const last = await EventInstanceEntity.findOne({
      where: { event_id: eventId },
      order: [['start_time', 'DESC']],
    });
    return last!.start_time;
  }

  function expectReachesHorizon(lastStart: Date): void {
    // A weekly series has an occurrence in the final week before the horizon.
    expect(lastStart.getTime()).toBeGreaterThan(REFRESH_HORIZON.getTime() - ONE_WEEK_MS);
    expect(lastStart.getTime()).toBeLessThanOrEqual(REFRESH_HORIZON.getTime());
  }

  beforeEach(async () => {
    await db.sync({ force: true });
    calendarId = uuidv4();
    await CalendarEntity.create({ id: calendarId, url_name: 'instance-refresh-cal' });
    eventBus = new EventEmitter();
    service = new EventInstanceService(eventBus);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('extends a local recurring event whose rows end inside the window out to the horizon', async () => {
    const eventId = await createStaleWeeklyEvent(calendarId);
    // Built from Jan 1, the rows stop around Jul 1: inside the window that
    // a refresh on Jun 1 should cover through Dec 1.
    expect((await lastStartFor(eventId)).getTime()).toBeLessThan(REFRESH_HORIZON.getTime() - ONE_WEEK_MS);

    const result = await service.refreshAllEventInstances(REFRESH_AT);

    expect(result).toEqual({ refreshed: 1, failed: 0 });
    expectReachesHorizon(await lastStartFor(eventId));
  });

  it('refreshes a remote-origin event (calendar_id null)', async () => {
    const eventId = await createStaleWeeklyEvent(null);

    const result = await service.refreshAllEventInstances(REFRESH_AT);

    expect(result).toEqual({ refreshed: 1, failed: 0 });
    expectReachesHorizon(await lastStartFor(eventId));
  });

  it('pages through every event when there are more events than one page', async () => {
    const eventIds = [
      await createStaleWeeklyEvent(calendarId),
      await createStaleWeeklyEvent(null),
      await createStaleWeeklyEvent(calendarId),
    ];
    const findAll = sinon.spy(EventEntity, 'findAll');

    const result = await service.refreshAllEventInstances(REFRESH_AT, 2);

    expect(result).toEqual({ refreshed: 3, failed: 0 });
    // Two full-or-partial pages, each bounded by the page size.
    expect(findAll.callCount).toBe(2);
    expect(findAll.getCalls().every(call => call.args[0]!.limit === 2)).toBe(true);
    for (const eventId of eventIds) {
      expectReachesHorizon(await lastStartFor(eventId));
    }
  });

  it('keeps going when one event fails to rebuild', async () => {
    const failingId = await createStaleWeeklyEvent(calendarId);
    const healthyId = await createStaleWeeklyEvent(calendarId);
    const failingLastStart = await lastStartFor(failingId);

    const build = service.buildEventInstances.bind(service);
    sinon.stub(service, 'buildEventInstances').callsFake(async (event: CalendarEvent, now?: Date) => {
      if (event.id === failingId) {
        throw new Error('rebuild failed');
      }
      return build(event, now);
    });

    const result = await service.refreshAllEventInstances(REFRESH_AT);

    expect(result).toEqual({ refreshed: 1, failed: 1 });
    expectReachesHorizon(await lastStartFor(healthyId));
    expect((await lastStartFor(failingId)).getTime()).toBe(failingLastStart.getTime());
  });

  it('rebuilds directly without emitting eventUpdated', async () => {
    // The bus path would also reach the ActivityPub handler and announce an
    // Update to followers for what is only a local regeneration.
    await createStaleWeeklyEvent(calendarId);
    const emitted: string[] = [];
    const emit = eventBus.emit.bind(eventBus);
    sinon.stub(eventBus, 'emit').callsFake((name: string | symbol, ...args: any[]) => {
      emitted.push(String(name));
      return emit(name, ...args);
    });

    await service.refreshAllEventInstances(REFRESH_AT);

    expect(emitted).toEqual([]);
  });
});
