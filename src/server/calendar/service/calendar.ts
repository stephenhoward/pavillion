import { v4 as uuidv4 } from 'uuid';

import { Calendar } from '@/common/model/calendar';
import { Account } from '@/common/model/account';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { UrlNameAlreadyExistsError, InvalidUrlNameError } from '@/common/exceptions/calendar';

class CalendarService {
  async getCalendar(id: string): Promise<Calendar|null> {
    const calendar = await CalendarEntity.findByPk(id);
    return calendar ? calendar.toModel() : null;
  }

  isValidUrlName(username: string): boolean {
    return username.match(/^[a-z0-9][a-z0-9_]{2,23}$/i) ? true : false;
  }

  async setUrlName(account: Account, calendar: Calendar, urlName: string): Promise<boolean> {

    if ( ! account.hasRole('admin') ) {
      const canEditCalendar = await this.userCanModifyCalendar(account, calendar);
      if ( ! canEditCalendar ) {
        throw new Error('Permission denied');
      }
    }

    if ( ! this.isValidUrlName(urlName) ) {
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

  async editableCalendarsForUser(account: Account): Promise<Calendar[]> {
    if (!account.id) {
      return [];
    }
    let calendars = await CalendarEntity.findAll({ where: { account_id: account.id } });
    return calendars.map((calendar) => calendar.toModel());
  }

  async userCanModifyCalendar(account: Account, calendar: Calendar): Promise<boolean> {
    if ( ! account.hasRole('admin') ) {
      let calendars = await this.editableCalendarsForUser(account);
      if ( calendars.length == 0 ) {
        return false;
      }
      // check if the calendar is in the list of editable calendars
      return calendars.some((cal) => cal.id == calendar.id);
    }
    return true;
  }

  async getCalendarByName(name: string): Promise<Calendar|null> {
    if (!name) {
      return null;
    }
    let calendar = await CalendarEntity.findOne({ where: { url_name: name } });
    return calendar ? calendar.toModel() : null;
  }

  async getPrimaryCalendarForUser(account: Account): Promise<Calendar|null> {
    if (!account.id) {
      return null;
    }
    let calendar = await CalendarEntity.findOne({ where: { account_id: account.id } });
    return calendar ? calendar.toModel() : null;
  }

  /**
   * Creates a calendar with the specified URL name for a user
   *
   * @param account - User account for which to create the calendar
   * @param urlName - Desired URL name for the calendar
   * @param name - Optional display name for the calendar
   * @returns The created calendar
   * @throws InvalidUrlNameError if the URL name is invalid
   * @throws UrlNameAlreadyExistsError if the URL name is already taken
   */
  async createCalendar(account: Account, urlName: string, name?: string): Promise<Calendar> {
    // Validate URL name format
    if (!this.isValidUrlName(urlName)) {
      throw new InvalidUrlNameError();
    }

    // Check if URL name is already taken
    const existingCalendar = await CalendarEntity.findOne({ where: { url_name: urlName } });
    if (existingCalendar) {
      throw new UrlNameAlreadyExistsError();
    }

    // Create the calendar with the specified URL name
    const calendarEntity = await CalendarEntity.create({
      id: uuidv4(),
      account_id: account.id,
      url_name: urlName,
      languages: 'en',  // Default language
    });

    const calendar = calendarEntity.toModel();

    // Set the calendar name if provided
    if (name) {
      const content = calendar.content('en');
      content.name = name;

      // Create content entity and save to database
      await this.createCalendarContent(calendar.id, content);
    }

    return calendar;
  }

  /**
   * Saves a calendar content translation to the database
   *
   * @param calendarId - The ID of the calendar
   * @param content - The content translation to save
   * @returns The saved content entity
   */
  async createCalendarContent(calendarId: string, content: import('@/common/model/calendar').CalendarContent): Promise<import('@/server/calendar/entity/calendar').CalendarContentEntity> {
    const { CalendarContentEntity } = await import('@/server/calendar/entity/calendar');

    // Create a new content entity from the model
    const contentEntity = CalendarContentEntity.fromModel(content);

    // Set the calendar ID and generate a new ID if needed
    contentEntity.calendar_id = calendarId;
    contentEntity.id = contentEntity.id || uuidv4();

    // Find existing content for this language
    const existingContent = await CalendarContentEntity.findOne({
      where: {
        calendar_id: calendarId,
        language: content.language,
      },
    });

    if (existingContent) {
      // Update existing content
      await existingContent.update({
        name: content.name,
        description: content.description,
      });
      return existingContent;
    }
    else {
      // Create new content
      return await CalendarContentEntity.create(contentEntity.toJSON());
    }
  }
}

export default CalendarService;
