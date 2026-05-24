import { v4 as uuidv4 } from 'uuid';
import { Op, UniqueConstraintError, literal } from 'sequelize';
import { EventEmitter } from 'events';
import config from 'config';
import axios from 'axios';
import { validateUrlNotPrivate } from '@/server/common/helper/ip-validation';
import { PUBLIC_KEY_FETCH_TIMEOUT_MS } from '@/server/common/constants';

import { Calendar, DefaultDateRange } from '@/common/model/calendar';
import { Account } from '@/common/model/account';
import { CalendarEntity, CalendarContentEntity } from '@/server/calendar/entity/calendar';
import { MediaEntity } from '@/server/media/entity/media';
import { CalendarMemberEntity } from '@/server/calendar/entity/calendar_member';
import { CalendarEditor } from '@/common/model/calendar_editor';
import { CalendarMember } from '@/common/model/calendar_member';
import { AccountEntity } from '@/server/common/entity/account';
import AccountInvitation from '@/common/model/invitation';
import { UrlNameAlreadyExistsError, InvalidUrlNameError, CalendarNotFoundError } from '@/common/exceptions/calendar';
import { isValidCalendarUrlName } from '@/common/validation/calendarUrlName';
import { ValidationError } from '@/common/exceptions/base';
import { MediaNotFoundError } from '@/common/exceptions/media';
import { CalendarEditorPermissionError, EditorAlreadyExistsError, EditorNotFoundError } from '@/common/exceptions/editor';
import { SubscriptionRequiredError } from '@/common/exceptions/subscription';
import { noAccountExistsError } from '@/server/accounts/exceptions';
import AccountsInterface from '@/server/accounts/interface';
import EmailInterface from '@/server/email/interface';
import { logError } from '@/server/common/helper/error-logger';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('calendar');
import FundingInterface from '@/server/funding/interface';
import EditorNotificationEmail from '@/server/calendar/model/editor_notification_email';
import db from '@/server/common/entity/db';
import type ActivityPubInterface from '@/server/activitypub/interface';
import type ModerationInterface from '@/server/moderation/interface';
import { CALENDAR_BUS_EVENTS } from '@/server/calendar/events/types';

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
  private readonly fundingInterface?: FundingInterface;
  private activityPubInterface?: ActivityPubInterface;
  private moderationInterface?: ModerationInterface;

  constructor(
    private accountsInterface?: AccountsInterface,
    private emailInterface?: EmailInterface,
    eventBus?: EventEmitter,
    fundingInterface?: FundingInterface,
  ) {
    this.eventBus = eventBus;
    this.fundingInterface = fundingInterface;
  }

  setActivityPubInterface(apInterface: ActivityPubInterface): void {
    this.activityPubInterface = apInterface;
  }

  setModerationInterface(moderationInterface: ModerationInterface): void {
    this.moderationInterface = moderationInterface;
  }

  private isValidUUID(uuid: string): boolean {
    const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return typeof uuid === 'string' && UUID_V4_REGEX.test(uuid);
  }

  private withPublicUrl(calendar: Calendar): Calendar {
    calendar.publicUrl = 'https://' + config.get('domain') + '/view/' + calendar.urlName;
    return calendar;
  }

  async getCalendar(id: string): Promise<Calendar|null> {
    if (!this.isValidUUID(id)) {
      return null;
    }
    const calendar = await CalendarEntity.findByPk(id, {
      include: [CalendarContentEntity, { model: MediaEntity, as: 'defaultEventImage', required: false, where: { status: 'approved' } }],
    });
    return calendar ? this.withPublicUrl(calendar.toModel()) : null;
  }

  isValidUrlName(username: string): boolean {
    return isValidCalendarUrlName(username);
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

  /**
   * Get all calendars a user can edit (as owner or editor).
   * Uses CalendarMemberEntity for a single unified query.
   *
   * @param account - The account to find editable calendars for
   * @returns Array of calendars the user can edit
   */
  async editableCalendarsForUser(account: Account): Promise<Calendar[]> {
    if (!account.id) {
      return [];
    }

    // Single query on CalendarMemberEntity for all memberships
    const memberships = await CalendarMemberEntity.findAll({
      where: { account_id: account.id },
      include: [{ model: CalendarEntity, as: 'calendar', include: [CalendarContentEntity, { model: MediaEntity, as: 'defaultEventImage', required: false, where: { status: 'approved' } }] }],
    });

    return memberships
      .filter(m => m.calendar)
      .map(m => this.withPublicUrl(m.calendar.toModel()));
  }

  /**
   * Get all calendars a user can edit, with their role (owner or editor).
   * Uses CalendarMemberEntity for a single unified query.
   *
   * @param account - The account to find editable calendars for
   * @returns Array of calendars with role information
   */
  async editableCalendarsWithRoleForUser(account: Account): Promise<Array<{calendar: Calendar, role: 'owner' | 'editor'}>> {
    if (!account.id) {
      return [];
    }

    // Single query on CalendarMemberEntity for all memberships
    const memberships = await CalendarMemberEntity.findAll({
      where: { account_id: account.id },
      include: [{ model: CalendarEntity, as: 'calendar', include: [CalendarContentEntity, { model: MediaEntity, as: 'defaultEventImage', required: false, where: { status: 'approved' } }] }],
    });

    return memberships
      .filter(m => m.calendar)
      .map(m => ({
        calendar: this.withPublicUrl(m.calendar.toModel()),
        role: m.role as 'owner' | 'editor',
      }));
  }

  async userCanModifyCalendar(account: Account, calendar: Calendar): Promise<boolean> {
    // Admins can modify any calendar
    if (account.hasRole('admin')) {
      return true;
    }

    // Check if user is owner or has been granted editor access
    return this.userCanEditCalendar(account.id, calendar.id);
  }

  /**
   * Check if a user can review reports for a calendar.
   * Admins and calendar owners always have access. Editors must have
   * the can_review_reports permission explicitly granted.
   *
   * @param account - The account to check permissions for
   * @param calendarId - The calendar UUID to check report review access for
   * @returns True if the user can review reports for the calendar
   */
  async userCanReviewReports(account: Account, calendarId: string): Promise<boolean> {
    // Instance admins can always review reports
    if (account.hasRole('admin')) {
      return true;
    }

    // Look up the membership for this account and calendar
    const membership = await CalendarMemberEntity.findOne({
      where: {
        account_id: account.id,
        calendar_id: calendarId,
      },
    });

    if (!membership) {
      return false;
    }

    // Calendar owners always have report review access
    if (membership.role === 'owner') {
      return true;
    }

    // Editors must have can_review_reports permission
    if (membership.role === 'editor' && membership.can_review_reports) {
      return true;
    }

    return false;
  }

  async getCalendarByName(name: string): Promise<Calendar|null> {
    if (!name || ! this.isValidUrlName(name)) {
      return null;
    }
    let calendar = await CalendarEntity.findOne({ where: { url_name: name }, include: [CalendarContentEntity, { model: MediaEntity, as: 'defaultEventImage', required: false, where: { status: 'approved' } }] });
    return calendar ? this.withPublicUrl(calendar.toModel()) : null;
  }

  /**
   * Get calendar for widget embedding with subscription check.
   * This method performs defense-in-depth subscription verification for widget data serving.
   *
   * @param urlName - Calendar URL name
   * @returns Calendar model if access is allowed
   * @throws CalendarNotFoundError if calendar doesn't exist
   * @throws SubscriptionRequiredError if subscriptions enabled and owner lacks active subscription
   */
  async getCalendarForWidget(urlName: string): Promise<Calendar> {
    const calendar = await this.getCalendarByName(urlName);

    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    // Check subscription for widget access (defense-in-depth)
    const settings = await this.fundingInterface?.getSettings();

    if (settings?.enabled) {
      const ownerId = await this.getCalendarOwnerAccountId(calendar.id);
      if (!ownerId) {
        throw new CalendarNotFoundError();
      }

      // Admin-owned calendars bypass subscription checks
      const isAdmin = await this.isCalendarOwnerAdmin(ownerId);
      if (!isAdmin) {
        const hasSubscription = await this.fundingInterface?.hasFundingAccess(calendar.id);
        if (!hasSubscription) {
          throw new SubscriptionRequiredError('widget_embedding');
        }
      }
    }

    return calendar;
  }

  /**
   * Check if an account owns a calendar.
   * Uses CalendarMemberEntity to check for owner role.
   *
   * @param account - Account to check ownership for
   * @param calendar - Calendar to check ownership of
   * @returns True if the account owns the calendar
   */
  async isCalendarOwner(account: Account, calendar: Calendar): Promise<boolean> {
    const membership = await CalendarMemberEntity.findOne({
      where: {
        calendar_id: calendar.id,
        account_id: account.id,
        role: 'owner',
      },
    });
    return membership !== null;
  }

  /**
   * Checks if a specific account is the owner of a calendar using primitive IDs.
   * Designed for cross-domain use via CalendarInterface.
   *
   * @param accountId - The account UUID to check
   * @param calendarId - The calendar UUID to check ownership of
   * @returns True if the account owns the calendar
   */
  async isCalendarOwnerById(accountId: string, calendarId: string): Promise<boolean> {
    const membership = await CalendarMemberEntity.findOne({
      where: {
        calendar_id: calendarId,
        account_id: accountId,
        role: 'owner',
      },
    });
    return membership !== null;
  }

  /**
   * Checks if a calendar exists by its primary key.
   *
   * @param calendarId - The calendar UUID to check
   * @returns True if the calendar exists
   */
  async calendarExists(calendarId: string): Promise<boolean> {
    const calendar = await CalendarEntity.findByPk(calendarId, {
      attributes: ['id'],
    });
    return calendar !== null;
  }

  /**
   * Retrieves the account ID of the calendar owner.
   *
   * @param calendarId - The calendar UUID to find the owner for
   * @returns The owner's account ID, or null if no owner found
   */
  async getCalendarOwnerAccountId(calendarId: string): Promise<string | null> {
    const membership = await CalendarMemberEntity.findOne({
      where: {
        calendar_id: calendarId,
        role: 'owner',
      },
    });
    return membership?.account_id ?? null;
  }

  /**
   * Returns all accounts with edit access to a calendar: the owner plus all local editors.
   * Used for notification fan-out when a calendar-level event occurs.
   *
   * @param calendarId - The calendar UUID to get editors for
   * @returns Array of Account models for all accounts with edit access; empty array if calendar not found
   */
  async getEditorsForCalendar(calendarId: string): Promise<Account[]> {
    const memberships = await CalendarMemberEntity.findAll({
      where: {
        calendar_id: calendarId,
        account_id: { [Op.ne]: null },
      },
      include: [
        {
          model: AccountEntity,
          as: 'account',
          attributes: ['id', 'username', 'email', 'language', 'display_name'],
        },
      ],
    });

    return memberships
      .filter(m => m.account)
      .map(m => m.account.toModel());
  }

  /**
   * Returns the local owner accounts of a calendar.
   *
   * Filters CalendarMemberEntity to rows with `role='owner'` and an
   * associated local account. Remote-only memberships (no local account)
   * are excluded. Used by the notifications role resolver to fan out
   * verbs like `Flag` to calendar-owners.
   *
   * @param calendarId - The calendar UUID to get owners for
   * @returns Array of Account models for local owners; empty array if none
   */
  async getOwnersForCalendar(calendarId: string): Promise<Account[]> {
    const memberships = await CalendarMemberEntity.findAll({
      where: {
        calendar_id: calendarId,
        role: 'owner',
        account_id: { [Op.ne]: null },
      },
      include: [
        {
          model: AccountEntity,
          as: 'account',
          attributes: ['id', 'username', 'email', 'language', 'display_name'],
        },
      ],
    });

    return memberships
      .filter(m => m.account)
      .map(m => m.account.toModel());
  }

  /**
   * Checks if a remote actor (identified by actor URI) is an editor of the given calendar.
   *
   * @param actorUri - The ActivityPub actor URI of the remote user
   * @param calendarId - The calendar UUID to check membership for
   * @returns True if the actor has editor access to the calendar
   */
  async isEditorOfCalendar(actorUri: string, calendarId: string): Promise<boolean> {
    const userActor = await this.activityPubInterface!.findUserActorByUri(actorUri);

    if (!userActor) {
      return false;
    }

    const membership = await CalendarMemberEntity.findOne({
      where: {
        calendar_id: calendarId,
        user_actor_id: userActor.id,
      },
    });

    return membership !== null;
  }

  /**
   * Check if the calendar owner account has admin role.
   * Returns false (fail-secure) if the account is not found or roles cannot be loaded.
   *
   * @param ownerId - The account ID of the calendar owner
   * @returns True if the owner is an admin, false otherwise
   * @private
   */
  private async isCalendarOwnerAdmin(ownerId: string): Promise<boolean> {
    if (!this.accountsInterface) {
      return false;
    }

    try {
      const account = await this.accountsInterface.getAccountById(ownerId);
      if (!account) {
        return false;
      }

      const accountWithRoles = await this.accountsInterface.loadAccountRoles(account);
      return accountWithRoles.hasRole('admin');
    }
    catch (error) {
      // Fail-secure: if we can't determine admin status, treat as non-admin
      return false;
    }
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

    // Create editor relationship via CalendarMemberEntity
    try {
      await CalendarMemberEntity.create({
        id: uuidv4(),
        calendar_id: calendar.id,
        account_id: editorAccount.id,
        role: 'editor',
        granted_by: grantingAccount.id,
      });

      await this.sendEditorNotificationEmail(calendar, grantingAccount, editorAccount, message);
      return new CalendarEditor(editorAccount.id, calendar.id, editorAccount.email, editorAccount.displayName ?? null, editorAccount.username ?? null);
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
      if (this.emailInterface) {
        await this.emailInterface.sendEmail(notificationEmail.buildMessage(editorAccount.language || 'en'));
      }
    }
    catch (error) {
      logError(error, '[Calendar] Failed to send editor notification email');
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
    // SECURITY: Validate that the WebFinger URL does not point to a private IP address.
    // NOTE: DNS TOCTOU gap — validateUrlNotPrivate resolves DNS at validation time;
    // axios re-resolves at connect time. A DNS rebinding attack could bypass this check.
    try {
      await validateUrlNotPrivate(webfingerUrl);
    }
    catch (error) {
      throw new Error(`[CALENDAR] Security: Blocked WebFinger request to private address for ${domain}: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      webfingerResponse = await axios.get(webfingerUrl, { timeout: PUBLIC_KEY_FETCH_TIMEOUT_MS, maxRedirects: 0 });
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
    // SECURITY: Validate actor URI from untrusted WebFinger response.
    // NOTE: DNS TOCTOU gap — validateUrlNotPrivate resolves DNS at validation time;
    // axios re-resolves at connect time. A DNS rebinding attack could bypass this check.
    try {
      await validateUrlNotPrivate(actorUri);
    }
    catch (error) {
      throw new Error(`[CALENDAR] Security: Blocked actor fetch to private address: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      actorResponse = await axios.get(actorUri, {
        headers: {
          'Accept': 'application/activity+json',
        },
        timeout: PUBLIC_KEY_FETCH_TIMEOUT_MS,
        maxRedirects: 0,
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
          displayName: existingAccount.displayName ?? null,
          username: existingAccount.username ?? null,
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

    // Find or create user actor for this remote user
    const userActorResult = await this.activityPubInterface!.findOrCreateRemoteUserActor(
      remoteUser.actorUri,
      remoteUser.preferredUsername,
      remoteDomain,
      remoteUser.publicKey || undefined,
    );

    // Check if already an editor via CalendarMemberEntity
    const existingMember = await CalendarMemberEntity.findOne({
      where: {
        calendar_id: calendarId,
        user_actor_id: userActorResult.id,
      },
    });

    if (existingMember) {
      throw new EditorAlreadyExistsError('This remote user is already an editor of this calendar');
    }

    // Create membership
    await CalendarMemberEntity.create({
      id: uuidv4(),
      calendar_id: calendarId,
      user_actor_id: userActorResult.id,
      role: 'editor',
      granted_by: grantingAccount.id,
    });

    // Send ActivityPub Add activity to notify the remote user via the signed
    // outbox path. The AP domain owns activity construction, signing-actor
    // selection (the calendar actor signs the Add per the pv-dyyw signing
    // table), and outbox enqueuing. Local membership is created above
    // regardless of remote delivery outcome — best-effort semantics are
    // preserved by the outbox worker, which logs delivery failures
    // asynchronously.
    try {
      await this.activityPubInterface!.sendEditorInvite(calendar, remoteUser);
      logger.info({ inbox: remoteUser.inbox, calendarId: calendar.id }, 'Enqueued Add activity for remote user');
    }
    catch (error: any) {
      // Best-effort: local membership row is already created above, so we do
      // not fail the grant if enqueuing the outbox message hits an unexpected
      // error (e.g. transient DB failure on the ap_outbox insert).
      logError(error, `[Calendar] Failed to enqueue Add activity to ${remoteUser.inbox}`);
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

    // Delete from CalendarMemberEntity only
    const deleted = await CalendarMemberEntity.destroy({
      where: {
        calendar_id: calendar.id,
        account_id: editorAccount.id,
        role: 'editor',
      },
    });

    if (deleted === 0) {
      throw new EditorNotFoundError();
    }

    // Emit cross-domain bus event for notifications. Notifications uses
    // the revoked editor's account_id to address an explicit single-
    // recipient audience.
    if (this.eventBus) {
      this.eventBus.emit(CALENDAR_BUS_EVENTS.EDITOR_REVOKED, {
        calendarId: calendar.id,
        accountId: editorAccount.id,
        revokedBy: revokingAccount.id,
      });
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

    // Find the user actor for this remote actor
    const userActor = await this.activityPubInterface!.findUserActorByUri(actorUri);
    if (!userActor) {
      throw new EditorNotFoundError();
    }

    const deleted = await CalendarMemberEntity.destroy({
      where: {
        calendar_id: calendar.id,
        user_actor_id: userActor.id,
        role: 'editor',
      },
    });

    if (deleted === 0) {
      throw new EditorNotFoundError();
    }

    // Send ActivityPub Remove activity to notify the remote user via the
    // signed outbox path. Mirrors the Add emission in grantRemoteEditorAccess
    // — the calendar actor signs the Remove (pv-dyyw signing table), and the
    // local membership row is already destroyed above regardless of remote
    // delivery outcome. Best-effort semantics: a transient enqueue failure
    // must not roll back the local revoke.
    try {
      await this.activityPubInterface!.sendEditorRevoke(calendar, actorUri);
      logger.info({ actorUri, calendarId: calendar.id }, 'Enqueued Remove activity for remote editor');
    }
    catch (error: any) {
      logError(error, `[Calendar] Failed to enqueue Remove activity to ${actorUri}`);
    }

    if (this.eventBus) {
      this.eventBus.emit('remoteEditorRevoked', {
        calendarId: calendar.id,
        actorUri,
      });
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
   * Get all editors for a calendar.
   * Uses CalendarMemberEntity for a single unified query.
   *
   * @param account - Account requesting the list (must be owner or admin)
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

    // Query CalendarMemberEntity for editors with account info
    const editorMembers = await CalendarMemberEntity.findAll({
      where: {
        calendar_id: calendar.id,
        role: 'editor',
        account_id: { [Op.ne]: null },
      },
      include: [
        {
          model: AccountEntity,
          as: 'account',
          attributes: ['id', 'email', 'username', 'display_name'],
        },
      ],
    });

    return editorMembers
      .filter(m => m.account)
      .map(m => new CalendarEditor(
        m.account.id,
        m.calendar_id,
        m.account.email,
        m.account.display_name ?? null,
        m.account.username ?? null,
      ));
  }

  /**
   * Lists calendar editors and pending invitations for a calendar.
   * Uses CalendarMemberEntity for a single unified query.
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

    // Query CalendarMemberEntity for all editors (both local and remote)
    const editorMembers = await CalendarMemberEntity.findAll({
      where: {
        calendar_id: calendar.id,
        role: 'editor',
      },
      include: [
        {
          model: AccountEntity,
          as: 'account',
          attributes: ['id', 'email', 'username', 'display_name'],
        },
        { association: 'userActor' },
      ],
    });

    // Build the editors list from unified membership records
    const allEditors: (CalendarEditor | RemoteEditorInfo)[] = [];

    for (const member of editorMembers) {
      if (member.account_id && member.account) {
        // Local member - create CalendarEditor
        allEditors.push(new CalendarEditor(
          member.account.id,
          member.calendar_id,
          member.account.email,
          member.account.display_name ?? null,
          member.account.username ?? null,
        ));
      }
      else if (member.user_actor_id && member.userActor) {
        // Remote member - create RemoteEditorInfo
        allEditors.push({
          id: member.id,
          actorUri: member.userActor.actor_uri,
          username: member.userActor.remote_username || '',
          domain: member.userActor.remote_domain || '',
        });
      }
    }

    // Get pending invitations for this calendar using unified method
    let pendingInvitations: AccountInvitation[] = [];
    if (this.accountsInterface) {
      const result = await this.accountsInterface.listInvitations(1, 100, undefined, calendarId);
      pendingInvitations = result.invitations;
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
    const result = await this.accountsInterface!.listInvitations(1, 100, undefined, calendarId);
    const invitation = result.invitations.find(inv => inv.id === invitationId);

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
    const result = await this.accountsInterface!.listInvitations(1, 100, undefined, calendarId);
    const invitation = result.invitations.find(inv => inv.id === invitationId);

    if (!invitation) {
      throw new Error('Invitation not found or not associated with this calendar');
    }

    // Resend the invitation
    return await this.accountsInterface!.resendInvite(invitationId);
  }

  /**
   * Get the primary (owned) calendar for a user.
   * Uses CalendarMemberEntity to find owner membership.
   *
   * @param account - The account to find the primary calendar for
   * @returns The primary calendar, or null if none found
   */
  async getPrimaryCalendarForUser(account: Account): Promise<Calendar|null> {
    if (!account.id) {
      return null;
    }
    // Stable sort: when an account owns multiple owner memberships,
    // return the oldest one so callers that need a deterministic
    // signing identity (e.g. the federation Flag courier in
    // ModerationService.forwardReport) get the same calendar every
    // run rather than DB-ordering-dependent results.
    const membership = await CalendarMemberEntity.findOne({
      where: { account_id: account.id, role: 'owner' },
      include: [{
        model: CalendarEntity,
        as: 'calendar',
        include: [CalendarContentEntity, { model: MediaEntity, as: 'defaultEventImage', required: false, where: { status: 'approved' } }],
      }],
      order: [['created_at', 'ASC']],
    });
    return membership?.calendar ? this.withPublicUrl(membership.calendar.toModel()) : null;
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
    // Validate required fields
    if (!urlName || urlName.trim().length === 0) {
      throw new ValidationError('urlName is required');
    }

    // Validate URL name format
    if (!this.isValidUrlName(urlName)) {
      throw new InvalidUrlNameError();
    }

    // Check if URL name is already taken
    const existingCalendar = await CalendarEntity.findOne({ where: { url_name: urlName } });
    if (existingCalendar) {
      throw new UrlNameAlreadyExistsError();
    }

    const calendarId = uuidv4();

    // Wrap calendar + owner member creation in transaction
    const calendarEntity = await db.transaction(async (t) => {
      const entity = await CalendarEntity.create({
        id: calendarId,
        url_name: urlName,
        languages: 'en',
      }, { transaction: t });

      await CalendarMemberEntity.create({
        id: uuidv4(),
        calendar_id: calendarId,
        account_id: account.id,
        role: 'owner',
        granted_by: null,
      }, { transaction: t });

      return entity;
    });

    const calendar = this.withPublicUrl(calendarEntity.toModel());

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
      logError(error, `[Calendar] Failed to emit calendar.created event: ${calendar.id}`);
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
    settings: {
      defaultDateRange?: DefaultDateRange;
      defaultEventImageId?: string | null;
      content?: Record<string, { name?: string; description?: string }>;
    },
  ): Promise<Calendar> {
    // Validate required fields
    if (!calendarId || calendarId.trim().length === 0) {
      throw new ValidationError('calendarId is required');
    }

    // Validate defaultDateRange if provided
    if (settings.defaultDateRange) {
      const validRanges: DefaultDateRange[] = ['1week', '2weeks', '1month'];
      if (!validRanges.includes(settings.defaultDateRange)) {
        throw new ValidationError('Invalid defaultDateRange. Must be one of: 1week, 2weeks, 1month');
      }
    }

    // Validate defaultEventImageId format if provided (null is allowed to clear)
    if (settings.defaultEventImageId !== undefined && settings.defaultEventImageId !== null) {
      if (!this.isValidUUID(settings.defaultEventImageId)) {
        throw new ValidationError('defaultEventImageId must be a valid UUID or null');
      }
    }

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

    // Update defaultEventImageId if provided
    if (settings.defaultEventImageId !== undefined) {
      if (settings.defaultEventImageId === null) {
        // Clear the default image
        await calendarEntity.update({ default_event_image_id: null });
      }
      else {
        // Validate that the media exists and belongs to this calendar
        const media = await MediaEntity.findByPk(settings.defaultEventImageId);
        if (!media) {
          throw new MediaNotFoundError(settings.defaultEventImageId);
        }
        if (media.calendar_id !== calendarId) {
          throw new ValidationError('Media does not belong to this calendar');
        }
        await calendarEntity.update({ default_event_image_id: settings.defaultEventImageId });

        // Trigger media approval for pending uploads (same flow as event/series media)
        if (this.eventBus) {
          this.eventBus.emit('mediaAttachedToCalendar', {
            mediaId: settings.defaultEventImageId,
            calendarId,
          });
        }
      }
    }

    // Update content translations if provided
    if (settings.content) {
      const calendar = calendarEntity.toModel();
      for (const [language, contentData] of Object.entries(settings.content)) {
        const content = calendar.content(language);
        if (contentData.name !== undefined) {
          content.name = contentData.name;
        }
        if (contentData.description !== undefined) {
          content.description = contentData.description;
        }
        await this.createCalendarContent(calendarId, content);
      }
    }

    // Re-fetch with content and default image included to return complete data
    const updatedEntity = await CalendarEntity.findByPk(calendarId, {
      include: [CalendarContentEntity, { model: MediaEntity, as: 'defaultEventImage', required: false, where: { status: 'approved' } }],
    });
    return this.withPublicUrl(updatedEntity!.toModel());
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

    // Create editor relationship via CalendarMemberEntity
    try {
      await CalendarMemberEntity.create({
        id: uuidv4(),
        calendar_id: calendarId,
        account_id: editorAccountId,
        role: 'editor',
        granted_by: owner.id,
      });
    }
    catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new EditorAlreadyExistsError('User already has editor access to this calendar');
      }
      throw error;
    }

    // Emit cross-domain bus event for notifications. Notifications uses
    // the invitee account_id to address an explicit single-recipient
    // audience; no role resolution is required.
    if (this.eventBus) {
      this.eventBus.emit(CALENDAR_BUS_EVENTS.EDITOR_INVITED, {
        calendarId,
        accountId: editorAccountId,
        grantedBy: owner.id,
      });
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

    // Delete from CalendarMemberEntity only
    const deleted = await CalendarMemberEntity.destroy({
      where: {
        calendar_id: calendarId,
        account_id: editorAccountId,
        role: 'editor',
      },
    });

    if (deleted === 0) {
      throw new EditorNotFoundError('Editor relationship not found');
    }

    // Emit cross-domain bus event for notifications. Notifications uses
    // the revoked editor's account_id to address an explicit single-
    // recipient audience.
    if (this.eventBus) {
      this.eventBus.emit(CALENDAR_BUS_EVENTS.EDITOR_REVOKED, {
        calendarId,
        accountId: editorAccountId,
        revokedBy: owner.id,
      });
    }
  }

  /**
   * Check if a user can edit a calendar (either as owner or editor).
   * Uses CalendarMemberEntity for a single unified query.
   * Supports both local calendars (via calendar_id) and remote calendars (via calendar_actor_id).
   *
   * @param accountId - The account to check permissions for
   * @param calendarId - The calendar UUID (local) or CalendarActorEntity UUID (remote)
   * @returns true if user can edit the calendar
   */
  async userCanEditCalendar(accountId: string, calendarId: string): Promise<boolean> {
    // Check for membership via either calendar_id (local) or calendar_actor_id (remote)
    const membership = await CalendarMemberEntity.findOne({
      where: {
        account_id: accountId,
        [Op.or]: [
          { calendar_id: calendarId },
          { calendar_actor_id: calendarId },
        ],
      },
    });

    return membership !== null;
  }

  /**
   * List all local person editors of a calendar.
   * Uses CalendarMemberEntity for a single unified query.
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

    // Query CalendarMemberEntity for local editors with account and grantor details
    const editorMembers = await CalendarMemberEntity.findAll({
      where: {
        calendar_id: calendarId,
        account_id: { [Op.ne]: null },
        role: 'editor',
      },
      include: [
        {
          model: AccountEntity,
          as: 'account',
          attributes: ['id', 'username', 'email'],
        },
        {
          model: AccountEntity,
          as: 'grantor',
          attributes: ['id', 'username', 'email'],
        },
      ],
    });

    return editorMembers
      .filter((m: any) => m.account && m.grantor)
      .map((m: any) => ({
        accountId: m.account.id,
        username: m.account.username,
        email: m.account.email,
        grantedBy: m.grantor.id,
      }));
  }

  /**
   * Update permissions for an editor on a calendar.
   * Only calendar owners can update editor permissions.
   *
   * @param account - The account making the update (must be calendar owner)
   * @param calendarId - The ID of the calendar
   * @param editorAccountId - The account ID of the editor whose permissions are being updated
   * @param permissions - The permissions to update
   * @returns The updated CalendarMember
   * @throws CalendarNotFoundError if calendar not found
   * @throws CalendarEditorPermissionError if the requesting account is not the calendar owner
   * @throws EditorNotFoundError if the editor membership is not found
   */
  async updateEditorPermissions(
    account: Account,
    calendarId: string,
    editorAccountId: string,
    permissions: { canReviewReports: boolean },
  ): Promise<CalendarMember> {
    // Get and validate calendar exists
    const calendar = await this.getCalendar(calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    // Only calendar owner or admin can update editor permissions
    if (!account.hasRole('admin')) {
      const isOwner = await this.isCalendarOwner(account, calendar);
      if (!isOwner) {
        throw new CalendarEditorPermissionError('Permission denied: only calendar owner can update editor permissions');
      }
    }

    // Find the editor membership record
    const membership = await CalendarMemberEntity.findOne({
      where: {
        calendar_id: calendarId,
        account_id: editorAccountId,
        role: 'editor',
      },
    });

    if (!membership) {
      throw new EditorNotFoundError();
    }

    // Update the permission
    await membership.update({
      can_review_reports: permissions.canReviewReports,
    });

    return membership.toModel();
  }

  /**
   * Set the allowed domain for a calendar's widget.
   * Includes subscription verification when subscriptions are enabled.
   *
   * @param account - Account setting the domain
   * @param calendarId - Calendar ID to configure
   * @param domain - Domain to allow for widget embedding
   * @throws SubscriptionRequiredError if subscriptions enabled and user lacks active subscription
   * @throws CalendarNotFoundError if calendar not found
   * @throws CalendarEditorPermissionError if user lacks permission
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async setWidgetDomain(account: Account, calendarId: string, _domain: string): Promise<void> {
    // Check if subscriptions are enabled
    const settings = await this.fundingInterface?.getSettings();

    if (settings?.enabled) {
      // Resolve calendar ownership
      const ownerId = await this.getCalendarOwnerAccountId(calendarId);
      if (!ownerId) {
        throw new CalendarNotFoundError();
      }

      // Admin-owned calendars bypass subscription checks
      const isAdmin = await this.isCalendarOwnerAdmin(ownerId);
      if (!isAdmin) {
        // Check subscription status
        const hasSubscription = await this.fundingInterface?.hasFundingAccess(calendarId);
        if (!hasSubscription) {
          throw new SubscriptionRequiredError('widget_embedding');
        }
      }
    }

    // Existing permission and validation logic would be handled by CalendarInterface
    // This method is called after those checks pass
  }

  /**
   * Record that a local account has been granted editor access to a remote calendar.
   * Idempotent — if membership already exists, returns the existing one.
   *
   * @param accountId - The local account ID
   * @param calendarActorId - The CalendarActorEntity ID for the remote calendar
   * @returns The CalendarMember domain model
   */
  async recordRemoteCalendarMembership(accountId: string, calendarActorId: string): Promise<CalendarMember> {
    const existingMember = await CalendarMemberEntity.findOne({
      where: {
        calendar_actor_id: calendarActorId,
        account_id: accountId,
      },
    });

    if (existingMember) {
      return existingMember.toModel();
    }

    const newMember = await CalendarMemberEntity.create({
      id: uuidv4(),
      calendar_id: null,
      calendar_actor_id: calendarActorId,
      account_id: accountId,
      user_actor_id: null,
      role: 'editor',
      granted_by: null,
    });

    return newMember.toModel();
  }

  /**
   * Remove a local account's editor access record for a remote calendar.
   * Returns true if a membership was found and deleted, false if none existed.
   *
   * @param accountId - The local account ID
   * @param calendarActorId - The CalendarActorEntity ID for the remote calendar
   * @returns True if a membership was deleted, false otherwise
   */
  async removeRemoteCalendarMembership(accountId: string, calendarActorId: string): Promise<boolean> {
    const deleted = await CalendarMemberEntity.destroy({
      where: {
        calendar_actor_id: calendarActorId,
        account_id: accountId,
      },
    });

    return deleted > 0;
  }

  /**
   * List public-discoverable calendars for the /view/ discovery page.
   *
   * Returns every calendar with `listed = true`, paired with the timestamp of
   * its most-recent publicly-visible event activity, sorted by that timestamp
   * descending (calendars without events sort last via NULLS LAST), capped at
   * 500 rows. Eager-loads `contentEntities` for the localized name +
   * description. Does NOT eager-load `defaultEventImage` — discovery tiles
   * don't render images in v1 (epic decision; YAGNI).
   *
   * Single SQL round-trip:
   *   SELECT calendar.*, calendar_content.*,
   *          (SELECT MAX(event.updatedAt)
   *             FROM event
   *             WHERE event.calendar_id = calendar.id
   *               AND EXISTS (
   *                 SELECT 1 FROM event_schedule
   *                 WHERE event_schedule.event_id = event.id
   *                   AND NOT (event_schedule.is_exclusion = true
   *                            AND event_schedule.hide_from_public = true)
   *               )
   *          ) AS lastEventActivity
   *   FROM calendar
   *   LEFT JOIN calendar_content ON calendar_content.calendar_id = calendar.id
   *   WHERE calendar.listed = true
   *   ORDER BY lastEventActivity DESC NULLS LAST
   *   LIMIT 500
   *
   * "Publicly visible event" predicate: an event contributes to
   * `lastEventActivity` only if it owns at least one schedule row that is NOT
   * a hidden cancellation. The canonical definition lives in
   * EventInstanceService.rrules() — a schedule suppresses an occurrence
   * (EXDATE-style) when BOTH `is_exclusion = true` AND `hide_from_public = true`.
   * An event whose every schedule is a hidden cancellation produces no public
   * occurrences and must not inflate the calendar's discovery activity. Events
   * with no event_schedule rows at all are intentionally excluded from
   * lastEventActivity — they have no published recurrence and therefore no
   * surface for the public to encounter (matching rrules() emitting nothing).
   *
   * Foreign events reposted onto a calendar are tracked via EventRepostEntity
   * and SharedEventEntity — those links intentionally do NOT influence
   * `lastEventActivity` here, since the discovery page should rank calendars
   * by their own publishing cadence, not by their syndication activity.
   *
   * @returns Calendars + lastEventActivity tuples, sorted activity-descending,
   *   capped at 500 rows
   */
  async listPublicCalendars(): Promise<Array<{ calendar: Calendar; lastEventActivity: Date | null }>> {
    const PUBLIC_DISCOVERY_LIMIT = 500;

    // Split into two queries because `subQuery: false` + LIMIT + a
    // CalendarContentEntity LEFT JOIN would cap *joined rows*, not distinct
    // calendars — a multilingual instance with N content rows per calendar
    // would return ~LIMIT/N distinct calendars. The discovery cap must apply
    // to calendars, not to language-content fan-out.
    //
    // Step 1 — select calendar ids (+ aliased last_event_activity) under the
    // listed=true predicate, the ORDER BY clauses, and the LIMIT. No content
    // join, so the cap is over distinct calendars by construction.
    //
    // Correlated subquery: an event contributes to MAX(event.updatedAt) only
    // when it has at least one event_schedule row that is NOT a hidden
    // cancellation (NOT (is_exclusion AND hide_from_public)). Mirrors the
    // canonical suppression predicate in EventInstanceService.rrules().
    // Events whose every schedule is an EXDATE-style hidden cancellation
    // produce no public occurrences and must not inflate discovery activity.
    //
    // NOTE: the alias 'last_event_activity' is load-bearing — the two ORDER BY
    // literals below reference it by name. Keep them all in lockstep on rename
    // or the sort silently regresses.
    const idRows = await CalendarEntity.findAll({
      where: { listed: true },
      attributes: [
        'id',
        [
          literal(
            '(SELECT MAX("event"."updatedAt") FROM "event" '
            + 'WHERE "event"."calendar_id" = "CalendarEntity"."id" '
            + 'AND EXISTS (SELECT 1 FROM "event_schedule" '
            + 'WHERE "event_schedule"."event_id" = "event"."id" '
            + 'AND NOT ("event_schedule"."is_exclusion" = true '
            + 'AND "event_schedule"."hide_from_public" = true)))',
          ),
          'last_event_activity',
        ],
      ],
      // NULLS LAST: calendars with no events sort after calendars that have
      // published activity. Both PostgreSQL (native, since 8.3) and SQLite
      // (since 3.30) accept `NULLS LAST`. The previous two-clause form used
      // `last_event_activity IS NULL` in the ORDER BY, which PostgreSQL rejects
      // because output-column aliases are not visible inside expression contexts
      // — only as bare ORDER BY terms. SQLite accepts the same SQL, so the
      // SQLite-only integration tests masked the regression.
      order: literal('last_event_activity DESC NULLS LAST'),
      limit: PUBLIC_DISCOVERY_LIMIT,
    } as any);

    if (idRows.length === 0) {
      return [];
    }

    // Build the ordered id list and an id → lastEventActivity lookup so we can
    // preserve step 1's ordering when we hydrate full entities in step 2.
    const orderedIds: string[] = idRows.map((r) => r.id);
    const activityById = new Map<string, Date | null>();
    for (const r of idRows) {
      const rawActivity = (r as any).get('last_event_activity');
      activityById.set(r.id, rawActivity ? new Date(rawActivity as string | number | Date) : null);
    }

    // Step 2 — hydrate full entities (with CalendarContentEntity) keyed by the
    // ids from step 1. The JOIN now fans out language rows safely; Sequelize
    // collapses duplicate calendar rows when an include is present. The ORDER
    // BY here is not load-bearing — we re-sort to step 1's order below.
    const hydrated = await CalendarEntity.findAll({
      where: { id: { [Op.in]: orderedIds } },
      include: [CalendarContentEntity],
    });

    // Preserve step 1's ordering: build an id → entity map and walk the
    // ordered id list.
    const entityById = new Map<string, typeof hydrated[number]>();
    for (const entity of hydrated) {
      entityById.set(entity.id, entity);
    }

    return orderedIds
      .map((id) => entityById.get(id))
      .filter((entity): entity is typeof hydrated[number] => entity !== undefined)
      .map((entity) => {
        const calendar = this.withPublicUrl(entity.toModel());
        const lastEventActivity = activityById.get(entity.id) ?? null;
        return { calendar, lastEventActivity };
      });
  }

  /**
   * List all local calendars for admin visibility.
   *
   * Returns paginated rows joined with the owner membership and account,
   * decorated with funding status and open-report count via cross-domain
   * interface bulk calls. Remote-owned calendars are excluded (admin page
   * is local-only in v1 per DEC-006 / epic scope).
   *
   * @param filters - Search / sort / pagination filters
   * @returns Paginated envelope of AdminCalendarRow DTOs
   * @throws ValidationError on invalid sortBy or sortDir values
   */
  async listAllCalendarsForAdmin(filters: AdminCalendarListFilters = {}): Promise<AdminCalendarListResult> {
    // Sort whitelist — NEVER interpolate user-supplied sort values into
    // raw SQL or Sequelize.literal. Column mapping is explicit.
    const sortColumnMap: Record<string, string> = {
      created: '"CalendarEntity"."createdAt"',
      lastActivity: 'last_activity_at',
      eventCount: 'upcoming_event_count',
    };
    const sortByKey = filters.sortBy ?? 'created';
    if (!(sortByKey in sortColumnMap)) {
      throw new ValidationError(`Invalid sortBy value: must be one of ${Object.keys(sortColumnMap).join(', ')}`);
    }

    const sortDirKey = (filters.sortDir ?? 'desc').toLowerCase();
    if (sortDirKey !== 'asc' && sortDirKey !== 'desc') {
      throw new ValidationError('Invalid sortDir value: must be asc or desc');
    }

    const sortColumn = sortColumnMap[sortByKey];
    const sortDirection = sortDirKey === 'asc' ? 'ASC' : 'DESC';

    // Pagination clamps
    const sanitizedPage = Math.max(1, filters.page ?? 1);
    const sanitizedLimit = Math.min(100, Math.max(1, filters.limit ?? 20));
    const offset = (sanitizedPage - 1) * sanitizedLimit;

    // Search normalization
    const rawSearch = typeof filters.search === 'string' ? filters.search.trim() : '';
    const searchTerm = rawSearch.length > 0 ? rawSearch.slice(0, 200) : '';

    // hasOpenReports pre-filter — fetch the set of calendar IDs with open
    // reports BEFORE the main query, so the main query's WHERE clause can
    // restrict to that set.
    let hasOpenReportsIdSet: string[] | null = null;
    if (filters.hasOpenReports) {
      if (!this.moderationInterface) {
        // If we can't determine the set, return empty — fail-closed.
        return {
          items: [],
          pagination: {
            currentPage: sanitizedPage,
            totalPages: 0,
            totalCount: 0,
            limit: sanitizedLimit,
          },
        };
      }
      hasOpenReportsIdSet = await this.moderationInterface.calendarIdsWithOpenReports();
      if (hasOpenReportsIdSet.length === 0) {
        return {
          items: [],
          pagination: {
            currentPage: sanitizedPage,
            totalPages: 0,
            totalCount: 0,
            limit: sanitizedLimit,
          },
        };
      }
    }

    // Build the WHERE clause for CalendarMemberEntity (owner memberships).
    // The primary query is rooted at CalendarMemberEntity so we get exactly
    // one row per local calendar with a local owner — filtering out remote
    // calendars and orphaned calendars in one join.
    const memberWhere: any = {
      role: 'owner',
      calendar_id: { [Op.ne]: null },
      account_id: { [Op.ne]: null },
    };
    if (hasOpenReportsIdSet) {
      memberWhere.calendar_id = { [Op.in]: hasOpenReportsIdSet };
    }

    // Search is applied to the included CalendarEntity via an inner-join
    // include — url_name directly, title via an EXISTS subquery on
    // calendar_content. Uses parameterized :search replacement so the
    // user-supplied value is bound, never interpolated.
    const calendarInclude: any = {
      model: CalendarEntity,
      as: 'calendar',
      required: true,
      include: [
        {
          model: CalendarContentEntity,
          required: false,
        },
      ],
    };
    if (searchTerm.length > 0) {
      const pattern = `%${searchTerm.toLowerCase()}%`;
      calendarInclude.where = {
        [Op.or]: [
          // Case-insensitive urlName match using LOWER() for dialect neutrality
          // (Op.iLike is PostgreSQL-only; LOWER(col) LIKE lower_pattern works on
          // both PostgreSQL and SQLite, which the e2e suite uses).
          literal('LOWER("calendar"."url_name") LIKE :search'),
          literal('EXISTS (SELECT 1 FROM calendar_content cc WHERE cc.calendar_id = "calendar"."id" AND LOWER(cc.name) LIKE :search)'),
        ],
      };
    }

    // Count query — mirrors the main query shape minus the decoration
    // subqueries, so pagination totals stay consistent with the listing.
    const totalCount = await CalendarMemberEntity.count({
      where: memberWhere,
      include: [calendarInclude],
      distinct: true,
      col: 'calendar_id',
      replacements: searchTerm.length > 0 ? { search: `%${searchTerm.toLowerCase()}%` } : undefined,
    } as any);

    if (totalCount === 0) {
      return {
        items: [],
        pagination: {
          currentPage: sanitizedPage,
          totalPages: 0,
          totalCount: 0,
          limit: sanitizedLimit,
        },
      };
    }

    // Map sort column onto the included calendar alias where needed so
    // the ORDER BY references the joined table.
    const resolvedSortColumn = sortByKey === 'created'
      ? '"calendar"."createdAt"'
      : sortColumn;

    // Main page query — rooted at CalendarMemberEntity, includes the
    // joined calendar + content + account, and adds correlated
    // subqueries for upcoming_event_count and last_activity_at.
    const rows = await CalendarMemberEntity.findAll({
      where: memberWhere,
      attributes: {
        include: [
          [
            // CAST AS INTEGER and CURRENT_TIMESTAMP are dialect-neutral — they
            // work on both PostgreSQL and SQLite (used by the e2e suite).
            literal(
              '(SELECT CAST(COUNT(*) AS INTEGER) FROM event_instance ei WHERE ei.calendar_id = "CalendarMemberEntity"."calendar_id" AND ei.start_time >= CURRENT_TIMESTAMP)',
            ),
            'upcoming_event_count',
          ],
          [
            literal(
              '(SELECT MAX(ei.start_time) FROM event_instance ei WHERE ei.calendar_id = "CalendarMemberEntity"."calendar_id")',
            ),
            'last_activity_at',
          ],
        ],
      },
      include: [
        calendarInclude,
        {
          model: AccountEntity,
          as: 'account',
          attributes: ['id', 'display_name', 'username'],
        },
      ],
      order: [[literal(resolvedSortColumn), sortDirection]],
      limit: sanitizedLimit,
      offset,
      subQuery: false,
      replacements: searchTerm.length > 0 ? { search: `%${searchTerm.toLowerCase()}%` } : undefined,
    } as any);

    const ids = rows.map((r: any) => r.calendar_id).filter((id: string | null): id is string => id !== null);

    // Decorate via cross-domain bulk calls (single round trip each).
    const fundingMap = this.fundingInterface
      ? await this.fundingInterface.getPlanStatusForCalendars(ids)
      : new Map<string, 'subscribed' | 'grant' | 'none'>();
    const reportMap = this.moderationInterface
      ? await this.moderationInterface.getOpenReportCountsForCalendars(ids)
      : new Map<string, number>();

    const items: AdminCalendarRow[] = rows.map((row: any) => {
      const calendar = row.calendar;
      const contents = calendar?.contentEntities || [];
      // Prefer English if present; otherwise first available translation.
      const englishContent = contents.find((c: any) => c.language === 'en');
      const chosenContent = englishContent ?? contents[0];
      const title = chosenContent?.name ?? '';

      const ownerAccount = row.account;
      const ownerId = ownerAccount?.id ?? '';
      const ownerDisplayName = ownerAccount?.display_name ?? ownerAccount?.username ?? '';

      const rawUpcomingCount = row.get('upcoming_event_count');
      const upcomingEventCount = typeof rawUpcomingCount === 'number'
        ? rawUpcomingCount
        : parseInt(rawUpcomingCount ?? '0', 10) || 0;

      const rawLastActivity = row.get('last_activity_at');
      const lastActivityAt = rawLastActivity ? new Date(rawLastActivity) : null;

      return {
        id: calendar?.id ?? '',
        urlName: calendar?.url_name ?? '',
        title,
        owner: {
          accountId: ownerId,
          displayName: ownerDisplayName,
        },
        upcomingEventCount,
        lastActivityAt,
        fundingStatus: fundingMap.get(calendar?.id) ?? 'none',
        openReportCount: reportMap.get(calendar?.id) ?? 0,
      };
    });

    return {
      items,
      pagination: {
        currentPage: sanitizedPage,
        totalPages: Math.ceil(totalCount / sanitizedLimit),
        totalCount,
        limit: sanitizedLimit,
      },
    };
  }
}

/**
 * Filters accepted by CalendarService.listAllCalendarsForAdmin.
 */
export interface AdminCalendarListFilters {
  search?: string;
  hasOpenReports?: boolean;
  sortBy?: 'created' | 'lastActivity' | 'eventCount';
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

/**
 * Row DTO returned by CalendarService.listAllCalendarsForAdmin.
 *
 * Deliberately omits owner email — admins reach contact info through the
 * account-management path, not this list.
 */
export interface AdminCalendarRow {
  id: string;
  urlName: string;
  title: string;
  owner: {
    accountId: string;
    displayName: string;
  };
  upcomingEventCount: number;
  lastActivityAt: Date | null;
  fundingStatus: 'subscribed' | 'grant' | 'none';
  openReportCount: number;
}

export interface AdminCalendarListResult {
  items: AdminCalendarRow[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalCount: number;
    limit: number;
  };
}

export default CalendarService;
