import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { EventSeries } from '@/common/model/event_series';
import CalendarInterface from '@/server/calendar/interface';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

/**
 * Integration tests for the series association on the management event list.
 *
 * The calendar-management event list renders a series badge from each
 * event's `series`, so `listEvents` must eager-load the series and its
 * content the same way the single-event lookup does. The search branch
 * replaces the content include with a filtered one, so it is asserted
 * separately to guard the only path that rewrites the include list.
 */
describe('listEvents — series association (integration)', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let eventBus: EventEmitter;
  let account: Account;
  let calendar: Calendar;
  let series: EventSeries;

  const findByName = (events: CalendarEvent[], name: string): CalendarEvent | undefined =>
    events.find(e => e.content('en').name === name);

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);

    calendarInterface.setActivityPubInterface({
      getSharedEventStatusMap: async () => new Map(),
      findCalendarActorByCalendarId: async () => null,
    } as any);

    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    const info = await accountService._setupAccount('listeventsseries@pavillion.dev', 'testpassword');
    account = info.account;
    calendar = await calendarInterface.createCalendar(account, 'listeventsseriescal');

    series = await calendarInterface.createSeries(account, calendar.id, {
      urlName: 'summer-concerts',
      content: { en: { name: 'Summer Concerts' } },
    });

    for (const name of ['Opening Night', 'Closing Night']) {
      await calendarInterface.createEvent(account, {
        calendarId: calendar.id,
        content: { en: { name } },
        schedules: [{ start: '2026-07-01T19:00:00.000Z' }],
        series: { id: series.id },
      });
    }

    await calendarInterface.createEvent(account, {
      calendarId: calendar.id,
      content: { en: { name: 'Standalone Workshop' } },
      schedules: [{ start: '2026-07-02T19:00:00.000Z' }],
    });
  });

  afterAll(async () => {
    if (eventBus) {
      eventBus.removeAllListeners();
    }
    await env.cleanup();
  });

  it('populates the series on series-bearing events and leaves it null otherwise', async () => {
    const events = await calendarInterface.listEvents(calendar);

    expect(events).toHaveLength(3);

    for (const name of ['Opening Night', 'Closing Night']) {
      const event = findByName(events, name);
      expect(event, name).toBeDefined();
      expect(event!.series).not.toBeNull();
      expect(event!.series!.id).toBe(series.id);
      expect(event!.series!.urlName).toBe('summer-concerts');
      expect(event!.series!.content('en').name).toBe('Summer Concerts');
    }

    const standalone = findByName(events, 'Standalone Workshop');
    expect(standalone).toBeDefined();
    expect(standalone!.series).toBeNull();
  });

  it('keeps the series populated when the list is filtered by search', async () => {
    const events = await calendarInterface.listEvents(calendar, { search: 'opening' });

    expect(events).toHaveLength(1);
    expect(events[0].content('en').name).toBe('Opening Night');
    expect(events[0].series).not.toBeNull();
    expect(events[0].series!.id).toBe(series.id);
    expect(events[0].series!.urlName).toBe('summer-concerts');
    expect(events[0].series!.content('en').name).toBe('Summer Concerts');
  });
});
