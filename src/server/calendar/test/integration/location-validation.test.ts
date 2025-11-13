import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import AccountService from '@/server/accounts/service/account';
import { TestEnvironment } from '@/server/test/lib/test_environment';

/**
 * Integration tests for Location Hierarchy Validation (LOC-002)
 *
 * These tests verify that invalid location combinations are rejected
 * and valid combinations are accepted by the API endpoints.
 */
describe('Location Validation API Integration Tests', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let testAccount: Account;
  let testCalendar: Calendar;
  let authToken: string;
  let eventBus: EventEmitter;

  const testEmail = 'locvalidation@pavillion.dev';
  const password = 'testpassword';

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init(3098); // Use unique port

    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    const configurationInterface = new ConfigurationInterface();
    const accountService = new AccountService(eventBus, configurationInterface);

    // Create test account
    let accountInfo = await accountService._setupAccount(testEmail, password);
    testAccount = accountInfo.account;

    // Login to get auth token
    authToken = await env.login(testEmail, password);

    // Create test calendar
    testCalendar = await calendarInterface.createCalendar(testAccount, 'testcalendar');
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it('should reject event with city but no address', async () => {
    const eventData = {
      calendarId: testCalendar.id,
      content: [{
        language: 'en',
        name: 'Test Event',
        description: 'Test description',
      }],
      location: {
        name: 'Venue Name',
        address: '',  // Missing required field
        city: 'San Francisco',
        state: '',
        postalCode: '',
      },
      schedules: [{
        startDate: '2025-12-01',
        endDate: '2025-12-01',
        startTime: '10:00',
        endTime: '11:00',
      }],
    };

    const response = await env.authPost(authToken, '/api/v1/events', eventData);

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('LOCATION_CITY_REQUIRES_ADDRESS');
  });

  it('should reject event with state but no city', async () => {
    const eventData = {
      calendarId: testCalendar.id,
      content: [{
        language: 'en',
        name: 'Test Event',
        description: 'Test description',
      }],
      location: {
        name: 'Venue Name',
        address: '123 Main St',
        city: '',  // Missing required field
        state: 'California',
        postalCode: '',
      },
      schedules: [{
        startDate: '2025-12-01',
        endDate: '2025-12-01',
        startTime: '10:00',
        endTime: '11:00',
      }],
    };

    const response = await env.authPost(authToken, '/api/v1/events', eventData);

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('LOCATION_STATE_REQUIRES_CITY');
  });

  it('should accept event with valid name-only location', async () => {
    const eventData = {
      calendarId: testCalendar.id,
      content: [{
        language: 'en',
        name: 'Test Event',
        description: 'Test description',
      }],
      location: {
        name: 'Venue Name',
        address: '',
        city: '',
        state: '',
        postalCode: '',
      },
      schedules: [{
        startDate: '2025-12-01',
        endDate: '2025-12-01',
        startTime: '10:00',
        endTime: '11:00',
      }],
    };

    const response = await env.authPost(authToken, '/api/v1/events', eventData);

    expect(response.status).toBe(200);
    expect(response.body.location.name).toBe('Venue Name');
  });

  it('should accept event with complete valid location', async () => {
    const eventData = {
      calendarId: testCalendar.id,
      content: [{
        language: 'en',
        name: 'Test Event',
        description: 'Test description',
      }],
      location: {
        name: 'Venue Name',
        address: '123 Main St',
        city: 'San Francisco',
        state: 'California',
        postalCode: '94102',
      },
      schedules: [{
        startDate: '2025-12-01',
        endDate: '2025-12-01',
        startTime: '10:00',
        endTime: '11:00',
      }],
    };

    const response = await env.authPost(authToken, '/api/v1/events', eventData);

    expect(response.status).toBe(200);
    expect(response.body.location.city).toBe('San Francisco');
    expect(response.body.location.state).toBe('California');
  });
});
