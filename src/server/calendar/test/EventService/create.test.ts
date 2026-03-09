import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { DateTime } from 'luxon';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { EventLocation } from '@/common/model/location';
import { Media } from '@/common/model/media';
import { EventEntity, EventContentEntity, EventScheduleEntity } from '@/server/calendar/entity/event';
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
