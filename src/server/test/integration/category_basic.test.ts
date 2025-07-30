import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';
import request from 'supertest';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { TestEnvironment } from '@/server/test/lib/test_environment';
import AccountService from '@/server/accounts/service/account';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';

/**
 * Basic integration tests for category functionality.
 * Tests that the API endpoints are working and properly integrated.
 */
describe('Category Basic Integration', () => {
  let account: Account;
  let calendar: Calendar;
  let event: CalendarEvent;
  let env: TestEnvironment;
  let userEmail: string = 'basiccategorytest@pavillion.dev';
  let userPassword: string = 'testpassword';

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init(3006); // Use different port

    const eventBus = new EventEmitter();
    const calendarInterface = new CalendarInterface(eventBus);
    const configurationInterface = new ConfigurationInterface();
    const accountService = new AccountService(eventBus, configurationInterface);

    // Set up test account and calendar
    let accountInfo = await accountService._setupAccount(userEmail, userPassword);
    account = accountInfo.account;
    calendar = await calendarInterface.createCalendar(account, 'basiccategorytest');

    // Create a test event for category assignment tests
    event = await calendarInterface.createEvent(account, {
      calendarId: calendar.id,
      content: {
        en: {
          name: 'Test Event for Categories',
          description: 'Event used for testing category assignments',
        },
      },
      start_date: '2025-08-01',
      start_time: '10:00',
      end_date: '2025-08-01',
      end_time: '11:00',
    });

  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  it('should create and retrieve a category', async () => {
    const categoryData = {
      content: {
        en: {
          name: 'Technology',
        },
      },
    };

    const authKey = await env.login(userEmail, userPassword);

    // Create category
    const createResponse = await env.authPost(authKey, `/api/v1/calendars/${calendar.id}/categories`, categoryData);

    expect(createResponse.status).toBe(201);
    expect(createResponse.body).toHaveProperty('id');
    expect(createResponse.body).toHaveProperty('calendarId', calendar.id);

    const categoryId = createResponse.body.id;

    // List categories
    const listResponse = await request(env.app)
      .get(`/api/v1/calendars/${calendar.id}/categories`)
      .set('Authorization', 'Bearer ' + authKey);

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body)).toBe(true);
    expect(listResponse.body.length).toBeGreaterThan(0);

    const category = listResponse.body.find((cat: any) => cat.id === categoryId);
    expect(category).toBeDefined();
    expect(category.content.en.name).toBe('Technology');
  });

  it('should assign and unassign categories to events', async () => {
    const authKey = await env.login(userEmail, userPassword);

    // Create a category for assignment
    const categoryData = {
      content: {
        en: {
          name: 'Workshop',
        },
      },
    };

    const categoryResponse = await env.authPost(authKey, `/api/v1/calendars/${calendar.id}/categories`, categoryData);
    expect(categoryResponse.status).toBe(201);

    const categoryId = categoryResponse.body.id;

    // Assign category to event (use URL-encoded event ID)
    const encodedEventId = encodeURIComponent(event.id);
    const assignResponse = await env.authPost(authKey, `/api/v1/events/${encodedEventId}/categories/${categoryId}`, {});


    expect(assignResponse.status).toBe(201);
    expect(assignResponse.body).toHaveProperty('eventId', event.id);
    expect(assignResponse.body).toHaveProperty('categoryId', categoryId);

    // Get event categories
    const eventCategoriesResponse = await request(env.app)
      .get(`/api/v1/events/${encodedEventId}/categories`)
      .set('Authorization', 'Bearer ' + authKey);
    expect(eventCategoriesResponse.status).toBe(200);
    expect(Array.isArray(eventCategoriesResponse.body)).toBe(true);
    expect(eventCategoriesResponse.body.length).toBe(1);
    expect(eventCategoriesResponse.body[0]).toHaveProperty('id', categoryId);

    // Unassign category from event
    const unassignResponse = await request(env.app)
      .delete(`/api/v1/events/${encodedEventId}/categories/${categoryId}`)
      .set('Authorization', 'Bearer ' + authKey);
    expect(unassignResponse.status).toBe(204);

    // Verify assignment is removed
    const verifyResponse = await request(env.app)
      .get(`/api/v1/events/${encodedEventId}/categories`)
      .set('Authorization', 'Bearer ' + authKey);
    expect(verifyResponse.status).toBe(200);
    expect(verifyResponse.body.length).toBe(0);
  });

  it('should handle permission errors correctly', async () => {
    const authKey = await env.login(userEmail, userPassword);

    // Try to get a non-existent category
    const response = await request(env.app)
      .get('/api/v1/categories/non-existent-id')
      .set('Authorization', 'Bearer ' + authKey);
    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('errorName', 'CategoryNotFoundError');
  });
});
