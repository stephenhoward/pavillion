import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Calendar } from '@/common/model/calendar';
import CalendarService from '@/server/calendar/service/calendar';
import ProcessOutboxService from '@/server/activitypub/service/outbox';
import { EventActivityEntity, ActivityPubOutboxMessageEntity, FollowerCalendarEntity } from '@/server/activitypub/entity/activitypub';


describe('resolveInbox', () => {
    let service: ProcessOutboxService;
    let sandbox: sinon.SinonSandbox = sinon.createSandbox();

    beforeEach (() => {
        service = new ProcessOutboxService();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('should return null without profile url', async () => {
        let profileStub = sandbox.stub(service,'fetchProfileUrl');
        profileStub.resolves(null);

        let result = await service.resolveInboxUrl('remotecalendar@remotedomain');
        expect(result).toBeNull();
    });

    it('should return null without profile response', async () => {
        let profileStub = sandbox.stub(service,'fetchProfileUrl');
        profileStub.resolves('https://remotedomain/o/testcalendar');

        let getStub = sandbox.stub(axios,'get');
        getStub.resolves(null);

        let result = await service.resolveInboxUrl('remotecalendar@remotedomain');
        expect(result).toBeNull();
    });

    it('should return a url for inbox', async () => {
        let profileStub = sandbox.stub(service,'fetchProfileUrl');
        profileStub.resolves('https://remotedomain/o/testcalendar');

        let getStub = sandbox.stub(axios,'get');
        getStub.resolves({ data: { inbox: 'https://remotedomain/o/testcalendar/inbox' } });

        let result = await service.resolveInboxUrl('remotecalendar@remotedomain');
        expect(result).toBe('https://remotedomain/o/testcalendar/inbox');
    });
});

describe('fetchProfileUrl', () => {
    let service: ProcessOutboxService;
    let sandbox: sinon.SinonSandbox = sinon.createSandbox();

    beforeEach (() => {
        service = new ProcessOutboxService();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('should return null without webfinger response', async () => {
        let getStub = sandbox.stub(axios,'get');
        getStub.resolves(null);

        let result = await service.fetchProfileUrl('remotecalendar@remotedomain');
        expect(result).toBeNull();
    });

    it('should return null without profile link', async () => {
        let getStub = sandbox.stub(axios,'get');
        getStub.resolves({ data: { links: [] } });

        let result = await service.fetchProfileUrl('remotecalendar@remotedomain');
        expect(result).toBeNull();
    });

    it('should return a url for profile', async () => {
        let getStub = sandbox.stub(axios,'get');
        getStub.resolves({ data: { links: [ { rel:'self', href:'https://remotedomain/o/testcalendar' } ] } });

        let result = await service.fetchProfileUrl('remotecalendar@remotedomain');
        expect(result).toBe('https://remotedomain/o/testcalendar');
    });
});

describe ('getRecipients', () => {
    let service: ProcessOutboxService;
    let sandbox: sinon.SinonSandbox = sinon.createSandbox();

    beforeEach (() => {
        service = new ProcessOutboxService();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('should return an empty array with no followers or observers', async () => {
        let followersStub = sandbox.stub(FollowerCalendarEntity,'findAll');
        followersStub.resolves([]);

        let observersStub = sandbox.stub(EventActivityEntity,'findAll');
        observersStub.resolves([]);

        let result = await service.getRecipients(Calendar.fromObject({ id: 'testid' }),{ id: 'testobject' });
        expect(result).toStrictEqual([]);
    });

    it('should return an array with followers and observers', async () => {
        let followersStub = sandbox.stub(FollowerCalendarEntity,'findAll');
        followersStub.resolves([ FollowerCalendarEntity.build({ remote_calendar_id: 'remotecalendar@remotedomain' }) ]);

        let observersStub = sandbox.stub(EventActivityEntity,'findAll');
        observersStub.resolves([ EventActivityEntity.build({ remote_calendar_id: 'observercalendar@observerdomain' }) ]);

        let result = await service.getRecipients(Calendar.fromObject({ id: 'testid' }),{ id: 'testobject' });
        expect(result).toStrictEqual(['remotecalendar@remotedomain','observercalendar@observerdomain']);
    });
});

describe('processOutboxMessage', () => {
    let service: ProcessOutboxService;
    let sandbox: sinon.SinonSandbox = sinon.createSandbox();

    beforeEach (() => {
        service = new ProcessOutboxService();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('should fail without calendar', async () => {
        let message = ActivityPubOutboxMessageEntity.build({ calendar_id: 'testid', type: 'Create', message: { to: 'remotecalendar@remotedomain' } });
        let getCalendarStub = sandbox.stub(CalendarService,'getCalendar');
        getCalendarStub.resolves(null);
        await expect(service.processOutboxMessage(message)).rejects.toThrow('No calendar found for message');

    });

    it('should skip invalid message type', async () => {
        let message = ActivityPubOutboxMessageEntity.build({ calendar_id: 'testid', type: 'NotAType', message: { to: 'remotecalendar@remotedomain' } });

        let getCalendarStub = sandbox.stub(CalendarService,'getCalendar');
        let postStub = sandbox.stub(axios,'post');
        let updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype,'update');

        getCalendarStub.resolves(Calendar.fromObject({ id: 'testid' }));

        await service.processOutboxMessage(message);

        expect(postStub.called).toBe(false);
        expect(updateStub.calledOnce).toBe(true);
        expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
        expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('bad message type');
    });

    it('should skip message without recipients', async () => {
        let message = ActivityPubOutboxMessageEntity.build({ calendar_id: 'testid', type: 'Create', message: { object: { id: 'testid' } } });

        let getCalendarStub = sandbox.stub(CalendarService,'getCalendar');
        let postStub = sandbox.stub(axios,'post');
        let updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype,'update');
        let getRecipientsStub = sandbox.stub(service,'getRecipients');
        let resolveStub = sandbox.stub(service,'resolveInboxUrl');

        getCalendarStub.resolves(Calendar.fromObject({ id: 'testid' }));
        getRecipientsStub.resolves([]);
        resolveStub.resolves(null);

        await service.processOutboxMessage(message);

        expect(postStub.called).toBe(false);
        expect(updateStub.calledOnce).toBe(true);
        expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
        expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
    });

    it('should skip recipients without inbox', async () => {
        let message = ActivityPubOutboxMessageEntity.build({ calendar_id: 'testid', type: 'Create', message: { object: { id: 'testid' } } });

        let getCalendarStub = sandbox.stub(CalendarService,'getCalendar');
        let postStub = sandbox.stub(axios,'post');
        let updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype,'update');
        let getRecipientsStub = sandbox.stub(service,'getRecipients');
        let resolveStub = sandbox.stub(service,'resolveInboxUrl');

        getCalendarStub.resolves(Calendar.fromObject({ id: 'testid' }));
        getRecipientsStub.resolves(['remotecalendar@remotedomain']);
        resolveStub.resolves(null);

        await service.processOutboxMessage(message);

        expect(postStub.called).toBe(false);
        expect(updateStub.calledOnce).toBe(true);
        expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
        expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
    });

    it('should send message to each recipient', async () => {
        let message = ActivityPubOutboxMessageEntity.build({ calendar_id: 'testid', type: 'Create', message: { object: { id: 'testid' } } });

        let getCalendarStub = sandbox.stub(CalendarService,'getCalendar');
        let postStub = sandbox.stub(axios,'post');
        let updateStub = sandbox.stub(ActivityPubOutboxMessageEntity.prototype,'update');
        let getRecipientsStub = sandbox.stub(service,'getRecipients');
        let resolveStub = sandbox.stub(service,'resolveInboxUrl');

        getCalendarStub.resolves(Calendar.fromObject({ id: 'testid' }));
        getRecipientsStub.resolves(['remotecalendar@remotedomain','observercalendar@observerdomain']);
        resolveStub.resolves('https://remotedomain/o/testcalendar/inbox');

        await service.processOutboxMessage(message);

        expect(postStub.calledTwice).toBe(true);
        expect(updateStub.calledOnce).toBe(true);
        expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
        expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
    });

});

describe('event listener', () => {
    let service: ProcessOutboxService;
    let source: EventEmitter;
    let sandbox: sinon.SinonSandbox = sinon.createSandbox();

    beforeEach (() => {
        service = new ProcessOutboxService();
        source = new EventEmitter();
        service.registerListeners(source);
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('should process message found in database', async () => {

        let processorStub = sandbox.stub(service,'processOutboxMessage');
        let entityStub = sandbox.stub(ActivityPubOutboxMessageEntity,'findByPk');
        entityStub.resolves(
            ActivityPubOutboxMessageEntity.build({
                calendar_id: 'testid', type: 'Create', message: { object: { id: 'testid' } }
            })
        );

        source.emit('outboxMessageAdded',{
            calendar_id: 'testid',
            type: 'Create',
            message: { object: { id: 'testid' } }
        });

        // wait for event to propogate:
        await new Promise(resolve => setTimeout(resolve, 100))

        expect(processorStub.calledOnce).toBe(true);
    });

    it('should ignore message not found in database', async () => {

        let processorStub = sandbox.stub(service,'processOutboxMessage');
        let entityStub = sandbox.stub(ActivityPubOutboxMessageEntity,'findByPk');
        entityStub.resolves(undefined);

        source.emit('outboxMessageAdded',{
            calendar_id: 'testid',
            type: 'Create',
            message: { object: { id: 'testid' } }
        });

        // wait for event to propogate:
        await new Promise(resolve => setTimeout(resolve, 100))

        expect(processorStub.calledOnce).toBe(false);
    });
});
