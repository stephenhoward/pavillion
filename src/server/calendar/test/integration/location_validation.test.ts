import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';
import request from 'supertest';
import { TestEnvironment } from '@/server/test/lib/test_environment';
import AccountService from '@/server/accounts/service/account';
import CalendarService from '@/server/calendar/service/calendar';
import ConfigurationInterface from '@/server/configuration/interface';
import AccountsInterface from '@/server/accounts/interface';
import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';

describe('Location Validation - API Integration', () => {
  let env: TestEnvironment;
  let authToken: string;
  let account: Account;
  let calendar: Calendar;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init(3011); // Use unique port

    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const accountService = new AccountService(eventBus, configurationInterface);
    const accountsInterface = new AccountsInterface(eventBus, configurationInterface);
    const calendarService = new CalendarService(accountsInterface, configurationInterface);

    // Create test account and calendar
    const accountInfo = await accountService._setupAccount('loc-validation@test.com', 'testpassword');
    account = accountInfo.account;
    calendar = await calendarService.createCalendar(account, 'loc-validation-calendar');

    // Login to get auth token
    authToken = await env.login('loc-validation@test.com', 'testpassword');
  });

  afterAll(async () => {
    if (env) {
      // Wait for async event instance operations to complete before cleanup
      await new Promise(resolve => setTimeout(resolve, 500));
      await env.cleanup();
    }
  });

  it('should reject event with city but no address (400 status)', async () => {
    const response = await request(env.app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        calendarId: calendar.id,
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
    expect(response.body.error).toContain('LOCATION_CITY_REQUIRES_ADDRESS');
  });

  it('should reject event with state but no city and address (400 status)', async () => {
    const response = await request(env.app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        calendarId: calendar.id,
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
    const response1 = await request(env.app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        calendarId: calendar.id,
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
    const response2 = await request(env.app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        calendarId: calendar.id,
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
    const response = await request(env.app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        calendarId: calendar.id,
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
