import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { EventLocation, EventLocationContent } from '@/common/model/location';
import CalendarInterface from '@/server/calendar/interface';
import { TestEnvironment } from '@/server/test/lib/test_environment';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';

/**
 * Integration tests for Event-Location integration
 * Tests locationId references and location resolution
 */
describe('EventService - Location Integration', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let testAccount: Account;
  let testCalendar: Calendar;
  let testLocation: EventLocation;
  let eventBus: EventEmitter;

  const testEmail = 'eventloc@pavillion.dev';
  const password = 'testpassword';

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    // Create test account
    let accountInfo = await accountService._setupAccount(testEmail, password);
    testAccount = accountInfo.account;

    // Create test calendar
    testCalendar = await calendarInterface.createCalendar(testAccount, 'testcalendar');

    // Create test location
    const locationData = new EventLocation(
      undefined,
      'Test Venue',
      '123 Main St',
      'Portland',
      'OR',
      '97201',
    );
    testLocation = await calendarInterface.createLocation(testCalendar, locationData);
  });

  afterAll(async () => {
    if (eventBus) {
      eventBus.removeAllListeners();
    }
    await env.cleanup();
  });

  describe('createEvent with locationId', () => {
    it('should create event with locationId reference', async () => {
      const eventParams = {
        calendarId: testCalendar.id,
        locationId: testLocation.id,
        content: {
          en: {
            name: 'Test Event',
            description: 'Event description',
          },
        },
        start_date: '2025-12-01',
        start_time: '10:00',
        end_date: '2025-12-01',
        end_time: '11:00',
      };

      const event = await calendarInterface.createEvent(testAccount, eventParams);

      expect(event).toBeDefined();
      expect(event.locationId).toBe(testLocation.id);
      expect(event.calendarId).toBe(testCalendar.id);
    });

    it('should reject event creation with non-existent locationId', async () => {
      const eventParams = {
        calendarId: testCalendar.id,
        locationId: 'https://pavillion.dev/places/nonexistent',
        content: {
          en: {
            name: 'Test Event',
          },
        },
        start_date: '2025-12-01',
      };

      await expect(calendarInterface.createEvent(testAccount, eventParams))
        .rejects.toThrow('Location not found or does not belong to this calendar');
    });

    it('should reject event creation with location from different calendar', async () => {
      // Create a different calendar
      const otherCalendar = await calendarInterface.createCalendar(testAccount, 'othercalendar');

      // Create a location in the other calendar
      const otherLocation = await calendarInterface.createLocation(
        otherCalendar,
        new EventLocation(undefined, 'Other Venue', '456 Oak St'),
      );

      // Try to create event in testCalendar with otherLocation's ID
      const eventParams = {
        calendarId: testCalendar.id,
        locationId: otherLocation.id,
        content: {
          en: {
            name: 'Test Event',
          },
        },
        start_date: '2025-12-01',
      };

      await expect(calendarInterface.createEvent(testAccount, eventParams))
        .rejects.toThrow('Location not found or does not belong to this calendar');
    });
  });

  describe('updateEvent with locationId', () => {
    it('should update event locationId', async () => {
      // Create an event with the first location
      const event = await calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        locationId: testLocation.id,
        content: {
          en: {
            name: 'Test Event',
          },
        },
        start_date: '2025-12-01',
      });

      // Create a new location
      const newLocation = await calendarInterface.createLocation(
        testCalendar,
        new EventLocation(undefined, 'New Venue', '456 Oak St'),
      );

      // Update event to use new location
      const updatedEvent = await calendarInterface.updateEvent(testAccount, event.id, {
        locationId: newLocation.id,
      });

      expect(updatedEvent.locationId).toBe(newLocation.id);
    });

    it('should clear event location when locationId is null', async () => {
      // Create an event with a location
      const event = await calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        locationId: testLocation.id,
        content: {
          en: {
            name: 'Test Event',
          },
        },
        start_date: '2025-12-01',
      });

      // Clear the location
      const updatedEvent = await calendarInterface.updateEvent(testAccount, event.id, {
        locationId: null,
      });

      expect(updatedEvent.locationId).toBeNull();
    });

    it('should reject update with non-existent locationId', async () => {
      // Create an event without a location
      const event = await calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        content: {
          en: {
            name: 'Test Event',
          },
        },
        start_date: '2025-12-01',
      });

      // Try to update with non-existent location
      await expect(calendarInterface.updateEvent(testAccount, event.id, {
        locationId: 'https://pavillion.dev/places/nonexistent',
      })).rejects.toThrow('Location not found or does not belong to this calendar');
    });
  });

  describe('listEvents with location resolution', () => {
    it('should resolve location details when loading events', async () => {
      // Create a fresh calendar and location for this test
      const resolveCalendar = await calendarInterface.createCalendar(testAccount, 'resolve-test');
      const resolveLocation = await calendarInterface.createLocation(
        resolveCalendar,
        new EventLocation(undefined, 'Resolve Venue', '789 Pine St', 'Portland', 'OR', '97202'),
      );

      // Create event with location
      await calendarInterface.createEvent(testAccount, {
        calendarId: resolveCalendar.id,
        locationId: resolveLocation.id,
        content: {
          en: {
            name: 'Resolve Test Event',
          },
        },
        start_date: '2025-12-01',
      });

      const events = await calendarInterface.listEvents(resolveCalendar);

      expect(events.length).toBeGreaterThan(0);
      const eventWithLocation = events.find(e => e.locationId === resolveLocation.id);
      expect(eventWithLocation).toBeDefined();
      expect(eventWithLocation?.location).toBeDefined();
      expect(eventWithLocation?.location?.name).toBe('Resolve Venue');
      expect(eventWithLocation?.location?.address).toBe('789 Pine St');
    });

    it('should handle events without location', async () => {
      // Create a fresh calendar for this test
      const noLocCalendar = await calendarInterface.createCalendar(testAccount, 'noloc-test');

      // Create event without location
      await calendarInterface.createEvent(testAccount, {
        calendarId: noLocCalendar.id,
        content: {
          en: {
            name: 'No Location Event',
          },
        },
        start_date: '2025-12-01',
      });

      const events = await calendarInterface.listEvents(noLocCalendar);

      expect(events).toHaveLength(1);
      expect(events[0].location).toBeNull();
      expect(events[0].locationId).toBeNull();
    });
  });

  describe('getEventById with location resolution', () => {
    it('should resolve location details for single event', async () => {
      // Create event with location
      const event = await calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        locationId: testLocation.id,
        content: {
          en: {
            name: 'Get By ID Test',
          },
        },
        start_date: '2025-12-01',
      });

      // Fetch the event by ID
      const fetchedEvent = await calendarInterface.getEventById(event.id);

      expect(fetchedEvent.location).toBeDefined();
      expect(fetchedEvent.location?.name).toBe('Test Venue');
      expect(fetchedEvent.location?.address).toBe('123 Main St');
      expect(fetchedEvent.locationId).toBe(testLocation.id);
    });
  });
});
