import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { EventCategory } from '@/common/model/event_category';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import AccountService from '@/server/accounts/service/account';
import { EventRepostEntity } from '@/server/calendar/entity/event_repost';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
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
    calendarInterface.setActivityPubInterface({
      getSharedEventStatusMap: async () => new Map<string, 'auto' | 'manual'>(),
      getCalendarIdsForSharedEvent: async () => [],
      getEventSourceActors: async () => new Map<string, string>(),
      findCalendarActorByCalendarId: async () => null,
    } as never);
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

  describe('with an acting calendarId (reposts)', () => {
    let calA: Calendar;
    let calB: Calendar;
    let calC: Calendar;
    let eventB1: CalendarEvent;
    let eventB2: CalendarEvent;
    let eventC1: CalendarEvent;
    let categoryA: EventCategory;

    const makeEvent = (calendarId: string, name: string) => calendarInterface.createEvent(testAccount, {
      calendarId,
      content: { en: { name, description: name } },
      start_date: '2025-09-01',
      start_time: '10:00',
      end_date: '2025-09-01',
      end_time: '11:00',
    });

    beforeAll(async () => {
      calA = await calendarInterface.createCalendar(testAccount, 'repostcalendara');
      calB = await calendarInterface.createCalendar(testAccount, 'repostcalendarb');
      calC = await calendarInterface.createCalendar(testAccount, 'repostcalendarc');
      eventB1 = await makeEvent(calB.id, 'B event 1');
      eventB2 = await makeEvent(calB.id, 'B event 2');
      eventC1 = await makeEvent(calC.id, 'C event 1');
      for (const event of [eventB1, eventB2, eventC1]) {
        await EventRepostEntity.create({ id: uuidv4(), event_id: event.id, calendar_id: calA.id });
      }
      categoryA = await calendarInterface.createCategory(testAccount, calA.id, { name: 'Kids', language: 'en' });
    });

    it('assigns the acting calendar category to reposts from one origin', async () => {
      const result = await calendarInterface.bulkAssignCategories(
        testAccount, [eventB1.id, eventB2.id], [categoryA.id], calA.id,
      );

      expect(result).toHaveLength(2);
      result.forEach(event => {
        expect(event.categories.map(c => c.id)).toContain(categoryA.id);
      });
    });

    it('accepts reposts from different origin calendars', async () => {
      const result = await calendarInterface.bulkAssignCategories(
        testAccount, [eventB1.id, eventC1.id], [categoryA.id], calA.id,
      );

      expect(result).toHaveLength(2);
    });

    it('rejects an event that is not shown on the acting calendar', async () => {
      const unshown = await makeEvent(calB.id, 'B not reposted');

      await expect(
        calendarInterface.bulkAssignCategories(testAccount, [unshown.id], [categoryA.id], calA.id),
      ).rejects.toThrow(MixedCalendarEventsError);
    });

    it('rejects an acting calendar the account cannot edit', async () => {
      const accountService = new AccountService(eventBus, new ConfigurationInterface(), new SetupInterface());
      const other = (await accountService._setupAccount('otherbulk@pavillion.dev', 'testpassword')).account;

      await expect(
        calendarInterface.bulkAssignCategories(other, [eventB1.id], [categoryA.id], calA.id),
      ).rejects.toThrow(InsufficientCalendarPermissionsError);
    });
  });
});
