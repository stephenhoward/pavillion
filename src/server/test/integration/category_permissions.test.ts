import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';
import request from 'supertest';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { TestEnvironment } from '@/server/test/lib/test_environment';
import AccountService from '@/server/accounts/service/account';
import CalendarService from '@/server/calendar/service/calendar';
import ConfigurationInterface from '@/server/configuration/interface';
import AccountsInterface from '@/server/accounts/interface';

/**
 * Integration tests specifically for category permissions system.
 * Verifies that category operations properly respect calendar authorization.
 */
describe('Category Permissions Integration', () => {
  let ownerAccount: Account;
  let unauthorizedAccount: Account;
  let calendar: Calendar;
  let otherCalendar: Calendar;
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init(3009); // Use unique port

    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const accountService = new AccountService(eventBus, configurationInterface);
    const accountsInterface = new AccountsInterface(eventBus, configurationInterface);
    const calendarService = new CalendarService(accountsInterface, configurationInterface);

    // Set up owner account and calendar
    let ownerInfo = await accountService._setupAccount('owner@pavillion.dev', 'testpassword');
    ownerAccount = ownerInfo.account;
    calendar = await calendarService.createCalendar(ownerAccount, 'permissionstest');

    // Set up editor account and grant editor access
    await accountService._setupAccount('editor@pavillion.dev', 'testpassword');
    await calendarService.grantEditAccessByEmail(ownerAccount, calendar.id, 'editor@pavillion.dev');

    // Set up unauthorized account with separate calendar
    let unauthorizedInfo = await accountService._setupAccount('unauthorized@pavillion.dev', 'testpassword');
    unauthorizedAccount = unauthorizedInfo.account;
    otherCalendar = await calendarService.createCalendar(unauthorizedAccount, 'othercalendar');
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  describe('Calendar Owner Permissions', () => {
    it('should allow calendar owner to create categories', async () => {
      const ownerAuthKey = await env.login('owner@pavillion.dev', 'testpassword');

      const categoryData = {
        content: {
          en: { name: 'Owner Created Category' },
        },
      };

      const response = await env.authPost(ownerAuthKey, `/api/v1/calendars/${calendar.id}/categories`, categoryData);

      expect(response.status).toBe(201);
      expect(response.body.content.en.name).toBe('Owner Created Category');
    });

    it('should allow calendar owner to update categories', async () => {
      const ownerAuthKey = await env.login('owner@pavillion.dev', 'testpassword');

      // Create category first
      const createData = {
        content: {
          en: { name: 'Original Name' },
        },
      };
      const createResponse = await env.authPost(ownerAuthKey, `/api/v1/calendars/${calendar.id}/categories`, createData);
      const categoryId = createResponse.body.id;

      // Update the category
      const updateData = {
        content: {
          en: { name: 'Updated Name' },
        },
      };
      const updateResponse = await request(env.app)
        .put(`/api/v1/categories/${categoryId}`)
        .set('Authorization', 'Bearer ' + ownerAuthKey)
        .send(updateData);

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.content.en.name).toBe('Updated Name');
    });

    it('should allow calendar owner to delete categories', async () => {
      const ownerAuthKey = await env.login('owner@pavillion.dev', 'testpassword');

      // Create category first
      const createData = {
        content: {
          en: { name: 'To Be Deleted' },
        },
      };
      const createResponse = await env.authPost(ownerAuthKey, `/api/v1/calendars/${calendar.id}/categories`, createData);
      const categoryId = createResponse.body.id;

      // Delete the category
      const deleteResponse = await request(env.app)
        .delete(`/api/v1/categories/${categoryId}`)
        .set('Authorization', 'Bearer ' + ownerAuthKey);

      expect(deleteResponse.status).toBe(204);
    });
  });

  describe('Calendar Editor Permissions', () => {
    it('should allow calendar editor to create categories', async () => {
      const editorAuthKey = await env.login('editor@pavillion.dev', 'testpassword');

      const categoryData = {
        content: {
          en: { name: 'Editor Created Category' },
        },
      };

      const response = await env.authPost(editorAuthKey, `/api/v1/calendars/${calendar.id}/categories`, categoryData);

      expect(response.status).toBe(201);
      expect(response.body.content.en.name).toBe('Editor Created Category');
    });

    it('should allow calendar editor to update categories', async () => {
      const editorAuthKey = await env.login('editor@pavillion.dev', 'testpassword');

      // Create category first
      const createData = {
        content: {
          en: { name: 'Editor Original' },
        },
      };
      const createResponse = await env.authPost(editorAuthKey, `/api/v1/calendars/${calendar.id}/categories`, createData);
      const categoryId = createResponse.body.id;

      // Update the category
      const updateData = {
        content: {
          en: { name: 'Editor Updated' },
        },
      };
      const updateResponse = await request(env.app)
        .put(`/api/v1/categories/${categoryId}`)
        .set('Authorization', 'Bearer ' + editorAuthKey)
        .send(updateData);

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.content.en.name).toBe('Editor Updated');
    });

    it('should allow calendar editor to delete categories', async () => {
      const editorAuthKey = await env.login('editor@pavillion.dev', 'testpassword');

      // Create category first
      const createData = {
        content: {
          en: { name: 'Editor To Delete' },
        },
      };
      const createResponse = await env.authPost(editorAuthKey, `/api/v1/calendars/${calendar.id}/categories`, createData);
      const categoryId = createResponse.body.id;

      // Delete the category
      const deleteResponse = await request(env.app)
        .delete(`/api/v1/categories/${categoryId}`)
        .set('Authorization', 'Bearer ' + editorAuthKey);

      expect(deleteResponse.status).toBe(204);
    });
  });

  describe('Unauthorized User Restrictions', () => {
    it('should prevent unauthorized user from creating categories', async () => {
      const unauthorizedAuthKey = await env.login('unauthorized@pavillion.dev', 'testpassword');

      const categoryData = {
        content: {
          en: { name: 'Unauthorized Category' },
        },
      };

      const response = await env.authPost(unauthorizedAuthKey, `/api/v1/calendars/${calendar.id}/categories`, categoryData);

      expect(response.status).toBe(403);
      expect(response.body.errorName).toBe('InsufficientCalendarPermissionsError');
    });

    it('should prevent unauthorized user from updating categories', async () => {
      const ownerAuthKey = await env.login('owner@pavillion.dev', 'testpassword');
      const unauthorizedAuthKey = await env.login('unauthorized@pavillion.dev', 'testpassword');

      // Create category as owner
      const createData = {
        content: {
          en: { name: 'Protected Category' },
        },
      };
      const createResponse = await env.authPost(ownerAuthKey, `/api/v1/calendars/${calendar.id}/categories`, createData);
      const categoryId = createResponse.body.id;

      // Try to update as unauthorized user
      const updateData = {
        content: {
          en: { name: 'Hacked Name' },
        },
      };
      const updateResponse = await request(env.app)
        .put(`/api/v1/categories/${categoryId}`)
        .set('Authorization', 'Bearer ' + unauthorizedAuthKey)
        .send(updateData);

      expect(updateResponse.status).toBe(403);
      expect(updateResponse.body.errorName).toBe('InsufficientCalendarPermissionsError');
    });

    it('should prevent unauthorized user from deleting categories', async () => {
      const ownerAuthKey = await env.login('owner@pavillion.dev', 'testpassword');
      const unauthorizedAuthKey = await env.login('unauthorized@pavillion.dev', 'testpassword');

      // Create category as owner
      const createData = {
        content: {
          en: { name: 'Protected from Deletion' },
        },
      };
      const createResponse = await env.authPost(ownerAuthKey, `/api/v1/calendars/${calendar.id}/categories`, createData);
      const categoryId = createResponse.body.id;

      // Try to delete as unauthorized user
      const deleteResponse = await request(env.app)
        .delete(`/api/v1/categories/${categoryId}`)
        .set('Authorization', 'Bearer ' + unauthorizedAuthKey);

      expect(deleteResponse.status).toBe(403);
      expect(deleteResponse.body.errorName).toBe('InsufficientCalendarPermissionsError');
    });
  });

  describe('Category Assignment Permissions', () => {
    let categoryId: string;
    let eventId: string;

    beforeAll(async () => {
      const ownerAuthKey = await env.login('owner@pavillion.dev', 'testpassword');

      // Create category
      const categoryData = {
        content: {
          en: { name: 'Assignment Test Category' },
        },
      };
      const categoryResponse = await env.authPost(ownerAuthKey, `/api/v1/calendars/${calendar.id}/categories`, categoryData);
      categoryId = categoryResponse.body.id;

      // Create event
      const eventData = {
        calendarId: calendar.id,
        content: {
          en: {
            name: 'Test Event for Assignment',
            description: 'Test event description',
          },
        },
        schedules: [{
          start: '2025-01-01T10:00:00.000Z',
          end: '2025-01-01T11:00:00.000Z',
        }],
      };
      const eventResponse = await env.authPost(ownerAuthKey, '/api/v1/events', eventData);
      eventId = eventResponse.body.id;
    });

    it('should allow owner to assign categories to events', async () => {
      const ownerAuthKey = await env.login('owner@pavillion.dev', 'testpassword');

      const encodedEventId = encodeURIComponent(eventId);
      const response = await request(env.app)
        .post(`/api/v1/events/${encodedEventId}/categories/${categoryId}`)
        .set('Authorization', 'Bearer ' + ownerAuthKey);

      expect(response.status).toBe(201);
      expect(response.body.eventId).toBe(eventId);
      expect(response.body.categoryId).toBe(categoryId);
    });

    it('should allow editor to assign categories to events', async () => {
      const ownerAuthKey = await env.login('owner@pavillion.dev', 'testpassword');
      const editorAuthKey = await env.login('editor@pavillion.dev', 'testpassword');

      // Create another category
      const categoryData = {
        content: {
          en: { name: 'Editor Assignment Category' },
        },
      };
      const categoryResponse = await env.authPost(ownerAuthKey, `/api/v1/calendars/${calendar.id}/categories`, categoryData);
      const editorCategoryId = categoryResponse.body.id;

      // Editor assigns category
      const encodedEventId = encodeURIComponent(eventId);
      const response = await request(env.app)
        .post(`/api/v1/events/${encodedEventId}/categories/${editorCategoryId}`)
        .set('Authorization', 'Bearer ' + editorAuthKey);

      expect(response.status).toBe(201);
      expect(response.body.eventId).toBe(eventId);
      expect(response.body.categoryId).toBe(editorCategoryId);
    });

    it('should prevent unauthorized user from assigning categories', async () => {
      const ownerAuthKey = await env.login('owner@pavillion.dev', 'testpassword');
      const unauthorizedAuthKey = await env.login('unauthorized@pavillion.dev', 'testpassword');

      // Create another category
      const categoryData = {
        content: {
          en: { name: 'Unauthorized Assignment Category' },
        },
      };
      const categoryResponse = await env.authPost(ownerAuthKey, `/api/v1/calendars/${calendar.id}/categories`, categoryData);
      const unauthorizedCategoryId = categoryResponse.body.id;

      // Unauthorized user tries to assign category
      const encodedEventId = encodeURIComponent(eventId);
      const response = await request(env.app)
        .post(`/api/v1/events/${encodedEventId}/categories/${unauthorizedCategoryId}`)
        .set('Authorization', 'Bearer ' + unauthorizedAuthKey);

      expect(response.status).toBe(403);
      expect(response.body.errorName).toBe('InsufficientCalendarPermissionsError');
    });

    it('should prevent unauthorized user from unassigning categories', async () => {
      const unauthorizedAuthKey = await env.login('unauthorized@pavillion.dev', 'testpassword');

      // Try to unassign existing category assignment
      const encodedEventId = encodeURIComponent(eventId);
      const response = await request(env.app)
        .delete(`/api/v1/events/${encodedEventId}/categories/${categoryId}`)
        .set('Authorization', 'Bearer ' + unauthorizedAuthKey);

      expect(response.status).toBe(403);
      expect(response.body.errorName).toBe('InsufficientCalendarPermissionsError');
    });
  });

  describe('Cross-Calendar Permission Isolation', () => {
    it('should prevent using categories from different calendars', async () => {
      const ownerAuthKey = await env.login('owner@pavillion.dev', 'testpassword');
      const unauthorizedAuthKey = await env.login('unauthorized@pavillion.dev', 'testpassword');

      // Create category in unauthorized user's calendar
      const categoryData = {
        content: {
          en: { name: 'Other Calendar Category' },
        },
      };
      const categoryResponse = await env.authPost(unauthorizedAuthKey, `/api/v1/calendars/${otherCalendar.id}/categories`, categoryData);
      const otherCategoryId = categoryResponse.body.id;

      // Create event in owner's calendar
      const eventData = {
        calendarId: calendar.id,
        content: {
          en: {
            name: 'Cross Calendar Test Event',
            description: 'Test event description',
          },
        },
        schedules: [{
          start: '2025-01-01T12:00:00.000Z',
          end: '2025-01-01T13:00:00.000Z',
        }],
      };
      const eventResponse = await env.authPost(ownerAuthKey, '/api/v1/events', eventData);
      const crossEventId = eventResponse.body.id;

      // Try to assign category from other calendar to event
      const encodedEventId = encodeURIComponent(crossEventId);
      const response = await request(env.app)
        .post(`/api/v1/events/${encodedEventId}/categories/${otherCategoryId}`)
        .set('Authorization', 'Bearer ' + ownerAuthKey);

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('CategoryEventCalendarMismatchError');
    });
  });
});
