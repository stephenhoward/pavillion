import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import CommonAccountService from '../../common/service/accounts';
import EventService from '../service/events';
import { EventEntity, EventContentEntity } from '../../common/entity/event';
import { Account } from '../../../common/model/account';
import { AccountAlreadyExistsError, AccountInviteAlreadyExistsError, AccountRegistrationClosedError, AccountApplicationAlreadyExistsError, AccountApplicationsClosedError, noAccountInviteExistsError, noAccountApplicationExistsError } from '../../exceptions/account_exceptions';

describe('listEvents', () => {

    let sandbox = sinon.createSandbox();

    afterEach(() => {
        sandbox.restore();
    });

    it('should return 0 events', async () => {
        let findEventsStub = sandbox.stub(EventEntity, 'findAll');
        findEventsStub.resolves([]);

        let events = await EventService.listEvents(new Account('id', 'testme', 'testme'));
        expect(events).toEqual([]);
    });

    it('should return 1 event', async () => {
        let findEventsStub = sandbox.stub(EventEntity, 'findAll');
        findEventsStub.resolves([new EventEntity()]);

        let events = await EventService.listEvents(new Account('id', 'testme', 'testme'));
        expect(events.length).toBe(1);
        expect(events[0].content("en").name).toBe('');
    });

    it('should return an event with content', async () => {
        let findEventsStub = sandbox.stub(EventEntity, 'findAll');
        let entity = EventEntity.build({ accountId: 'id' });
        entity.content = [ EventContentEntity.build({language: "en", name: "testName", description: "description"}) ];
        findEventsStub.resolves([entity]);

        let events = await EventService.listEvents(new Account('id', 'testme', 'testme'));
        expect(events[0].content("en").name).toBe('testName');
    });

});

describe('createEvent', () => {

    let sandbox = sinon.createSandbox();

    afterEach(() => {
        sandbox.restore();
    });

    it('should create an event with content', async () => {
        let saveStub = sandbox.stub(EventEntity.prototype, 'save');
        let saveContentStub = sandbox.stub(EventContentEntity.prototype, 'save');
        let eventSpy = sandbox.spy(EventEntity, 'fromModel');
        let contentSpy = sandbox.spy(EventContentEntity, 'fromModel');

        let event = await EventService.createEvent(new Account('testAccountId', 'testme', 'testme'), {
            content: {
                en: {
                    name: "testName",
                    description: "description"
                }
            }
        });

        expect(event.id).toBeDefined();
        expect(eventSpy.returnValues[0].accountId).toBe('testAccountId');
        expect(contentSpy.returnValues[0].event_id).toBe(event.id);
        expect(event.content("en").name).toBe('testName');
        expect(saveStub.called).toBe(true);
        expect(saveContentStub.called).toBe(true);
    });

});

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
        let saveContentStub = sandbox.stub(EventContentEntity.prototype, 'save');

        findEventStub.resolves(new EventEntity({ accountId: 'testAccountId' }));
        findEventContentStub.resolves(new EventContentEntity({ event_id: 'testEventId', language: 'en' }));

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


});
