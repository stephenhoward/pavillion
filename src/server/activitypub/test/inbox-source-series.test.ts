/**
 * Unit tests for source_series parsing in ProcessInboxService.
 *
 * These tests verify that incoming ActivityPub event payloads with a series field
 * are correctly validated and stored as source_series on EventObjectEntity.
 *
 * Test scenarios:
 * 1. Event with valid series object stores parsed source_series (processCreateEvent)
 * 2. Event without series field stores null (processCreateEvent)
 * 3. Series with domain mismatch is discarded; event still processed
 * 4. Series with oversized string fields are truncated to max lengths
 * 5. HTML tags in series string fields are stripped (tags removed, text preserved)
 * 6. Malformed series (non-object) is discarded; event still processed
 * 7. Series with HTTP (non-HTTPS) id is rejected
 * 8. processUpdateEvent updates source_series on existing AP object record
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';

import ProcessInboxService from '@/server/activitypub/service/inbox';
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';
import CreateActivity from '@/server/activitypub/model/action/create';
import UpdateActivity from '@/server/activitypub/model/action/update';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { EventEmitter } from 'events';
import CalendarInterface from '@/server/calendar/interface';

describe('ProcessInboxService - source_series parsing', () => {
  let sandbox: sinon.SinonSandbox;
  let inboxService: ProcessInboxService;
  let eventBus: EventEmitter;
  let testCalendar: Calendar;
  let calendarInterface: CalendarInterface;

  const calendarActorUri = 'https://remote.example.com/calendars/remotecal';

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

  // ─── processCreateEvent tests ───────────────────────────────────────────────

  it('should store validated source_series when event has a valid series field', async () => {
    const eventApId = `https://remote.example.com/events/${uuidv4()}`;
    const seriesId = 'https://remote.example.com/series/summer-fest';
    const eventObject = {
      id: eventApId,
      type: 'Event',
      attributedTo: calendarActorUri,
      name: 'Test Event',
      series: {
        id: seriesId,
        name: 'Summer Festival',
        description: 'Annual summer festival series',
      },
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
    expect(capturedDefaults.source_series).toEqual({
      id: seriesId,
      name: 'Summer Festival',
      description: 'Annual summer festival series',
    });
  });

  it('should store null source_series when event has no series field', async () => {
    const eventApId = `https://remote.example.com/events/${uuidv4()}`;
    const eventObject = {
      id: eventApId,
      type: 'Event',
      attributedTo: calendarActorUri,
      name: 'Test Event Without Series',
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
    expect(capturedDefaults.source_series).toBeNull();
  });

  it('should discard series and store null when series id domain does not match actor domain', async () => {
    const eventApId = `https://remote.example.com/events/${uuidv4()}`;
    const eventObject = {
      id: eventApId,
      type: 'Event',
      attributedTo: calendarActorUri,
      name: 'Test Event',
      series: {
        id: 'https://evil.attacker.com/series/hijack',
        name: 'Hijacked Series',
      },
    };

    let capturedDefaults: any = null;
    sandbox.stub(EventObjectEntity, 'findOrCreate').callsFake(async (options: any) => {
      capturedDefaults = options.defaults;
      return [{ event_id: options.defaults.event_id } as any, true];
    });
    sandbox.stub(EventObjectEntity, 'findOne').resolves(null);

    const createActivity = new CreateActivity(calendarActorUri, eventObject);
    // Event should still be processed (not rejected)
    await expect(
      inboxService['processCreateEvent'](testCalendar, createActivity),
    ).resolves.toBeDefined();

    expect(capturedDefaults).not.toBeNull();
    expect(capturedDefaults.source_series).toBeNull();
  });

  it('should truncate series name to 255 characters', async () => {
    const eventApId = `https://remote.example.com/events/${uuidv4()}`;
    const longName = 'A'.repeat(300);
    const eventObject = {
      id: eventApId,
      type: 'Event',
      attributedTo: calendarActorUri,
      name: 'Test Event',
      series: {
        id: 'https://remote.example.com/series/long-name',
        name: longName,
      },
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
    expect(capturedDefaults.source_series).not.toBeNull();
    expect(capturedDefaults.source_series.name).toHaveLength(255);
    expect(capturedDefaults.source_series.name).toBe('A'.repeat(255));
  });

  it('should truncate series description to 2000 characters', async () => {
    const eventApId = `https://remote.example.com/events/${uuidv4()}`;
    const longDescription = 'B'.repeat(2500);
    const eventObject = {
      id: eventApId,
      type: 'Event',
      attributedTo: calendarActorUri,
      name: 'Test Event',
      series: {
        id: 'https://remote.example.com/series/long-desc',
        description: longDescription,
      },
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
    expect(capturedDefaults.source_series).not.toBeNull();
    expect(capturedDefaults.source_series.description).toHaveLength(2000);
    expect(capturedDefaults.source_series.description).toBe('B'.repeat(2000));
  });

  it('should strip HTML tags from series name and description (text content preserved)', async () => {
    const eventApId = `https://remote.example.com/events/${uuidv4()}`;
    const eventObject = {
      id: eventApId,
      type: 'Event',
      attributedTo: calendarActorUri,
      name: 'Test Event',
      series: {
        id: 'https://remote.example.com/series/html-test',
        // Tag wrappers are stripped; inner text is preserved
        name: '<b>Bold Series</b>',
        description: '<p>Hello World</p>',
      },
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
    expect(capturedDefaults.source_series).not.toBeNull();
    // HTML tags are stripped; inner text content is preserved
    expect(capturedDefaults.source_series.name).toBe('Bold Series');
    expect(capturedDefaults.source_series.description).toBe('Hello World');
  });

  it('should discard series and store null when series is not an object', async () => {
    const eventApId = `https://remote.example.com/events/${uuidv4()}`;
    const eventObject = {
      id: eventApId,
      type: 'Event',
      attributedTo: calendarActorUri,
      name: 'Test Event',
      series: 'not-an-object' as any,
    };

    let capturedDefaults: any = null;
    sandbox.stub(EventObjectEntity, 'findOrCreate').callsFake(async (options: any) => {
      capturedDefaults = options.defaults;
      return [{ event_id: options.defaults.event_id } as any, true];
    });
    sandbox.stub(EventObjectEntity, 'findOne').resolves(null);

    const createActivity = new CreateActivity(calendarActorUri, eventObject);
    // Event should still be processed (not rejected)
    await expect(
      inboxService['processCreateEvent'](testCalendar, createActivity),
    ).resolves.toBeDefined();

    expect(capturedDefaults).not.toBeNull();
    expect(capturedDefaults.source_series).toBeNull();
  });

  it('should discard series when series id uses HTTP instead of HTTPS', async () => {
    const eventApId = `https://remote.example.com/events/${uuidv4()}`;
    const eventObject = {
      id: eventApId,
      type: 'Event',
      attributedTo: calendarActorUri,
      name: 'Test Event',
      series: {
        id: 'http://remote.example.com/series/insecure',
        name: 'Insecure Series',
      },
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
    expect(capturedDefaults.source_series).toBeNull();
  });

  it('should discard series when series id is not a valid URL', async () => {
    const eventApId = `https://remote.example.com/events/${uuidv4()}`;
    const eventObject = {
      id: eventApId,
      type: 'Event',
      attributedTo: calendarActorUri,
      name: 'Test Event',
      series: {
        id: 'not-a-url',
        name: 'Invalid Series',
      },
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
    expect(capturedDefaults.source_series).toBeNull();
  });

  it('should store series with only the id field when name and description are absent', async () => {
    const eventApId = `https://remote.example.com/events/${uuidv4()}`;
    const seriesId = 'https://remote.example.com/series/minimal';
    const eventObject = {
      id: eventApId,
      type: 'Event',
      attributedTo: calendarActorUri,
      name: 'Test Event',
      series: {
        id: seriesId,
      },
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
    expect(capturedDefaults.source_series).toEqual({ id: seriesId });
    expect(capturedDefaults.source_series.name).toBeUndefined();
    expect(capturedDefaults.source_series.description).toBeUndefined();
  });

  it('should ignore unknown fields in series and only store id, name, description', async () => {
    const eventApId = `https://remote.example.com/events/${uuidv4()}`;
    const seriesId = 'https://remote.example.com/series/extra-fields';
    const eventObject = {
      id: eventApId,
      type: 'Event',
      attributedTo: calendarActorUri,
      name: 'Test Event',
      series: {
        id: seriesId,
        name: 'Known Series',
        description: 'Known description',
        unknownField: 'should be discarded',
        anotherField: 12345,
      },
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
    expect(capturedDefaults.source_series).toEqual({
      id: seriesId,
      name: 'Known Series',
      description: 'Known description',
    });
    expect(capturedDefaults.source_series.unknownField).toBeUndefined();
    expect(capturedDefaults.source_series.anotherField).toBeUndefined();
  });

  // ─── processUpdateEvent tests ────────────────────────────────────────────────

  it('should update source_series on EventObjectEntity when updating an event with series', async () => {
    const eventApId = `https://remote.example.com/events/${uuidv4()}`;
    const localEventId = uuidv4();
    const seriesId = 'https://remote.example.com/series/updated-fest';

    // Create a proper CalendarEvent (remote, calendarId=null) so isLocal() works
    const remoteEvent = new CalendarEvent(localEventId, null);

    const mockApObject: any = {
      event_id: localEventId,
      ap_id: eventApId,
      attributed_to: calendarActorUri,
      source_series: null,
      update: sandbox.stub().resolves(),
    };

    sandbox.stub(EventObjectEntity, 'findOne').resolves(mockApObject);
    sandbox.stub(calendarInterface, 'getEventById').resolves(remoteEvent);
    sandbox.stub(calendarInterface, 'updateRemoteEvent').resolves(remoteEvent);

    const eventObject = {
      id: eventApId,
      type: 'Event',
      attributedTo: calendarActorUri,
      name: 'Updated Event',
      series: {
        id: seriesId,
        name: 'Updated Festival',
        description: 'Updated series description',
      },
    };

    const updateActivity = new UpdateActivity(calendarActorUri, eventObject);
    await inboxService['processUpdateEvent'](testCalendar, updateActivity);

    expect(mockApObject.update.calledOnce).toBe(true);
    const updateArgs = mockApObject.update.firstCall.args[0];
    expect(updateArgs.source_series).toEqual({
      id: seriesId,
      name: 'Updated Festival',
      description: 'Updated series description',
    });
  });

  it('should update source_series to null when updating an event without series', async () => {
    const eventApId = `https://remote.example.com/events/${uuidv4()}`;
    const localEventId = uuidv4();

    // Create a proper CalendarEvent (remote, calendarId=null) so isLocal() works
    const remoteEvent = new CalendarEvent(localEventId, null);

    const mockApObject: any = {
      event_id: localEventId,
      ap_id: eventApId,
      attributed_to: calendarActorUri,
      source_series: { id: 'https://remote.example.com/series/old', name: 'Old Series' },
      update: sandbox.stub().resolves(),
    };

    sandbox.stub(EventObjectEntity, 'findOne').resolves(mockApObject);
    sandbox.stub(calendarInterface, 'getEventById').resolves(remoteEvent);
    sandbox.stub(calendarInterface, 'updateRemoteEvent').resolves(remoteEvent);

    const eventObject = {
      id: eventApId,
      type: 'Event',
      attributedTo: calendarActorUri,
      name: 'Updated Event Without Series',
    };

    const updateActivity = new UpdateActivity(calendarActorUri, eventObject);
    await inboxService['processUpdateEvent'](testCalendar, updateActivity);

    expect(mockApObject.update.calledOnce).toBe(true);
    const updateArgs = mockApObject.update.firstCall.args[0];
    expect(updateArgs.source_series).toBeNull();
  });
});
