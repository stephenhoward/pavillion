import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { DateTime } from 'luxon';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { CalendarEventContent, CalendarEventSchedule, language, EventFrequency } from '@/common/model/events';
import { EventLocation } from '@/common/model/location';
import { EventEntity, EventContentEntity, EventScheduleEntity } from '@/server/calendar/entity/event';
import { EventImportOriginEntity } from '@/server/calendar/entity/event_import_origin';
import { LocationSpaceEntity } from '@/server/calendar/entity/location_space';
import { SpaceLocationMismatchError } from '@/common/exceptions/calendar';
import EventService from '@/server/calendar/service/events';

describe('updateEvent with content', () => {
  let service: EventService;
  let sandbox = sinon.createSandbox();
  let getCalendarStub: sinon.SinonStub;
  let editableCalendarsStub: sinon.SinonStub;

  beforeEach(() => {
    service = new EventService(new EventEmitter());
    // Stub the internal service instances created by EventService
    getCalendarStub = sandbox.stub(service['calendarService'], 'getCalendar');
    editableCalendarsStub = sandbox.stub(service['calendarService'], 'editableCalendarsForUser');
    // Stub the sibling origin lookup so user-context updateEvent's flip-check
    // does not hit the in-memory DB (the event_import_origin table is not
    // created in the shared test DB bootstrap).
    sandbox.stub(EventImportOriginEntity, 'findOne').resolves(null);
  });
  afterEach(() => {
    sandbox.restore();
  });

  it('should throw an error if event not found', async () => {
    let findEventStub = sandbox.stub(EventEntity, 'findByPk');
    findEventStub.resolves(undefined);

    await expect(service.updateEvent(new Account('testAccountId', 'testme', 'testme'), '11111111-1111-4111-8111-111111111111', {
      content: {
        en: {
          name: "testName",
          description: "description",
        },
      },
    })).rejects.toThrow('Event not found');
  });

  it('should throw an error if account does not own event', async () => {
    let findEventStub = sandbox.stub(EventEntity, 'findByPk');
    getCalendarStub.resolves(new Calendar('notTestCalendarId', 'testme'));
    editableCalendarsStub.resolves([]);
    findEventStub.resolves(new EventEntity({ calendar_id: 'testCalendarId' }));

    await expect(service.updateEvent(new Account('testAccountId', 'testme', 'testme'), '11111111-1111-4111-8111-111111111111', {
      content: {
        en: {
          name: "testName",
          description: "description",
        },
      },
    })).rejects.toThrow('Insufficient permissions to modify events in this calendar');
  });

  it('should update an event', async () => {
    let findEventStub = sandbox.stub(EventEntity, 'findByPk');
    let findEventContentStub = sandbox.stub(EventContentEntity, 'findOne');
    let saveEventStub = sandbox.stub(EventEntity.prototype, 'save');
    let saveContentStub = sandbox.stub(EventContentEntity.prototype, 'save');

    const cal = new Calendar('testCalendarId', 'testme');
    getCalendarStub.resolves(cal);
    editableCalendarsStub.resolves([cal]);
    findEventStub.resolves(EventEntity.build({ calendar_id: 'testCalendarId' }));
    findEventContentStub.resolves(EventContentEntity.build({ event_id: '11111111-1111-4111-8111-111111111111', language: 'en' }));

    let updatedEvent = await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), '11111111-1111-4111-8111-111111111111', {
      content: {
        en: {
          name: "updatedName",
          description: "updatedDescription",
        },
      },
    });

    expect(saveEventStub.called).toBe(true);
    expect(updatedEvent.content("en").name).toBe('updatedName');
    expect(updatedEvent.content("en").description).toBe('updatedDescription');
    expect(saveContentStub.called).toBe(true);
  });

  it('should delete event content if given empty data', async () => {
    let findEventStub = sandbox.stub(EventEntity, 'findByPk');
    let saveEventStub = sandbox.stub(EventEntity.prototype, 'save');
    let findEventContentStub = sandbox.stub(EventContentEntity, 'findOne');
    let destroyContentStub = sandbox.stub(EventContentEntity.prototype, 'destroy');

    const cal = new Calendar('testCalendarId', 'testme');
    getCalendarStub.resolves(cal);
    editableCalendarsStub.resolves([cal]);
    findEventStub.resolves(EventEntity.build({ calendar_id: 'testCalendarId' }));
    findEventContentStub.resolves(EventContentEntity.build({ event_id: '11111111-1111-4111-8111-111111111111', language: 'en' }));

    let updatedEvent = await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), '11111111-1111-4111-8111-111111111111', {
      content: {
        en: {},
      },
    });

    expect(saveEventStub.called).toBe(true);
    expect(updatedEvent.content("en").isEmpty()).toBe(true);
    expect(destroyContentStub.called).toBe(true);
  });

  it('should delete event content if given empty data except for language', async () => {
    let findEventStub = sandbox.stub(EventEntity, 'findByPk');
    let saveEventStub = sandbox.stub(EventEntity.prototype, 'save');
    let findEventContentStub = sandbox.stub(EventContentEntity, 'findOne');
    let destroyContentStub = sandbox.stub(EventContentEntity.prototype, 'destroy');

    const cal = new Calendar('testCalendarId', 'testme');
    getCalendarStub.resolves(cal);
    editableCalendarsStub.resolves([cal]);
    findEventStub.resolves(EventEntity.build({ calendar_id: 'testCalendarId' }));
    findEventContentStub.resolves(EventContentEntity.build({ event_id: '11111111-1111-4111-8111-111111111111', language: 'en' }));

    let updatedEvent = await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), '11111111-1111-4111-8111-111111111111', {
      content: {
        en: { language: 'en'},
      },
    });

    expect(saveEventStub.called).toBe(true);
    expect(updatedEvent.content("en").isEmpty()).toBe(true);
    expect(destroyContentStub.called).toBe(true);
  });

  it('should delete event content if given undefined data', async () => {
    let findEventStub = sandbox.stub(EventEntity, 'findByPk');
    let saveEventStub = sandbox.stub(EventEntity.prototype, 'save');
    let findEventContentStub = sandbox.stub(EventContentEntity, 'findOne');
    let destroyContentStub = sandbox.stub(EventContentEntity.prototype, 'destroy');

    const cal = new Calendar('testCalendarId', 'testme');
    getCalendarStub.resolves(cal);
    editableCalendarsStub.resolves([cal]);
    findEventStub.resolves(EventEntity.build({ calendar_id: 'testCalendarId' }));
    findEventContentStub.resolves(EventContentEntity.build({ event_id: '11111111-1111-4111-8111-111111111111', language: 'en' }));

    let updatedEvent = await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), '11111111-1111-4111-8111-111111111111', {
      content: {
        en: undefined,
      },
    });

    expect(saveEventStub.called).toBe(true);
    expect(updatedEvent.content("en").isEmpty()).toBe(true);
    expect(destroyContentStub.called).toBe(true);
  });

  it('should create event content if not found', async () => {
    let findEventStub = sandbox.stub(EventEntity, 'findByPk');
    let saveEventStub = sandbox.stub(EventEntity.prototype, 'save');
    let findEventContentStub = sandbox.stub(EventContentEntity, 'findOne');
    let createContentStub = sandbox.stub(service, 'createEventContent');

    const cal = new Calendar('testCalendarId', 'testme');
    getCalendarStub.resolves(cal);
    editableCalendarsStub.resolves([cal]);
    findEventStub.resolves(EventEntity.build({ calendar_id: 'testCalendarId' }));
    findEventContentStub.resolves(undefined);
    createContentStub.resolves(new CalendarEventContent(language.EN, 'updatedName', 'updatedDescription'));

    let updatedEvent = await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), '11111111-1111-4111-8111-111111111111', {
      content: {
        en: {
          name: "updatedName",
          description: "updatedDescription",
        },
      },
    });

    expect(saveEventStub.called).toBe(true);
    expect(updatedEvent.content("en").name).toBe('updatedName');
    expect(updatedEvent.content("en").description).toBe('updatedDescription');
    expect(createContentStub.called).toBe(true);
  });

});

describe('updateEvent with location', () => {
  let service: EventService;
  let sandbox = sinon.createSandbox();
  let getCalendarStub: sinon.SinonStub;
  let editableCalendarsStub: sinon.SinonStub;

  beforeEach(() => {
    service = new EventService(new EventEmitter());
    // Stub the internal service instances created by EventService
    getCalendarStub = sandbox.stub(service['calendarService'], 'getCalendar');
    editableCalendarsStub = sandbox.stub(service['calendarService'], 'editableCalendarsForUser');
    const cal = new Calendar('testCalendarId', 'testme');
    getCalendarStub.resolves(cal);
    editableCalendarsStub.resolves([cal]);
    sandbox.stub(EventImportOriginEntity, 'findOne').resolves(null);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should add a location to an event', async () => {
    let findEventStub = sandbox.stub(EventEntity, 'findByPk');
    let saveEventStub = sandbox.stub(EventEntity.prototype, 'save');
    let findLocationStub = sandbox.stub(service['locationService'], 'findOrCreateLocation');

    findEventStub.resolves(EventEntity.build({ account_id: 'testAccountId', calendar_id: 'testCalendarId' }));
    findLocationStub.resolves(new EventLocation('testId','testLocation', 'testAddress'));

    let updatedEvent = await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), '11111111-1111-4111-8111-111111111111', {
      location: {
        name: "testLocation",
        address: "testAddress",
      },
    });

    expect(saveEventStub.called).toBe(true);
    expect(findLocationStub.called).toBe(true);
    expect(updatedEvent.location).toBeDefined();
    expect(updatedEvent.location?.id === 'testId');
  });

  it('should clear location from an event', async () => {

    let eventEntity = EventEntity.build({ account_id: 'testAccountId', calendar_id: 'testCalendarId', location_id: 'testLocationId' });

    let findEventStub = sandbox.stub(EventEntity, 'findByPk');
    let saveEventStub = sandbox.stub(EventEntity.prototype, 'save');
    let findLocationStub = sandbox.stub(service['locationService'], 'findOrCreateLocation');

    findEventStub.resolves(eventEntity);
    findLocationStub.resolves(new EventLocation('testId','testLocation', 'testAddress'));

    let updatedEvent = await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), '11111111-1111-4111-8111-111111111111', {});

    expect(saveEventStub.called).toBe(true);
    expect(findLocationStub.called).toBe(false);
    expect(updatedEvent.location).toBeNull();
    expect(eventEntity.location_id).toBeNull();
  });


});

describe('updateEvent Space/Place invariant', () => {
  let service: EventService;
  let sandbox = sinon.createSandbox();
  let getCalendarStub: sinon.SinonStub;
  let editableCalendarsStub: sinon.SinonStub;

  beforeEach(() => {
    service = new EventService(new EventEmitter());
    getCalendarStub = sandbox.stub(service['calendarService'], 'getCalendar');
    editableCalendarsStub = sandbox.stub(service['calendarService'], 'editableCalendarsForUser');
    const cal = new Calendar('testCalendarId', 'testme');
    getCalendarStub.resolves(cal);
    editableCalendarsStub.resolves([cal]);
    sandbox.stub(EventImportOriginEntity, 'findOne').resolves(null);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('rejects event update with mismatched (locationId, spaceId)', async () => {
    // Place A has a Space; the update tries to attach that Space to Place B.
    const placeAId = '22222222-2222-4222-8222-222222222222';
    const placeBId = '33333333-3333-4333-8333-333333333333';
    const spaceUnderAId = '44444444-4444-4444-8444-444444444444';

    const findEventStub = sandbox.stub(EventEntity, 'findByPk');
    findEventStub.resolves(EventEntity.build({
      account_id: 'testAccountId',
      calendar_id: 'testCalendarId',
    }));

    // Caller-provided locationId points at Place B; resolving it succeeds.
    const findLocationByIdStub = sandbox.stub(service['locationService'], 'getLocationById');
    findLocationByIdStub.resolves(new EventLocation(placeBId, 'placeB', 'address'));

    // Space lookup returns a Space whose place_id is Place A — the mismatch.
    const findSpaceStub = sandbox.stub(LocationSpaceEntity, 'findByPk');
    findSpaceStub.resolves(LocationSpaceEntity.build({
      id: spaceUnderAId,
      place_id: placeAId,
    }) as unknown as LocationSpaceEntity);

    let thrown: unknown = null;
    try {
      await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), '11111111-1111-4111-8111-111111111111', {
        locationId: placeBId,
        spaceId: spaceUnderAId,
      });
    }
    catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(SpaceLocationMismatchError);
    const err = thrown as SpaceLocationMismatchError;
    expect(err.spaceId).toBe(spaceUnderAId);
    expect(err.expectedPlaceId).toBe(placeBId);
    expect(err.actualPlaceId).toBe(placeAId);
  });

  it('rejects event update when spaceId is set but the Space row is missing', async () => {
    const placeBId = '33333333-3333-4333-8333-333333333333';
    const missingSpaceId = '55555555-5555-4555-8555-555555555555';

    const findEventStub = sandbox.stub(EventEntity, 'findByPk');
    findEventStub.resolves(EventEntity.build({
      account_id: 'testAccountId',
      calendar_id: 'testCalendarId',
    }));

    const findLocationByIdStub = sandbox.stub(service['locationService'], 'getLocationById');
    findLocationByIdStub.resolves(new EventLocation(placeBId, 'placeB', 'address'));

    const findSpaceStub = sandbox.stub(LocationSpaceEntity, 'findByPk');
    findSpaceStub.resolves(null);

    let thrown: unknown = null;
    try {
      await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), '11111111-1111-4111-8111-111111111111', {
        locationId: placeBId,
        spaceId: missingSpaceId,
      });
    }
    catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(SpaceLocationMismatchError);
    const err = thrown as SpaceLocationMismatchError;
    expect(err.spaceId).toBe(missingSpaceId);
    expect(err.expectedPlaceId).toBe(placeBId);
    expect(err.actualPlaceId).toBe('unknown');
  });

  it('persists space_id when (locationId, spaceId) match', async () => {
    const placeId = '22222222-2222-4222-8222-222222222222';
    const spaceId = '33333333-3333-4333-8333-333333333333';

    const eventEntity = EventEntity.build({
      account_id: 'testAccountId',
      calendar_id: 'testCalendarId',
    });

    const findEventStub = sandbox.stub(EventEntity, 'findByPk');
    findEventStub.resolves(eventEntity);
    sandbox.stub(EventEntity.prototype, 'save').resolves();

    const findLocationByIdStub = sandbox.stub(service['locationService'], 'getLocationById');
    findLocationByIdStub.resolves(new EventLocation(placeId, 'place', 'address'));

    const findSpaceStub = sandbox.stub(LocationSpaceEntity, 'findByPk');
    findSpaceStub.resolves(LocationSpaceEntity.build({
      id: spaceId,
      place_id: placeId,
    }) as unknown as LocationSpaceEntity);

    await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), '11111111-1111-4111-8111-111111111111', {
      locationId: placeId,
      spaceId: spaceId,
    });

    expect(eventEntity.location_id).toBe(placeId);
    expect(eventEntity.space_id).toBe(spaceId);
  });

  it('clears space_id when locationId is changed and spaceId is omitted (whole-venue fallback on Place re-pick)', async () => {
    // Seed: event already has location_id=placeA and space_id=spaceUnderA.
    // Update: only locationId changes to placeB; spaceId is omitted from the
    // payload. Expected: persisted event has location_id=placeB, space_id=null.
    const placeAId = '22222222-2222-4222-8222-222222222222';
    const placeBId = '33333333-3333-4333-8333-333333333333';
    const spaceUnderAId = '44444444-4444-4444-8444-444444444444';

    const eventEntity = EventEntity.build({
      account_id: 'testAccountId',
      calendar_id: 'testCalendarId',
      location_id: placeAId,
      space_id: spaceUnderAId,
    });

    const findEventStub = sandbox.stub(EventEntity, 'findByPk');
    findEventStub.resolves(eventEntity);
    sandbox.stub(EventEntity.prototype, 'save').resolves();

    const findLocationByIdStub = sandbox.stub(service['locationService'], 'getLocationById');
    findLocationByIdStub.resolves(new EventLocation(placeBId, 'placeB', 'address'));

    await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), '11111111-1111-4111-8111-111111111111', {
      locationId: placeBId,
      // spaceId intentionally omitted
    });

    expect(eventEntity.location_id).toBe(placeBId);
    expect(eventEntity.space_id).toBeNull();
  });

  it('clears space_id when spaceId is explicitly null and locationId is unchanged', async () => {
    const placeAId = '22222222-2222-4222-8222-222222222222';
    const spaceUnderAId = '44444444-4444-4444-8444-444444444444';

    const eventEntity = EventEntity.build({
      account_id: 'testAccountId',
      calendar_id: 'testCalendarId',
      location_id: placeAId,
      space_id: spaceUnderAId,
    });

    const findEventStub = sandbox.stub(EventEntity, 'findByPk');
    findEventStub.resolves(eventEntity);
    sandbox.stub(EventEntity.prototype, 'save').resolves();

    const findLocationByIdStub = sandbox.stub(service['locationService'], 'getLocationById');
    findLocationByIdStub.resolves(new EventLocation(placeAId, 'placeA', 'address'));

    // Explicit locationId: placeAId keeps the location stable so we observe
    // the clear-only-space behaviour rather than the implicit "no location key
    // means clear location" path that already exists.
    await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), '11111111-1111-4111-8111-111111111111', {
      locationId: placeAId,
      spaceId: null,
    });

    expect(eventEntity.location_id).toBe(placeAId);
    expect(eventEntity.space_id).toBeNull();
  });

  // Regression — Wave 6 IDOR fix.
  // Before the fix, the (spaceId && effectiveLocationId) gate skipped
  // validation when spaceId was supplied without locationId AND the persisted
  // event had no location_id, allowing an attacker-supplied foreign spaceId
  // to be written to event.space_id without any parent-place check.
  it('rejects event update when spaceId is supplied and the event has no location at all', async () => {
    const orphanSpaceId = '88888888-8888-4888-8888-888888888888';

    // Event has no location_id. No locationId in payload. spaceId only.
    const eventEntity = EventEntity.build({
      account_id: 'testAccountId',
      calendar_id: 'testCalendarId',
    });

    const findEventStub = sandbox.stub(EventEntity, 'findByPk');
    findEventStub.resolves(eventEntity);
    sandbox.stub(EventEntity.prototype, 'save').resolves();

    // Stub Space lookup so we can assert it is NOT consulted (the early
    // reject must fire first, before any DB read on the supplied spaceId).
    const findSpaceStub = sandbox.stub(LocationSpaceEntity, 'findByPk');

    let thrown: unknown = null;
    try {
      await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), '11111111-1111-4111-8111-111111111111', {
        spaceId: orphanSpaceId,
      });
    }
    catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(SpaceLocationMismatchError);
    const err = thrown as SpaceLocationMismatchError;
    expect(err.spaceId).toBe(orphanSpaceId);
    expect(findSpaceStub.called).toBe(false);
  });

  it('rejects spaceId-only update when the payload omits both locationId and embedded location (existing location is cleared first)', async () => {
    // Defense-in-depth case: the event already has location_id=placeA, but the
    // update supplies only spaceId (no locationId, no embedded location).
    // The pre-existing update logic clears the location in that scenario
    // (line 1016: `eventEntity.location_id && !eventParams.location` → null).
    // After the clear, no parent Place exists to validate spaceId against, so
    // the Space invariant must reject — preventing an attacker from attaching
    // an arbitrary spaceId by simply omitting location keys.
    const placeAId = '22222222-2222-4222-8222-222222222222';
    const orphanSpaceId = '99999999-9999-4999-8999-999999999999';

    const eventEntity = EventEntity.build({
      account_id: 'testAccountId',
      calendar_id: 'testCalendarId',
      location_id: placeAId,
    });

    const findEventStub = sandbox.stub(EventEntity, 'findByPk');
    findEventStub.resolves(eventEntity);
    sandbox.stub(EventEntity.prototype, 'save').resolves();

    // Stub Space lookup so we can assert it is NOT consulted (the early
    // reject must fire first, before any DB read on the supplied spaceId).
    const findSpaceStub = sandbox.stub(LocationSpaceEntity, 'findByPk');

    let thrown: unknown = null;
    try {
      await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), '11111111-1111-4111-8111-111111111111', {
        spaceId: orphanSpaceId,
      });
    }
    catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(SpaceLocationMismatchError);
    const err = thrown as SpaceLocationMismatchError;
    expect(err.spaceId).toBe(orphanSpaceId);
    expect(findSpaceStub.called).toBe(false);
  });

  it('validates spaceId against embedded location.id when locationId is omitted', async () => {
    // Embedded location flows through findOrCreateLocation and updates
    // eventEntity.location_id. The Space invariant must run against that
    // resolved id even though the request did not supply locationId directly.
    const placeAId = '22222222-2222-4222-8222-222222222222';
    const placeBId = '33333333-3333-4333-8333-333333333333';
    const spaceUnderBId = '99999999-9999-4999-8999-999999999999';

    const eventEntity = EventEntity.build({
      account_id: 'testAccountId',
      calendar_id: 'testCalendarId',
    });

    const findEventStub = sandbox.stub(EventEntity, 'findByPk');
    findEventStub.resolves(eventEntity);
    sandbox.stub(EventEntity.prototype, 'save').resolves();

    const findOrCreateLocationStub = sandbox.stub(service['locationService'], 'findOrCreateLocation');
    findOrCreateLocationStub.resolves(new EventLocation(placeAId, 'placeA', 'address'));

    // Space belongs to Place B, but the resolved embedded location is Place A.
    const findSpaceStub = sandbox.stub(LocationSpaceEntity, 'findByPk');
    findSpaceStub.resolves(LocationSpaceEntity.build({
      id: spaceUnderBId,
      place_id: placeBId,
    }) as unknown as LocationSpaceEntity);

    let thrown: unknown = null;
    try {
      await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), '11111111-1111-4111-8111-111111111111', {
        location: { name: 'placeA', address: 'address' },
        spaceId: spaceUnderBId,
      });
    }
    catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(SpaceLocationMismatchError);
    const err = thrown as SpaceLocationMismatchError;
    expect(err.spaceId).toBe(spaceUnderBId);
    expect(err.expectedPlaceId).toBe(placeAId);
    expect(err.actualPlaceId).toBe(placeBId);
  });
});

describe('updateEvent with schedules', () => {
  let service: EventService;
  let sandbox = sinon.createSandbox();
  let getCalendarStub: sinon.SinonStub;
  let editableCalendarsStub: sinon.SinonStub;

  beforeEach(() => {
    service = new EventService(new EventEmitter());
    // Stub the internal service instances created by EventService
    getCalendarStub = sandbox.stub(service['calendarService'], 'getCalendar');
    editableCalendarsStub = sandbox.stub(service['calendarService'], 'editableCalendarsForUser');
    const cal = new Calendar('testCalendarId', 'testme');
    getCalendarStub.resolves(cal);
    editableCalendarsStub.resolves([cal]);
    sandbox.stub(EventImportOriginEntity, 'findOne').resolves(null);
  });
  afterEach(() => {
    sandbox.restore();
  });

  it('should add a schedule to an event', async () => {
    let findEventStub = sandbox.stub(EventEntity, 'findByPk');
    let saveEventStub = sandbox.stub(EventEntity.prototype, 'save');
    let createScheduleStub = sandbox.stub(service, 'createEventSchedule');
    let findSchedulesStub = sandbox.stub(EventScheduleEntity, 'findAll');

    findEventStub.resolves(EventEntity.build({ account_id: 'testAccountId', id: '11111111-1111-4111-8111-111111111111', calendar_id: 'testCalendarId' }));
    createScheduleStub.resolves(new CalendarEventSchedule('testScheduleId', DateTime.now(), DateTime.now().plus({days: 12})));
    findSchedulesStub.resolves([]);

    let updatedEvent = await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), '11111111-1111-4111-8111-111111111111', {
      schedules: [
        {
          start: new Date(),
          end: new Date(),
        },
      ],
    });

    expect(saveEventStub.called).toBe(true);
    expect(createScheduleStub.called).toBe(true);
    expect(updatedEvent.schedules.length).toBe(1);
  });

  it('should clear schedules from an event', async () => {

    let findEventStub = sandbox.stub(EventEntity, 'findByPk');
    let saveEventStub = sandbox.stub(EventEntity.prototype, 'save');
    let findSchedulesStub = sandbox.stub(EventScheduleEntity, 'findAll');
    let destroySchedulesStub = sandbox.stub(EventScheduleEntity, 'destroy');

    findEventStub.resolves(EventEntity.build({ account_id: 'testAccountId', id: '11111111-1111-4111-8111-111111111111', calendar_id: 'testCalendarId' }));
    findSchedulesStub.resolves([ EventScheduleEntity.build({ event_id: '11111111-1111-4111-8111-111111111111', id: 'testScheduleId' }) ]);

    let updatedEvent = await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), '11111111-1111-4111-8111-111111111111', {
      schedules: [],
    });

    expect(saveEventStub.called).toBe(true);
    expect(destroySchedulesStub.called).toBe(true);
    expect(updatedEvent.schedules.length).toBe(0);
  });

  it('should modify a schedule in an event', async () => {
    let scheduleEntity = EventScheduleEntity.build({
      id: 'testScheduleId',
      frequency: EventFrequency.WEEKLY as string,
      interval: 3,
    });

    let findEventStub = sandbox.stub(EventEntity, 'findByPk');
    let saveEventStub = sandbox.stub(EventEntity.prototype, 'save');
    let findSchedulesStub = sandbox.stub(EventScheduleEntity, 'findAll');
    let updateScheduleStub = sandbox.stub(EventScheduleEntity.prototype, 'update');

    findEventStub.resolves(EventEntity.build({ account_id: 'testAccountId', id: '11111111-1111-4111-8111-111111111111', calendar_id: 'testCalendarId' }));
    findSchedulesStub.resolves([ scheduleEntity ]);
    updateScheduleStub.callsFake(async (params) => {
      for (let key in params) {
        scheduleEntity.set(key, params[key]);
      }

      return scheduleEntity;
    });

    let updatedEvent = await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), '11111111-1111-4111-8111-111111111111', {
      schedules: [
        {
          id: 'testScheduleId',
          frequency: EventFrequency.DAILY,
        },
      ],
    });

    expect(saveEventStub.called).toBe(true);
    expect(findSchedulesStub.called).toBe(true);
    expect(updatedEvent.schedules.length).toBe(1);
    expect(updatedEvent.schedules[0].interval).toBe(3);
    expect(updatedEvent.schedules[0].frequency).toBe(EventFrequency.DAILY);
  });

  it('should update start_date when request sends "start" key (property name mapping)', async () => {
    let scheduleEntity = EventScheduleEntity.build({
      id: 'testScheduleId',
      start_date: new Date('2026-01-01T10:00:00Z'),
      end_date: new Date('2026-01-01T12:00:00Z'),
      timezone: 'America/Los_Angeles',
    });

    let findEventStub = sandbox.stub(EventEntity, 'findByPk');
    sandbox.stub(EventEntity.prototype, 'save');
    let findSchedulesStub = sandbox.stub(EventScheduleEntity, 'findAll');
    let updateScheduleStub = sandbox.stub(EventScheduleEntity.prototype, 'update');

    findEventStub.resolves(EventEntity.build({ account_id: 'testAccountId', id: '11111111-1111-4111-8111-111111111111', calendar_id: 'testCalendarId' }));
    findSchedulesStub.resolves([ scheduleEntity ]);
    updateScheduleStub.callsFake(async (params) => {
      for (let key in params) {
        scheduleEntity.set(key, params[key]);
      }
      return scheduleEntity;
    });

    await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), '11111111-1111-4111-8111-111111111111', {
      schedules: [{
        id: 'testScheduleId',
        start: '2026-06-15T14:00:00',
        end: '2026-06-15T16:00:00',
        eventEndTime: '2026-06-15T16:00:00',
      }],
    });

    const updateArgs = updateScheduleStub.firstCall.args[0];
    expect(updateArgs.start_date).toBeInstanceOf(Date);
    expect(updateArgs.start_date).not.toEqual(new Date('2026-01-01T10:00:00Z'));
    expect(updateArgs.end_date).toBeInstanceOf(Date);
  });

  it('should preserve end_date when "end" key is absent from request', async () => {
    const originalEndDate = new Date('2026-01-01T12:00:00Z');
    let scheduleEntity = EventScheduleEntity.build({
      id: 'testScheduleId',
      start_date: new Date('2026-01-01T10:00:00Z'),
      end_date: originalEndDate,
      timezone: 'UTC',
    });

    let findEventStub = sandbox.stub(EventEntity, 'findByPk');
    sandbox.stub(EventEntity.prototype, 'save');
    let findSchedulesStub = sandbox.stub(EventScheduleEntity, 'findAll');
    let updateScheduleStub = sandbox.stub(EventScheduleEntity.prototype, 'update');

    findEventStub.resolves(EventEntity.build({ account_id: 'testAccountId', id: '11111111-1111-4111-8111-111111111111', calendar_id: 'testCalendarId' }));
    findSchedulesStub.resolves([ scheduleEntity ]);
    updateScheduleStub.callsFake(async (params) => {
      for (let key in params) {
        scheduleEntity.set(key, params[key]);
      }
      return scheduleEntity;
    });

    await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), '11111111-1111-4111-8111-111111111111', {
      schedules: [{
        id: 'testScheduleId',
        frequency: EventFrequency.DAILY,
      }],
    });

    const updateArgs = updateScheduleStub.firstCall.args[0];
    expect(updateArgs.end_date).toEqual(originalEndDate);
  });

  it('should clear end_date when "end" key is explicitly null', async () => {
    let scheduleEntity = EventScheduleEntity.build({
      id: 'testScheduleId',
      start_date: new Date('2026-01-01T10:00:00Z'),
      end_date: new Date('2026-06-01T00:00:00Z'),
      count: 6,
      timezone: 'UTC',
    });

    let findEventStub = sandbox.stub(EventEntity, 'findByPk');
    sandbox.stub(EventEntity.prototype, 'save');
    let findSchedulesStub = sandbox.stub(EventScheduleEntity, 'findAll');
    let updateScheduleStub = sandbox.stub(EventScheduleEntity.prototype, 'update');

    findEventStub.resolves(EventEntity.build({ account_id: 'testAccountId', id: '11111111-1111-4111-8111-111111111111', calendar_id: 'testCalendarId' }));
    findSchedulesStub.resolves([ scheduleEntity ]);
    updateScheduleStub.callsFake(async (params) => {
      for (let key in params) {
        scheduleEntity.set(key, params[key]);
      }
      return scheduleEntity;
    });

    await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), '11111111-1111-4111-8111-111111111111', {
      schedules: [{
        id: 'testScheduleId',
        end: null,
        count: 0,
      }],
    });

    const updateArgs = updateScheduleStub.firstCall.args[0];
    expect(updateArgs.end_date).toBeNull();
    expect(updateArgs.count).toBe(0);
  });

  it('should remove an existing schedule and add a new one', async () => {
    let scheduleEntity = EventScheduleEntity.build({
      id: 'testScheduleId',
      frequency: EventFrequency.WEEKLY as string,
      interval: 3,
    });

    let findEventStub = sandbox.stub(EventEntity, 'findByPk');
    let saveEventStub = sandbox.stub(EventEntity.prototype, 'save');
    let createScheduleStub = sandbox.stub(service, 'createEventSchedule');
    let findSchedulesStub = sandbox.stub(EventScheduleEntity, 'findAll');
    let destroySchedulesStub = sandbox.stub(EventScheduleEntity, 'destroy');

    findEventStub.resolves(EventEntity.build({ account_id: 'testAccountId', id: '11111111-1111-4111-8111-111111111111', calendar_id: 'testCalendarId' }));
    findSchedulesStub.resolves([ scheduleEntity ]);
    createScheduleStub.resolves(new CalendarEventSchedule('otherTestScheduleId', DateTime.now(), DateTime.now().plus({days: 12})));

    let updatedEvent = await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), '11111111-1111-4111-8111-111111111111', {
      schedules: [ {
        start: new Date(),
        end: new Date(),
      } ],
    });

    expect(saveEventStub.called).toBe(true);
    expect(createScheduleStub.called).toBe(true);
    expect(destroySchedulesStub.called).toBe(true);
    expect(updatedEvent.schedules.length).toBe(1);
    expect(updatedEvent.schedules[0].id).toBe('otherTestScheduleId');

  });

});

describe('updateEvent exclusion preservation (reconcileSchedules)', () => {
  let service: EventService;
  let sandbox = sinon.createSandbox();
  let getCalendarStub: sinon.SinonStub;
  let editableCalendarsStub: sinon.SinonStub;
  const cal = new Calendar('testCalendarId', 'testme');
  const acct = new Account('testAccountId', 'testme', 'testme');
  const eventId = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    service = new EventService(new EventEmitter());
    getCalendarStub = sandbox.stub(service['calendarService'], 'getCalendar');
    editableCalendarsStub = sandbox.stub(service['calendarService'], 'editableCalendarsForUser');
    getCalendarStub.resolves(cal);
    editableCalendarsStub.resolves([cal]);
    sandbox.stub(EventImportOriginEntity, 'findOne').resolves(null);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should preserve existing is_exclusion=true rows when payload contains only positive schedules (omit-case)', async () => {
    // An event with one positive schedule and one exclusion/cancellation row.
    const positiveEntity = EventScheduleEntity.build({
      id: 'positiveScheduleId',
      event_id: eventId,
      frequency: EventFrequency.WEEKLY as string,
      interval: 1,
      is_exclusion: false,
    });
    const exclusionEntity = EventScheduleEntity.build({
      id: 'exclusionScheduleId',
      event_id: eventId,
      is_exclusion: true,
      hide_from_public: false,
    });

    sandbox.stub(EventEntity, 'findByPk').resolves(
      EventEntity.build({ account_id: 'testAccountId', id: eventId, calendar_id: 'testCalendarId' }),
    );
    sandbox.stub(EventEntity.prototype, 'save');
    const findSchedulesStub = sandbox.stub(EventScheduleEntity, 'findAll');
    findSchedulesStub.resolves([positiveEntity, exclusionEntity]);
    const updateScheduleStub = sandbox.stub(EventScheduleEntity.prototype, 'update');
    updateScheduleStub.resolves();
    const destroyStub = sandbox.stub(EventScheduleEntity, 'destroy');

    const updated = await service.updateEvent(acct, eventId, {
      schedules: [
        { id: 'positiveScheduleId', frequency: EventFrequency.DAILY },
      ],
    });

    // Positive row was updated; destroy was not called because the payload
    // keeps the only existing positive. Exclusion row untouched.
    expect(updateScheduleStub.called).toBe(true);
    expect(destroyStub.called).toBe(false);

    // Returned model includes both the updated positive and the preserved
    // exclusion.
    expect(updated.schedules.length).toBe(2);
    const preservedExclusion = updated.schedules.find(s => s.isExclusion === true);
    expect(preservedExclusion).toBeDefined();
    expect(preservedExclusion?.id).toBe('exclusionScheduleId');
  });

  it('should scope destroy to positive rows only when payload clears schedules (omit-case with deletion)', async () => {
    const positiveEntity = EventScheduleEntity.build({
      id: 'positiveScheduleId',
      event_id: eventId,
      frequency: EventFrequency.WEEKLY as string,
      is_exclusion: false,
    });
    const exclusionEntity = EventScheduleEntity.build({
      id: 'exclusionScheduleId',
      event_id: eventId,
      is_exclusion: true,
    });

    sandbox.stub(EventEntity, 'findByPk').resolves(
      EventEntity.build({ account_id: 'testAccountId', id: eventId, calendar_id: 'testCalendarId' }),
    );
    sandbox.stub(EventEntity.prototype, 'save');
    sandbox.stub(EventScheduleEntity, 'findAll').resolves([positiveEntity, exclusionEntity]);
    const destroyStub = sandbox.stub(EventScheduleEntity, 'destroy');

    const updated = await service.updateEvent(acct, eventId, { schedules: [] });

    // Destroy is called, but scoped to positive ids only and double-gated by
    // event_id and is_exclusion=false.
    expect(destroyStub.calledOnce).toBe(true);
    const whereArg = destroyStub.firstCall.args[0].where;
    expect(whereArg.event_id).toBe(eventId);
    expect(whereArg.is_exclusion).toBe(false);
    expect(whereArg.id).toEqual(['positiveScheduleId']);

    // Exclusion row is preserved and returned on the model.
    expect(updated.schedules.length).toBe(1);
    expect(updated.schedules[0].isExclusion).toBe(true);
    expect(updated.schedules[0].id).toBe('exclusionScheduleId');
  });

  it('should reject payload that includes a schedule with isException=true (include-case)', async () => {
    sandbox.stub(EventEntity, 'findByPk').resolves(
      EventEntity.build({ account_id: 'testAccountId', id: eventId, calendar_id: 'testCalendarId' }),
    );
    sandbox.stub(EventEntity.prototype, 'save');
    const findSchedulesStub = sandbox.stub(EventScheduleEntity, 'findAll');
    findSchedulesStub.resolves([]);

    await expect(service.updateEvent(acct, eventId, {
      schedules: [
        {
          start: new Date(),
          end: new Date(),
          isException: true,
        },
      ],
    })).rejects.toThrow('Exclusion schedules cannot be created or modified through updateEvent');

    // Payload rejection must be short-circuited: no findAll/destroy against
    // the existing rows should run in the failure path. (findAll is inside
    // reconcileSchedules, which throws on the first rejection loop.)
    expect(findSchedulesStub.called).toBe(false);
  });

  it('should re-key the exclusion row to the new start_date when a single event date is edited', async () => {
    // A single (non-recurring) event with one positive schedule and a
    // cancellation exclusion row keyed to the same occurrence. Editing the
    // event's date must move the exclusion to the new date so it stays
    // cancelled (cancellation-follows-event).
    //
    // The positive schedule uses a NON-UTC timezone so its resolved instant
    // diverges from its raw start_date column digits. Positive rows store
    // wall-clock digits reinterpreted via their `timezone` column
    // (keepLocalTime): raw 10:00 on 2026-01-01 in America/New_York (EST,
    // UTC-5) resolves to the instant 2026-01-01T15:00:00Z. The exclusion row
    // (no timezone → UTC convention) is keyed to that RESOLVED instant
    // (15:00Z), NOT the positive's raw 10:00 digits, because reconcileSchedules
    // matches the exclusion to the positive by resolved UTC instant — never by
    // raw column bytes.
    //
    // This divergence is the regression guard. The original bug matched/copied
    // raw start_date column bytes: here that compares 10:00Z (positive) against
    // 15:00Z (exclusion), which do NOT match, so a buggy implementation never
    // re-keys the exclusion at all. The correct implementation matches resolved
    // instants (15:00Z == 15:00Z) and re-keys. Because the divergence is built
    // into the fixture (not the runner's timezone), the guard discriminates on
    // any server timezone, including a UTC runner where the old fixture was
    // vacuous.
    const positiveRawStart = new Date('2026-01-01T10:00:00Z');
    const oldOccurrenceInstantMs = DateTime.fromISO('2026-01-01T15:00:00Z', { zone: 'UTC' }).toMillis();
    const positiveEntity = EventScheduleEntity.build({
      id: 'positiveScheduleId',
      event_id: eventId,
      start_date: positiveRawStart,
      timezone: 'America/New_York',
      is_exclusion: false,
    });
    const exclusionEntity = EventScheduleEntity.build({
      id: 'exclusionScheduleId',
      event_id: eventId,
      start_date: new Date('2026-01-01T15:00:00Z'),
      is_exclusion: true,
      hide_from_public: false,
    });

    sandbox.stub(EventEntity, 'findByPk').resolves(
      EventEntity.build({ account_id: 'testAccountId', id: eventId, calendar_id: 'testCalendarId' }),
    );
    sandbox.stub(EventEntity.prototype, 'save');
    sandbox.stub(EventScheduleEntity, 'findAll').resolves([positiveEntity, exclusionEntity]);
    const updateScheduleStub = sandbox.stub(EventScheduleEntity.prototype, 'update');
    updateScheduleStub.callsFake(async function(this: typeof positiveEntity, params: Record<string, unknown>) {
      for (const key in params) {
        this.set(key, params[key]);
      }
      return this;
    });

    await service.updateEvent(acct, eventId, {
      schedules: [
        { id: 'positiveScheduleId', start: '2026-06-15T14:00:00', end: '2026-06-15T16:00:00' },
      ],
    });

    // The positive schedule moved to a new date.
    const positiveUpdate = updateScheduleStub.getCalls().find(c => c.thisValue === positiveEntity);
    expect(positiveUpdate).toBeDefined();
    const newStart = positiveUpdate?.args[0].start_date as Date;
    expect(newStart.getTime()).not.toBe(positiveRawStart.getTime());

    // The exclusion row was re-keyed onto the new occurrence. Positive
    // schedules and exclusion rows do NOT share a storage convention — positive
    // rows store wall-clock digits reinterpreted in their `timezone` column
    // (keepLocalTime), while exclusion rows are written as true UTC instants.
    // So the re-key is asserted by the resolved occurrence INSTANT via
    // toModel(), not by raw start_date column equality (which would only hold
    // on a UTC server).
    const exclusionUpdate = updateScheduleStub.getCalls().find(c => c.thisValue === exclusionEntity);
    expect(exclusionUpdate).toBeDefined();
    const reKeyedInstantMs = exclusionEntity.toModel().startDate?.toUTC().toMillis();
    expect(reKeyedInstantMs).toBe(positiveEntity.toModel().startDate?.toUTC().toMillis());
    // And it is genuinely the NEW occurrence, not the old one (15:00Z).
    expect(reKeyedInstantMs).not.toBe(oldOccurrenceInstantMs);
  });

  it('should not re-key exclusions for a recurring single event date edit', async () => {
    // A recurring event's exclusions are keyed to individual occurrence dates,
    // not the lone schedule's start_date, so editing the schedule must NOT
    // re-key them.
    const oldStart = new Date('2026-01-01T10:00:00Z');
    const positiveEntity = EventScheduleEntity.build({
      id: 'positiveScheduleId',
      event_id: eventId,
      start_date: oldStart,
      frequency: EventFrequency.WEEKLY as string,
      timezone: 'UTC',
      is_exclusion: false,
    });
    const exclusionEntity = EventScheduleEntity.build({
      id: 'exclusionScheduleId',
      event_id: eventId,
      start_date: oldStart,
      is_exclusion: true,
      hide_from_public: false,
    });

    sandbox.stub(EventEntity, 'findByPk').resolves(
      EventEntity.build({ account_id: 'testAccountId', id: eventId, calendar_id: 'testCalendarId' }),
    );
    sandbox.stub(EventEntity.prototype, 'save');
    sandbox.stub(EventScheduleEntity, 'findAll').resolves([positiveEntity, exclusionEntity]);
    const updateScheduleStub = sandbox.stub(EventScheduleEntity.prototype, 'update');
    updateScheduleStub.callsFake(async function(this: typeof positiveEntity, params: Record<string, unknown>) {
      for (const key in params) {
        this.set(key, params[key]);
      }
      return this;
    });

    await service.updateEvent(acct, eventId, {
      schedules: [
        { id: 'positiveScheduleId', start: '2026-06-15T14:00:00' },
      ],
    });

    // The exclusion row's update must not have been invoked.
    const exclusionUpdate = updateScheduleStub.getCalls().find(c => c.thisValue === exclusionEntity);
    expect(exclusionUpdate).toBeUndefined();
  });

  it('should leave exclusions deleted after a restore (edit unrelated field post-restore)', async () => {
    // Scenario: a cancellation was restored elsewhere (the exclusion row was
    // deleted). Editing an unrelated field (e.g. content) must not recreate
    // the exclusion, and the positive schedule must still update cleanly.
    const positiveEntity = EventScheduleEntity.build({
      id: 'positiveScheduleId',
      event_id: eventId,
      frequency: EventFrequency.WEEKLY as string,
      is_exclusion: false,
    });

    sandbox.stub(EventEntity, 'findByPk').resolves(
      EventEntity.build({ account_id: 'testAccountId', id: eventId, calendar_id: 'testCalendarId' }),
    );
    sandbox.stub(EventEntity.prototype, 'save');
    // No exclusion row returned — it has been deleted by the restore flow.
    sandbox.stub(EventScheduleEntity, 'findAll').resolves([positiveEntity]);
    const destroyStub = sandbox.stub(EventScheduleEntity, 'destroy');
    const findContentStub = sandbox.stub(EventContentEntity, 'findOne');
    findContentStub.resolves(EventContentEntity.build({ event_id: eventId, language: 'en' }));
    sandbox.stub(EventContentEntity.prototype, 'save');

    // Editing content only — no schedules key in the payload at all. The
    // reconcileSchedules helper is not invoked.
    const updated = await service.updateEvent(acct, eventId, {
      content: {
        en: { name: 'newName', description: 'newDescription' },
      },
    });

    expect(destroyStub.called).toBe(false);
    // No exclusions are fabricated by the edit; schedules list is untouched.
    expect(updated.schedules.some(s => s.isExclusion === true)).toBe(false);
  });
});

describe('updateEvent with mediaId', () => {
  let service: EventService;
  let sandbox = sinon.createSandbox();
  let getCalendarStub: sinon.SinonStub;
  let editableCalendarsStub: sinon.SinonStub;
  let mockMediaInterface: { getMediaById: sinon.SinonStub };
  const cal = new Calendar('testCalendarId', 'testme');
  const acct = new Account('testAccountId', 'testme', 'testme');

  beforeEach(async () => {
    const { Media: _Media } = await import('@/common/model/media');
    const _MediaInterface = (await import('@/server/media/interface')).default;

    service = new EventService(new EventEmitter());
    getCalendarStub = sandbox.stub(service['calendarService'], 'getCalendar');
    editableCalendarsStub = sandbox.stub(service['calendarService'], 'editableCalendarsForUser');
    getCalendarStub.resolves(cal);
    editableCalendarsStub.resolves([cal]);
    sandbox.stub(EventImportOriginEntity, 'findOne').resolves(null);

    mockMediaInterface = { getMediaById: sandbox.stub() };
    service.setMediaInterface(mockMediaInterface as unknown as InstanceType<typeof MediaInterface>);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should attach media when mediaId belongs to the same calendar', async () => {
    const { Media } = await import('@/common/model/media');
    const media = new Media('mediaId1', 'testCalendarId', 'abc123', 'photo.jpg', 'image/jpeg', 1024);
    mockMediaInterface.getMediaById.resolves(media);

    sandbox.stub(EventEntity, 'findByPk').resolves(EventEntity.build({ calendar_id: 'testCalendarId' }));
    sandbox.stub(EventEntity.prototype, 'save').resolves();

    const updatedEvent = await service.updateEvent(acct, '11111111-1111-4111-8111-111111111111', {
      mediaId: 'mediaId1',
    });

    expect(mockMediaInterface.getMediaById.calledWith('mediaId1')).toBe(true);
    expect(updatedEvent.media).toBe(media);
  });

  it('should throw an error when updating with a mediaId from a different calendar', async () => {
    const { Media } = await import('@/common/model/media');
    const media = new Media('mediaId1', 'otherCalendarId', 'abc123', 'photo.jpg', 'image/jpeg', 1024);
    mockMediaInterface.getMediaById.resolves(media);

    sandbox.stub(EventEntity, 'findByPk').resolves(EventEntity.build({ calendar_id: 'testCalendarId' }));
    sandbox.stub(EventEntity.prototype, 'save').resolves();

    await expect(service.updateEvent(acct, '11111111-1111-4111-8111-111111111111', {
      mediaId: 'mediaId1',
    })).rejects.toThrow('Media not found or does not belong to this calendar');
  });

  it('should throw an error when updating with a mediaId that is not found', async () => {
    mockMediaInterface.getMediaById.resolves(null);

    sandbox.stub(EventEntity, 'findByPk').resolves(EventEntity.build({ calendar_id: 'testCalendarId' }));
    sandbox.stub(EventEntity.prototype, 'save').resolves();

    await expect(service.updateEvent(acct, '11111111-1111-4111-8111-111111111111', {
      mediaId: 'nonexistentMediaId',
    })).rejects.toThrow('Media not found or does not belong to this calendar');
  });

});
