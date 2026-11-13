import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { DateTime } from 'luxon';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { ValidationError } from '@/common/exceptions/base';
import CalendarInterface from '@/server/calendar/interface';
import EventService from '@/server/calendar/service/events';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { EventContentEntity, EventEntity, EventScheduleEntity } from '@/server/calendar/entity/event';
import { waitFor } from '@/server/common/test/helpers/emit-and-settle';

/**
 * EventService.updateEvent opens its own transaction when the caller passes
 * none, so an update through the API path is all-or-nothing: a failure or a
 * refused schedule payload leaves no partial content or schedule state, and
 * `eventUpdated` fires only after commit.
 */
describe('EventService.updateEvent — atomic without a caller transaction (integration)', () => {
  let env: TestEnvironment;
  let eventService: EventService;
  let testAccount: Account;
  let testCalendar: Calendar;
  let eventBus: EventEmitter;

  const start = DateTime.utc().plus({ days: 10 }).set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
  const newStart = start.plus({ days: 5 });

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    const calendarInterface = new CalendarInterface(eventBus);
    calendarInterface.setActivityPubInterface({
      getSharedEventStatusMap: async () => new Map(),
      findCalendarActorByCalendarId: async () => null,
    } as never);

    const accountService = new AccountService(eventBus, new ConfigurationInterface(), new SetupInterface());
    const info = await accountService._setupAccount('atomicupdate@pavillion.dev', 'testpassword');
    testAccount = info.account;
    testCalendar = await calendarInterface.createCalendar(testAccount, 'atomicupdatecalendar');

    eventService = (calendarInterface as unknown as { eventService: EventService }).eventService;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    eventBus.removeAllListeners();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  async function seed(name: string) {
    return eventService.createEvent(testAccount, {
      calendarId: testCalendar.id,
      content: { en: { name, description: 'original description' } },
      schedules: [{ start: start.toISO(), eventEndTime: start.plus({ hours: 1 }).toISO() }],
    });
  }

  async function readState(eventId: string) {
    const content = await EventContentEntity.findAll({ where: { event_id: eventId } });
    const schedules = await EventScheduleEntity.findAll({ where: { event_id: eventId } });
    return {
      names: content.map(c => c.name),
      starts: schedules.map(s => s.start_date?.toISOString() ?? null),
    };
  }

  async function expectNoEmit(observed: unknown[]) {
    // Bounded absence window: nothing arrives, so there is no signal to poll.
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(observed).toHaveLength(0);
  }

  it('rolls back content and schedule edits and emits nothing when a write fails mid-update', async () => {
    const seeded = await seed('Atomic original');
    const before = await readState(seeded.id);
    expect(before.names).toEqual(['Atomic original']);

    const observed: unknown[] = [];
    eventBus.on('eventUpdated', (p: unknown) => observed.push(p));

    vi.spyOn(EventEntity.prototype, 'save').mockRejectedValue(new Error('simulated write failure'));

    await expect(
      eventService.updateEvent(testAccount, seeded.id, {
        content: { en: { name: 'Atomic edited', description: 'edited' } },
        schedules: [{ id: seeded.schedules[0].id, start: newStart.toISO() }],
      }),
    ).rejects.toThrow('simulated write failure');

    vi.restoreAllMocks();

    expect(await readState(seeded.id)).toEqual(before);
    await expectNoEmit(observed);
  });

  it('keeps content unchanged when the schedule payload is refused', async () => {
    const seeded = await seed('Refused original');
    const before = await readState(seeded.id);

    await expect(
      eventService.updateEvent(testAccount, seeded.id, {
        content: { en: { name: 'Refused edited', description: 'edited' } },
        schedules: [{ start: newStart.toISO(), isException: true }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(await readState(seeded.id)).toEqual(before);
  });

  it('commits the update and emits eventUpdated after commit', async () => {
    const seeded = await seed('Success original');

    const visible: string[] = [];
    eventBus.on('eventUpdated', async (p: { event: { id: string } }) => {
      const rows = await EventContentEntity.findAll({ where: { event_id: p.event.id } });
      visible.push(...rows.map(r => r.name));
    });

    await eventService.updateEvent(testAccount, seeded.id, {
      content: { en: { name: 'Success edited', description: 'edited' } },
    });

    await waitFor(() => visible.length === 1);
    expect(visible).toEqual(['Success edited']);
  });
});
