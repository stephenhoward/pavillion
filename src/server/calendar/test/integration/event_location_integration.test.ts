import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';

import { v4 as uuidv4 } from 'uuid';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { EventLocation, EventLocationContent, EventLocationSpace } from '@/common/model/location';
import CalendarInterface from '@/server/calendar/interface';
import db from '@/server/common/entity/db';
import { EventEntity } from '@/server/calendar/entity/event';
import { EventInstanceEntity } from '@/server/calendar/entity/event_instance';
import { LocationSpaceEntity } from '@/server/calendar/entity/location_space';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { SpaceLocationMismatchError } from '@/common/exceptions/calendar';

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

    // Inject a minimal AP interface stub so listEvents does not crash when
    // no real ActivityPub domain is wired up in this test environment.
    calendarInterface.setActivityPubInterface({
      getSharedEventIds: async () => [],
      getSharedEventStatusMap: async () => new Map(),
    } as any);

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

/**
 * Integration tests for Space persistence in event create/update.
 *
 * Covers the serialization symmetry bug where updateEvent read only
 * eventParams.spaceId but the client wire contract emits space:{id} (object).
 * After the fix, both shapes are accepted on create and update.
 */
describe('EventService - Space persistence integration', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let testAccount: Account;
  let testCalendar: Calendar;
  let otherCalendar: Calendar;
  let testLocation: EventLocation;
  let testSpace: EventLocationSpace;
  let otherLocation: EventLocation;
  let otherSpace: EventLocationSpace;

  const testEmail = 'eventspace@pavillion.dev';
  const password = 'testpassword';

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    calendarInterface.setActivityPubInterface({
      getSharedEventIds: async () => [],
      getSharedEventStatusMap: async () => new Map(),
    } as any);

    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    const accountInfo = await accountService._setupAccount(testEmail, password);
    testAccount = accountInfo.account;

    testCalendar = await calendarInterface.createCalendar(testAccount, 'spacetestcal');
    otherCalendar = await calendarInterface.createCalendar(testAccount, 'otherspacevcal');

    testLocation = await calendarInterface.createLocation(
      testCalendar,
      new EventLocation(undefined, 'Space Venue', '1 Main St'),
    );

    testSpace = await calendarInterface.createSpace(
      testCalendar,
      testLocation.id,
      { en: { name: 'Pacific Room', accessibilityInfo: '' } },
    );

    otherLocation = await calendarInterface.createLocation(
      otherCalendar,
      new EventLocation(undefined, 'Other Venue', '2 Oak St'),
    );

    otherSpace = await calendarInterface.createSpace(
      otherCalendar,
      otherLocation.id,
      { en: { name: 'Other Room', accessibilityInfo: '' } },
    );
  });

  afterAll(async () => {
    await env.cleanup();
  });

  describe('updateEvent with spaceId (top-level wire field)', () => {
    it('persists space_id when update sends spaceId', async () => {
      const event = await calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        locationId: testLocation.id,
        content: { en: { name: 'Space Test Event' } },
        start_date: '2026-09-01',
      });

      const updated = await calendarInterface.updateEvent(testAccount, event.id, {
        locationId: testLocation.id,
        spaceId: testSpace.id,
      });

      expect(updated.space?.id).toBe(testSpace.id);
    });

    it('persists space_id when update sends space:{id} object (federation/legacy shape)', async () => {
      const event = await calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        locationId: testLocation.id,
        content: { en: { name: 'Space Object Test Event' } },
        start_date: '2026-09-01',
      });

      // Simulate the legacy/federation wire shape: space:{id, placeId} but NO top-level spaceId.
      const updated = await calendarInterface.updateEvent(testAccount, event.id, {
        locationId: testLocation.id,
        space: { id: testSpace.id, placeId: testLocation.id, content: {} },
      });

      expect(updated.space?.id).toBe(testSpace.id);
    });

    it('clears space_id when switching to whole-venue (spaceId explicitly null)', async () => {
      const event = await calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        locationId: testLocation.id,
        spaceId: testSpace.id,
        content: { en: { name: 'Whole Venue Test Event' } },
        start_date: '2026-09-01',
      });

      const updated = await calendarInterface.updateEvent(testAccount, event.id, {
        locationId: testLocation.id,
        spaceId: null,
      });

      expect(updated.space).toBeNull();
    });

    it('rejects cross-calendar spaceId on update with 400 SpaceLocationMismatchError', async () => {
      const event = await calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        locationId: testLocation.id,
        content: { en: { name: 'IDOR Guard Update Test' } },
        start_date: '2026-09-01',
      });

      await expect(
        calendarInterface.updateEvent(testAccount, event.id, {
          locationId: testLocation.id,
          spaceId: otherSpace.id,
        }),
      ).rejects.toThrow(SpaceLocationMismatchError);
    });
  });

  describe('createEvent with space:{id} object (IDOR defense-in-depth)', () => {
    it('rejects cross-calendar space:{id} on create with SpaceLocationMismatchError', async () => {
      await expect(
        calendarInterface.createEvent(testAccount, {
          calendarId: testCalendar.id,
          locationId: testLocation.id,
          space: { id: otherSpace.id, placeId: otherLocation.id, content: {} },
          content: { en: { name: 'IDOR Guard Create Test' } },
          start_date: '2026-09-01',
        }),
      ).rejects.toThrow(SpaceLocationMismatchError);
    });
  });
});

/**
 * Regression: the public-listing endpoints
 * (`listEventInstancesForCalendar`, `listEventInstancesWithFilters`, and
 * `getEventInstanceById`) must eager-load `LocationSpaceEntity` so listed
 * events render the Space name on the public site card. Before the fix,
 * only the single-event detail path included the Space, and listing
 * responses returned `space: null` for every Space-scoped event.
 */
describe('EventInstanceService - Space eager-loading on listing endpoints', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let testAccount: Account;
  let testCalendar: Calendar;
  let testLocation: EventLocation;
  let testSpace: EventLocationSpace;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    calendarInterface.setActivityPubInterface({
      getSharedEventIds: async () => [],
      getSharedEventStatusMap: async () => new Map(),
      getEventSourceActorUris: async () => new Map<string, string>(),
      findCalendarActorByCalendarId: async () => null,
    } as any);

    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    const accountInfo = await accountService._setupAccount('listing-space@pavillion.dev', 'testpassword');
    testAccount = accountInfo.account;

    testCalendar = await calendarInterface.createCalendar(testAccount, 'listingspacecal');

    testLocation = await calendarInterface.createLocation(
      testCalendar,
      new EventLocation(undefined, 'Library Annex', '123 Library Lane'),
    );

    testSpace = await calendarInterface.createSpace(
      testCalendar,
      testLocation.id,
      { en: { name: 'Reading Room', accessibilityInfo: 'Quiet seating area' } },
    );
  });

  afterAll(async () => {
    await env.cleanup();
  });

  /**
   * Helper: create a Space-scoped event on the test calendar and materialize
   * a single canonical instance row (the locally-constructed CalendarInterface
   * does not register the eventCreated handler that auto-builds instances).
   */
  async function createInstanceWithSpace(name: string, startIso: string): Promise<{ event: CalendarEvent; instanceId: string }> {
    const event = await calendarInterface.createEvent(testAccount, {
      calendarId: testCalendar.id,
      locationId: testLocation.id,
      spaceId: testSpace.id,
      content: { en: { name, description: name } },
      start_date: startIso.slice(0, 10),
      start_time: startIso.slice(11, 16),
    });
    const instanceId = uuidv4();
    await EventInstanceEntity.create({
      id: instanceId,
      event_id: event.id,
      calendar_id: testCalendar.id,
      start_time: new Date(startIso),
      end_time: null,
    });
    return { event, instanceId };
  }

  it('listEventInstancesForCalendar populates event.space for Space-scoped events', async () => {
    const { event } = await createInstanceWithSpace('Listing Space Event', '2026-10-01T10:00:00Z');

    const instances = await calendarInterface.listEventInstancesForCalendar(testCalendar);
    const matching = instances.filter(i => i.event.id === event.id);
    expect(matching).toHaveLength(1);

    const listed = matching[0];
    expect(listed.event.space).not.toBeNull();
    expect(listed.event.space?.id).toBe(testSpace.id);
    expect(listed.event.space?.content('en').name).toBe('Reading Room');
  });

  it('listEventInstancesWithFilters populates event.space for Space-scoped events', async () => {
    const { event } = await createInstanceWithSpace('Filtered Listing Space Event', '2026-10-02T10:00:00Z');

    const instances = await calendarInterface.listEventInstancesWithFilters(testCalendar, {});
    const matching = instances.filter(i => i.event.id === event.id);
    expect(matching).toHaveLength(1);

    const listed = matching[0];
    expect(listed.event.space).not.toBeNull();
    expect(listed.event.space?.id).toBe(testSpace.id);
    expect(listed.event.space?.content('en').name).toBe('Reading Room');
  });

  it('getEventInstanceById populates event.space for Space-scoped events', async () => {
    const { instanceId } = await createInstanceWithSpace('By-Id Space Event', '2026-10-03T10:00:00Z');

    const instance = await calendarInterface.getEventInstanceById(instanceId);
    expect(instance).not.toBeNull();
    expect(instance!.event.space).not.toBeNull();
    expect(instance!.event.space?.id).toBe(testSpace.id);
    expect(instance!.event.space?.content('en').name).toBe('Reading Room');
  });
});

/**
 * Integration test for the events.space_id ON DELETE SET NULL FK behavior.
 * Architectural keystone for the Place + Spaces atomic-save model:
 * deleting a Space must automatically null any referencing
 * event.space_id rather than rejecting the delete or cascading the events.
 * This lets the LocationService nest the Space delete inside the Place
 * upsert transaction without enumerating referencing events.
 *
 * Real DB, real constraint — the entity decorator drives schema generation
 * via db.sync(), and SQLite enforces the FK only when foreign_keys = ON.
 */
describe('EventEntity - space_id FK ON DELETE SET NULL', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let testAccount: Account;
  let testCalendar: Calendar;
  let testLocation: EventLocation;
  let testSpace: EventLocationSpace;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    // SQLite defaults to foreign_keys = OFF, which would silently no-op the
    // ON DELETE SET NULL behavior. Enable enforcement so the constraint is
    // exercised end-to-end. Postgres enforces FKs unconditionally.
    if (db.getDialect() === 'sqlite') {
      await db.query('PRAGMA foreign_keys = ON');
    }

    const eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    calendarInterface.setActivityPubInterface({
      getSharedEventIds: async () => [],
      getSharedEventStatusMap: async () => new Map(),
    } as any);

    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    const accountInfo = await accountService._setupAccount('space-fk@pavillion.dev', 'testpassword');
    testAccount = accountInfo.account;

    testCalendar = await calendarInterface.createCalendar(testAccount, 'spacefkcal');

    testLocation = await calendarInterface.createLocation(
      testCalendar,
      new EventLocation(undefined, 'Conference Hall', '500 Park Ave'),
    );

    testSpace = await calendarInterface.createSpace(
      testCalendar,
      testLocation.id,
      { en: { name: 'Studio A', accessibilityInfo: '' } },
    );
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it('nulls events.space_id when the referenced Space is deleted (whole-venue fallback)', async () => {
    const event = await calendarInterface.createEvent(testAccount, {
      calendarId: testCalendar.id,
      locationId: testLocation.id,
      spaceId: testSpace.id,
      content: { en: { name: 'Studio A Event' } },
      start_date: '2026-11-01',
    });

    // Sanity: the event row genuinely points at the Space before deletion.
    const before = await EventEntity.findByPk(event.id);
    expect(before).not.toBeNull();
    expect(before!.space_id).toBe(testSpace.id);

    // Delete the Space row directly at the entity layer. The atomic-save
    // service path will issue this delete inside the Place upsert
    // transaction; for this test we want to assert the FK semantic in
    // isolation, not the service orchestration.
    await LocationSpaceEntity.destroy({ where: { id: testSpace.id } });

    const after = await EventEntity.findByPk(event.id);
    expect(after).not.toBeNull();
    // The event row survives — only the FK column is nulled out.
    expect(after!.space_id).toBeNull();
    // Whole-venue fallback: location_id is untouched.
    expect(after!.location_id).toBe(testLocation.id);
  });
});
