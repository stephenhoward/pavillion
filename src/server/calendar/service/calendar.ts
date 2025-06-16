import { v4 as uuidv4 } from 'uuid';

import { Calendar } from '@/common/model/calendar';
import { Account } from '@/common/model/account';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { CalendarEditorEntity } from '@/server/calendar/entity/calendar_editor';
import { CalendarEditor } from '@/common/model/calendar_editor';
import { UrlNameAlreadyExistsError, InvalidUrlNameError, CalendarNotFoundError } from '@/common/exceptions/calendar';
import { CalendarEditorPermissionError, EditorAlreadyExistsError, EditorNotFoundError } from '@/server/calendar/exceptions/editors';
import { noAccountExistsError } from '@/server/accounts/exceptions';
import AccountsInterface from '@/server/accounts/interface';

class CalendarService {
  constructor(private accountsInterface?: AccountsInterface) {}
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
      throw new CalendarNotFoundError();
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

    // Get calendars owned by the user
    let ownedCalendars = await CalendarEntity.findAll({ where: { account_id: account.id } });

    // Get calendars where the user has editor access
    let editorRelationships = await CalendarEditorEntity.findAll({
      where: { account_id: account.id },
      include: [CalendarEntity],
    });

    // Combine owned calendars and editor calendars
    let allCalendars = [
      ...ownedCalendars.map(calendar => calendar.toModel()),
      ...editorRelationships.map(rel => rel.calendar.toModel()),
    ];

    // Remove duplicates (in case user is both owner and editor)
    return allCalendars.filter((calendar, index, self) =>
      index === self.findIndex(c => c.id === calendar.id),
    );
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

  /**
   * Check if an account owns a calendar
   *
   * @param account - Account to check ownership for
   * @param calendar - Calendar to check ownership of
   * @returns True if the account owns the calendar
   */
  async isCalendarOwner(account: Account, calendar: Calendar): Promise<boolean> {
    const calendarEntity = await CalendarEntity.findByPk(calendar.id);
    if (!calendarEntity) {
      return false;
    }
    return calendarEntity.account_id === account.id;
  }

  /**
   * Grant edit access to a user for a calendar
   *
   * @param grantingAccount - Account granting access (must be calendar owner or admin)
   * @param calendarId - ID of the calendar to grant access to
   * @param editorAccountId - ID of the account to grant edit access to
   * @returns The created editor relationship
   * @throws CalendarNotFoundError if calendar not found
   * @throws noAccountExistsError if account not found
   * @throws CalendarEditorPermissionError if permission denied
   * @throws EditorAlreadyExistsError if editor already exists
   */
  async grantEditAccess(grantingAccount: Account, calendarId: string, editorAccountId: string): Promise<CalendarEditor> {
    // Get and validate calendar exists
    const calendar = await this.getCalendar(calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    // Get and validate editor account exists
    if (!this.accountsInterface) {
      throw new Error('AccountsInterface not available');
    }
    const editorAccount = await this.accountsInterface.getAccountById(editorAccountId);
    if (!editorAccount) {
      throw new noAccountExistsError();
    }

    // Check if granting account has permission (must be calendar owner or admin)
    if (!grantingAccount.hasRole('admin')) {
      const isOwner = await this.isCalendarOwner(grantingAccount, calendar);
      if (!isOwner) {
        throw new CalendarEditorPermissionError('Permission denied: only calendar owner can grant edit access');
      }
    }

    // Check if editor relationship already exists
    const existingEditor = await CalendarEditorEntity.findOne({
      where: {
        calendar_id: calendar.id,
        account_id: editorAccount.id,
      },
    });

    if (existingEditor) {
      throw new EditorAlreadyExistsError();
    }

    // Create editor relationship
    const editorEntity = await CalendarEditorEntity.create({
      id: uuidv4(),
      calendar_id: calendar.id,
      account_id: editorAccount.id,
      granted_by: grantingAccount.id,
      granted_at: new Date(),
    });

    return editorEntity.toModel();
  }

  /**
   * Revoke edit access from a user for a calendar
   *
   * @param revokingAccount - Account revoking access (must be calendar owner or admin)
   * @param calendarId - ID of the calendar to revoke access from
   * @param editorAccountId - ID of the account to revoke edit access from
   * @returns True if access was revoked
   * @throws CalendarNotFoundError if calendar not found
   * @throws noAccountExistsError if account not found
   * @throws CalendarEditorPermissionError if permission denied
   * @throws EditorNotFoundError if editor relationship doesn't exist
   */
  async revokeEditAccess(revokingAccount: Account, calendarId: string, editorAccountId: string): Promise<boolean> {
    // Get and validate calendar exists
    const calendar = await this.getCalendar(calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    // Get and validate editor account exists
    if (!this.accountsInterface) {
      throw new Error('AccountsInterface not available');
    }
    const editorAccount = await this.accountsInterface.getAccountById(editorAccountId);
    if (!editorAccount) {
      throw new noAccountExistsError();
    }

    // Check if revoking account has permission (must be calendar owner or admin)
    if (!revokingAccount.hasRole('admin')) {
      const isOwner = await this.isCalendarOwner(revokingAccount, calendar);
      if (!isOwner) {
        throw new CalendarEditorPermissionError('Permission denied: only calendar owner can revoke edit access');
      }
    }

    // Find and delete editor relationship
    const deleted = await CalendarEditorEntity.destroy({
      where: {
        calendar_id: calendar.id,
        account_id: editorAccount.id,
      },
    });

    if (deleted === 0) {
      throw new EditorNotFoundError();
    }

    return true;
  }

  /**
   * Check if a user can view calendar editors (only calendar owners and admins)
   *
   * @param account - Account to check permission for
   * @param calendarId - ID of the calendar to check permission for
   * @returns True if the account can view editors
   * @throws CalendarNotFoundError if calendar not found
   */
  async canViewCalendarEditors(account: Account, calendarId: string): Promise<boolean> {
    // Get and validate calendar exists
    const calendar = await this.getCalendar(calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    if (account.hasRole('admin')) {
      return true;
    }
    return await this.isCalendarOwner(account, calendar);
  }

  /**
   * Get all editors for a calendar
   *
   * @param calendarId - ID of the calendar to get editors for
   * @returns Array of editor relationships
   * @throws CalendarNotFoundError if calendar not found
   */
  async getCalendarEditors(calendarId: string): Promise<CalendarEditor[]> {
    // Get and validate calendar exists
    const calendar = await this.getCalendar(calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    const editors = await CalendarEditorEntity.findAll({
      where: { calendar_id: calendar.id },
    });

    return editors.map(editor => editor.toModel());
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
