import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import { TestEnvironment } from '../lib/test_environment';
import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import AccountService from '@/server/accounts/service/account';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { EventEntity } from '@/server/calendar/entity/event';
import { EventContentEntity } from '@/server/calendar/entity/event';
import { EventScheduleEntity } from '@/server/calendar/entity/event';
import { EventCategoryAssignmentEntity } from '@/server/calendar/entity/event_category_assignment';
import { EventInstanceEntity } from '@/server/calendar/entity/event_instance';
import { MediaEntity } from '@/server/media/entity/media';
import { LocationEntity } from '@/server/calendar/entity/location';

describe('Event Deletion - Related Entities Cleanup', () => {
  let account: Account;
  let calendar: Calendar;
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let userEmail: string = 'eventdeletion@pavillion.dev';
  let userPassword: string = 'testpassword';

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    // Set up test account and calendar
    let accountInfo = await accountService._setupAccount(userEmail, userPassword);
    account = accountInfo.account;
    calendar = await calendarInterface.createCalendar(account, 'eventdeletion');
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  describe('Event with Categories', () => {
    it('should delete event and remove category assignments', async () => {
      const authKey = await env.login(userEmail, userPassword);

      // Create a category
      const categoryResponse = await request(env.app)
        .post(`/api/v1/calendars/${calendar.id}/categories`)
        .set('Authorization', 'Bearer ' + authKey)
        .send({
          content: {
            en: { name: 'Test Category' },
          },
        });

      expect(categoryResponse.status).toBe(201);
      const categoryId = categoryResponse.body.id;

      // Create an event
      const eventResponse = await request(env.app)
        .post('/api/v1/events')
        .set('Authorization', 'Bearer ' + authKey)
        .send({
          calendarId: calendar.id,
          content: {
            en: {
              name: 'Event with Category',
              description: 'Test event',
            },
          },
        });

      expect(eventResponse.status).toBe(201);
      const eventId = eventResponse.body.id;

      // Assign category to event
      const encodedEventId = encodeURIComponent(eventId);
      const assignResponse = await request(env.app)
        .post(`/api/v1/events/${encodedEventId}/categories/${categoryId}`)
        .set('Authorization', 'Bearer ' + authKey);

      expect(assignResponse.status).toBe(201);

      // Verify assignment exists
      const assignmentBefore = await EventCategoryAssignmentEntity.findOne({
        where: { event_id: eventId, category_id: categoryId },
      });
      expect(assignmentBefore).not.toBeNull();

      // Delete the event
      const deleteResponse = await request(env.app)
        .delete(`/api/v1/events/${encodedEventId}`)
        .set('Authorization', 'Bearer ' + authKey);

      expect(deleteResponse.status).toBe(204);

      // Verify event is deleted
      const eventEntity = await EventEntity.findByPk(eventId);
      expect(eventEntity).toBeNull();

      // Verify category assignment is deleted
      const assignmentAfter = await EventCategoryAssignmentEntity.findOne({
        where: { event_id: eventId, category_id: categoryId },
      });
      expect(assignmentAfter).toBeNull();

      // Verify category still exists (should not be deleted)
      const categoryAfter = await request(env.app)
        .get(`/api/v1/calendars/${calendar.id}/categories/${categoryId}`)
        .set('Authorization', 'Bearer ' + authKey);

      expect(categoryAfter.status).toBe(200);
    });
  });

  describe('Event with Multilingual Content', () => {
    it('should delete event and all content translations', async () => {
      const authKey = await env.login(userEmail, userPassword);

      // Create an event with multiple languages
      const eventResponse = await request(env.app)
        .post('/api/v1/events')
        .set('Authorization', 'Bearer ' + authKey)
        .send({
          calendarId: calendar.id,
          content: {
            en: {
              name: 'Multilingual Event',
              description: 'English description',
            },
            es: {
              name: 'Evento Multilingüe',
              description: 'Descripción en español',
            },
            fr: {
              name: 'Événement Multilingue',
              description: 'Description en français',
            },
          },
        });

      expect(eventResponse.status).toBe(201);
      const eventId = eventResponse.body.id;

      // Verify content exists for all languages
      const contentBefore = await EventContentEntity.findAll({
        where: { event_id: eventId },
      });
      expect(contentBefore.length).toBe(3);

      // Delete the event
      const encodedEventId = encodeURIComponent(eventId);
      const deleteResponse = await request(env.app)
        .delete(`/api/v1/events/${encodedEventId}`)
        .set('Authorization', 'Bearer ' + authKey);

      expect(deleteResponse.status).toBe(204);

      // Verify all content is deleted
      const contentAfter = await EventContentEntity.findAll({
        where: { event_id: eventId },
      });
      expect(contentAfter.length).toBe(0);
    });
  });

  describe('Event with Recurring Schedules', () => {
    it('should delete event and all schedules', async () => {
      const authKey = await env.login(userEmail, userPassword);

      // Create a recurring event
      const eventData = {
        calendarId: calendar.id,
        content: {
          en: {
            name: 'Recurring Event',
            description: 'Weekly meeting',
          },
        },
        start_date: '2025-08-01',
        start_time: '10:00',
        end_date: '2025-08-01',
        end_time: '11:00',
        recurrence: 'FREQ=WEEKLY;BYDAY=MO;COUNT=10',
      };

      const event = await calendarInterface.createEvent(account, eventData);
      expect(event).toBeDefined();
      const eventId = event.id;

      // Verify schedules exist (they are created automatically with recurring events)
      const schedulesBefore = await EventScheduleEntity.findAll({
        where: { event_id: eventId },
      });
      // The service creates schedules automatically, but if none exist, manually create one
      if (schedulesBefore.length === 0) {
        await EventScheduleEntity.create({
          id: uuidv4(),
          event_id: eventId,
          start_date: '2025-08-01',
          start_time: '10:00',
          end_date: '2025-08-01',
          end_time: '11:00',
          recurrence: 'FREQ=WEEKLY;BYDAY=MO;COUNT=10',
        });
      }
      const schedules = await EventScheduleEntity.findAll({ where: { event_id: eventId } });
      expect(schedules.length).toBeGreaterThan(0);

      // Delete the event
      const encodedEventId = encodeURIComponent(eventId);
      const deleteResponse = await request(env.app)
        .delete(`/api/v1/events/${encodedEventId}`)
        .set('Authorization', 'Bearer ' + authKey);

      expect(deleteResponse.status).toBe(204);

      // Verify all schedules are deleted
      const schedulesAfter = await EventScheduleEntity.findAll({
        where: { event_id: eventId },
      });
      expect(schedulesAfter.length).toBe(0);
    });
  });

  describe('Event with Instances', () => {
    it('should delete event and all generated instances', async () => {
      const authKey = await env.login(userEmail, userPassword);

      // Create a recurring event that will generate instances
      const eventData = {
        calendarId: calendar.id,
        content: {
          en: {
            name: 'Event with Instances',
            description: 'Daily standup',
          },
        },
        start_date: '2025-08-01',
        start_time: '09:00',
        end_date: '2025-08-01',
        end_time: '09:30',
        recurrence: 'FREQ=DAILY;COUNT=5',
      };

      const event = await calendarInterface.createEvent(account, eventData);
      expect(event).toBeDefined();
      const eventId = event.id;

      // Manually create some event instances to test deletion
      await EventInstanceEntity.create({
        id: `instance-1-${eventId}`,
        event_id: eventId,
        calendar_id: calendar.id,
        start_time: new Date('2025-08-01T09:00:00Z'),
        end_time: new Date('2025-08-01T09:30:00Z'),
      });

      await EventInstanceEntity.create({
        id: `instance-2-${eventId}`,
        event_id: eventId,
        calendar_id: calendar.id,
        start_time: new Date('2025-08-02T09:00:00Z'),
        end_time: new Date('2025-08-02T09:30:00Z'),
      });

      // Verify instances exist
      const instancesBefore = await EventInstanceEntity.findAll({
        where: { event_id: eventId },
      });
      expect(instancesBefore.length).toBeGreaterThan(0);

      // Delete the event
      const encodedEventId = encodeURIComponent(eventId);
      const deleteResponse = await request(env.app)
        .delete(`/api/v1/events/${encodedEventId}`)
        .set('Authorization', 'Bearer ' + authKey);

      expect(deleteResponse.status).toBe(204);

      // Verify all instances are deleted
      const instancesAfter = await EventInstanceEntity.findAll({
        where: { event_id: eventId },
      });
      expect(instancesAfter.length).toBe(0);
    });
  });

  describe('Event with Media', () => {
    it('should delete event but preserve media entity', async () => {
      const authKey = await env.login(userEmail, userPassword);

      // Create a media entity (simulating uploaded image)
      const mediaEntity = await MediaEntity.create({
        id: 'test-media-id-' + Date.now(),
        account_id: account.id,
        calendar_id: calendar.id,
        original_filename: 'test.jpg',
        storage_path: '/test/path.jpg',
        mime_type: 'image/jpeg',
        file_size: 1024,
        sha256: 'test-sha256-hash-' + Date.now(),
      });

      // Create an event with media
      const eventResponse = await request(env.app)
        .post('/api/v1/events')
        .set('Authorization', 'Bearer ' + authKey)
        .send({
          calendarId: calendar.id,
          content: {
            en: {
              name: 'Event with Media',
              description: 'Event with image',
            },
          },
        });

      expect(eventResponse.status).toBe(201);
      const eventId = eventResponse.body.id;

      // Manually associate media with event (simulating what would happen via API)
      await EventEntity.update(
        { media_id: mediaEntity.id },
        { where: { id: eventId } },
      );

      // Verify event has media
      const eventWithMedia = await EventEntity.findByPk(eventId);
      expect(eventWithMedia?.media_id).toBe(mediaEntity.id);

      // Delete the event
      const encodedEventId = encodeURIComponent(eventId);
      const deleteResponse = await request(env.app)
        .delete(`/api/v1/events/${encodedEventId}`)
        .set('Authorization', 'Bearer ' + authKey);

      expect(deleteResponse.status).toBe(204);

      // Verify event is deleted
      const eventAfter = await EventEntity.findByPk(eventId);
      expect(eventAfter).toBeNull();

      // Verify media still exists (media is shared, not deleted with event)
      const mediaAfter = await MediaEntity.findByPk(mediaEntity.id);
      expect(mediaAfter).not.toBeNull();

      // Cleanup
      await mediaEntity.destroy();
    });
  });

  describe('Event with Location', () => {
    it('should delete event but preserve location entity', async () => {
      const authKey = await env.login(userEmail, userPassword);

      // Create a location entity
      const locationEntity = await LocationEntity.create({
        id: 'test-location-id-' + Date.now(),
        calendar_id: calendar.id,
        name: 'Test Venue',
        address: '123 Test St',
        city: 'Test City',
      });

      // Create an event with location
      const eventResponse = await request(env.app)
        .post('/api/v1/events')
        .set('Authorization', 'Bearer ' + authKey)
        .send({
          calendarId: calendar.id,
          content: {
            en: {
              name: 'Event with Location',
              description: 'Event at venue',
            },
          },
        });

      expect(eventResponse.status).toBe(201);
      const eventId = eventResponse.body.id;

      // Manually associate location with event
      await EventEntity.update(
        { location_id: locationEntity.id },
        { where: { id: eventId } },
      );

      // Verify event has location
      const eventWithLocation = await EventEntity.findByPk(eventId);
      expect(eventWithLocation?.location_id).toBe(locationEntity.id);

      // Delete the event
      const encodedEventId = encodeURIComponent(eventId);
      const deleteResponse = await request(env.app)
        .delete(`/api/v1/events/${encodedEventId}`)
        .set('Authorization', 'Bearer ' + authKey);

      expect(deleteResponse.status).toBe(204);

      // Verify event is deleted
      const eventAfter = await EventEntity.findByPk(eventId);
      expect(eventAfter).toBeNull();

      // Verify location still exists (locations are reusable)
      const locationAfter = await LocationEntity.findByPk(locationEntity.id);
      expect(locationAfter).not.toBeNull();

      // Cleanup
      await locationEntity.destroy();
    });
  });

  describe('Complex Event with Multiple Relations', () => {
    it('should delete event with all relation types cleanly', async () => {
      const authKey = await env.login(userEmail, userPassword);

      // Create category
      const categoryResponse = await request(env.app)
        .post(`/api/v1/calendars/${calendar.id}/categories`)
        .set('Authorization', 'Bearer ' + authKey)
        .send({
          content: {
            en: { name: 'Complex Event Category' },
          },
        });
      const categoryId = categoryResponse.body.id;

      // Create location
      const locationEntity = await LocationEntity.create({
        id: 'complex-location-id-' + Date.now(),
        calendar_id: calendar.id,
        name: 'Complex Venue',
        address: '456 Complex Ave',
      });

      // Create media
      const mediaEntity = await MediaEntity.create({
        id: 'complex-media-id-' + Date.now(),
        account_id: account.id,
        calendar_id: calendar.id,
        original_filename: 'complex.jpg',
        storage_path: '/complex/path.jpg',
        mime_type: 'image/jpeg',
        file_size: 2048,
        sha256: 'complex-sha256-hash-' + Date.now(),
      });

      // Create recurring event with all relations
      const eventData = {
        calendarId: calendar.id,
        content: {
          en: {
            name: 'Complex Event',
            description: 'Event with everything',
          },
          es: {
            name: 'Evento Complejo',
            description: 'Evento con todo',
          },
        },
        start_date: '2025-09-01',
        start_time: '14:00',
        end_date: '2025-09-01',
        end_time: '16:00',
        recurrence: 'FREQ=WEEKLY;COUNT=3',
      };

      const event = await calendarInterface.createEvent(account, eventData);
      const eventId = event.id;

      // Associate location and media
      await EventEntity.update(
        {
          location_id: locationEntity.id,
          media_id: mediaEntity.id,
        },
        { where: { id: eventId } },
      );

      // Assign category
      const encodedEventId = encodeURIComponent(eventId);
      await request(env.app)
        .post(`/api/v1/events/${encodedEventId}/categories/${categoryId}`)
        .set('Authorization', 'Bearer ' + authKey);

      // Manually create some event instances
      await EventInstanceEntity.create({
        id: `complex-instance-1-${eventId}`,
        event_id: eventId,
        calendar_id: calendar.id,
        start_time: new Date('2025-09-01T14:00:00Z'),
        end_time: new Date('2025-09-01T16:00:00Z'),
      });

      await EventInstanceEntity.create({
        id: `complex-instance-2-${eventId}`,
        event_id: eventId,
        calendar_id: calendar.id,
        start_time: new Date('2025-09-08T14:00:00Z'),
        end_time: new Date('2025-09-08T16:00:00Z'),
      });

      // Create a schedule manually if none exist
      const existingSchedules = await EventScheduleEntity.count({ where: { event_id: eventId } });
      if (existingSchedules === 0) {
        await EventScheduleEntity.create({
          id: uuidv4(),
          event_id: eventId,
          start_date: '2025-09-01',
          start_time: '14:00',
          end_date: '2025-09-01',
          end_time: '16:00',
          recurrence: 'FREQ=WEEKLY;COUNT=3',
        });
      }

      // Verify all relations exist
      const contentCount = await EventContentEntity.count({ where: { event_id: eventId } });
      const scheduleCount = await EventScheduleEntity.count({ where: { event_id: eventId } });
      const assignmentCount = await EventCategoryAssignmentEntity.count({ where: { event_id: eventId } });
      const instanceCount = await EventInstanceEntity.count({ where: { event_id: eventId } });

      expect(contentCount).toBe(2); // en, es
      expect(scheduleCount).toBeGreaterThan(0);
      expect(assignmentCount).toBe(1);
      expect(instanceCount).toBeGreaterThan(0);

      // Delete the event
      const deleteResponse = await request(env.app)
        .delete(`/api/v1/events/${encodedEventId}`)
        .set('Authorization', 'Bearer ' + authKey);

      expect(deleteResponse.status).toBe(204);

      // Verify event and owned relations are deleted
      expect(await EventEntity.findByPk(eventId)).toBeNull();
      expect(await EventContentEntity.count({ where: { event_id: eventId } })).toBe(0);
      expect(await EventScheduleEntity.count({ where: { event_id: eventId } })).toBe(0);
      expect(await EventCategoryAssignmentEntity.count({ where: { event_id: eventId } })).toBe(0);
      expect(await EventInstanceEntity.count({ where: { event_id: eventId } })).toBe(0);

      // Verify shared entities still exist
      expect(await LocationEntity.findByPk(locationEntity.id)).not.toBeNull();
      expect(await MediaEntity.findByPk(mediaEntity.id)).not.toBeNull();

      // Cleanup
      await locationEntity.destroy();
      await mediaEntity.destroy();
    });
  });
});
