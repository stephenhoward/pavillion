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
import SetupInterface from '@/server/setup/interface';
import { AccountRoleEntity } from '@/server/common/entity/account';

/**
 * Comprehensive integration tests for category management functionality.
 * Tests the complete category workflow including multilingual support,
 * permissions, and full CRUD operations with event assignments.
 */
describe('Category Management - Comprehensive Integration', () => {
  let account: Account;
  let otherAccount: Account;
  let calendar: Calendar;
  let otherCalendar: Calendar;
  let event1: CalendarEvent;
  let event2: CalendarEvent;
  let env: TestEnvironment;
  let userEmail: string = 'categorycomprehensive@pavillion.dev';
  let userPassword: string = 'testpassword';
  let otherEmail: string = 'categoryother@pavillion.dev';
  let otherPassword: string = 'testpassword';

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init(3007); // Use unique port

    const eventBus = new EventEmitter();
    const calendarInterface = new CalendarInterface(eventBus);
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    // Set up primary test account and calendar
    let accountInfo = await accountService._setupAccount(userEmail, userPassword);
    account = accountInfo.account;
    calendar = await calendarInterface.createCalendar(account, 'comprehensive');

    // Set up second account and calendar for permission testing
    let otherAccountInfo = await accountService._setupAccount(otherEmail, otherPassword);
    otherAccount = otherAccountInfo.account;
    otherCalendar = await calendarInterface.createCalendar(otherAccount, 'othercomprehensive');

    // Create test events
    event1 = await calendarInterface.createEvent(account, {
      calendarId: calendar.id,
      content: {
        en: {
          name: 'Technology Conference',
          description: 'Annual tech conference',
        },
        es: {
          name: 'Conferencia de Tecnología',
          description: 'Conferencia anual de tecnología',
        },
      },
      start_date: '2025-08-01',
      start_time: '09:00',
      end_date: '2025-08-01',
      end_time: '17:00',
    });

    event2 = await calendarInterface.createEvent(account, {
      calendarId: calendar.id,
      content: {
        en: {
          name: 'Workshop: Machine Learning',
          description: 'Hands-on ML workshop',
        },
      },
      start_date: '2025-08-02',
      start_time: '14:00',
      end_date: '2025-08-02',
      end_time: '16:00',
    });
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  describe('Category CRUD with Multilingual Support', () => {
    let techCategoryId: string;
    let workshopCategoryId: string;

    it('should create categories with multilingual content', async () => {
      const authKey = await env.login(userEmail, userPassword);

      // Create Technology category with multiple languages
      const techCategoryData = {
        content: {
          en: {
            name: 'Technology',
          },
          es: {
            name: 'Tecnología',
          },
          fr: {
            name: 'Technologie',
          },
        },
      };

      const techResponse = await env.authPost(authKey, `/api/v1/calendars/${calendar.id}/categories`, techCategoryData);

      expect(techResponse.status).toBe(201);
      expect(techResponse.body).toHaveProperty('id');
      expect(techResponse.body).toHaveProperty('calendarId', calendar.id);
      expect(techResponse.body.content.en.name).toBe('Technology');
      expect(techResponse.body.content.es.name).toBe('Tecnología');
      expect(techResponse.body.content.fr.name).toBe('Technologie');

      techCategoryId = techResponse.body.id;

      // Create Workshop category with single language
      const workshopCategoryData = {
        content: {
          en: {
            name: 'Workshop',
          },
        },
      };

      const workshopResponse = await env.authPost(authKey, `/api/v1/calendars/${calendar.id}/categories`, workshopCategoryData);

      expect(workshopResponse.status).toBe(201);
      expect(workshopResponse.body.content.en.name).toBe('Workshop');
      expect(workshopResponse.body.content).not.toHaveProperty('es');

      workshopCategoryId = workshopResponse.body.id;
    });

    it('should list all categories for a calendar', async () => {
      const authKey = await env.login(userEmail, userPassword);

      const response = await request(env.app)
        .get(`/api/v1/calendars/${calendar.id}/categories`)
        .set('Authorization', 'Bearer ' + authKey);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(2);

      const techCategory = response.body.find((cat: any) => cat.id === techCategoryId);
      const workshopCategory = response.body.find((cat: any) => cat.id === workshopCategoryId);

      expect(techCategory).toBeDefined();
      expect(workshopCategory).toBeDefined();
    });

    it('should get individual categories by ID', async () => {
      const authKey = await env.login(userEmail, userPassword);

      const response = await request(env.app)
        .get(`/api/v1/calendars/${calendar.id}/categories/${techCategoryId}`)
        .set('Authorization', 'Bearer ' + authKey);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(techCategoryId);
      expect(response.body.content.en.name).toBe('Technology');
      expect(response.body.content.es.name).toBe('Tecnología');
      expect(response.body.content.fr.name).toBe('Technologie');
    });

    it('should update category content', async () => {
      const authKey = await env.login(userEmail, userPassword);

      const updateData = {
        content: {
          en: {
            name: 'Technology & Innovation',
          },
          es: {
            name: 'Tecnología e Innovación',
          },
          fr: null, // Remove French content
          de: {
            name: 'Technologie und Innovation',
          },
        },
      };

      const response = await request(env.app)
        .put(`/api/v1/calendars/${calendar.id}/categories/${techCategoryId}`)
        .set('Authorization', 'Bearer ' + authKey)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.content.en.name).toBe('Technology & Innovation');
      expect(response.body.content.es.name).toBe('Tecnología e Innovación');
      expect(response.body.content.de.name).toBe('Technologie und Innovation');
      expect(response.body.content).not.toHaveProperty('fr');
    });

    it('should delete categories', async () => {
      const authKey = await env.login(userEmail, userPassword);

      // Delete workshop category
      const deleteResponse = await request(env.app)
        .delete(`/api/v1/calendars/${calendar.id}/categories/${workshopCategoryId}`)
        .set('Authorization', 'Bearer ' + authKey);

      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.body).toHaveProperty('affectedEventCount');

      // Verify category is deleted
      const getResponse = await request(env.app)
        .get(`/api/v1/calendars/${calendar.id}/categories/${workshopCategoryId}`)
        .set('Authorization', 'Bearer ' + authKey);

      expect(getResponse.status).toBe(404);
      expect(getResponse.body).toHaveProperty('errorName', 'CategoryNotFoundError');
    });
  });

  describe('Category Assignment Workflow', () => {
    let categoryId: string;

    beforeAll(async () => {
      // Create a category for assignment tests
      const authKey = await env.login(userEmail, userPassword);
      const categoryData = {
        content: {
          en: {
            name: 'Conference',
          },
          es: {
            name: 'Conferencia',
          },
        },
      };

      const response = await env.authPost(authKey, `/api/v1/calendars/${calendar.id}/categories`, categoryData);
      categoryId = response.body.id;
    });

    it('should assign categories to events', async () => {
      const authKey = await env.login(userEmail, userPassword);

      // Assign category to first event
      const encodedEvent1Id = encodeURIComponent(event1.id);
      const assignResponse = await env.authPost(authKey, `/api/v1/events/${encodedEvent1Id}/categories/${categoryId}`, {});

      expect(assignResponse.status).toBe(201);
      expect(assignResponse.body).toHaveProperty('eventId', event1.id);
      expect(assignResponse.body).toHaveProperty('categoryId', categoryId);
      expect(assignResponse.body).toHaveProperty('createdAt');
    });

    it('should get all categories for an event', async () => {
      const authKey = await env.login(userEmail, userPassword);

      const encodedEvent1Id = encodeURIComponent(event1.id);
      const response = await request(env.app)
        .get(`/api/v1/events/${encodedEvent1Id}/categories`)
        .set('Authorization', 'Bearer ' + authKey);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(1);
      expect(response.body[0]).toHaveProperty('id', categoryId);
      expect(response.body[0].content.en.name).toBe('Conference');
      expect(response.body[0].content.es.name).toBe('Conferencia');
    });

    it('should get all events for a category', async () => {
      const authKey = await env.login(userEmail, userPassword);

      const response = await request(env.app)
        .get(`/api/v1/calendars/${calendar.id}/categories/${categoryId}/events`)
        .set('Authorization', 'Bearer ' + authKey);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(1);
      expect(response.body[0]).toBe(event1.id);
    });

    it('should assign same category to multiple events', async () => {
      const authKey = await env.login(userEmail, userPassword);

      // Assign category to second event
      const encodedEvent2Id = encodeURIComponent(event2.id);
      const assignResponse = await env.authPost(authKey, `/api/v1/events/${encodedEvent2Id}/categories/${categoryId}`, {});

      expect(assignResponse.status).toBe(201);

      // Verify category now appears for both events
      const categoryEventsResponse = await request(env.app)
        .get(`/api/v1/calendars/${calendar.id}/categories/${categoryId}/events`)
        .set('Authorization', 'Bearer ' + authKey);

      expect(categoryEventsResponse.status).toBe(200);
      expect(categoryEventsResponse.body.length).toBe(2);
      expect(categoryEventsResponse.body).toContain(event1.id);
      expect(categoryEventsResponse.body).toContain(event2.id);
    });

    it('should prevent duplicate category assignments', async () => {
      const authKey = await env.login(userEmail, userPassword);

      // Try to assign the same category to event1 again
      const encodedEvent1Id = encodeURIComponent(event1.id);
      const duplicateResponse = await env.authPost(authKey, `/api/v1/events/${encodedEvent1Id}/categories/${categoryId}`, {});

      expect(duplicateResponse.status).toBe(409);
      expect(duplicateResponse.body).toHaveProperty('errorName', 'CategoryAlreadyAssignedError');
    });

    it('should unassign categories from events', async () => {
      const authKey = await env.login(userEmail, userPassword);

      // Unassign category from first event
      const encodedEvent1Id = encodeURIComponent(event1.id);
      const unassignResponse = await request(env.app)
        .delete(`/api/v1/events/${encodedEvent1Id}/categories/${categoryId}`)
        .set('Authorization', 'Bearer ' + authKey);

      expect(unassignResponse.status).toBe(204);

      // Verify category is removed from event1
      const event1CategoriesResponse = await request(env.app)
        .get(`/api/v1/events/${encodedEvent1Id}/categories`)
        .set('Authorization', 'Bearer ' + authKey);

      expect(event1CategoriesResponse.status).toBe(200);
      expect(event1CategoriesResponse.body.length).toBe(0);

      // Verify category is still assigned to event2
      const categoryEventsResponse = await request(env.app)
        .get(`/api/v1/calendars/${calendar.id}/categories/${categoryId}/events`)
        .set('Authorization', 'Bearer ' + authKey);

      expect(categoryEventsResponse.status).toBe(200);
      expect(categoryEventsResponse.body.length).toBe(1);
      expect(categoryEventsResponse.body[0]).toBe(event2.id);
    });

    it('should delete categories that have event assignments', async () => {
      const authKey = await env.login(userEmail, userPassword);

      // Create a new category for deletion test
      const categoryResponse = await request(env.app)
        .post(`/api/v1/calendars/${calendar.id}/categories`)
        .set('Authorization', 'Bearer ' + authKey)
        .send({
          content: {
            en: { name: 'Category to Delete' },
          },
        });

      expect(categoryResponse.status).toBe(201);
      const categoryToDeleteId = categoryResponse.body.id;

      // Assign the category to event1 (which already exists)
      const encodedEvent1Id = encodeURIComponent(event1.id);
      const assignResponse = await request(env.app)
        .post(`/api/v1/events/${encodedEvent1Id}/categories/${categoryToDeleteId}`)
        .set('Authorization', 'Bearer ' + authKey);

      expect(assignResponse.status).toBe(201);

      // Verify assignment exists
      const getAssignmentsResponse = await request(env.app)
        .get(`/api/v1/events/${encodedEvent1Id}/categories`)
        .set('Authorization', 'Bearer ' + authKey);

      expect(getAssignmentsResponse.status).toBe(200);
      const assignedCategories = getAssignmentsResponse.body;
      const hasOurCategory = assignedCategories.some(cat => cat.id === categoryToDeleteId);
      expect(hasOurCategory).toBe(true);

      // Delete the category (should succeed and clean up assignments)
      const deleteResponse = await request(env.app)
        .delete(`/api/v1/calendars/${calendar.id}/categories/${categoryToDeleteId}`)
        .set('Authorization', 'Bearer ' + authKey);

      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.body).toHaveProperty('affectedEventCount');

      // Verify category is deleted
      const getCategoryResponse = await request(env.app)
        .get(`/api/v1/calendars/${calendar.id}/categories/${categoryToDeleteId}`)
        .set('Authorization', 'Bearer ' + authKey);

      expect(getCategoryResponse.status).toBe(404);

      // Verify assignment is also deleted
      const getAssignmentsAfterResponse = await request(env.app)
        .get(`/api/v1/events/${encodedEvent1Id}/categories`)
        .set('Authorization', 'Bearer ' + authKey);

      expect(getAssignmentsAfterResponse.status).toBe(200);
      const remainingCategories = getAssignmentsAfterResponse.body;
      const stillHasOurCategory = remainingCategories.some(cat => cat.id === categoryToDeleteId);
      expect(stillHasOurCategory).toBe(false);
    });
  });

  describe('Permission Validation', () => {
    let privateCategoryId: string;

    beforeAll(async () => {
      // Remove admin role from first account to test permission checks
      // (First account gets admin role from _setupAccount)
      await AccountRoleEntity.destroy({
        where: {
          account_id: account.id,
          role: 'admin',
        },
      });

      // Create a category in the other calendar
      const otherAuthKey = await env.login(otherEmail, otherPassword);
      const categoryData = {
        content: {
          en: {
            name: 'Private Category',
          },
        },
      };

      const response = await env.authPost(otherAuthKey, `/api/v1/calendars/${otherCalendar.id}/categories`, categoryData);
      privateCategoryId = response.body.id;
    });

    it('should prevent unauthorized category creation', async () => {
      const authKey = await env.login(userEmail, userPassword);

      const categoryData = {
        content: {
          en: {
            name: 'Unauthorized Category',
          },
        },
      };

      const response = await env.authPost(authKey, `/api/v1/calendars/${otherCalendar.id}/categories`, categoryData);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('errorName', 'InsufficientCalendarPermissionsError');
    });

    it('should prevent unauthorized category updates', async () => {
      const authKey = await env.login(userEmail, userPassword);

      const updateData = {
        content: {
          en: {
            name: 'Updated Private Category',
          },
        },
      };

      const response = await request(env.app)
        .put(`/api/v1/calendars/${otherCalendar.id}/categories/${privateCategoryId}`)
        .set('Authorization', 'Bearer ' + authKey)
        .send(updateData);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('errorName', 'InsufficientCalendarPermissionsError');
    });

    it('should prevent unauthorized category deletion', async () => {
      const authKey = await env.login(userEmail, userPassword);

      const response = await request(env.app)
        .delete(`/api/v1/calendars/${otherCalendar.id}/categories/${privateCategoryId}`)
        .set('Authorization', 'Bearer ' + authKey);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('errorName', 'InsufficientCalendarPermissionsError');
    });

    it('should prevent cross-calendar category assignments', async () => {
      const authKey = await env.login(userEmail, userPassword);

      // Try to assign a category from otherCalendar to an event in our calendar
      const encodedEvent1Id = encodeURIComponent(event1.id);
      const response = await env.authPost(authKey, `/api/v1/events/${encodedEvent1Id}/categories/${privateCategoryId}`, {});

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('errorName', 'CategoryEventCalendarMismatchError');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent calendars', async () => {
      const authKey = await env.login(userEmail, userPassword);

      const categoryData = {
        content: {
          en: {
            name: 'Test Category',
          },
        },
      };

      const response = await env.authPost(authKey, '/api/v1/calendars/non-existent-id/categories', categoryData);

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('errorName', 'CalendarNotFoundError');
    });

    it('should return 404 for non-existent categories', async () => {
      const authKey = await env.login(userEmail, userPassword);

      const response = await request(env.app)
        .get(`/api/v1/calendars/${calendar.id}/categories/non-existent-id`)
        .set('Authorization', 'Bearer ' + authKey);

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('errorName', 'CategoryNotFoundError');
    });

    it('should return 404 for non-existent events in category assignment', async () => {
      const authKey = await env.login(userEmail, userPassword);

      // Create a category first
      const categoryData = {
        content: {
          en: {
            name: 'Test Category',
          },
        },
      };

      const categoryResponse = await env.authPost(authKey, `/api/v1/calendars/${calendar.id}/categories`, categoryData);
      const categoryId = categoryResponse.body.id;

      // Try to assign to non-existent event
      const response = await env.authPost(authKey, '/api/v1/events/non-existent-event/categories/' + categoryId, {});

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('errorName', 'EventNotFoundError');
    });

    it('should return 401 for unauthenticated requests', async () => {
      const categoryData = {
        content: {
          en: {
            name: 'Unauthorized Category',
          },
        },
      };

      const response = await request(env.app)
        .post(`/api/v1/calendars/${calendar.id}/categories`)
        .send(categoryData);

      expect(response.status).toBe(401);
    });
  });
});
