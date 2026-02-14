import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { EventCategory } from '@/common/model/event_category';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import AccountService from '@/server/accounts/service/account';
import { TestEnvironment } from '@/server/test/lib/test_environment';
import {
  BulkEventsNotFoundError,
  CategoriesNotFoundError,
  MixedCalendarEventsError,
  InsufficientCalendarPermissionsError,
} from '@/common/exceptions/calendar';

describe('CalendarInterface.bulkAssignCategories', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let testAccount: Account;
  let testCalendar: Calendar;
  let testEvents: CalendarEvent[];
  let testCategories: EventCategory[];
  let eventBus: EventEmitter;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    // Create test account and calendar
    let accountInfo = await accountService._setupAccount('bulktest@pavillion.dev', 'testpassword');
    testAccount = accountInfo.account;
    testCalendar = await calendarInterface.createCalendar(testAccount, 'bulktestcalendar');

    // Create test events
    testEvents = [
      await calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        content: {
          en: {
            name: 'Test Event 1',
            description: 'First test event for bulk assignment',
          },
        },
        start_date: '2025-08-01',
        start_time: '10:00',
        end_date: '2025-08-01',
        end_time: '11:00',
      }),
      await calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        content: {
          en: {
            name: 'Test Event 2',
            description: 'Second test event for bulk assignment',
          },
        },
        start_date: '2025-08-02',
        start_time: '14:00',
        end_date: '2025-08-02',
        end_time: '15:00',
      }),
      await calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        content: {
          en: {
            name: 'Test Event 3',
            description: 'Third test event for bulk assignment',
          },
        },
        start_date: '2025-08-03',
        start_time: '09:00',
        end_date: '2025-08-03',
        end_time: '10:00',
      }),
    ];

    // Create test categories
    testCategories = [
      await calendarInterface.createCategory(testAccount, testCalendar.id, {
        name: 'Meeting',
        language: 'en',
      }),
      await calendarInterface.createCategory(testAccount, testCalendar.id, {
        name: 'Workshop',
        language: 'en',
      }),
    ];
  });

  afterAll(async () => {
    if (eventBus) {
      eventBus.removeAllListeners();
    }
    if (env) {
      await env.cleanup();
    }
  });

  describe('successful bulk assignment', () => {
    it('should assign categories to multiple events', async () => {
      const eventIds = testEvents.map(event => event.id);
      const categoryIds = testCategories.map(category => category.id);

      const result = await calendarInterface.bulkAssignCategories(testAccount, eventIds, categoryIds);

      expect(result).toHaveLength(3);
      result.forEach(event => {
        expect(event.categories).toHaveLength(2);
        expect(event.categories.map(c => c.id)).toEqual(expect.arrayContaining(categoryIds));
      });
    });

    it('should handle single event and single category', async () => {
      // Use the second event and check that it includes the new category
      const eventIds = [testEvents[1].id];
      const categoryIds = [testCategories[1].id];

      const result = await calendarInterface.bulkAssignCategories(testAccount, eventIds, categoryIds);

      expect(result).toHaveLength(1);
      expect(result[0].categories).toContainEqual(
        expect.objectContaining({ id: categoryIds[0] }),
      );
    });
  });

  describe('validation errors', () => {
    it('should throw BulkEventsNotFoundError for non-existent events', async () => {
      const eventIds = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
      const categoryIds = [testCategories[0].id];

      await expect(
        calendarInterface.bulkAssignCategories(testAccount, eventIds, categoryIds),
      ).rejects.toThrow(BulkEventsNotFoundError);
    });

    it('should throw CategoriesNotFoundError for non-existent categories', async () => {
      const eventIds = [testEvents[0].id];
      const categoryIds = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];

      await expect(
        calendarInterface.bulkAssignCategories(testAccount, eventIds, categoryIds),
      ).rejects.toThrow(CategoriesNotFoundError);
    });

    it('should throw MixedCalendarEventsError for events from different calendars', async () => {
      // Create another calendar and event to test mixed calendar scenario
      const otherCalendar = await calendarInterface.createCalendar(testAccount, 'othercalendar');
      const otherEvent = await calendarInterface.createEvent(testAccount, {
        calendarId: otherCalendar.id,
        content: {
          en: {
            name: 'Event from other calendar',
            description: 'This event is from a different calendar',
          },
        },
        start_date: '2025-08-04',
        start_time: '10:00',
        end_date: '2025-08-04',
        end_time: '11:00',
      });

      const eventIds = [testEvents[0].id, otherEvent.id];
      const categoryIds = [testCategories[0].id];

      await expect(
        calendarInterface.bulkAssignCategories(testAccount, eventIds, categoryIds),
      ).rejects.toThrow(MixedCalendarEventsError);
    });

    it('should throw InsufficientCalendarPermissionsError for unauthorized user', async () => {
      // Create another account that doesn't have permissions on the test calendar
      const configurationInterface = new ConfigurationInterface();
      const setupInterface = new SetupInterface();
      const accountService = new AccountService(eventBus, configurationInterface, setupInterface);
      const unauthorizedAccountInfo = await accountService._setupAccount('unauthorized@pavillion.dev', 'testpassword');
      const unauthorizedAccount = unauthorizedAccountInfo.account;

      const eventIds = [testEvents[0].id];
      const categoryIds = [testCategories[0].id];

      await expect(
        calendarInterface.bulkAssignCategories(unauthorizedAccount, eventIds, categoryIds),
      ).rejects.toThrow(InsufficientCalendarPermissionsError);
    });
  });

  describe('edge cases', () => {
    it('should throw error for duplicate event IDs', async () => {
      const eventIds = [testEvents[2].id, testEvents[2].id]; // Duplicate
      const categoryIds = [testCategories[0].id];

      // Backend doesn't deduplicate - it validates count matches
      await expect(
        calendarInterface.bulkAssignCategories(testAccount, eventIds, categoryIds),
      ).rejects.toThrow(BulkEventsNotFoundError);
    });

    it('should throw error for duplicate category IDs', async () => {
      const eventIds = [testEvents[2].id];
      const categoryIds = [testCategories[1].id, testCategories[1].id]; // Duplicate

      // Backend doesn't deduplicate - it validates count matches
      await expect(
        calendarInterface.bulkAssignCategories(testAccount, eventIds, categoryIds),
      ).rejects.toThrow(CategoriesNotFoundError);
    });
  });
});
