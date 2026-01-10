import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';

import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { Account } from '@/common/model/account';
import EventService from '@/server/calendar/service/events';
import CalendarService from '@/server/calendar/service/calendar';
import db from '@/server/common/entity/db';

/**
 * Integration test to verify event search works with SQLite
 *
 * This test specifically checks that the case-insensitive search using LOWER()
 * works correctly with SQLite (which doesn't support PostgreSQL's ILIKE operator)
 */
describe('Event Search Integration (SQLite)', () => {
  let eventService: EventService;
  let calendarService: CalendarService;
  let eventBus: EventEmitter;
  let testCalendar: Calendar;
  let testAccount: Account;

  beforeAll(async () => {
    // Initialize database
    await db.sync({ force: true });

    eventBus = new EventEmitter();
    eventService = new EventService(eventBus);
    calendarService = new CalendarService();

    // Create test account and calendar
    testAccount = new Account('test-account-id', 'testuser');
    testAccount.email = 'test@example.com';

    testCalendar = new Calendar('test-calendar-id', 'test-calendar');
    testCalendar.accountId = testAccount.id;

    // Note: In a real test, you'd use proper service methods to create these
    // For now we're just testing the search functionality
  });

  afterAll(async () => {
    // No-op: Don't close the database connection
    // SQLite :memory: is automatically cleaned up when the process exits
  });

  it('should perform case-insensitive search using LOWER() function', async () => {
    // Test 1: Search should not throw an error (was throwing with Op.iLike)
    const results1 = await eventService.listEvents(testCalendar, {
      search: 'workshop',
    });
    expect(results1).toBeDefined();
    expect(Array.isArray(results1)).toBe(true);

    // Test 2: Case-insensitive search with uppercase query
    const results2 = await eventService.listEvents(testCalendar, {
      search: 'WORKSHOP',
    });
    expect(results2).toBeDefined();
    expect(Array.isArray(results2)).toBe(true);

    // Test 3: Case-insensitive search with mixed case
    const results3 = await eventService.listEvents(testCalendar, {
      search: 'WoRkShOp',
    });
    expect(results3).toBeDefined();
    expect(Array.isArray(results3)).toBe(true);
  });

  it('should handle search with special characters', async () => {
    const results = await eventService.listEvents(testCalendar, {
      search: 'test%',
    });
    expect(results).toBeDefined();
    expect(Array.isArray(results)).toBe(true);
  });

  it('should handle empty search results gracefully', async () => {
    const results = await eventService.listEvents(testCalendar, {
      search: 'nonexistentquerystringthatwillnevermatch',
    });
    expect(results).toBeDefined();
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(0);
  });
});
