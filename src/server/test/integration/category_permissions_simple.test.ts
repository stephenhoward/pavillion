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
 * Simple integration tests for category permissions system.
 * Verifies that category operations properly respect calendar authorization
 * by testing owner vs non-owner permissions.
 */
describe('Category Permissions - Simple Integration', () => {
  let ownerAccount: Account;
  let nonOwnerAccount: Account;
  let ownerCalendar: Calendar;
  let nonOwnerCalendar: Calendar;
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init(3010); // Use unique port

    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const accountService = new AccountService(eventBus, configurationInterface);
    const accountsInterface = new AccountsInterface(eventBus);
    const calendarService = new CalendarService(eventBus, accountsInterface);

    // Set up owner account and calendar
    let ownerInfo = await accountService._setupAccount('owner@pavillion.dev', 'testpassword');
    ownerAccount = ownerInfo.account;
    ownerCalendar = await calendarService.createCalendar(ownerAccount, 'ownercalendar');

    // Set up non-owner account with separate calendar
    let nonOwnerInfo = await accountService._setupAccount('nonowner@pavillion.dev', 'testpassword');
    nonOwnerAccount = nonOwnerInfo.account;
    nonOwnerCalendar = await calendarService.createCalendar(nonOwnerAccount, 'nonownercalendar');
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  describe('Owner Permissions', () => {
    it('should allow calendar owner to create categories', async () => {
      const ownerAuthKey = await env.login('owner@pavillion.dev', 'testpassword');

      const categoryData = {
        content: {
          en: { name: 'Owner Created Category' },
        },
      };

      const response = await env.authPost(ownerAuthKey, `/api/v1/calendars/${ownerCalendar.id}/categories`, categoryData);

      expect(response.status).toBe(201);
      expect(response.body.content.en.name).toBe('Owner Created Category');
      expect(response.body.calendarId).toBe(ownerCalendar.id);
    });

    it('should allow calendar owner to update their categories', async () => {
      const ownerAuthKey = await env.login('owner@pavillion.dev', 'testpassword');

      // Create category first
      const createData = {
        content: {
          en: { name: 'Original Owner Name' },
        },
      };
      const createResponse = await env.authPost(ownerAuthKey, `/api/v1/calendars/${ownerCalendar.id}/categories`, createData);
      const categoryId = createResponse.body.id;

      // Update the category
      const updateData = {
        content: {
          en: { name: 'Updated Owner Name' },
        },
      };
      const updateResponse = await request(env.app)
        .put(`/api/v1/calendars/${ownerCalendar.id}/categories/${categoryId}`)
        .set('Authorization', 'Bearer ' + ownerAuthKey)
        .send(updateData);

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.content.en.name).toBe('Updated Owner Name');
    });

    it('should allow calendar owner to delete their categories', async () => {
      const ownerAuthKey = await env.login('owner@pavillion.dev', 'testpassword');

      // Create category first
      const createData = {
        content: {
          en: { name: 'To Be Deleted by Owner' },
        },
      };
      const createResponse = await env.authPost(ownerAuthKey, `/api/v1/calendars/${ownerCalendar.id}/categories`, createData);
      const categoryId = createResponse.body.id;

      // Delete the category
      const deleteResponse = await request(env.app)
        .delete(`/api/v1/calendars/${ownerCalendar.id}/categories/${categoryId}`)
        .set('Authorization', 'Bearer ' + ownerAuthKey);

      expect(deleteResponse.status).toBe(204);
    });
  });

  describe('Non-Owner Restrictions', () => {
    it('should prevent non-owner from creating categories in another calendar', async () => {
      const nonOwnerAuthKey = await env.login('nonowner@pavillion.dev', 'testpassword');

      const categoryData = {
        content: {
          en: { name: 'Unauthorized Category Creation' },
        },
      };

      const response = await env.authPost(nonOwnerAuthKey, `/api/v1/calendars/${ownerCalendar.id}/categories`, categoryData);

      expect(response.status).toBe(403);
      expect(response.body.errorName).toBe('InsufficientCalendarPermissionsError');
    });

    it('should prevent non-owner from updating categories in another calendar', async () => {
      const ownerAuthKey = await env.login('owner@pavillion.dev', 'testpassword');
      const nonOwnerAuthKey = await env.login('nonowner@pavillion.dev', 'testpassword');

      // Create category as owner
      const createData = {
        content: {
          en: { name: 'Protected Category' },
        },
      };
      const createResponse = await env.authPost(ownerAuthKey, `/api/v1/calendars/${ownerCalendar.id}/categories`, createData);
      const categoryId = createResponse.body.id;

      // Try to update as non-owner
      const updateData = {
        content: {
          en: { name: 'Hacked Name' },
        },
      };
      const updateResponse = await request(env.app)
        .put(`/api/v1/calendars/${ownerCalendar.id}/categories/${categoryId}`)
        .set('Authorization', 'Bearer ' + nonOwnerAuthKey)
        .send(updateData);

      expect(updateResponse.status).toBe(403);
      expect(updateResponse.body.errorName).toBe('InsufficientCalendarPermissionsError');
    });

    it('should prevent non-owner from deleting categories in another calendar', async () => {
      const ownerAuthKey = await env.login('owner@pavillion.dev', 'testpassword');
      const nonOwnerAuthKey = await env.login('nonowner@pavillion.dev', 'testpassword');

      // Create category as owner
      const createData = {
        content: {
          en: { name: 'Protected from Deletion' },
        },
      };
      const createResponse = await env.authPost(ownerAuthKey, `/api/v1/calendars/${ownerCalendar.id}/categories`, createData);
      const categoryId = createResponse.body.id;

      // Try to delete as non-owner
      const deleteResponse = await request(env.app)
        .delete(`/api/v1/calendars/${ownerCalendar.id}/categories/${categoryId}`)
        .set('Authorization', 'Bearer ' + nonOwnerAuthKey);

      expect(deleteResponse.status).toBe(403);
      expect(deleteResponse.body.errorName).toBe('InsufficientCalendarPermissionsError');
    });
  });

  describe('Category Assignment Permissions', () => {
    let ownerCategoryId: string;
    let ownerEventId: string;

    beforeAll(async () => {
      const ownerAuthKey = await env.login('owner@pavillion.dev', 'testpassword');

      // Create category for owner
      const categoryData = {
        content: {
          en: { name: 'Assignment Test Category' },
        },
      };
      const categoryResponse = await env.authPost(ownerAuthKey, `/api/v1/calendars/${ownerCalendar.id}/categories`, categoryData);
      ownerCategoryId = categoryResponse.body.id;

      // Create event for owner
      const eventData = {
        calendarId: ownerCalendar.id,
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
      ownerEventId = eventResponse.body.id;
    });

    it('should allow owner to assign categories to their events', async () => {
      const ownerAuthKey = await env.login('owner@pavillion.dev', 'testpassword');

      const encodedEventId = encodeURIComponent(ownerEventId);
      const response = await request(env.app)
        .post(`/api/v1/events/${encodedEventId}/categories/${ownerCategoryId}`)
        .set('Authorization', 'Bearer ' + ownerAuthKey);

      expect(response.status).toBe(201);
      expect(response.body.eventId).toBe(ownerEventId);
      expect(response.body.categoryId).toBe(ownerCategoryId);
    });

    it('should prevent non-owner from assigning categories to events', async () => {
      const nonOwnerAuthKey = await env.login('nonowner@pavillion.dev', 'testpassword');

      const encodedEventId = encodeURIComponent(ownerEventId);
      const response = await request(env.app)
        .post(`/api/v1/events/${encodedEventId}/categories/${ownerCategoryId}`)
        .set('Authorization', 'Bearer ' + nonOwnerAuthKey);

      expect(response.status).toBe(403);
      expect(response.body.errorName).toBe('InsufficientCalendarPermissionsError');
    });

    it('should prevent non-owner from unassigning categories from events', async () => {
      const nonOwnerAuthKey = await env.login('nonowner@pavillion.dev', 'testpassword');

      const encodedEventId = encodeURIComponent(ownerEventId);
      const response = await request(env.app)
        .delete(`/api/v1/events/${encodedEventId}/categories/${ownerCategoryId}`)
        .set('Authorization', 'Bearer ' + nonOwnerAuthKey);

      expect(response.status).toBe(403);
      expect(response.body.errorName).toBe('InsufficientCalendarPermissionsError');
    });
  });

  describe('Cross-Calendar Category Protection', () => {
    it('should prevent using categories from different calendars with events', async () => {
      const ownerAuthKey = await env.login('owner@pavillion.dev', 'testpassword');
      const nonOwnerAuthKey = await env.login('nonowner@pavillion.dev', 'testpassword');

      // Create category in non-owner's calendar
      const categoryData = {
        content: {
          en: { name: 'Non-Owner Category' },
        },
      };
      const categoryResponse = await env.authPost(nonOwnerAuthKey, `/api/v1/calendars/${nonOwnerCalendar.id}/categories`, categoryData);
      const nonOwnerCategoryId = categoryResponse.body.id;

      // Create event in owner's calendar
      const eventData = {
        calendarId: ownerCalendar.id,
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

      // Try to assign category from different calendar to event
      const encodedEventId = encodeURIComponent(crossEventId);
      const response = await request(env.app)
        .post(`/api/v1/events/${encodedEventId}/categories/${nonOwnerCategoryId}`)
        .set('Authorization', 'Bearer ' + ownerAuthKey);

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('CategoryEventCalendarMismatchError');
    });
  });

  describe('Read Operations - Public Access', () => {
    it('should allow any authenticated user to list categories in a calendar', async () => {
      const nonOwnerAuthKey = await env.login('nonowner@pavillion.dev', 'testpassword');

      const response = await request(env.app)
        .get(`/api/v1/calendars/${ownerCalendar.id}/categories`)
        .set('Authorization', 'Bearer ' + nonOwnerAuthKey);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should allow any authenticated user to get a specific category', async () => {
      const ownerAuthKey = await env.login('owner@pavillion.dev', 'testpassword');
      const nonOwnerAuthKey = await env.login('nonowner@pavillion.dev', 'testpassword');

      // Create category as owner
      const createData = {
        content: {
          en: { name: 'Public Readable Category' },
        },
      };
      const createResponse = await env.authPost(ownerAuthKey, `/api/v1/calendars/${ownerCalendar.id}/categories`, createData);
      const categoryId = createResponse.body.id;

      // Read category as non-owner
      const readResponse = await request(env.app)
        .get(`/api/v1/calendars/${ownerCalendar.id}/categories/${categoryId}`)
        .set('Authorization', 'Bearer ' + nonOwnerAuthKey);

      expect(readResponse.status).toBe(200);
      expect(readResponse.body.content.en.name).toBe('Public Readable Category');
    });
  });
});
