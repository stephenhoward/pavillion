import { v4 as uuidv4 } from 'uuid';

import { Calendar } from '@/common/model/calendar';
import { Account } from '@/common/model/account';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { UrlNameAlreadyExistsError, InvalidUrlNameError } from '@/server/calendar/exceptions';

class CalendarService {
    static async getCalendar(id: string): Promise<Calendar|null> {
        const calendar = await CalendarEntity.findByPk(id);
        return calendar ? calendar.toModel() : null;
    }

    static isValidUrlName(username: string): boolean {
        return username.match(/^[a-z0-9][a-z0-9_]{2,23}$/i) ? true : false;
    }

    static async setUrlName(account: Account, calendar: Calendar, urlName: string): Promise<boolean> {

        if ( ! account.hasRole('admin') ) {
            const canEditCalendar = await CalendarService.userCanModifyCalendar(account, calendar);
            if ( ! canEditCalendar ) {
                throw new Error('Permission denied');
            }
        }

        if ( ! CalendarService.isValidUrlName(urlName) ) {
            throw new InvalidUrlNameError();
        }

        let calendarEntity = await CalendarEntity.findByPk(calendar.id);
        if ( ! calendarEntity ) {
            throw new Error('Calendar not found');
        }

        if ( calendarEntity.url_name == urlName ) {
            return true;
        }

        let existingCalendar = await CalendarEntity.findOne({ where: { url_name: urlName } });

        if ( existingCalendar && existingCalendar.id != calendarEntity.id ) {
            throw new UrlNameAlreadyExistsError();
        }

        calendarEntity.update({ url_name: urlName });
        calendar.urlName = urlName;

        return true;
    }

    static async editableCalendarsForUser(account: Account): Promise<Calendar[]> {
        let calendars = await CalendarEntity.findAll({ where: { account_id: account.id } });
        return calendars.map((calendar) => calendar.toModel());
    }

    static async userCanModifyCalendar(account: Account, calendar: Calendar): Promise<boolean> {
        if ( ! account.hasRole('admin') ) {
            let calendars = await CalendarService.editableCalendarsForUser(account);
            if ( calendars.length == 0 ) {
                return false;
            }
            // check if the calendar is in the list of editable calendars
            return calendars.some((cal) => cal.id == calendar.id);
        }
        return true;
    }

    static async getCalendarByName(username: string): Promise<Calendar|null> {
        let calendar = await CalendarEntity.findOne({ where: { url_name: username } });
        return calendar ? calendar.toModel() : null;
    }

    static async createCalendarForUser(account: Account): Promise<Calendar> {
        let calendar = await CalendarEntity.create({ id: uuidv4(), account_id: account.id });
        return calendar.toModel();
    }

    static async getPrimaryCalendarForUser(account: Account): Promise<Calendar|null> {
        let calendar = await CalendarEntity.findOne({ where: { account_id: account.id } });
        return calendar ? calendar.toModel() : null;
    }

}

export default CalendarService;