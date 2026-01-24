import { v4 as uuidv4 } from 'uuid';
import { UniqueConstraintError } from 'sequelize';
import { EventEmitter } from 'events';
import config from 'config';
import axios from 'axios';

import { Calendar, DefaultDateRange } from '@/common/model/calendar';
import { Account } from '@/common/model/account';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { CalendarEditorEntity } from '@/server/calendar/entity/calendar_editor';
import { CalendarEditorPersonEntity } from '@/server/calendar/entity/calendar_editor_person';
import { CalendarEditorRemoteEntity, RemoteEditor } from '@/server/calendar/entity/calendar_editor_remote';
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
  activeEditors: (CalendarEditor | RemoteEditorInfo)[];
  pendingInvitations: AccountInvitation[];
};

// Remote editor info for API responses
type RemoteEditorInfo = {
  id: string;
  actorUri: string;
  username: string;
  domain: string;
};

// Response type for grantEditAccessByEmail
type GrantEditAccessResult = {
  type: 'editor' | 'invitation' | 'remote_editor';
  data: CalendarEditor | AccountInvitation | { actorUri: string };
};

class CalendarService {
  private eventBus?: EventEmitter;

  constructor(
    private accountsInterface?: AccountsInterface,
    eventBus?: EventEmitter,
  ) {
    this.eventBus = eventBus;
  }
  async getCalendar(id: string): Promise<Calendar|null> {
    const calendar = await CalendarEntity.findByPk(id);
    return calendar ? calendar.toModel() : null;
  }

  isValidUrlName(username: string): boolean {
    return username.match(/^[a-z0-9][a-z0-9_-]{1,22}[a-z0-9_]$/i) ? true : false;
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

    // Get calendars where the user has federated editor access
    let federatedEditorRelationships = await CalendarEditorEntity.findAll({
      where: { account_id: account.id },
      include: [CalendarEntity],
    });

    // Get calendars where the user has local person editor access
    let localPersonEditorRelationships = await CalendarEditorPersonEntity.findAll({
      where: { account_id: account.id },
      include: [{ association: 'calendar' }],
    });

    // Combine owned calendars and editor calendars
    let allCalendars = [
      ...ownedCalendars.map(calendar => calendar.toModel()),
      ...federatedEditorRelationships.map(rel => rel.calendar.toModel()),
      ...localPersonEditorRelationships.map((rel: any) => rel.calendar.toModel()),
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

    // Get calendars where the user has remote editor access (federated)
    let remoteEditorRoles = await CalendarEditorEntity.findAll({
      where: { account_id: account.id },
      include: [CalendarEntity],
    });

    // Get calendars where the user has local person editor access
    let localEditorRoles = await CalendarEditorPersonEntity.findAll({
      where: { account_id: account.id },
      include: [{ association: 'calendar' }],
    });

    // Create result with relationship information
    let calendarsWithRole = [
      ...ownedCalendars.map(calendar => ({
        calendar: calendar.toModel(),
        role: 'owner' as const,
      })),
      ...remoteEditorRoles.map(rel => ({
        calendar: rel.calendar.toModel(),
        role: 'editor' as const,
      })),
      ...localEditorRoles.map((rel: any) => ({
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
    // Admins can modify any calendar
    if (account.hasRole('admin')) {
      return true;
    }

    // Check if user is owner or has been granted editor access
    return this.userCanEditCalendar(account.id, calendar.id);
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
   * Check if an email is in federated format (username@remote.domain)
   * Federated emails have a domain that differs from the local instance domain.
   *
   * @param email - Email address to check
   * @returns Object with isFederated flag and parsed username/domain, or null if not federated
   */
  private parseFederatedEmail(email: string): { isFederated: boolean; username?: string; domain?: string } {
    const localDomain = config.get<string>('domain');

    // Check if email looks like username@domain (no TLD like .com, .org, etc. that indicates a real email)
    // Federated identifiers typically have domains like "beta.federation.local"
    const parts = email.split('@');
    if (parts.length !== 2) {
      return { isFederated: false };
    }

    const [username, domain] = parts;

    // Skip if it's the local domain
    if (domain === localDomain) {
      return { isFederated: false };
    }

    // Check if the domain looks like a federation domain (contains a dot but isn't a typical email domain)
    // We consider it federated if the domain contains "federation" or "local" or matches known patterns
    // For production, we might want a more sophisticated check
    const isFederationDomain = domain.includes('.') &&
      (domain.endsWith('.local') ||
       domain.includes('federation') ||
       !domain.match(/\.(com|org|net|edu|gov|io|co|dev)$/i));

    if (isFederationDomain) {
      return { isFederated: true, username, domain };
    }

    return { isFederated: false };
  }

  /**
   * Look up a remote user via WebFinger and fetch their Person actor
   *
   * @param username - Username on the remote instance
   * @param domain - Domain of the remote instance
   * @returns Remote user information including actorUri
   */
  private async lookupRemoteUser(username: string, domain: string): Promise<{
    actorUri: string;
    preferredUsername: string;
    inbox: string;
    publicKey?: string;
  }> {
    // WebFinger lookup for user (note the @ prefix for user resources)
    const webfingerUrl = `https://${domain}/.well-known/webfinger?resource=acct:@${username}@${domain}`;

    let webfingerResponse;
    try {
      webfingerResponse = await axios.get(webfingerUrl, { timeout: 10000 });
    }
    catch (error: any) {
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        throw new Error(`Could not connect to ${domain}`);
      }
      if (error.response?.status === 404) {
        throw new Error(`User "${username}" not found on ${domain}`);
      }
      throw new Error(`Failed to lookup user: ${error.message}`);
    }

    // Find the ActivityPub actor URL from WebFinger links
    const actorLink = webfingerResponse.data.links?.find(
      (link: any) => link.rel === 'self' && link.type === 'application/activity+json',
    );

    if (!actorLink || !actorLink.href) {
      throw new Error('User does not support ActivityPub federation');
    }

    const actorUri = actorLink.href;

    // Fetch the Person actor to verify it exists
    let actorResponse;
    try {
      actorResponse = await axios.get(actorUri, {
        headers: {
          'Accept': 'application/activity+json',
        },
        timeout: 10000,
      });
    }
    catch (error: any) {
      throw new Error(`Failed to fetch user actor: ${error.message}`);
    }

    const actor = actorResponse.data;

    if (actor.type !== 'Person') {
      throw new Error(`Expected Person actor but got ${actor.type}`);
    }

    return {
      actorUri,
      preferredUsername: actor.preferredUsername || username,
      inbox: actor.inbox,
      publicKey: actor.publicKey?.publicKeyPem,
    };
  }

  /**
   * Grant edit access by email address - handles local users, federated users, and new users
   *
   * @param grantingAccount - Account granting access (must be calendar owner or admin)
   * @param calendarId - ID of the calendar to grant access to
   * @param email - Email address or federated identifier to grant edit access to
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
  ): Promise<GrantEditAccessResult> {

    if (!this.accountsInterface) {
      throw new Error('AccountsInterface not available');
    }

    // Check if this is a federated email (e.g., Admin@beta.federation.local)
    const federatedInfo = this.parseFederatedEmail(email);

    if (federatedInfo.isFederated && federatedInfo.username && federatedInfo.domain) {
      // Handle federated user from remote instance
      return this.grantRemoteEditorAccess(
        grantingAccount,
        calendarId,
        federatedInfo.username,
        federatedInfo.domain,
      );
    }

    // Try to find existing account by email
    const existingAccount = await this.accountsInterface.getAccountByEmail(email);

    if (existingAccount) {
      // User exists locally - grant person editor access directly
      await this.grantEditorAccess(grantingAccount, calendarId, existingAccount.id);

      // Return compatible format (CalendarEditor-like object)
      return {
        type: 'editor',
        data: {
          id: existingAccount.id,
          calendarId: calendarId,
          email: existingAccount.email,
        },
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
   * Grant editor access to a remote (federated) user
   *
   * @param grantingAccount - Account granting access
   * @param calendarId - Calendar to grant access to
   * @param remoteUsername - Username on the remote instance
   * @param remoteDomain - Domain of the remote instance
   * @returns Remote editor result with actor URI
   */
  private async grantRemoteEditorAccess(
    grantingAccount: Account,
    calendarId: string,
    remoteUsername: string,
    remoteDomain: string,
  ): Promise<GrantEditAccessResult> {
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

    // Look up the remote user via WebFinger
    const remoteUser = await this.lookupRemoteUser(remoteUsername, remoteDomain);

    // Check if remote editor already exists
    const existingEditor = await CalendarEditorRemoteEntity.findOne({
      where: {
        calendar_id: calendarId,
        actor_uri: remoteUser.actorUri,
      },
    });

    if (existingEditor) {
      throw new EditorAlreadyExistsError('This remote user is already an editor of this calendar');
    }

    // Create the remote editor relationship
    await CalendarEditorRemoteEntity.create({
      id: uuidv4(),
      calendar_id: calendarId,
      actor_uri: remoteUser.actorUri,
      remote_username: remoteUser.preferredUsername,
      remote_domain: remoteDomain,
      granted_by: grantingAccount.id,
    });

    // Send ActivityPub Add activity to notify the remote user
    const localDomain = config.get<string>('domain');
    const calendarActorUri = `https://${localDomain}/calendars/${calendar.urlName}`;
    const calendarInboxUrl = `https://${localDomain}/calendars/${calendar.urlName}/inbox`;

    const addActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Add',
      id: `${calendarActorUri}/activities/${uuidv4()}`,
      actor: calendarActorUri,
      object: remoteUser.actorUri,
      target: `${calendarActorUri}/editors`,
      calendarId: calendar.id,
      calendarInboxUrl: calendarInboxUrl,
    };

    // Send to remote user's inbox
    try {
      await axios.post(remoteUser.inbox, addActivity, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/activity+json',
        },
      });
      console.log(`[CALENDAR] Sent Add activity to ${remoteUser.inbox}`);
    }
    catch (error: any) {
      // Log but don't fail - the local record is created, notification is best-effort
      console.error(`[CALENDAR] Failed to send Add activity to ${remoteUser.inbox}: ${error.message}`);
    }

    return {
      type: 'remote_editor',
      data: {
        actorUri: remoteUser.actorUri,
      },
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

    // Try to delete from both federated and local person editor tables
    const federatedDeleted = await CalendarEditorEntity.destroy({
      where: {
        calendar_id: calendar.id,
        account_id: editorAccount.id,
      },
    });

    const localPersonDeleted = await CalendarEditorPersonEntity.destroy({
      where: {
        calendar_id: calendar.id,
        account_id: editorAccount.id,
      },
    });

    const totalDeleted = federatedDeleted + localPersonDeleted;

    if (totalDeleted === 0) {
      throw new EditorNotFoundError();
    }

    return true;
  }

  /**
   * Remove a remote (federated) editor from a calendar
   *
   * @param revokingAccount - Account revoking the remote editor access
   * @param calendarId - ID of the calendar
   * @param actorUri - ActivityPub actor URI of the remote editor
   * @returns True if editor was removed
   * @throws CalendarNotFoundError if calendar not found
   * @throws CalendarEditorPermissionError if user lacks permission
   * @throws EditorNotFoundError if remote editor not found
   */
  async removeRemoteEditor(revokingAccount: Account, calendarId: string, actorUri: string): Promise<boolean> {
    // Get and validate calendar exists
    const calendar = await this.getCalendar(calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    // Check if revoking account has permission (must be owner or admin)
    const revokerIsOwner = await this.isCalendarOwner(revokingAccount, calendar);
    if (!revokerIsOwner && !revokingAccount.hasRole('admin')) {
      throw new CalendarEditorPermissionError('Permission denied: only calendar owner can revoke remote editor access');
    }

    // Delete the remote editor
    const deleted = await CalendarEditorRemoteEntity.destroy({
      where: {
        calendar_id: calendar.id,
        actor_uri: actorUri,
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

    // Get federated editors
    const federatedEditors = await CalendarEditorEntity.findAll({
      where: { calendar_id: calendar.id },
    });

    // Get local person editors with account information
    const localPersonEditors = await CalendarEditorPersonEntity.findAll({
      where: { calendar_id: calendar.id },
      include: [
        {
          association: 'account',
          attributes: ['id', 'email'],
        },
      ],
    });

    // Combine both types into CalendarEditor format
    return [
      ...federatedEditors.map(editor => editor.toModel()),
      ...localPersonEditors.map((personEditor: any) => new CalendarEditor(
        personEditor.account.id,
        personEditor.calendar_id,
        personEditor.account.email,
      )),
    ];
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

    // Get federated editors (old system - editors who are local accounts that were added through federation)
    const federatedEditors = await CalendarEditorEntity.findAll({
      where: { calendar_id: calendar.id },
    });

    // Get local person editors with account information
    const localPersonEditors = await CalendarEditorPersonEntity.findAll({
      where: { calendar_id: calendar.id },
      include: [
        {
          association: 'account',
          attributes: ['id', 'email'],
        },
      ],
    });

    // Get remote editors (new system - editors from other ActivityPub instances)
    const remoteEditors = await CalendarEditorRemoteEntity.findAll({
      where: { calendar_id: calendar.id },
    });

    // Combine all editor types
    const allEditors: (CalendarEditor | RemoteEditorInfo)[] = [
      // Federated editors (local accounts)
      ...federatedEditors.map(editor => editor.toModel()),
      // Local person editors
      ...localPersonEditors.map((personEditor: any) => new CalendarEditor(
        personEditor.account.id,
        personEditor.calendar_id,
        personEditor.account.email,
      )),
      // Remote editors (from other ActivityPub instances) - includes actorUri
      ...remoteEditors.map(remoteEditor => ({
        id: remoteEditor.id,
        actorUri: remoteEditor.actor_uri,
        username: remoteEditor.remote_username,
        domain: remoteEditor.remote_domain,
      })),
    ];

    // Get pending invitations for this calendar using unified method
    let pendingInvitations: AccountInvitation[] = [];
    if (this.accountsInterface) {
      pendingInvitations = await this.accountsInterface.listInvitations(undefined, calendarId);
    }

    return {
      activeEditors: allEditors,
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

    // Emit calendar.created event for ActivityPub domain to create CalendarActor
    this.emitCalendarCreatedEvent(calendar);

    return calendar;
  }

  /**
   * Emits the calendar.created event for ActivityPub actor creation
   */
  private emitCalendarCreatedEvent(calendar: Calendar): void {
    if (!this.eventBus) {
      return;
    }

    try {
      const domain = config.get<string>('domain');
      if (domain) {
        this.eventBus.emit('calendar.created', {
          calendarId: calendar.id,
          urlName: calendar.urlName,
          domain: domain,
        });
      }
    }
    catch (error) {
      console.error('Failed to emit calendar.created event:', calendar.id, error);
      // Don't fail calendar creation if event emission fails
    }
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

  /**
   * Update calendar settings
   *
   * @param account - Account making the update (must be calendar owner or admin)
   * @param calendarId - ID of the calendar to update
   * @param settings - Settings to update
   * @returns The updated calendar
   * @throws CalendarNotFoundError if calendar not found
   * @throws CalendarEditorPermissionError if permission denied
   */
  async updateCalendarSettings(
    account: Account,
    calendarId: string,
    settings: { defaultDateRange?: DefaultDateRange },
  ): Promise<Calendar> {
    const calendar = await this.getCalendar(calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    // Only calendar owner or admin can update settings
    if (!account.hasRole('admin')) {
      const isOwner = await this.isCalendarOwner(account, calendar);
      if (!isOwner) {
        throw new CalendarEditorPermissionError('Permission denied: only calendar owner can update settings');
      }
    }

    const calendarEntity = await CalendarEntity.findByPk(calendarId);
    if (!calendarEntity) {
      throw new CalendarNotFoundError();
    }

    // Update the settings
    if (settings.defaultDateRange) {
      await calendarEntity.update({ default_date_range: settings.defaultDateRange });
    }

    return calendarEntity.toModel();
  }

  /**
   * Grant editor access to a calendar for a local person/account
   *
   * @param owner - The account performing the grant (must be calendar owner)
   * @param calendarId - The calendar to grant access to
   * @param editorAccountId - The account to grant editor access to
   */
  async grantEditorAccess(owner: Account, calendarId: string, editorAccountId: string): Promise<void> {
    // Verify calendar exists
    const calendar = await this.getCalendar(calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError('Calendar not found');
    }

    // Verify requester is the owner
    if (!owner.hasRole('admin')) {
      const isOwner = await this.isCalendarOwner(owner, calendar);
      if (!isOwner) {
        throw new CalendarEditorPermissionError('Only calendar owner can grant editor access');
      }
    }

    // Prevent granting access to the owner themselves
    if (editorAccountId === owner.id) {
      throw new CalendarEditorPermissionError('Cannot grant editor access to calendar owner');
    }

    // Create editor relationship
    try {
      await CalendarEditorPersonEntity.create({
        calendar_id: calendarId,
        account_id: editorAccountId,
        granted_by: owner.id,
      });
    }
    catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new EditorAlreadyExistsError('User already has editor access to this calendar');
      }
      throw error;
    }
  }

  /**
   * Revoke editor access from a calendar
   *
   * @param owner - The account performing the revocation (must be calendar owner)
   * @param calendarId - The calendar to revoke access from
   * @param editorAccountId - The account to revoke editor access from
   */
  async revokeEditorAccess(owner: Account, calendarId: string, editorAccountId: string): Promise<void> {
    // Verify calendar exists
    const calendar = await this.getCalendar(calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError('Calendar not found');
    }

    // Verify requester is the owner
    if (!owner.hasRole('admin')) {
      const isOwner = await this.isCalendarOwner(owner, calendar);
      if (!isOwner) {
        throw new CalendarEditorPermissionError('Only calendar owner can revoke editor access');
      }
    }

    // Find and remove editor relationship
    const editorEntity = await CalendarEditorPersonEntity.findOne({
      where: {
        calendar_id: calendarId,
        account_id: editorAccountId,
      },
    });

    if (!editorEntity) {
      throw new EditorNotFoundError('Editor relationship not found');
    }

    await editorEntity.destroy();
  }

  /**
   * Check if a user can edit a calendar (either as owner or editor)
   *
   * @param accountId - The account to check permissions for
   * @param calendarId - The calendar to check
   * @returns true if user can edit the calendar
   */
  async userCanEditCalendar(accountId: string, calendarId: string): Promise<boolean> {
    // Check if calendar exists
    const calendar = await this.getCalendar(calendarId);
    if (!calendar) {
      return false;
    }

    // Check if user is the owner
    if (calendar.accountId === accountId) {
      return true;
    }

    // Check if user has federated editor access
    const federatedEditorEntity = await CalendarEditorEntity.findOne({
      where: {
        calendar_id: calendarId,
        account_id: accountId,
      },
    });

    if (federatedEditorEntity) {
      return true;
    }

    // Check if user has local person editor access
    const localPersonEditorEntity = await CalendarEditorPersonEntity.findOne({
      where: {
        calendar_id: calendarId,
        account_id: accountId,
      },
    });

    return localPersonEditorEntity !== null;
  }

  /**
   * List all local person editors of a calendar
   *
   * @param calendarId - The calendar to list editors for
   * @returns Array of local person editor information
   */
  async listPersonEditors(calendarId: string): Promise<Array<{
    accountId: string;
    username: string;
    email: string;
    grantedBy: string;
  }>> {
    // Verify calendar exists
    const calendar = await this.getCalendar(calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError('Calendar not found');
    }

    // Fetch all editor relationships with account details
    const editorEntities = await CalendarEditorPersonEntity.findAll({
      where: {
        calendar_id: calendarId,
      },
      include: [
        {
          association: 'account',
          attributes: ['id', 'username', 'email'],
        },
        {
          association: 'grantor',
          attributes: ['id', 'username', 'email'],
        },
      ],
    });

    return editorEntities.map((entity: any) => ({
      accountId: entity.account.id,
      username: entity.account.username,
      email: entity.account.email,
      grantedBy: entity.grantor.id,
    }));
  }
}

export default CalendarService;
