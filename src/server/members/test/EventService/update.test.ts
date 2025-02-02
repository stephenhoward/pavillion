import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { DateTime } from 'luxon';

import { Account } from '@/common/model/account';
import { CalendarEventContent, CalendarEventSchedule, language, EventFrequency } from '@/common/model/events';
import { EventLocation } from '@/common/model/location';
import { EventEntity, EventContentEntity, EventScheduleEntity } from '@/server/common/entity/event';
import EventService from '@/server/members/service/events';
import LocationService from '@/server/members/service/locations';

describe('updateEvent with content', () => {
    let service: EventService
    let sandbox = sinon.createSandbox();

    beforeEach(() => {
        service = new EventService();
    })
    afterEach(() => {
        sandbox.restore();
    });

    it('should throw an error if event not found', async () => {
        let findEventStub = sandbox.stub(EventEntity, 'findByPk');
        findEventStub.resolves(undefined);

        await expect(service.updateEvent(new Account('testAccountId', 'testme', 'testme'), 'testEventId', {
            content: {
                en: {
                    name: "testName",
                    description: "description"
                }
            }
        })).rejects.toThrow('Event not found');
    });

    it('should throw an error if account does not own event', async () => {
        let findEventStub = sandbox.stub(EventEntity, 'findByPk');
        findEventStub.resolves(new EventEntity({ accountId: 'notTestAccountId' }));

        await expect(service.updateEvent(new Account('testAccountId', 'testme', 'testme'), 'testEventId', {
            content: {
                en: {
                    name: "testName",
                    description: "description"
                }
            }
        })).rejects.toThrow('account does not own event');
    });

    it('should update an event', async () => {
        let findEventStub = sandbox.stub(EventEntity, 'findByPk');
        let findEventContentStub = sandbox.stub(EventContentEntity, 'findOne');
        let saveEventStub = sandbox.stub(EventEntity.prototype, 'save');
        let saveContentStub = sandbox.stub(EventContentEntity.prototype, 'save');

        findEventStub.resolves(EventEntity.build({ account_id: 'testAccountId' }));
        findEventContentStub.resolves(EventContentEntity.build({ event_id: 'testEventId', language: 'en' }));

        let updatedEvent = await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), 'testEventId', {
            content: {
                en: {
                    name: "updatedName",
                    description: "updatedDescription"
                }
            }
        });

        expect(updatedEvent.content("en").name).toBe('updatedName');
        expect(updatedEvent.content("en").description).toBe('updatedDescription');
        expect(saveContentStub.called).toBe(true);
    });

    it('should delete event content if given empty data', async () => {
        let findEventStub = sandbox.stub(EventEntity, 'findByPk');
        let saveEventStub = sandbox.stub(EventEntity.prototype, 'save');
        let findEventContentStub = sandbox.stub(EventContentEntity, 'findOne');
        let destroyContentStub = sandbox.stub(EventContentEntity.prototype, 'destroy');

        findEventStub.resolves(EventEntity.build({ account_id: 'testAccountId' }));
        findEventContentStub.resolves(EventContentEntity.build({ event_id: 'testEventId', language: 'en' }));

        let updatedEvent = await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), 'testEventId', {
            content: {
                en: {}
            }
        });

        expect(updatedEvent.content("en").isEmpty()).toBe(true);
        expect(destroyContentStub.called).toBe(true);
    });

    it('should delete event content if given empty data except for language', async () => {
        let findEventStub = sandbox.stub(EventEntity, 'findByPk');
        let saveEventStub = sandbox.stub(EventEntity.prototype, 'save');
        let findEventContentStub = sandbox.stub(EventContentEntity, 'findOne');
        let destroyContentStub = sandbox.stub(EventContentEntity.prototype, 'destroy');

        findEventStub.resolves(EventEntity.build({ account_id: 'testAccountId' }));
        findEventContentStub.resolves(EventContentEntity.build({ event_id: 'testEventId', language: 'en' }));

        let updatedEvent = await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), 'testEventId', {
            content: {
                en: { language: 'en'}
            }
        });

        expect(updatedEvent.content("en").isEmpty()).toBe(true);
        expect(destroyContentStub.called).toBe(true);
    });

    it('should delete event content if given undefined data', async () => {
        let findEventStub = sandbox.stub(EventEntity, 'findByPk');
        let saveEventStub = sandbox.stub(EventEntity.prototype, 'save');
        let findEventContentStub = sandbox.stub(EventContentEntity, 'findOne');
        let destroyContentStub = sandbox.stub(EventContentEntity.prototype, 'destroy');

        findEventStub.resolves(EventEntity.build({ account_id: 'testAccountId' }));
        findEventContentStub.resolves(EventContentEntity.build({ event_id: 'testEventId', language: 'en' }));

        let updatedEvent = await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), 'testEventId', {
            content: {
                en: undefined
            }
        });

        expect(updatedEvent.content("en").isEmpty()).toBe(true);
        expect(destroyContentStub.called).toBe(true);
    })

    it('should create event content if not found', async () => {
        let findEventStub = sandbox.stub(EventEntity, 'findByPk');
        let saveEventStub = sandbox.stub(EventEntity.prototype, 'save');
        let findEventContentStub = sandbox.stub(EventContentEntity, 'findOne');
        let createContentStub = sandbox.stub(service, 'createEventContent');

        findEventStub.resolves(EventEntity.build({ account_id: 'testAccountId' }));
        findEventContentStub.resolves(undefined);
        createContentStub.resolves(new CalendarEventContent(language.EN, 'updatedName', 'updatedDescription'));

        let updatedEvent = await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), 'testEventId', {
            content: {
                en: {
                    name: "updatedName",
                    description: "updatedDescription"
                }
            }
        });

        expect(updatedEvent.content("en").name).toBe('updatedName');
        expect(updatedEvent.content("en").description).toBe('updatedDescription');
        expect(createContentStub.called).toBe(true);
    });

});

describe('updateEvent with location', () => {
    let service: EventService;
    let sandbox = sinon.createSandbox();

    beforeEach(() => {
        service = new EventService();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('should add a location to an event', async () => {
        let findEventStub = sandbox.stub(EventEntity, 'findByPk');
        let saveEventStub = sandbox.stub(EventEntity.prototype, 'save');
        let findLocationStub = sandbox.stub(LocationService, 'findOrCreateLocation');

        findEventStub.resolves(EventEntity.build({ account_id: 'testAccountId' }));
        findLocationStub.resolves(new EventLocation('testId','testLocation', 'testAddress'));

        let updatedEvent = await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), 'testEventId', {
            location: {
                name: "testLocation",
                address: "testAddress"
            }
        });

        expect(saveEventStub.called).toBe(true);
        expect(findLocationStub.called).toBe(true);
        expect(updatedEvent.location).toBeDefined();
        expect(updatedEvent.location?.id === 'testId');
    });

    it('should clear location from an event', async () => {

        let eventEntity = EventEntity.build({ account_id: 'testAccountId', location_id: 'testLocationId' });

        let findEventStub = sandbox.stub(EventEntity, 'findByPk');
        let saveEventStub = sandbox.stub(EventEntity.prototype, 'save');
        let findLocationStub = sandbox.stub(LocationService, 'findOrCreateLocation');

        findEventStub.resolves(eventEntity);
        findLocationStub.resolves(new EventLocation('testId','testLocation', 'testAddress'));

        let updatedEvent = await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), 'testEventId', {});

        expect(saveEventStub.called).toBe(true);
        expect(findLocationStub.called).toBe(false);
        expect(updatedEvent.location).toBeNull();
        expect(eventEntity.location_id).toBe('');
    });


});

describe('updateEvent with schedules', () => {
    let service: EventService;
    let sandbox = sinon.createSandbox();

    beforeEach(() => {
        service = new EventService();
    });
    afterEach(() => {
        sandbox.restore();
    });

    it('should add a schedule to an event', async () => {
        let findEventStub = sandbox.stub(EventEntity, 'findByPk');
        let saveEventStub = sandbox.stub(EventEntity.prototype, 'save');
        let createScheduleStub = sandbox.stub(service, 'createEventSchedule');
        let findSchedulesStub = sandbox.stub(EventScheduleEntity, 'findAll');

        findEventStub.resolves(EventEntity.build({ account_id: 'testAccountId', id: 'testEventId' }));
        createScheduleStub.resolves(new CalendarEventSchedule('testScheduleId', DateTime.now(), DateTime.now().plus({days: 12})));
        findSchedulesStub.resolves([]);

        let updatedEvent = await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), 'testEventId', {
            schedules: [
                {
                    start: new Date(),
                    end: new Date()
                }
            ]
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

        findEventStub.resolves(EventEntity.build({ account_id: 'testAccountId', id: 'testEventId' }));
        findSchedulesStub.resolves([ EventScheduleEntity.build({ event_id: 'testEventId', id: 'testScheduleId' }) ]);

        let updatedEvent = await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), 'testEventId', {
            schedules: []
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

        findEventStub.resolves(EventEntity.build({ account_id: 'testAccountId', id: 'testEventId' }));
        findSchedulesStub.resolves([ scheduleEntity ]);
        updateScheduleStub.callsFake(async (params) => {
            for (let key in params) {
                scheduleEntity.set(key, params[key]);
            }

            return scheduleEntity;
        });

        let updatedEvent = await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), 'testEventId', {
            schedules: [
                {
                    id: 'testScheduleId',
                    frequency: EventFrequency.DAILY,
                }
            ]
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

        findEventStub.resolves(EventEntity.build({ account_id: 'testAccountId', id: 'testEventId' }));
        findSchedulesStub.resolves([ scheduleEntity ]);
        createScheduleStub.resolves(new CalendarEventSchedule('otherTestScheduleId', DateTime.now(), DateTime.now().plus({days: 12})));

        let updatedEvent = await service.updateEvent(new Account('testAccountId', 'testme', 'testme'), 'testEventId', {
            schedules: [ {
                start: new Date(),
                end: new Date()
            } ]
        });

        expect(saveEventStub.called).toBe(true);
        expect(createScheduleStub.called).toBe(true);
        expect(destroySchedulesStub.called).toBe(true);
        expect(updatedEvent.schedules.length).toBe(1);
        expect(updatedEvent.schedules[0].id).toBe('otherTestScheduleId');

    });

});
