import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { EventCategory } from '@/common/model/event_category';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import AccountService from '@/server/accounts/service/account';
import { TestEnvironment } from '@/server/test/lib/test_environment';

/**
 * Integration tests for Category Management Enhancements
 *
 * These tests verify end-to-end workflows for category deletion with migration,
 * category merging, event count accuracy, and permission validation.
 */
describe('Category Management Integration Tests', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let testAccount: Account;
  let unauthorizedAccount: Account;
  let testCalendar: Calendar;
  let testCategory1: EventCategory;
  let testCategory2: EventCategory;
  let testCategory3: EventCategory;
  let testEvent1: CalendarEvent;
  let testEvent2: CalendarEvent;
  let authToken: string;
  let unauthorizedToken: string;
  let eventBus: EventEmitter;

  const testEmail = 'catmgmt@pavillion.dev';
  const unauthorizedEmail = 'unauthorized@pavillion.dev';
  const password = 'testpassword';

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init(3099); // Use unique port

    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    const configurationInterface = new ConfigurationInterface();
    const accountService = new AccountService(eventBus, configurationInterface);

    // Create test accounts
    let accountInfo = await accountService._setupAccount(testEmail, password);
    testAccount = accountInfo.account;

    let unauthorizedInfo = await accountService._setupAccount(unauthorizedEmail, password);
    unauthorizedAccount = unauthorizedInfo.account;

    // Login both users to get proper auth tokens
    authToken = await env.login(testEmail, password);
    unauthorizedToken = await env.login(unauthorizedEmail, password);

    // Create test calendar
    testCalendar = await calendarInterface.createCalendar(testAccount, 'testcalendar');

    // Create test categories
    testCategory1 = await calendarInterface.createCategory(testAccount, testCalendar.id, {
      name: 'Music',
      language: 'en',
    });

    testCategory2 = await calendarInterface.createCategory(testAccount, testCalendar.id, {
      name: 'Sports',
      language: 'en',
    });

    testCategory3 = await calendarInterface.createCategory(testAccount, testCalendar.id, {
      name: 'Arts',
      language: 'en',
    });

    // Create test events
    testEvent1 = await calendarInterface.createEvent(testAccount, {
      calendarId: testCalendar.id,
      content: {
        en: {
          name: 'Test Event 1',
          description: 'First test event',
        },
      },
      start_date: '2025-12-01',
      start_time: '10:00',
      end_date: '2025-12-01',
      end_time: '12:00',
    });

    testEvent2 = await calendarInterface.createEvent(testAccount, {
      calendarId: testCalendar.id,
      content: {
        en: {
          name: 'Test Event 2',
          description: 'Second test event',
        },
      },
      start_date: '2025-12-02',
      start_time: '14:00',
      end_date: '2025-12-02',
      end_time: '16:00',
    });

    // Assign event1 to category1 and category2
    await calendarInterface.assignCategoryToEvent(testAccount, testEvent1.id, testCategory1.id);
    await calendarInterface.assignCategoryToEvent(testAccount, testEvent1.id, testCategory2.id);

    // Assign event2 to category1 only
    await calendarInterface.assignCategoryToEvent(testAccount, testEvent2.id, testCategory1.id);
  });

  afterAll(async () => {
    if (eventBus) {
      eventBus.removeAllListeners();
    }
    await env.cleanup();
  });

  describe('End-to-end delete with migration workflow', () => {
    it('should successfully delete category and migrate events to target category', async () => {
      // Initial state: category1 has 2 events, category2 has 1 event

      // Delete category1 and migrate to category2
      const response = await env.authDelete(
        authToken,
        `/api/v1/calendars/${testCalendar.urlName}/categories/${testCategory1.id}?action=migrate&targetCategoryId=${testCategory2.id}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.affectedEventCount).toBe(2);

      // Verify category1 is deleted
      const categoriesResponse = await env.authGet(
        authToken,
        `/api/v1/calendars/${testCalendar.urlName}/categories`,
      );

      expect(categoriesResponse.status).toBe(200);
      const remainingCategories = categoriesResponse.body.map((c: any) => c.id);
      expect(remainingCategories).not.toContain(testCategory1.id);
      expect(remainingCategories).toContain(testCategory2.id);

      // Verify category2 now has 2 events
      const category2Data = categoriesResponse.body.find((c: any) => c.id === testCategory2.id);
      expect(category2Data.eventCount).toBe(2);

      // Verify events are correctly assigned
      const event1Categories = await calendarInterface.getEventCategories(testEvent1.id);
      expect(event1Categories.map(c => c.id)).toContain(testCategory2.id);
      expect(event1Categories.map(c => c.id)).not.toContain(testCategory1.id);

      const event2Categories = await calendarInterface.getEventCategories(testEvent2.id);
      expect(event2Categories.map(c => c.id)).toContain(testCategory2.id);
      expect(event2Categories.map(c => c.id)).not.toContain(testCategory1.id);
    });
  });

  describe('End-to-end category merge workflow', () => {
    it('should successfully merge multiple categories into target category', async () => {
      // Recreate test setup for this test
      const cal2 = await calendarInterface.createCalendar(testAccount, 'merge-test-cal');
      const cat1 = await calendarInterface.createCategory(testAccount, cal2.id, { name: 'Cat1', language: 'en' });
      const cat2 = await calendarInterface.createCategory(testAccount, cal2.id, { name: 'Cat2', language: 'en' });
      const cat3 = await calendarInterface.createCategory(testAccount, cal2.id, { name: 'Cat3', language: 'en' });

      const evt1 = await calendarInterface.createEvent(testAccount, {
        calendarId: cal2.id,
        content: { en: { name: 'Event 1', description: 'Test' } },
        start_date: '2025-12-01',
        start_time: '10:00',
        end_date: '2025-12-01',
        end_time: '11:00',
      });

      const evt2 = await calendarInterface.createEvent(testAccount, {
        calendarId: cal2.id,
        content: { en: { name: 'Event 2', description: 'Test' } },
        start_date: '2025-12-02',
        start_time: '10:00',
        end_date: '2025-12-02',
        end_time: '11:00',
      });

      // Assign: event1 to cat1 and cat2, event2 to cat1 only
      await calendarInterface.assignCategoryToEvent(testAccount, evt1.id, cat1.id);
      await calendarInterface.assignCategoryToEvent(testAccount, evt1.id, cat2.id);
      await calendarInterface.assignCategoryToEvent(testAccount, evt2.id, cat1.id);

      // Merge cat2 and cat3 into cat1
      const response = await env.authPost(
        authToken,
        `/api/v1/calendars/${cal2.urlName}/categories/merge`,
        {
          targetCategoryId: cat1.id,
          sourceCategoryIds: [cat2.id, cat3.id],
        },
      );

      expect(response.status).toBe(200);
      expect(response.body.totalAffectedEvents).toBe(1); // Only evt1 had cat2

      // Verify source categories are deleted
      const categoriesResponse = await env.authGet(
        authToken,
        `/api/v1/calendars/${cal2.urlName}/categories`,
      );

      expect(categoriesResponse.status).toBe(200);
      const remainingCategories = categoriesResponse.body.map((c: any) => c.id);
      expect(remainingCategories).toContain(cat1.id);
      expect(remainingCategories).not.toContain(cat2.id);
      expect(remainingCategories).not.toContain(cat3.id);

      // Verify target category has correct event count (2 events, no duplicates)
      const cat1Data = categoriesResponse.body.find((c: any) => c.id === cat1.id);
      expect(cat1Data.eventCount).toBe(2);

      // Verify event1 only has cat1 (no duplicate assignments)
      const evt1Categories = await calendarInterface.getEventCategories(evt1.id);
      expect(evt1Categories.length).toBe(1);
      expect(evt1Categories[0].id).toBe(cat1.id);
    });
  });

  describe('Event count accuracy after operations', () => {
    it('should maintain accurate event counts after multiple operations', async () => {
      // Create new calendar for this test
      const cal3 = await calendarInterface.createCalendar(testAccount, 'count-test-cal');
      const cat1 = await calendarInterface.createCategory(testAccount, cal3.id, { name: 'Cat1', language: 'en' });
      const cat2 = await calendarInterface.createCategory(testAccount, cal3.id, { name: 'Cat2', language: 'en' });
      const cat3 = await calendarInterface.createCategory(testAccount, cal3.id, { name: 'Cat3', language: 'en' });

      const evt1 = await calendarInterface.createEvent(testAccount, {
        calendarId: cal3.id,
        content: { en: { name: 'Event 1', description: 'Test' } },
        start_date: '2025-12-01',
        start_time: '10:00',
        end_date: '2025-12-01',
        end_time: '11:00',
      });

      const evt2 = await calendarInterface.createEvent(testAccount, {
        calendarId: cal3.id,
        content: { en: { name: 'Event 2', description: 'Test' } },
        start_date: '2025-12-02',
        start_time: '10:00',
        end_date: '2025-12-02',
        end_time: '11:00',
      });

      // Assign events: evt1 to cat1 and cat2, evt2 to cat1
      await calendarInterface.assignCategoryToEvent(testAccount, evt1.id, cat1.id);
      await calendarInterface.assignCategoryToEvent(testAccount, evt1.id, cat2.id);
      await calendarInterface.assignCategoryToEvent(testAccount, evt2.id, cat1.id);

      // Verify initial counts
      let categoriesResponse = await env.authGet(authToken, `/api/v1/calendars/${cal3.urlName}/categories`);
      let cat1Data = categoriesResponse.body.find((c: any) => c.id === cat1.id);
      expect(cat1Data.eventCount).toBe(2);

      // Create new event and assign to cat3
      const evt3 = await calendarInterface.createEvent(testAccount, {
        calendarId: cal3.id,
        content: { en: { name: 'Event 3', description: 'Test' } },
        start_date: '2025-12-03',
        start_time: '10:00',
        end_date: '2025-12-03',
        end_time: '11:00',
      });
      await calendarInterface.assignCategoryToEvent(testAccount, evt3.id, cat3.id);

      // Verify cat3 count increased
      categoriesResponse = await env.authGet(authToken, `/api/v1/calendars/${cal3.urlName}/categories`);
      let cat3Data = categoriesResponse.body.find((c: any) => c.id === cat3.id);
      expect(cat3Data.eventCount).toBe(1);

      // Merge cat3 into cat1
      await env.authPost(authToken, `/api/v1/calendars/${cal3.urlName}/categories/merge`, {
        targetCategoryId: cat1.id,
        sourceCategoryIds: [cat3.id],
      });

      // Verify cat1 count is now 3
      categoriesResponse = await env.authGet(authToken, `/api/v1/calendars/${cal3.urlName}/categories`);
      cat1Data = categoriesResponse.body.find((c: any) => c.id === cat1.id);
      expect(cat1Data.eventCount).toBe(3);

      // Delete cat1 with remove action
      await env.authDelete(authToken, `/api/v1/calendars/${cal3.urlName}/categories/${cat1.id}?action=remove`);

      // Verify cat1 is gone and cat2 count unchanged
      categoriesResponse = await env.authGet(authToken, `/api/v1/calendars/${cal3.urlName}/categories`);
      const remainingIds = categoriesResponse.body.map((c: any) => c.id);
      expect(remainingIds).not.toContain(cat1.id);

      const cat2Data = categoriesResponse.body.find((c: any) => c.id === cat2.id);
      expect(cat2Data.eventCount).toBe(1); // Still has evt1
    });
  });

  describe('Permission validation', () => {
    it('should reject unauthorized user from deleting category', async () => {
      // Unauthorized user attempts to delete category
      const response = await env.authDelete(
        unauthorizedToken,
        `/api/v1/calendars/${testCalendar.urlName}/categories/${testCategory2.id}?action=remove`,
      );

      expect(response.status).toBe(403);

      // Verify category still exists
      const categoriesResponse = await env.authGet(
        authToken,
        `/api/v1/calendars/${testCalendar.urlName}/categories`,
      );

      expect(categoriesResponse.status).toBe(200);
      const categoryIds = categoriesResponse.body.map((c: any) => c.id);
      expect(categoryIds).toContain(testCategory2.id);
    });

    it('should reject unauthorized user from merging categories', async () => {
      // Unauthorized user attempts to merge categories
      const response = await env.authPost(
        unauthorizedToken,
        `/api/v1/calendars/${testCalendar.urlName}/categories/merge`,
        {
          targetCategoryId: testCategory2.id,
          sourceCategoryIds: [testCategory3.id],
        },
      );

      expect(response.status).toBe(403);

      // Verify categories still exist
      const categoriesResponse = await env.authGet(
        authToken,
        `/api/v1/calendars/${testCalendar.urlName}/categories`,
      );

      expect(categoriesResponse.status).toBe(200);
      const categoryIds = categoriesResponse.body.map((c: any) => c.id);
      expect(categoryIds).toContain(testCategory2.id);
      expect(categoryIds).toContain(testCategory3.id);
    });
  });

  describe('Error handling for edge cases', () => {
    it('should reject deletion with migration to non-existent target', async () => {
      const response = await env.authDelete(
        authToken,
        `/api/v1/calendars/${testCalendar.urlName}/categories/${testCategory2.id}?action=migrate&targetCategoryId=non-existent-id`,
      );

      expect(response.status).toBe(404);

      // Verify category2 still exists
      const categoriesResponse = await env.authGet(
        authToken,
        `/api/v1/calendars/${testCalendar.urlName}/categories`,
      );

      const categoryIds = categoriesResponse.body.map((c: any) => c.id);
      expect(categoryIds).toContain(testCategory2.id);
    });

    it('should reject merge with target in source list', async () => {
      const response = await env.authPost(
        authToken,
        `/api/v1/calendars/${testCalendar.urlName}/categories/merge`,
        {
          targetCategoryId: testCategory2.id,
          sourceCategoryIds: [testCategory2.id, testCategory3.id],
        },
      );

      expect(response.status).toBe(400);

      // Verify both categories still exist
      const categoriesResponse = await env.authGet(
        authToken,
        `/api/v1/calendars/${testCalendar.urlName}/categories`,
      );

      const categoryIds = categoriesResponse.body.map((c: any) => c.id);
      expect(categoryIds).toContain(testCategory2.id);
      expect(categoryIds).toContain(testCategory3.id);
    });

    it('should reject merge with non-existent source category', async () => {
      const response = await env.authPost(
        authToken,
        `/api/v1/calendars/${testCalendar.urlName}/categories/merge`,
        {
          targetCategoryId: testCategory2.id,
          sourceCategoryIds: ['non-existent-id'],
        },
      );

      expect(response.status).toBe(404);
    });

  });
});
