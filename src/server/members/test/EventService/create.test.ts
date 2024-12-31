import { describe, it, expect, afterEach } from 'vitest';
import sinon from 'sinon';
import { DateTime } from 'luxon';

import { Account } from '@/common/model/account';
import { EventLocation } from '@/common/model/location';
import { EventEntity, EventContentEntity, EventScheduleEntity } from '@/server/common/entity/event';
import EventService from '@/server/members/service/events';
import LocationService from '@/server/members/service/locations';

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
        expect(eventSpy.returnValues[0].account_id).toBe('testAccountId');
        expect(contentSpy.returnValues[0].event_id).toBe(event.id);
        expect(event.content("en").name).toBe('testName');
        expect(saveStub.called).toBe(true);
        expect(saveContentStub.called).toBe(true);
    });

    it('should create an event with a location', async () => {
        let saveStub = sandbox.stub(EventEntity.prototype, 'save');
        let findLocationStub = sandbox.stub(LocationService, 'findOrCreateLocation');
        let eventSpy = sandbox.spy(EventEntity, 'fromModel');

        findLocationStub.resolves(new EventLocation('testId','testLocation', 'testAddress'));

        let event = await EventService.createEvent(new Account('testAccountId', 'testme', 'testme'), {
            location: {
                name: "testLocation",
                address: "testAddress"
            }
        });

        expect(event.id).toBeDefined();
        expect(eventSpy.returnValues[0].account_id).toBe('testAccountId');
        expect(event.location).toBeDefined();
        expect(saveStub.called).toBe(true);
    })

    it('should create an event with a schedule', async () => {
        let saveStub = sandbox.stub(EventEntity.prototype, 'save');
        let saveScheduleStub = sandbox.stub(EventScheduleEntity.prototype, 'save');

        const when = DateTime.now();

        let event = await EventService.createEvent(new Account('testAccountId', 'testme', 'testme'), {
            schedules: [{ start: when.toString() }]
        });

        expect(event.id).toBeDefined();
        expect(event.schedules.length).toBe(1);
        expect(event.schedules[0].startDate?.toString() === when.toString()).toBeTruthy();
        expect(saveStub.called).toBe(true);
        expect(saveScheduleStub.called).toBe(true);
    });

});
