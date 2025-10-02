import { v4 as uuidv4 } from 'uuid';
import { UniqueConstraintError } from 'sequelize';

import { Calendar } from '@/common/model/calendar';
import { Account } from '@/common/model/account';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { CalendarEditorEntity } from '@/server/calendar/entity/calendar_editor';
import { CalendarEditor } from '@/common/model/calendar_editor';
import AccountInvitation from '@/common/model/invitation';
import { UrlNameAlreadyExistsError, InvalidUrlNameError, CalendarNotFoundError } from '@/common/exceptions/calendar';
import { CalendarEditorPermissionError, EditorAlreadyExistsError, EditorNotFoundError } from '@/common/exceptions/editor';
import { noAccountExistsError } from '@/server/accounts/exceptions';
import AccountsInterface from '@/server/accounts/interface';
import EmailService from '@/server/common/service/mail';
import EditorNotificationEmail from '@/server/calendar/model/editor_notification_email';

// Import the interface type (this avoids circular dependency)
type CalendarEditorsResponse = {
  activeEditors: CalendarEditor[];
  pendingInvitations: AccountInvitation[];
};

class CalendarService {
  constructor(
    private accountsInterface?: AccountsInterface,
  ) {}
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

  async editableCalendarsWithRoleForUser(account: Account): Promise<Array<{calendar: Calendar, role: 'owner' | 'editor'}>> {
    if (!account.id) {
      return [];
    }

    // Get calendars owned by the user
    let ownedCalendars = await CalendarEntity.findAll({ where: { account_id: account.id } });

    // Get calendars where the user has editor access
    let editorRoles = await CalendarEditorEntity.findAll({
      where: { account_id: account.id },
      include: [CalendarEntity],
    });

    // Create result with relationship information
    let calendarsWithRole = [
      ...ownedCalendars.map(calendar => ({
        calendar: calendar.toModel(),
        role: 'owner' as const,
      })),
      ...editorRoles.map(rel => ({
        calendar: rel.calendar.toModel(),
        role: 'editor' as const,
      })),
    ];

    // Remove duplicates (prioritize owner relationship over editor)
    return calendarsWithRole.filter((calendarInfo, index, self) => {
      const duplicateIndex = self.findIndex(c => c.calendar.id === calendarInfo.calendar.id);
      if (duplicateIndex === index) {
        return true; // First occurrence, keep it
      }
      // If this is a duplicate, only keep it if current is owner and first is editor
      return calendarInfo.role === 'owner' && self[duplicateIndex].role === 'editor';
    });
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
    if (!name || ! this.isValidUrlName(name)) {
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
   * Grant edit access to a specific account (internal use for invitation acceptance)
   * @param grantingAccount - Account granting access (must be calendar owner or admin)
   * @param calendarId - ID of the calendar to grant access to
   * @param editorAccountId - ID of the account to grant access to
   * @returns The created editor relationship
   * @throws CalendarNotFoundError if calendar not found
   * @throws noAccountExistsError if account not found
   * @throws CalendarEditorPermissionError if permission denied
   * @throws EditorAlreadyExistsError if editor already exists
   */
  async grantEditAccess(grantingAccount: Account, calendarId: string, editorAccountId: string, message?: string): Promise<CalendarEditor> {
    // Get and validate calendar exists
    const calendar = await this.getCalendar(calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    // Check if granting account has permission (must be calendar owner or admin)
    if (!grantingAccount.hasRole('admin')) {
      const isOwner = await this.isCalendarOwner(grantingAccount, calendar);
      if (!isOwner) {
        throw new CalendarEditorPermissionError('Permission denied: only calendar owner can grant edit access');
      }
    }

    // Get and validate editor account exists
    if (!this.accountsInterface) {
      throw new Error('AccountsInterface not available');
    }
    const editorAccount = await this.accountsInterface.getAccountById(editorAccountId);
    if (!editorAccount) {
      throw new noAccountExistsError();
    }

    // Create editor relationship with uniqueness constraint handling
    // TODO: storing the email seems problematic long term - the inviter needs a way to identify who they invited,
    // but I don't like the idea of storing potentially outdated email addresses here. I also don't like
    // the inviter being able to see when the invitee changes their email address. Maybe we need to introduce names/handles?
    try {
      const editorEntity = await CalendarEditorEntity.create({
        id: uuidv4(),
        calendar_id: calendar.id,
        account_id: editorAccount.id,
        email: editorAccount.email,
      });

      await this.sendEditorNotificationEmail(calendar, grantingAccount, editorAccount, message);
      return editorEntity.toModel();
    }
    catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new EditorAlreadyExistsError();
      }
      throw error;
    }
  }

  private async sendEditorNotificationEmail(calendar: Calendar, grantingAccount: Account, editorAccount: Account, message?: string) {
    // Send email notification about editor access
    const notificationEmail = new EditorNotificationEmail(
      calendar,
      grantingAccount,
      editorAccount,
      message,
    );

    try {
      await EmailService.sendEmail(notificationEmail.buildMessage(editorAccount.language || 'en'));
    }
    catch (error) {
      console.error('Failed to send editor notification email:', error);
      // Don't fail the whole operation if email fails
    }
  }

  /**
   * Grant edit access by email address - handles both existing and new users
   *
   * @param grantingAccount - Account granting access (must be calendar owner or admin)
   * @param calendarId - ID of the calendar to grant access to
   * @param email - Email address to grant edit access to
   * @param message - Optional personal message to include in the invitation
   * @returns The created editor relationship or invitation details
   * @throws CalendarNotFoundError if calendar not found
   * @throws CalendarEditorPermissionError if permission denied
   * @throws EditorAlreadyExistsError if editor already exists
   */
  async grantEditAccessByEmail(
    grantingAccount: Account,
    calendarId: string,
    email: string,
    message?: string,
  ): Promise<{ type: 'editor' | 'invitation', data: CalendarEditor | any }> {

    if (!this.accountsInterface) {
      throw new Error('AccountsInterface not available');
    }

    // Try to find existing account by email
    const existingAccount = await this.accountsInterface.getAccountByEmail(email);

    if (existingAccount) {
      // User exists - grant editor access directly
      const editorRelationship = await this.grantEditAccess(grantingAccount, calendarId, existingAccount.id);

      return {
        type: 'editor',
        data: editorRelationship,
      };
    }

    // Get and validate calendar exists
    const calendar = await this.getCalendar(calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    // Check if granting account has permission (must be calendar owner or admin)
    if (!grantingAccount.hasRole('admin')) {
      const isOwner = await this.isCalendarOwner(grantingAccount, calendar);
      if (!isOwner) {
        throw new CalendarEditorPermissionError('Permission denied: only calendar owner can grant edit access');
      }
    }

    // Create account invitation
    const invitation = await this.accountsInterface.inviteNewAccount(
      grantingAccount,
      email,
      `You've been invited to edit the calendar "${calendar.content('en').name}".\n\n${message || ''}`,
      calendar.id,
    );

    return {
      type: 'invitation',
      data: invitation,
    };
  }

  /**
   * Remove edit access from a user for a calendar
   *
   * @param revokingAccount - Account removing access (must be calendar owner or admin, or the editor who wishes to leave)
   * @param calendarId - ID of the calendar to remove access from
   * @param editorAccountId - ID of the account to remove edit access from
   * @returns True if access was removed
   * @throws CalendarNotFoundError if calendar not found
   * @throws noAccountExistsError if account not found
   * @throws CalendarEditorPermissionError if permission denied
   * @throws EditorNotFoundError if editor relationship doesn't exist
   */
  async removeEditAccess(revokingAccount: Account, calendarId: string, editorAccountId: string): Promise<boolean> {
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

    const isSelfRemoval = revokingAccount.id === editorAccount.id;
    const revokerIsOwner = await this.isCalendarOwner(revokingAccount, calendar);
    const editorIsOwner = await this.isCalendarOwner(editorAccount, calendar);

    // Check if revoking account has permission
    if (!revokerIsOwner && !revokingAccount.hasRole('admin') && !isSelfRemoval) {
      throw new CalendarEditorPermissionError('Permission denied: only calendar owner or the editor themselves can revoke edit access');
    }

    if (editorIsOwner) {
      throw new CalendarEditorPermissionError('Calendar owners cannot remove themselves from their own calendar');
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
  async listCalendarEditors(account: Account, calendarId: string): Promise<CalendarEditor[]> {
    // Get and validate calendar exists
    const calendar = await this.getCalendar(calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    if (!(await this.canViewCalendarEditors(account, calendarId))) {
      throw new CalendarEditorPermissionError('Permission denied: only calendar owner can view editors');
    }

    const editors = await CalendarEditorEntity.findAll({
      where: { calendar_id: calendar.id },
    });

    return editors.map(editor => editor.toModel());
  }

  /**
   * Lists calendar editors and pending invitations for a calendar.
   * This enhanced version includes both active editors and pending invitations.
   *
   * @param account - The account requesting the editor list
   * @param calendarId - The ID of the calendar
   * @returns Object containing activeEditors and pendingInvitations arrays
   */
  async listCalendarEditorsWithInvitations(account: Account, calendarId: string): Promise<CalendarEditorsResponse> {
    // Get and validate calendar exists
    const calendar = await this.getCalendar(calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    if (!(await this.canViewCalendarEditors(account, calendarId))) {
      throw new CalendarEditorPermissionError('Permission denied: only calendar owner can view editors');
    }

    // Get active editors
    const editors = await CalendarEditorEntity.findAll({
      where: { calendar_id: calendar.id },
    });

    // Get pending invitations for this calendar using unified method
    let pendingInvitations: AccountInvitation[] = [];
    if (this.accountsInterface) {
      pendingInvitations = await this.accountsInterface.listInvitations(undefined, calendarId);
    }

    return {
      activeEditors: editors.map(editor => editor.toModel()),
      pendingInvitations: pendingInvitations,
    };
  }

  /**
   * Cancel a pending invitation for a calendar
   * @param requestingAccount - Account requesting the cancellation (must be calendar owner or admin)
   * @param calendarId - ID of the calendar the invitation is for
   * @param invitationId - ID of the invitation to cancel
   * @returns True if cancellation successful
   * @throws CalendarNotFoundError if calendar not found
   * @throws CalendarEditorPermissionError if permission denied
   */
  async cancelCalendarInvitation(requestingAccount: Account, calendarId: string, invitationId: string): Promise<boolean> {
    // Get and validate calendar exists
    const calendar = await this.getCalendar(calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    // Check if requesting account has permission (must be calendar owner or admin)
    if (!requestingAccount.hasRole('admin')) {
      const isOwner = await this.isCalendarOwner(requestingAccount, calendar);
      if (!isOwner) {
        throw new CalendarEditorPermissionError('Only calendar owners can cancel invitations');
      }
    }

    // Verify the invitation belongs to this calendar using unified method
    const pendingInvitations = await this.accountsInterface!.listInvitations(undefined, calendarId);
    const invitation = pendingInvitations.find(inv => inv.id === invitationId);

    if (!invitation) {
      throw new Error('Invitation not found or not associated with this calendar');
    }

    // Cancel the invitation
    return await this.accountsInterface!.cancelInvite(invitationId);
  }

  /**
   * Resend a pending invitation for a calendar
   * @param requestingAccount - Account requesting the resend (must be calendar owner or admin)
   * @param calendarId - ID of the calendar the invitation is for
   * @param invitationId - ID of the invitation to resend
   * @returns The resent invitation or undefined if failed
   * @throws CalendarNotFoundError if calendar not found
   * @throws CalendarEditorPermissionError if permission denied
   */
  async resendCalendarInvitation(requestingAccount: Account, calendarId: string, invitationId: string): Promise<AccountInvitation | undefined> {
    // Get and validate calendar exists
    const calendar = await this.getCalendar(calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    // Check if requesting account has permission (must be calendar owner or admin)
    if (!requestingAccount.hasRole('admin')) {
      const isOwner = await this.isCalendarOwner(requestingAccount, calendar);
      if (!isOwner) {
        throw new CalendarEditorPermissionError('Only calendar owners can resend invitations');
      }
    }

    // Verify the invitation belongs to this calendar using unified method
    const pendingInvitations = await this.accountsInterface!.listInvitations(undefined, calendarId);
    const invitation = pendingInvitations.find(inv => inv.id === invitationId);

    if (!invitation) {
      throw new Error('Invitation not found or not associated with this calendar');
    }

    // Resend the invitation
    return await this.accountsInterface!.resendInvite(invitationId);
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
