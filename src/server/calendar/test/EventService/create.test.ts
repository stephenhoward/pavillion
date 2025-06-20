import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { DateTime } from 'luxon';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { EventLocation } from '@/common/model/location';
import { EventEntity, EventContentEntity, EventScheduleEntity } from '@/server/calendar/entity/event';
import EventService from '@/server/calendar/service/events';

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
    expect(event.id).toMatch(/^https:\/\/pavillion.dev\/events\/[a-z0-9-]+$/);
    expect(eventSpy.returnValues[0].calendar_id).toBe('testCalendarId');
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
    expect(eventSpy.returnValues[0].calendar_id).toBe('testCalendarId');
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
