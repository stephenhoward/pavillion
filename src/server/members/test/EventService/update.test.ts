import { describe, it, expect, afterEach } from 'vitest';
import sinon from 'sinon';

import { CalendarEventContent, language } from '../../../../common/model/events';
import { Account } from '../../../../common/model/account';
import { EventLocation } from '../../../../common/model/location';
import { EventEntity, EventContentEntity } from '../../../common/entity/event';
import EventService from '../../service/events';
import LocationService from '../../service/locations';

describe('updateEvent', () => {

    let sandbox = sinon.createSandbox();

    afterEach(() => {
        sandbox.restore();
    });

    it('should throw an error if event not found', async () => {
        let findEventStub = sandbox.stub(EventEntity, 'findByPk');
        findEventStub.resolves(undefined);

        await expect(EventService.updateEvent(new Account('testAccountId', 'testme', 'testme'), 'testEventId', {
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

        await expect(EventService.updateEvent(new Account('testAccountId', 'testme', 'testme'), 'testEventId', {
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

        let updatedEvent = await EventService.updateEvent(new Account('testAccountId', 'testme', 'testme'), 'testEventId', {
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

        let updatedEvent = await EventService.updateEvent(new Account('testAccountId', 'testme', 'testme'), 'testEventId', {
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

        let updatedEvent = await EventService.updateEvent(new Account('testAccountId', 'testme', 'testme'), 'testEventId', {
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

        let updatedEvent = await EventService.updateEvent(new Account('testAccountId', 'testme', 'testme'), 'testEventId', {
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
        let createContentStub = sandbox.stub(EventService, 'createEventContent');

        findEventStub.resolves(EventEntity.build({ account_id: 'testAccountId' }));
        findEventContentStub.resolves(undefined);
        createContentStub.resolves(new CalendarEventContent(language.EN, 'updatedName', 'updatedDescription'));

        let updatedEvent = await EventService.updateEvent(new Account('testAccountId', 'testme', 'testme'), 'testEventId', {
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

    it('should add a location to an event', async () => {
        let findEventStub = sandbox.stub(EventEntity, 'findByPk');
        let saveEventStub = sandbox.stub(EventEntity.prototype, 'save');
        let findLocationStub = sandbox.stub(LocationService, 'findOrCreateLocation');

        findEventStub.resolves(EventEntity.build({ account_id: 'testAccountId' }));
        findLocationStub.resolves(new EventLocation('testId','testLocation', 'testAddress'));

        let updatedEvent = await EventService.updateEvent(new Account('testAccountId', 'testme', 'testme'), 'testEventId', {
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

        let updatedEvent = await EventService.updateEvent(new Account('testAccountId', 'testme', 'testme'), 'testEventId', {});

        expect(saveEventStub.called).toBe(true);
        expect(findLocationStub.called).toBe(false);
        expect(updatedEvent.location).toBeNull();
        expect(eventEntity.location_id).toBe('');
    });


});
