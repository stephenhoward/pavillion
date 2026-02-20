/**
 * Unit tests for source_categories parsing in ProcessInboxService.processCreateEvent.
 *
 * These tests verify that incoming ActivityPub event payloads with categories[]
 * arrays are correctly parsed and stored as source_categories on EventObjectEntity.
 *
 * Test scenarios:
 * 1. Event with valid categories[] URIs stores parsed source_categories
 * 2. Event without categories[] stores null (no crash)
 * 3. Event with malformed/non-UUID category URIs are filtered out defensively
 * 4. Event with empty categories[] array stores null
 * 5. Event with mixed valid/invalid URIs stores only valid UUIDs
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';

import ProcessInboxService from '@/server/activitypub/service/inbox';
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';
import CreateActivity from '@/server/activitypub/model/action/create';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import { EventEmitter } from 'events';
import CalendarInterface from '@/server/calendar/interface';

describe('ProcessInboxService - source_categories parsing', () => {
  let sandbox: sinon.SinonSandbox;
  let inboxService: ProcessInboxService;
  let eventBus: EventEmitter;
  let testCalendar: Calendar;
  let calendarInterface: CalendarInterface;

  const calendarActorUri = 'https://remote.example.com/calendars/remotecal';
  const categoryId1 = '11111111-1111-1111-1111-111111111111';
  const categoryId2 = '22222222-2222-2222-2222-222222222222';

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    inboxService = new ProcessInboxService(eventBus, calendarInterface);

    testCalendar = new Calendar('test-calendar-id', 'test-calendar');
    testCalendar.addContent('en', new CalendarContent('en'));
    testCalendar.content('en').title = 'Test Calendar';

    // Stub isPersonActorUri to return false (calendar actor)
    sandbox.stub(inboxService as any, 'isPersonActorUri').resolves(false);

    // Stub actorOwnsObject to avoid remote HTTP calls
    sandbox.stub(inboxService as any, 'actorOwnsObject').resolves(true);

    // Stub addRemoteEvent to avoid database operations
    sandbox.stub(calendarInterface, 'addRemoteEvent').resolves({
      id: uuidv4(),
      calendarId: null,
    } as any);

    // Stub checkAndPerformAutoRepost to avoid follow-up processing
    sandbox.stub(inboxService as any, 'checkAndPerformAutoRepost').resolves();

    // Suppress console output during tests
    sandbox.stub(console, 'log');
    sandbox.stub(console, 'warn');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should store parsed source_categories when event has valid category URIs', async () => {
    const eventApId = `https://remote.example.com/events/${uuidv4()}`;
    const eventObject = {
      id: eventApId,
      type: 'Event',
      attributedTo: calendarActorUri,
      name: 'Test Event',
      categories: [
        `https://remote.example.com/api/public/v1/calendars/remotecal/categories/${categoryId1}`,
        `https://remote.example.com/api/public/v1/calendars/remotecal/categories/${categoryId2}`,
      ],
    };

    // Stub EventObjectEntity.findOrCreate to capture what it's called with
    let capturedDefaults: any = null;
    sandbox.stub(EventObjectEntity, 'findOrCreate').callsFake(async (options: any) => {
      capturedDefaults = options.defaults;
      return [{ event_id: options.defaults.event_id } as any, true];
    });

    // Also stub EventObjectEntity.findOne (initial duplicate check)
    sandbox.stub(EventObjectEntity, 'findOne').resolves(null);

    const createActivity = new CreateActivity(calendarActorUri, eventObject);
    await inboxService['processCreateEvent'](testCalendar, createActivity);

    expect(capturedDefaults).not.toBeNull();
    expect(capturedDefaults.source_categories).toEqual([
      { id: categoryId1 },
      { id: categoryId2 },
    ]);
  });

  it('should store null source_categories when event has no categories field', async () => {
    const eventApId = `https://remote.example.com/events/${uuidv4()}`;
    const eventObject = {
      id: eventApId,
      type: 'Event',
      attributedTo: calendarActorUri,
      name: 'Test Event Without Categories',
    };

    let capturedDefaults: any = null;
    sandbox.stub(EventObjectEntity, 'findOrCreate').callsFake(async (options: any) => {
      capturedDefaults = options.defaults;
      return [{ event_id: options.defaults.event_id } as any, true];
    });
    sandbox.stub(EventObjectEntity, 'findOne').resolves(null);

    const createActivity = new CreateActivity(calendarActorUri, eventObject);
    await inboxService['processCreateEvent'](testCalendar, createActivity);

    expect(capturedDefaults).not.toBeNull();
    expect(capturedDefaults.source_categories).toBeNull();
  });

  it('should store null source_categories when categories is an empty array', async () => {
    const eventApId = `https://remote.example.com/events/${uuidv4()}`;
    const eventObject = {
      id: eventApId,
      type: 'Event',
      attributedTo: calendarActorUri,
      name: 'Test Event Empty Categories',
      categories: [],
    };

    let capturedDefaults: any = null;
    sandbox.stub(EventObjectEntity, 'findOrCreate').callsFake(async (options: any) => {
      capturedDefaults = options.defaults;
      return [{ event_id: options.defaults.event_id } as any, true];
    });
    sandbox.stub(EventObjectEntity, 'findOne').resolves(null);

    const createActivity = new CreateActivity(calendarActorUri, eventObject);
    await inboxService['processCreateEvent'](testCalendar, createActivity);

    expect(capturedDefaults).not.toBeNull();
    expect(capturedDefaults.source_categories).toBeNull();
  });

  it('should filter out non-UUID path segments defensively', async () => {
    const eventApId = `https://remote.example.com/events/${uuidv4()}`;
    const eventObject = {
      id: eventApId,
      type: 'Event',
      attributedTo: calendarActorUri,
      name: 'Test Event',
      categories: [
        `https://remote.example.com/api/public/v1/calendars/remotecal/categories/${categoryId1}`,
        'not-a-valid-uri',
        'https://remote.example.com/categories/not-a-uuid',
        12345 as any, // non-string entry
      ],
    };

    let capturedDefaults: any = null;
    sandbox.stub(EventObjectEntity, 'findOrCreate').callsFake(async (options: any) => {
      capturedDefaults = options.defaults;
      return [{ event_id: options.defaults.event_id } as any, true];
    });
    sandbox.stub(EventObjectEntity, 'findOne').resolves(null);

    const createActivity = new CreateActivity(calendarActorUri, eventObject);
    await inboxService['processCreateEvent'](testCalendar, createActivity);

    expect(capturedDefaults).not.toBeNull();
    // Only the valid UUID should be stored; invalid ones filtered out
    expect(capturedDefaults.source_categories).toEqual([
      { id: categoryId1 },
    ]);
  });

  it('should store null when all category URIs have non-UUID path segments', async () => {
    const eventApId = `https://remote.example.com/events/${uuidv4()}`;
    const eventObject = {
      id: eventApId,
      type: 'Event',
      attributedTo: calendarActorUri,
      name: 'Test Event',
      categories: [
        'https://remote.example.com/categories/not-a-uuid',
        'https://remote.example.com/categories/also-not-a-uuid',
      ],
    };

    let capturedDefaults: any = null;
    sandbox.stub(EventObjectEntity, 'findOrCreate').callsFake(async (options: any) => {
      capturedDefaults = options.defaults;
      return [{ event_id: options.defaults.event_id } as any, true];
    });
    sandbox.stub(EventObjectEntity, 'findOne').resolves(null);

    const createActivity = new CreateActivity(calendarActorUri, eventObject);
    await inboxService['processCreateEvent'](testCalendar, createActivity);

    expect(capturedDefaults).not.toBeNull();
    // All entries filtered out → null stored
    expect(capturedDefaults.source_categories).toBeNull();
  });

  it('should not crash when categories field is not an array', async () => {
    const eventApId = `https://remote.example.com/events/${uuidv4()}`;
    const eventObject = {
      id: eventApId,
      type: 'Event',
      attributedTo: calendarActorUri,
      name: 'Test Event',
      categories: 'not-an-array' as any,
    };

    let capturedDefaults: any = null;
    sandbox.stub(EventObjectEntity, 'findOrCreate').callsFake(async (options: any) => {
      capturedDefaults = options.defaults;
      return [{ event_id: options.defaults.event_id } as any, true];
    });
    sandbox.stub(EventObjectEntity, 'findOne').resolves(null);

    const createActivity = new CreateActivity(calendarActorUri, eventObject);
    // Should not throw
    await expect(
      inboxService['processCreateEvent'](testCalendar, createActivity),
    ).resolves.toBeDefined();

    expect(capturedDefaults).not.toBeNull();
    expect(capturedDefaults.source_categories).toBeNull();
  });
});
