import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import app from '@/server/app';
import db from '@/server/common/entity/db';
import { AccountEntity } from '@/server/common/entity/account';
import { CalendarEntity, CalendarContentEntity } from '@/server/calendar/entity/calendar';

describe('Location Validation - API Integration', () => {
  let authToken: string;
  let accountId: string;
  let calendarId: string;

  beforeAll(async () => {
    // Sync database
    await db.sync();

    // Create test account
    const account = await AccountEntity.create({
      id: 'test-account-loc-validation',
      email: 'loc-validation@test.com',
      password: 'hashedpassword',
      name: 'Location Validation Test',
      status: 'active',
    });
    accountId = account.id;

    // Create test calendar
    const calendar = await CalendarEntity.create({
      id: 'test-calendar-loc-validation',
      account_id: accountId,
      url_name: 'loc-validation-calendar',
      languages: 'en',
    });
    calendarId = calendar.id;

    await CalendarContentEntity.create({
      calendar_id: calendarId,
      language: 'en',
      name: 'Location Validation Test Calendar',
      description: 'Test calendar for location validation',
    });

    // Login to get auth token
    const loginResponse = await request(app)
      .post('/api/v1/accounts/login')
      .send({
        email: 'loc-validation@test.com',
        password: 'hashedpassword',
      });

    authToken = loginResponse.body.token;
  });

  afterEach(async () => {
    // Clean up events after each test
    await db.query('DELETE FROM event WHERE calendar_id = ?', {
      replacements: [calendarId],
    });
  });

  it('should reject event with city but no address (400 status)', async () => {
    const response = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        calendarId: calendarId,
        content: {
          en: {
            name: 'Test Event',
            description: 'Test Description',
          },
        },
        location: {
          name: 'Test Venue',
          address: '',
          city: 'Portland',
          state: '',
          postalCode: '',
        },
        schedules: [{
          startDate: '2025-12-01',
          startTime: '10:00',
          endDate: '2025-12-01',
          endTime: '11:00',
        }],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
    expect(response.body.error).toContain('City requires Address');
  });

  it('should reject event with state but no city and address (400 status)', async () => {
    const response = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        calendarId: calendarId,
        content: {
          en: {
            name: 'Test Event',
            description: 'Test Description',
          },
        },
        location: {
          name: 'Test Venue',
          address: '',
          city: '',
          state: 'Oregon',
          postalCode: '',
        },
        schedules: [{
          startDate: '2025-12-01',
          startTime: '10:00',
          endDate: '2025-12-01',
          endTime: '11:00',
        }],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
    expect(response.body.error).toContain('LOCATION_STATE_REQUIRES_CITY');
    expect(response.body.error).toContain('LOCATION_STATE_REQUIRES_ADDRESS');
  });

  it('should accept event with valid location hierarchy', async () => {
    // Test name-only location
    const response1 = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        calendarId: calendarId,
        content: {
          en: {
            name: 'Test Event 1',
            description: 'Test Description',
          },
        },
        location: {
          name: 'Test Venue',
          address: '',
          city: '',
          state: '',
          postalCode: '',
        },
        schedules: [{
          startDate: '2025-12-01',
          startTime: '10:00',
          endDate: '2025-12-01',
          endTime: '11:00',
        }],
      });

    expect(response1.status).toBe(200);
    expect(response1.body.id).toBeDefined();

    // Test full valid location
    const response2 = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        calendarId: calendarId,
        content: {
          en: {
            name: 'Test Event 2',
            description: 'Test Description',
          },
        },
        location: {
          name: 'Test Venue',
          address: '123 Main St',
          city: 'Portland',
          state: 'Oregon',
          postalCode: '97201',
        },
        schedules: [{
          startDate: '2025-12-01',
          startTime: '10:00',
          endDate: '2025-12-01',
          endTime: '11:00',
        }],
      });

    expect(response2.status).toBe(200);
    expect(response2.body.id).toBeDefined();
  });

  it('should return clear error messages for invalid location combinations', async () => {
    const response = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        calendarId: calendarId,
        content: {
          en: {
            name: 'Test Event',
            description: 'Test Description',
          },
        },
        location: {
          name: 'Test Venue',
          address: '',
          city: '',
          state: '',
          postalCode: '97201',
        },
        schedules: [{
          startDate: '2025-12-01',
          startTime: '10:00',
          endDate: '2025-12-01',
          endTime: '11:00',
        }],
      });

    expect(response.status).toBe(400);
    expect(response.body.errorName).toBe('LocationValidationError');
    expect(response.body.error).toContain('LOCATION_POSTAL_CODE_REQUIRES_STATE');
    expect(response.body.error).toContain('LOCATION_POSTAL_CODE_REQUIRES_CITY');
    expect(response.body.error).toContain('LOCATION_POSTAL_CODE_REQUIRES_ADDRESS');
  });
});
