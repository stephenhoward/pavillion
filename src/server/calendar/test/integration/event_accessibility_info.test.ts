import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

/**
 * Integration tests for event content accessibilityInfo round-trip.
 *
 * Exercises the full calendar interface -> service -> entity -> SQLite stack
 * without mocks. Confirms that accessibilityInfo survives create -> get
 * and update -> get cycles.
 */
describe('Event content accessibilityInfo — API round-trip (integration)', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let testAccount: Account;
  let testCalendar: Calendar;
  let eventBus: EventEmitter;

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

    const info = await accountService._setupAccount('a11y@pavillion.dev', 'testpassword');
    testAccount = info.account;
    testCalendar = await calendarInterface.createCalendar(testAccount, 'a11ycalendar');
  });

  afterAll(async () => {
    if (eventBus) {
      eventBus.removeAllListeners();
    }
    await env.cleanup();
  });

  it('persists accessibilityInfo on create and returns it on fetch', async () => {
    const created = await calendarInterface.createEvent(testAccount, {
      calendarId: testCalendar.id,
      content: {
        en: {
          name: 'Accessible Event',
          description: 'An event with accessibility info',
          accessibilityInfo: 'Wheelchair ramp at main entrance. ASL interpreter provided.',
        },
      },
      start_date: '2026-06-01',
    });

    const enContent = created.content('en');
    expect(enContent.accessibilityInfo).toBe('Wheelchair ramp at main entrance. ASL interpreter provided.');

    const fetched = await calendarInterface.getEventById(created.id);
    const fetchedContent = fetched.content('en');
    expect(fetchedContent.accessibilityInfo).toBe('Wheelchair ramp at main entrance. ASL interpreter provided.');
  });

  it('persists empty accessibilityInfo without error', async () => {
    const created = await calendarInterface.createEvent(testAccount, {
      calendarId: testCalendar.id,
      content: {
        en: {
          name: 'No A11y Info',
          description: 'Event without accessibility info',
        },
      },
      start_date: '2026-06-02',
    });

    const fetched = await calendarInterface.getEventById(created.id);
    const content = fetched.content('en');
    expect(content.accessibilityInfo).toBe('');
  });

  it('updates accessibilityInfo on an existing event', async () => {
    const created = await calendarInterface.createEvent(testAccount, {
      calendarId: testCalendar.id,
      content: {
        en: {
          name: 'Update A11y Event',
          description: 'Will be updated',
          accessibilityInfo: 'Original info',
        },
      },
      start_date: '2026-06-03',
    });

    await calendarInterface.updateEvent(testAccount, created.id, {
      content: {
        en: {
          name: 'Update A11y Event',
          description: 'Will be updated',
          accessibilityInfo: 'Updated accessibility information',
        },
      },
    });

    const fetched = await calendarInterface.getEventById(created.id);
    const content = fetched.content('en');
    expect(content.accessibilityInfo).toBe('Updated accessibility information');
  });
});
