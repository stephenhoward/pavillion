import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { DateTime } from 'luxon';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { CalendarEventContent, CalendarEventSchedule, language, EventFrequency } from '@/common/model/events';
import { EventLocation } from '@/common/model/location';
import { EventEntity, EventContentEntity, EventScheduleEntity } from '@/server/calendar/entity/event';
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

  // TODO: test replacing an event schedule with another one
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
