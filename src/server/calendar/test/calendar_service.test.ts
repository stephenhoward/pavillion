import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import CalendarService from '@/server/calendar/service/calendar';


describe('isValidUrlName', () => {

    let sandbox = sinon.createSandbox();

    afterEach(() => {
        sandbox.restore();
    });

    it('should return false if urlName is invalid', async () => {
        const tests: [string,boolean][] = [
            ['_noleadunderscore', false],
            ['thisisamuchtoolongusername', false],
            ['no spaces allowed', false],
            ['illegal@character', false],
            ['legalusername', true],
            ['9alsolegal', true],
            ['alsolegal_', true]
        ]
        for( let test of tests) {
            expect(CalendarService.isValidUrlName(test[0])).toBe(test[1]);
        }
    });
});

describe('setUrlName', () => {
    let sandbox: sinon.SinonSandbox = sinon.createSandbox();
    let editableCalendarsStub: sinon.SinonStub;
    let cal: Calendar;
    let acct: Account;

    beforeEach(() => {
        cal = new Calendar('testCalendarId', 'testme');
        acct = new Account('testAccountId', 'testme', 'testme');
        editableCalendarsStub = sandbox.stub(CalendarService, 'userCanModifyCalendar');
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('should skip permission check if user is admin', async () => {
        const calendarFindStub = sandbox.stub(CalendarEntity, 'findByPk');
        const calendarCheckStub = sandbox.stub(CalendarEntity, 'findOne');
        const calendarUpdateStub = sandbox.stub(CalendarEntity.prototype, 'update');
        calendarFindStub.resolves(CalendarEntity.fromModel(cal));

        acct.roles = ['admin'];
        await CalendarService.setUrlName(acct, cal, 'validname');

        expect(editableCalendarsStub.called).toBe(false);
        expect(calendarUpdateStub.called).toBe(true);
    });

    it('should fail if user not allowed to edit calendar', async () => {
        editableCalendarsStub.resolves(false);
        await expect( () => CalendarService.setUrlName(acct, cal, 'validname') ).rejects.toThrowError('Permission denied');
        expect(editableCalendarsStub.called).toBe(true);
    });

    it('should throw an error if urlName is invalid', async () => {
        editableCalendarsStub.resolves(true);
        await expect( () => CalendarService.setUrlName(acct, cal, '_noleadunderscore') ).rejects.toThrowError('Invalid url name');
    });

    it('should throw an error if urlName already exists', async () => {
        const calendarFindStub = sandbox.stub(CalendarEntity, 'findByPk');
        const calendarCheckStub = sandbox.stub(CalendarEntity, 'findOne');
        const calendarUpdateStub = sandbox.stub(CalendarEntity.prototype, 'update');
        calendarFindStub.resolves(CalendarEntity.fromModel(cal));
        calendarCheckStub.resolves({ id: 'otherCalendarId', url_name: 'validname' });
        editableCalendarsStub.resolves(true);

        await expect( () => CalendarService.setUrlName(acct, cal, 'validname') ).rejects.toThrowError('url name already exists');
    });

    it('should throw an error if calendar not found', async () => {
        const calendarFindStub = sandbox.stub(CalendarEntity, 'findByPk');
        const calendarCheckStub = sandbox.stub(CalendarEntity, 'findOne');
        const calendarUpdateStub = sandbox.stub(CalendarEntity.prototype, 'update');
        calendarFindStub.resolves(null);
        editableCalendarsStub.resolves(true);

        await expect( () => CalendarService.setUrlName(acct, cal, 'validname') ).rejects.toThrowError('Calendar not found');
    });

    it('should return without work if name already matches', async () => {
        cal.urlName = 'validname';

        const calendarFindStub = sandbox.stub(CalendarEntity, 'findByPk');
        const calendarCheckStub = sandbox.stub(CalendarEntity, 'findOne');
        const calendarUpdateStub = sandbox.stub(CalendarEntity.prototype, 'update');
        calendarFindStub.resolves(CalendarEntity.fromModel(cal));
        calendarCheckStub.resolves(undefined);
        editableCalendarsStub.resolves(true);
        
        await CalendarService.setUrlName(acct, cal, 'validname');
        expect(calendarUpdateStub.called).toBe(false);
    });

    it('should update url name of calendar', async () => {
        const calendarFindStub = sandbox.stub(CalendarEntity, 'findByPk');
        const calendarCheckStub = sandbox.stub(CalendarEntity, 'findOne');
        const calendarUpdateStub = sandbox.stub(CalendarEntity.prototype, 'update');
        calendarFindStub.resolves(CalendarEntity.fromModel(cal));
        calendarCheckStub.resolves(undefined);
        editableCalendarsStub.resolves(true);
        
        await CalendarService.setUrlName(acct, cal, 'validname');

        expect(calendarUpdateStub.calledWith({ url_name: 'validname' })).toBe(true);
        expect(cal.urlName).toBe('validname');
    });

});
