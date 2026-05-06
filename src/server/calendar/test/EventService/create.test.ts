import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { DateTime } from 'luxon';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { EventLocation } from '@/common/model/location';
import { Media } from '@/common/model/media';
import { EventEntity, EventContentEntity, EventScheduleEntity } from '@/server/calendar/entity/event';
import { LocationSpaceEntity } from '@/server/calendar/entity/location_space';
import { SpaceLocationMismatchError } from '@/common/exceptions/calendar';
import EventService from '@/server/calendar/service/events';
import type MediaInterface from '@/server/media/interface';

describe('createEvent', () => {
  let service: EventService;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  const cal = new Calendar('testCalendarId', 'testme');
  const acct = new Account('testAccountId', 'testme', 'testme');
  let editableCalendarsStub: sinon.SinonStub;

  beforeEach(() => {
    service = new EventService(new EventEmitter());
    editableCalendarsStub = sandbox.stub(service['calendarService'], 'editableCalendarsForUser');
    editableCalendarsStub.resolves([cal]);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should create an event with content', async () => {
    let saveStub = sandbox.stub(EventEntity.prototype, 'save');
    let findCalendarStub = sandbox.stub(service['calendarService'], 'getCalendar');
    let saveContentStub = sandbox.stub(EventContentEntity.prototype, 'save');
    let eventSpy = sandbox.spy(EventEntity, 'fromModel');
    let contentSpy = sandbox.spy(EventContentEntity, 'fromModel');

    findCalendarStub.resolves(cal);

    let event = await service.createEvent(acct, {
      calendarId: cal.id,
      content: {
        en: {
          name: "testName",
          description: "description",
        },
      },
    });

    expect(event.id).toBeDefined();
    // event.id should now be a UUID
    expect(event.id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
    // event.eventSourceUrl should be a relative path with calendar urlName and event UUID
    expect(event.eventSourceUrl).toMatch(/^\/testme\/[a-f0-9-]+$/);
    expect(eventSpy.returnValues[0].calendar_id).toBe(cal.id);
    expect(contentSpy.returnValues[0].event_id).toBe(event.id);
    expect(event.content("en").name).toBe('testName');
    expect(saveStub.called).toBe(true);
    expect(saveContentStub.called).toBe(true);
  });

  it('should create an event with a location', async () => {
    let saveStub = sandbox.stub(EventEntity.prototype, 'save');
    let findCalendarStub = sandbox.stub(service['calendarService'], 'getCalendar');
    let findLocationStub = sandbox.stub(service['locationService'], 'findOrCreateLocation');
    let eventSpy = sandbox.spy(EventEntity, 'fromModel');

    findCalendarStub.resolves(cal);
    findLocationStub.resolves(new EventLocation('testId','testLocation', 'testAddress'));

    let event = await service.createEvent(acct, {
      calendarId: cal.id,
      location: {
        name: "testLocation",
        address: "testAddress",
      },
    });

    expect(event.id).toBeDefined();
    expect(eventSpy.returnValues[0].calendar_id).toBe(cal.id);
    expect(event.location).toBeDefined();
    expect(saveStub.called).toBe(true);
  });

  it('should create an event with a schedule', async () => {
    let saveStub = sandbox.stub(EventEntity.prototype, 'save');
    let findCalendarStub = sandbox.stub(service['calendarService'], 'getCalendar');
    let saveScheduleStub = sandbox.stub(EventScheduleEntity.prototype, 'save');

    findCalendarStub.resolves(cal);
    const when = DateTime.now();

    let event = await service.createEvent(acct, {
      calendarId: cal.id,
      schedules: [{ start: when.toString() }],
    });

    expect(event.id).toBeDefined();
    expect(event.schedules.length).toBe(1);
    expect(event.schedules[0].startDate?.toString() === when.toString()).toBeTruthy();
    expect(saveStub.called).toBe(true);
    expect(saveScheduleStub.called).toBe(true);
  });

});

describe('createEvent with mediaId', () => {
  let service: EventService;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  const cal = new Calendar('testCalendarId', 'testme');
  const acct = new Account('testAccountId', 'testme', 'testme');
  let mockMediaInterface: { getMediaById: sinon.SinonStub };

  beforeEach(() => {
    service = new EventService(new EventEmitter());
    sandbox.stub(service['calendarService'], 'editableCalendarsForUser').resolves([cal]);
    sandbox.stub(service['calendarService'], 'getCalendar').resolves(cal);
    sandbox.stub(EventEntity.prototype, 'save').resolves();

    mockMediaInterface = { getMediaById: sandbox.stub() };
    service.setMediaInterface(mockMediaInterface as unknown as MediaInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should attach media when mediaId belongs to the same calendar', async () => {
    const media = new Media('mediaId1', 'testCalendarId', 'abc123', 'photo.jpg', 'image/jpeg', 1024);
    mockMediaInterface.getMediaById.resolves(media);

    const event = await service.createEvent(acct, {
      calendarId: cal.id,
      mediaId: 'mediaId1',
    });

    expect(mockMediaInterface.getMediaById.calledWith('mediaId1')).toBe(true);
    expect(event.media).toBe(media);
  });

  it('should throw an error when mediaId belongs to a different calendar', async () => {
    const media = new Media('mediaId1', 'otherCalendarId', 'abc123', 'photo.jpg', 'image/jpeg', 1024);
    mockMediaInterface.getMediaById.resolves(media);

    await expect(service.createEvent(acct, {
      calendarId: cal.id,
      mediaId: 'mediaId1',
    })).rejects.toThrow('Media not found or does not belong to this calendar');
  });

  it('should throw an error when mediaId is not found', async () => {
    mockMediaInterface.getMediaById.resolves(null);

    await expect(service.createEvent(acct, {
      calendarId: cal.id,
      mediaId: 'nonexistentMediaId',
    })).rejects.toThrow('Media not found or does not belong to this calendar');
  });

});

describe('createEvent Space/Place invariant', () => {
  let service: EventService;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  const cal = new Calendar('testCalendarId', 'testme');
  const acct = new Account('testAccountId', 'testme', 'testme');

  beforeEach(() => {
    service = new EventService(new EventEmitter());
    sandbox.stub(service['calendarService'], 'editableCalendarsForUser').resolves([cal]);
    sandbox.stub(service['calendarService'], 'getCalendar').resolves(cal);
    sandbox.stub(EventEntity.prototype, 'save').resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('rejects event create with mismatched (locationId, spaceId)', async () => {
    // Place A has a Space; the create tries to attach that Space to Place B.
    const placeAId = '22222222-2222-4222-8222-222222222222';
    const placeBId = '33333333-3333-4333-8333-333333333333';
    const spaceUnderAId = '44444444-4444-4444-8444-444444444444';

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
      await service.createEvent(acct, {
        calendarId: cal.id,
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

  it('rejects event create when spaceId is set but the Space row is missing', async () => {
    const placeBId = '33333333-3333-4333-8333-333333333333';
    const missingSpaceId = '55555555-5555-4555-8555-555555555555';

    const findLocationByIdStub = sandbox.stub(service['locationService'], 'getLocationById');
    findLocationByIdStub.resolves(new EventLocation(placeBId, 'placeB', 'address'));

    const findSpaceStub = sandbox.stub(LocationSpaceEntity, 'findByPk');
    findSpaceStub.resolves(null);

    let thrown: unknown = null;
    try {
      await service.createEvent(acct, {
        calendarId: cal.id,
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

  it('persists space_id on create when (locationId, spaceId) match', async () => {
    const placeId = '66666666-6666-4666-8666-666666666666';
    const spaceId = '77777777-7777-4777-8777-777777777777';

    const findLocationByIdStub = sandbox.stub(service['locationService'], 'getLocationById');
    findLocationByIdStub.resolves(new EventLocation(placeId, 'place', 'address'));

    const findSpaceStub = sandbox.stub(LocationSpaceEntity, 'findByPk');
    findSpaceStub.resolves(LocationSpaceEntity.build({
      id: spaceId,
      place_id: placeId,
    }) as unknown as LocationSpaceEntity);

    const eventSpy = sandbox.spy(EventEntity, 'fromModel');

    await service.createEvent(acct, {
      calendarId: cal.id,
      locationId: placeId,
      spaceId: spaceId,
    });

    // The built EventEntity should carry the supplied space_id at save time.
    const built = eventSpy.returnValues[0];
    expect(built.space_id).toBe(spaceId);
    expect(built.location_id).toBe(placeId);
  });

  // Regression — Wave 6 IDOR fix.
  // Before the fix, the (locationId && spaceId) gate skipped validation when
  // only spaceId was provided, allowing an attacker-supplied foreign spaceId
  // to be written to event.space_id without any parent-place check.
  it('rejects event create when spaceId is supplied without any parent location', async () => {
    const orphanSpaceId = '88888888-8888-4888-8888-888888888888';

    // No location resolution path is exercised — the request supplies neither
    // locationId nor an embedded location object. Stub Space lookup so we can
    // assert it is NOT consulted (validation should reject before that point).
    const findSpaceStub = sandbox.stub(LocationSpaceEntity, 'findByPk');

    let thrown: unknown = null;
    try {
      await service.createEvent(acct, {
        calendarId: cal.id,
        spaceId: orphanSpaceId,
      });
    }
    catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(SpaceLocationMismatchError);
    const err = thrown as SpaceLocationMismatchError;
    expect(err.spaceId).toBe(orphanSpaceId);
    // No Space lookup should have happened — the early reject fires first.
    expect(findSpaceStub.called).toBe(false);
  });

  it('validates spaceId against embedded location.id when locationId is omitted', async () => {
    // Embedded location flows through findOrCreateLocation, which sets
    // eventEntity.location_id. The Space invariant must run against that
    // resolved id even though the request did not supply locationId directly.
    const placeAId = '22222222-2222-4222-8222-222222222222';
    const spaceUnderBId = '99999999-9999-4999-8999-999999999999';
    const placeBId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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
      await service.createEvent(acct, {
        calendarId: cal.id,
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
