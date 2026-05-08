import { Calendar, DefaultDateRange } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { Account } from '@/common/model/account';
import { EventLocation } from '@/common/model/location';
import { CalendarEditor } from '@/common/model/calendar_editor';
import { CalendarMember } from '@/common/model/calendar_member';
import { EventCategory } from '@/common/model/event_category';
import { EventCategoryAssignmentModel } from '@/common/model/event_category_assignment';
import { EventSeries } from '@/common/model/event_series';
import AccountInvitation from '@/common/model/invitation';
import CalendarService, { AdminCalendarListFilters, AdminCalendarListResult } from '../service/calendar';
import EventService from '../service/events';
import LocationService from '../service/locations';
import CategoryService from '../service/categories';
import CategoryMappingService from '@/server/calendar/service/category_mapping';
import WidgetDomainService from '../service/widget_domain';
import WidgetConfigService from '../service/widget_config';
import { WidgetConfig } from '@/common/model/widget_config';
import { EventEmitter } from 'events';
import EventInstanceService, { UpcomingOccurrencesResult } from '../service/event_instance';
import { DateTime } from 'luxon';
import SeriesService from '../service/series';
import ImportSourceService from '../service/import/import_source_service';
import SyncService, { type SyncDependencies, type SyncResult } from '../service/import/sync';
import { ImportSource, ImportSourceVerificationType } from '@/common/model/import_source';
import CalendarEventInstance from '@/common/model/event_instance';
import AccountsInterface from '@/server/accounts/interface';
import EmailInterface from '@/server/email/interface';
import FundingInterface from '@/server/funding/interface';
import type MediaInterface from '@/server/media/interface';
import type ActivityPubInterface from '@/server/activitypub/interface';
import type ModerationInterface from '@/server/moderation/interface';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';
import { CalendarEditorPermissionError } from '@/common/exceptions/editor';

export interface CalendarWithRole {
  calendar: Calendar;
  role: 'owner' | 'editor';
}

export interface CalendarEditorsResponse {
  activeEditors: CalendarEditor[];
  pendingInvitations: AccountInvitation[];
}

export default class CalendarInterface {
  private calendarService: CalendarService;
  private eventService: EventService;
  private locationService: LocationService;
  private eventInstanceService: EventInstanceService;
  private categoryService: CategoryService;
  private widgetDomainService: WidgetDomainService;
  private widgetConfigService: WidgetConfigService;
  private categoryMappingService: CategoryMappingService;
  private seriesService: SeriesService;
  private importSourceService: ImportSourceService;

  constructor(
    eventBus: EventEmitter,
    accountsInterface?: AccountsInterface,
    emailInterface?: EmailInterface,
    fundingInterface?: FundingInterface,
  ) {
    this.calendarService = new CalendarService(accountsInterface, emailInterface, eventBus, fundingInterface);
    this.eventService = new EventService(eventBus);
    this.locationService = new LocationService();
    // EventInstanceService listing depends on EventService.listEventIdsForCalendar
    // (single-producer model). Inject the shared instance so the AP-interface
    // wiring and any future EventService configuration apply uniformly to both
    // consumers.
    this.eventInstanceService = new EventInstanceService(eventBus, this.eventService);
    this.categoryService = new CategoryService(this.calendarService);
    this.widgetDomainService = new WidgetDomainService();
    this.widgetConfigService = new WidgetConfigService(this.calendarService);
    this.categoryMappingService = new CategoryMappingService();
    this.seriesService = new SeriesService(this.calendarService, eventBus);
    // A single shared SyncService instance is constructed here so the
    // per-source in-memory rate limiter has stable state across invocations,
    // and injected directly into ImportSourceService via its constructor.
    const sharedSyncService = new SyncService({
      eventService: this.eventService,
      calendarService: this.calendarService,
    });
    this.importSourceService = new ImportSourceService(this.calendarService, sharedSyncService);
  }

  /**
   * Construct a {@link SyncService} wired with the domain's internal
   * EventService and CalendarService. Intended for CLI / operational entry
   * points that need to drive the sync pipeline outside the HTTP path — the
   * HTTP path goes through {@link ImportSourceService} via
   * {@link syncImportSource}.
   *
   * Callers may pass additional overrides (fetcher, rateLimiter, parseICS,
   * now) for tests or alternative transport wiring. Providing
   * `eventService` or `calendarService` here overrides the interface's
   * internally-wired services.
   *
   * Exposing this factory keeps the interface's internal services private
   * while still giving the CLI a supported way to materialize a sync
   * pipeline.
   *
   * @param overrides - Optional subset of SyncDependencies to override
   * @returns A new SyncService instance using interface-internal services
   */
  createSyncService(overrides: Partial<SyncDependencies> = {}): SyncService {
    return new SyncService({
      eventService: this.eventService,
      calendarService: this.calendarService,
      ...overrides,
    });
  }

  /**
   * Injects MediaInterface into the services that need it for cross-domain media lookups.
   * Called after MediaDomain is initialized to avoid circular construction dependencies.
   *
   * @param mediaInterface - The MediaInterface instance from the media domain
   */
  setMediaInterface(mediaInterface: MediaInterface): void {
    this.eventService.setMediaInterface(mediaInterface);
    this.seriesService.setMediaInterface(mediaInterface);
  }

  /**
   * Injects ActivityPubInterface into the services that need it for cross-domain AP lookups.
   * Called after ActivityPubDomain is initialized to avoid circular construction dependencies.
   *
   * @param apInterface - The ActivityPubInterface instance from the activitypub domain
   */
  setActivityPubInterface(apInterface: ActivityPubInterface): void {
    this.eventService.setActivityPubInterface(apInterface);
    this.eventInstanceService.setActivityPubInterface(apInterface);
    this.calendarService.setActivityPubInterface(apInterface);
    this.categoryMappingService.setActivityPubInterface(apInterface);
  }

  /**
   * Injects ModerationInterface into the services that need it for cross-domain moderation lookups.
   * Called after ModerationDomain is initialized to avoid circular construction dependencies.
   *
   * @param moderationInterface - The ModerationInterface instance from the moderation domain
   */
  setModerationInterface(moderationInterface: ModerationInterface): void {
    this.calendarService.setModerationInterface(moderationInterface);
  }

  // Calendar operations
  async getCalendar(id: string): Promise<Calendar | null> {
    return this.calendarService.getCalendar(id);
  }

  async getCalendarByName(name: string): Promise<Calendar | null> {
    return this.calendarService.getCalendarByName(name);
  }

  async getCalendarForWidget(urlName: string): Promise<Calendar> {
    return this.calendarService.getCalendarForWidget(urlName);
  }

  async createCalendar(account: Account, urlName: string, name?: string): Promise<Calendar> {
    return this.calendarService.createCalendar(account, urlName, name);
  }

  async setUrlName(account: Account, calendar: Calendar, urlName: string): Promise<boolean> {
    return this.calendarService.setUrlName(account, calendar, urlName);
  }

  isValidUrlName(urlName: string): boolean {
    return this.calendarService.isValidUrlName(urlName);
  }

  async editableCalendarsForUser(account: Account): Promise<Calendar[]> {
    return this.calendarService.editableCalendarsForUser(account);
  }

  async editableCalendarsWithRoleForUser(account: Account): Promise<CalendarWithRole[]> {
    return this.calendarService.editableCalendarsWithRoleForUser(account);
  }

  async userCanModifyCalendar(account: Account, calendar: Calendar): Promise<boolean> {
    return this.calendarService.userCanModifyCalendar(account, calendar);
  }

  /**
   * Checks if a user can review reports for a calendar.
   * Admins and owners always can; editors need can_review_reports.
   *
   * @param account - The account to check
   * @param calendarId - The calendar UUID
   * @returns True if the user can review reports
   */
  async userCanReviewReports(account: Account, calendarId: string): Promise<boolean> {
    return this.calendarService.userCanReviewReports(account, calendarId);
  }

  async getPrimaryCalendarForUser(account: Account): Promise<Calendar | null> {
    return this.calendarService.getPrimaryCalendarForUser(account);
  }

  /**
   * Retrieves the account ID of the calendar owner.
   *
   * @param calendarId - The calendar UUID to find the owner for
   * @returns The owner's account ID, or null if no owner found
   */
  async getCalendarOwnerAccountId(calendarId: string): Promise<string | null> {
    return this.calendarService.getCalendarOwnerAccountId(calendarId);
  }

  /**
   * Checks if a specific account is the owner of a calendar using primitive IDs.
   *
   * @param accountId - The account UUID to check
   * @param calendarId - The calendar UUID to check ownership of
   * @returns True if the account owns the calendar
   */
  async isCalendarOwnerById(accountId: string, calendarId: string): Promise<boolean> {
    return this.calendarService.isCalendarOwnerById(accountId, calendarId);
  }

  /**
   * Checks if a calendar exists by its primary key.
   *
   * @param calendarId - The calendar UUID to check
   * @returns True if the calendar exists
   */
  async calendarExists(calendarId: string): Promise<boolean> {
    return this.calendarService.calendarExists(calendarId);
  }

  /**
   * Checks if a remote actor (identified by actor URI) is an editor of the given calendar.
   *
   * @param actorUri - The ActivityPub actor URI of the remote user
   * @param calendarId - The calendar UUID to check membership for
   * @returns True if the actor has editor access to the calendar
   */
  async isEditorOfCalendar(actorUri: string, calendarId: string): Promise<boolean> {
    return this.calendarService.isEditorOfCalendar(actorUri, calendarId);
  }

  /**
   * Returns all accounts with edit access to a calendar (owner + editors).
   * Used for notification fan-out.
   *
   * @param calendarId - The calendar UUID to get editors for
   * @returns Array of Account models; empty array if calendar not found
   */
  async getEditorsForCalendar(calendarId: string): Promise<Account[]> {
    return this.calendarService.getEditorsForCalendar(calendarId);
  }

  /**
   * List all local calendars for admin visibility with pagination and filtering.
   * Delegates to CalendarService; see service docs for full filter/sort semantics.
   *
   * @param filters - Search, sort, pagination, and report-filter options
   * @returns Paginated envelope of AdminCalendarRow DTOs
   */
  async listAllCalendarsForAdmin(filters: AdminCalendarListFilters = {}): Promise<AdminCalendarListResult> {
    return this.calendarService.listAllCalendarsForAdmin(filters);
  }

  // Event operations
  async listEvents(calendar: Calendar, options?: {
    search?: string;
    categories?: string[];
  }): Promise<CalendarEvent[]> {
    return this.eventService.listEvents(calendar, options);
  }

  async getEventById(eventId: string, displayCalendarId?: string): Promise<CalendarEvent> {
    return this.eventService.getEventById(eventId, displayCalendarId);
  }

  async createEvent(account: Account, eventParams: Record<string, any>): Promise<CalendarEvent> {
    return this.eventService.createEvent(account, eventParams);
  }

  async updateEvent(account: Account, eventId: string, eventParams: Record<string, any>): Promise<CalendarEvent> {
    return this.eventService.updateEvent(account, eventId, eventParams);
  }

  async deleteEvent(account: Account, eventId: string, calendarId?: string): Promise<void> {
    return this.eventService.deleteEvent(account, eventId, calendarId);
  }

  async addRemoteEvent(calendar: Calendar, eventParams: Record<string, any>): Promise<CalendarEvent> {
    return this.eventService.addRemoteEvent(calendar, eventParams);
  }

  async updateRemoteEvent(calendar: Calendar, eventParams: Record<string, any>): Promise<CalendarEvent> {
    return this.eventService.updateRemoteEvent(calendar, eventParams);
  }

  async deleteRemoteEvent(eventId: string): Promise<void> {
    return this.eventService.deleteRemoteEvent(eventId);
  }

  // Location operations
  async getLocationsForCalendar(calendar: Calendar): Promise<EventLocation[]> {
    return this.locationService.getLocationsForCalendar(calendar);
  }

  async getLocationById(calendar: Calendar, locationId: string): Promise<EventLocation | null> {
    return this.locationService.getLocationById(calendar, locationId);
  }

  async findLocation(calendar: Calendar, location: EventLocation): Promise<EventLocation | null> {
    return this.locationService.findLocation(calendar, location);
  }

  async createLocation(calendar: Calendar, location: EventLocation): Promise<EventLocation> {
    return this.locationService.createLocation(calendar, location);
  }

  async findOrCreateLocation(calendar: Calendar, locationParams: Record<string, any>): Promise<EventLocation> {
    return this.locationService.findOrCreateLocation(calendar, locationParams);
  }

  /**
   * Update an existing location's fields and content.
   *
   * @param calendar - The calendar that should own the location
   * @param locationId - The ID of the location to update
   * @param location - The location model with updated data
   * @returns Updated EventLocation model, or null if not found
   */
  async updateLocation(calendar: Calendar, locationId: string, location: EventLocation): Promise<EventLocation | null> {
    return this.locationService.updateLocation(calendar, locationId, location);
  }

  /**
   * Delete a location and nullify location_id on associated events.
   *
   * @param calendar - The calendar that should own the location
   * @param locationId - The ID of the location to delete
   * @returns True if deleted, false if not found
   */
  async deleteLocation(calendar: Calendar, locationId: string): Promise<boolean> {
    return this.locationService.deleteLocation(calendar, locationId);
  }

  /**
   * Reassign events from one Space to another within a single Place.
   *
   * Single SQL UPDATE inside a transaction:
   *   UPDATE events SET space_id = :toSpaceId
   *   WHERE place_id = :placeId AND space_id = :fromSpaceId
   *
   * The `place_id` WHERE-clause is the safety boundary — events outside this
   * Place can never be touched. Out-of-Place `fromSpaceId` returns
   * `{ count: 0, placeFound: true, toSpaceValid: true }` (idempotent no-op
   * for retry semantics).
   *
   * @param calendar - The calendar that should own the Place
   * @param placeId - The Place id; events outside this Place are never touched
   * @param fromSpaceId - The current Space id to migrate events away from
   * @param toSpaceId - The destination Space id; must be on this Place
   * @returns `{ count, placeFound, toSpaceValid }` discriminator object
   */
  async reassignEvents(
    calendar: Calendar,
    placeId: string,
    fromSpaceId: string,
    toSpaceId: string,
  ): Promise<{ count: number; placeFound: boolean; toSpaceValid: boolean }> {
    return this.locationService.reassignEvents(calendar, placeId, fromSpaceId, toSpaceId);
  }

  async buildEventInstances(event: CalendarEvent): Promise<void> {
    return this.eventInstanceService.buildEventInstances(event);
  }

  async removeEventInstances(event: CalendarEvent): Promise<void> {
    return this.eventInstanceService.removeEventInstances(event);
  }

  async refreshAllEventInstances(): Promise<void> {
    return this.eventInstanceService.refreshAllEventInstances();
  }

  async listEventInstances(event: CalendarEvent): Promise<CalendarEventInstance[]> {
    return this.eventInstanceService.listEventInstances(event);
  }

  /**
   * List all event instances for a calendar without filters.
   * Used by internal calendar-domain code and legacy public-domain paths
   * (e.g. listEventInstances, listEventInstancesWithCategoryFilter in PublicCalendarService).
   * Prefer listEventInstancesWithFilters for new public-facing queries.
   */
  async listEventInstancesForCalendar(calendar: Calendar): Promise<CalendarEventInstance[]> {
    return this.eventInstanceService.listEventInstancesForCalendar(calendar);
  }

  async getEventInstanceById(instanceId: string): Promise<CalendarEventInstance | null> {
    return this.eventInstanceService.getEventInstanceById(instanceId);
  }

  /**
   * List event instances for a calendar with combined filters.
   * Augments each instance with isRecurring on the event object.
   *
   * @param calendar - The calendar to filter events for
   * @param options - Filter options (search, categories, startDate, endDate)
   * @returns Filtered event instances, each augmented with isRecurring
   */
  async listEventInstancesWithFilters(
    calendar: Calendar,
    options?: {
      search?: string;
      categories?: string[];
      startDate?: string;
      endDate?: string;
    },
  ): Promise<CalendarEventInstance[]> {
    return this.eventInstanceService.listEventInstancesWithFilters(calendar, options);
  }

  /**
   * Get a single event instance with full schedule, location content, and category data.
   * Schedules are loaded onto the model so the public API layer can compute
   * `isRecurring` + `recurrenceSummary` via `toPublicEventObject` before
   * stripping them from the response.
   *
   * @param instanceId - The UUID of the event instance
   * @returns The event instance augmented with schedule detail, or null if not found
   */
  async getEventInstanceWithDetails(instanceId: string): Promise<CalendarEventInstance | null> {
    return this.eventInstanceService.getEventInstanceWithDetails(instanceId);
  }

  /**
   * Look up an event instance by (eventId, startTime), materializing it on
   * demand from the event's RRuleSet if it hasn't been persisted yet. Used by
   * the public (event + timestamp) URL route so bookmarks survive the
   * materialization horizon and race safely with scheduled materialization.
   *
   * @param eventId - The owning event ID
   * @param startTime - Occurrence start datetime (minute precision)
   * @returns Hydrated CalendarEventInstance or null if not found / invalid
   */
  async findOrMaterializeInstanceWithDetails(
    eventId: string,
    startTime: DateTime,
    displayCalendarId?: string,
  ): Promise<CalendarEventInstance | null> {
    return this.eventInstanceService.findOrMaterializeInstanceWithDetails(eventId, startTime, displayCalendarId);
  }

  /**
   * List upcoming occurrences of a recurring event, tagging each with its
   * state (active / cancelled-shown / hidden). Transient DTOs — not persisted.
   *
   * @param event - The recurring event; its schedules must be loaded
   * @param afterDate - Occurrences strictly after this datetime are returned
   * @param limit - Maximum occurrences to return
   * @returns Occurrences with state flags and a hasMore indicator
   */
  async listUpcomingOccurrences(
    event: CalendarEvent,
    afterDate: DateTime,
    limit: number,
  ): Promise<UpcomingOccurrencesResult> {
    return this.eventInstanceService.listUpcomingOccurrences(event, afterDate, limit);
  }

  /**
   * Cancel a single occurrence of a recurring event by its start datetime
   * rather than by a materialized instance ID. Decouples the UI from the
   * instance materialization horizon.
   *
   * @param account - Authenticated account (must be calendar editor)
   * @param eventId - The owning event ID
   * @param start - Occurrence start datetime; must match the rrule
   * @param hideFromPublic - true for EXDATE-style hidden, false for
   *                         RECURRENCE-ID-style shown cancellation
   */
  async cancelOccurrenceByDate(
    account: Account,
    eventId: string,
    start: DateTime,
    hideFromPublic: boolean,
  ): Promise<void> {
    return this.eventInstanceService.cancelOccurrenceByDate(account, eventId, start, hideFromPublic);
  }

  /**
   * Restore a previously cancelled occurrence by deleting the exclusion row
   * for the given start datetime. Silent no-op if no exclusion exists.
   *
   * @param account - Authenticated account (must be calendar editor)
   * @param eventId - The owning event ID
   * @param start - Occurrence start datetime for the exclusion row
   */
  async restoreOccurrenceByDate(
    account: Account,
    eventId: string,
    start: DateTime,
  ): Promise<void> {
    return this.eventInstanceService.restoreOccurrenceByDate(account, eventId, start);
  }

  async grantEditAccessByEmail(grantingAccount: Account, calendarId: string, email: string, message?: string): Promise<{ type: 'editor' | 'invitation', data: CalendarEditor | any }> {
    return this.calendarService.grantEditAccessByEmail(grantingAccount, calendarId, email, message);
  }

  async grantEditAccess(grantingAccount: Account, calendarId: string, editorAccountId: string): Promise<CalendarEditor> {
    return this.calendarService.grantEditAccess(grantingAccount, calendarId, editorAccountId);
  }

  async removeEditAccess(revokingAccount: Account, calendarId: string, editorAccountId: string): Promise<boolean> {
    return this.calendarService.removeEditAccess(revokingAccount, calendarId, editorAccountId);
  }

  async removeRemoteEditor(revokingAccount: Account, calendarId: string, actorUri: string): Promise<boolean> {
    return this.calendarService.removeRemoteEditor(revokingAccount, calendarId, actorUri);
  }

  async listCalendarEditors(account: Account, calendarId: string): Promise<CalendarEditor[]> {
    return this.calendarService.listCalendarEditors(account, calendarId);
  }

  async listCalendarEditorsWithInvitations(account: Account, calendarId: string): Promise<CalendarEditorsResponse> {
    return this.calendarService.listCalendarEditorsWithInvitations(account, calendarId);
  }

  async cancelCalendarInvitation(requestingAccount: Account, calendarId: string, invitationId: string): Promise<boolean> {
    return this.calendarService.cancelCalendarInvitation(requestingAccount, calendarId, invitationId);
  }

  async resendCalendarInvitation(requestingAccount: Account, calendarId: string, invitationId: string): Promise<AccountInvitation | undefined> {
    return this.calendarService.resendCalendarInvitation(requestingAccount, calendarId, invitationId);
  }

  /**
   * Update permissions for an editor on a calendar.
   *
   * @param account - The account making the update (must be calendar owner)
   * @param calendarId - The ID of the calendar
   * @param editorAccountId - The account ID of the editor
   * @param permissions - The permissions to update
   * @returns The updated CalendarMember
   */
  async updateEditorPermissions(
    account: Account,
    calendarId: string,
    editorAccountId: string,
    permissions: { canReviewReports: boolean },
  ): Promise<CalendarMember> {
    return this.calendarService.updateEditorPermissions(account, calendarId, editorAccountId, permissions);
  }

  // Category operations
  async getCategories(calendarId: string): Promise<EventCategory[]> {
    return this.categoryService.getCategories(calendarId);
  }

  async getCategory(categoryId: string, calendarId?: string): Promise<EventCategory> {
    return this.categoryService.getCategory(categoryId, calendarId);
  }

  async createCategory(account: Account, calendarId: string, categoryData: {
    name: string;
    language: string;
  }): Promise<EventCategory> {
    return this.categoryService.createCategory(account, calendarId, categoryData);
  }

  async updateCategory(account: Account, categoryId: string, updateData: Record<string, any>, calendarId?: string): Promise<EventCategory> {
    return this.categoryService.updateCategory(account, categoryId, updateData, calendarId);
  }

  async deleteCategory(
    account: Account,
    categoryId: string,
    calendarId?: string,
    action?: 'remove' | 'migrate',
    targetCategoryId?: string,
  ): Promise<number> {
    return this.categoryService.deleteCategory(account, categoryId, calendarId, action, targetCategoryId);
  }

  async mergeCategories(
    account: Account,
    calendarId: string,
    targetCategoryId: string,
    sourceCategoryIds: string[],
  ): Promise<{ totalAffectedEvents: number }> {
    return this.categoryService.mergeCategories(account, calendarId, targetCategoryId, sourceCategoryIds);
  }

  async getCategoryStats(calendarId: string): Promise<Map<string, number>> {
    return this.categoryService.getCategoryStats(calendarId);
  }

  // Category assignment operations
  async assignCategoryToEvent(account: Account, eventId: string, categoryId: string): Promise<EventCategoryAssignmentModel> {
    return this.categoryService.assignCategoryToEvent(account, eventId, categoryId);
  }

  async unassignCategoryFromEvent(account: Account, eventId: string, categoryId: string): Promise<void> {
    return this.categoryService.unassignCategoryFromEvent(account, eventId, categoryId);
  }

  async setCategoriesForEvent(account: Account, eventId: string, categoryIds: string[]): Promise<CalendarEvent> {
    await this.categoryService.setCategoriesForEvent(account, eventId, categoryIds);
    return this.getEventById(eventId);
  }

  async getEventCategories(eventId: string, calendarId?: string): Promise<EventCategory[]> {
    return this.categoryService.getEventCategories(eventId, calendarId);
  }

  async getCategoryEvents(categoryId: string, calendarId?: string): Promise<string[]> {
    return this.categoryService.getCategoryEvents(categoryId, calendarId);
  }

  async bulkAssignCategories(
    account: Account,
    eventIds: string[],
    categoryIds: string[],
  ): Promise<CalendarEvent[]> {
    return this.eventService.bulkAssignCategories(account, eventIds, categoryIds);
  }

  async replaceEventCategories(
    account: Account,
    eventId: string,
    categoryIds: string[],
    calendarId?: string,
  ): Promise<CalendarEvent> {
    return this.eventService.replaceEventCategories(account, eventId, categoryIds, calendarId);
  }

  // Calendar settings operations
  async updateCalendarSettings(
    account: Account,
    calendarId: string,
    settings: {
      defaultDateRange?: DefaultDateRange;
      defaultEventImageId?: string | null;
      content?: Record<string, { name?: string; description?: string }>;
    },
  ): Promise<Calendar> {
    return this.calendarService.updateCalendarSettings(account, calendarId, settings);
  }

  // Widget domain operations
  async getWidgetDomain(account: Account, calendarId: string): Promise<string | null> {
    const calendar = await this.calendarService.getCalendar(calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    const canModify = await this.calendarService.userCanModifyCalendar(account, calendar);
    if (!canModify) {
      throw new CalendarEditorPermissionError();
    }

    return this.widgetDomainService.getAllowedDomain(calendar);
  }

  async setWidgetDomain(account: Account, calendarId: string, domain: string): Promise<void> {
    // Get calendar and check permissions
    const calendar = await this.calendarService.getCalendar(calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    const canModify = await this.calendarService.userCanModifyCalendar(account, calendar);
    if (!canModify) {
      throw new CalendarEditorPermissionError();
    }

    // Call service method for subscription check
    await this.calendarService.setWidgetDomain(account, calendarId, domain);

    // Set the domain using widget domain service
    return this.widgetDomainService.setAllowedDomain(calendar, domain);
  }

  async clearWidgetDomain(account: Account, calendarId: string): Promise<void> {
    const calendar = await this.calendarService.getCalendar(calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    const canModify = await this.calendarService.userCanModifyCalendar(account, calendar);
    if (!canModify) {
      throw new CalendarEditorPermissionError();
    }

    return this.widgetDomainService.clearAllowedDomain(calendar);
  }

  // Widget config operations

  /**
   * Public widget-serving read. Returns stored widget config for the calendar
   * identified by URL name, or a fresh defaults WidgetConfig when no row exists.
   * No permission check — used by the anonymous widget iframe path.
   *
   * @param calendarUrlName - The calendar's URL name
   * @returns The stored or default WidgetConfig
   */
  async getWidgetConfig(calendarUrlName: string): Promise<WidgetConfig> {
    return this.widgetConfigService.getWidgetConfig(calendarUrlName);
  }

  /**
   * Editor-permission-checked widget config read for the admin UI.
   *
   * @param account - The requesting account
   * @param calendarId - The calendar UUID
   * @returns The stored or default WidgetConfig
   */
  async getWidgetConfigForEditor(account: Account, calendarId: string): Promise<WidgetConfig> {
    return this.widgetConfigService.getWidgetConfigForEditor(account, calendarId);
  }

  /**
   * Upsert widget config for a calendar. Editor permission required; not
   * subscription-gated.
   *
   * @param account - The requesting account
   * @param calendarId - The calendar UUID
   * @param config - Partial WidgetConfig; missing fields fall back to defaults
   * @returns The persisted WidgetConfig
   */
  async setWidgetConfig(
    account: Account,
    calendarId: string,
    config: Partial<WidgetConfig>,
  ): Promise<WidgetConfig> {
    return this.widgetConfigService.setWidgetConfig(account, calendarId, config);
  }

  // Category mapping operations

  /**
   * Assigns explicitly selected local categories to a manually reposted event.
   * Delegates to CategoryMappingService; no permission check needed here because
   * the caller (shareEvent) has already verified the user can modify the calendar.
   *
   * @param eventId - The local event ID to assign categories to
   * @param categoryIds - Local category IDs selected by the user in the repost modal
   */
  async assignManualRepostCategories(eventId: string, categoryIds: string[]): Promise<void> {
    return this.categoryMappingService.assignManualRepostCategories(eventId, categoryIds);
  }

  // Series operations

  /**
   * Validate a series URL name against the allowed pattern.
   *
   * @param urlName - The URL name to validate
   * @returns true if valid, false otherwise
   */
  isValidSeriesUrlName(urlName: string): boolean {
    return this.seriesService.isValidUrlName(urlName);
  }

  /**
   * Create a new event series for a calendar.
   *
   * @param account - The account performing the creation
   * @param calendarId - The calendar to create the series in
   * @param seriesData - Series data including urlName, mediaId, and content
   * @returns The created EventSeries
   */
  async createSeries(account: Account, calendarId: string, seriesData: Record<string, any>): Promise<EventSeries> {
    return this.seriesService.createSeries(account, calendarId, seriesData);
  }

  /**
   * Get a specific series by ID with optional calendar scope enforcement.
   *
   * @param seriesId - The ID of the series to retrieve
   * @param calendarId - Optional calendar ID to verify series belongs to calendar
   * @returns The EventSeries
   */
  async getSeries(seriesId: string, calendarId?: string): Promise<EventSeries> {
    return this.seriesService.getSeries(seriesId, calendarId);
  }

  /**
   * Get a series by its URL name within a calendar.
   *
   * @param calendarId - The calendar to search within
   * @param urlName - The URL name of the series
   * @returns The EventSeries
   */
  async getSeriesByUrlName(calendarId: string, urlName: string): Promise<EventSeries> {
    return this.seriesService.getSeriesByUrlName(calendarId, urlName);
  }

  /**
   * Get all series for a calendar.
   *
   * @param calendarId - The calendar to retrieve series for
   * @returns Array of EventSeries
   */
  async getSeriesForCalendar(calendarId: string): Promise<EventSeries[]> {
    return this.seriesService.getSeriesForCalendar(calendarId);
  }

  /**
   * Update a series with new data.
   *
   * @param account - The account performing the update
   * @param seriesId - The ID of the series to update
   * @param seriesData - The data to update
   * @param calendarId - Optional calendar ID to verify series belongs to calendar
   * @returns The updated EventSeries
   */
  async updateSeries(account: Account, seriesId: string, seriesData: Record<string, any>, calendarId?: string): Promise<EventSeries> {
    return this.seriesService.updateSeries(account, seriesId, seriesData, calendarId);
  }

  /**
   * Delete a series and clear series_id from associated events.
   *
   * @param account - The account performing the deletion
   * @param seriesId - The ID of the series to delete
   * @param calendarId - Optional calendar ID to verify series belongs to calendar
   */
  async deleteSeries(account: Account, seriesId: string, calendarId?: string): Promise<void> {
    return this.seriesService.deleteSeries(account, seriesId, calendarId);
  }

  /**
   * Assign an event to a series.
   *
   * @param account - The account performing the assignment
   * @param eventId - The ID of the event to assign
   * @param seriesId - The ID of the series to assign the event to
   */
  async setSeriesForEvent(account: Account, eventId: string, seriesId: string): Promise<void> {
    return this.seriesService.setSeriesForEvent(account, eventId, seriesId);
  }

  /**
   * Clear the series assignment from an event (set series_id to null).
   *
   * @param account - The account performing the operation
   * @param eventId - The ID of the event to clear
   */
  async clearSeriesForEvent(account: Account, eventId: string): Promise<void> {
    return this.seriesService.clearSeriesForEvent(account, eventId);
  }

  /**
   * Get the series assigned to an event, if any.
   *
   * @param eventId - The ID of the event
   * @returns The EventSeries if assigned, or null
   */
  async getEventSeries(eventId: string): Promise<EventSeries | null> {
    return this.seriesService.getEventSeries(eventId);
  }

  /**
   * Get event counts per series for a calendar.
   *
   * @param calendarId - The calendar ID to get stats for
   * @returns Map of series ID to event count
   */
  async getSeriesStats(calendarId: string): Promise<Map<string, number>> {
    return this.seriesService.getSeriesStats(calendarId);
  }

  /**
   * Get all events belonging to a series.
   *
   * @param seriesId - The ID of the series
   * @param calendarId - Optional calendar ID to verify the series belongs to it
   * @returns Array of CalendarEvent with full eager loading
   */
  async getSeriesEvents(seriesId: string, calendarId?: string): Promise<CalendarEvent[]> {
    return this.seriesService.getSeriesEvents(seriesId, calendarId);
  }

  /**
   * Retrieves events from calendars that the given calendar is following.
   * Delegates to EventService; used by ActivityPubService to avoid
   * crossing the domain boundary by importing EventEntity directly.
   *
   * @param calendar - The calendar whose followed sources should be queried
   * @param page - Zero-based page number for pagination (default: 0)
   * @param pageSize - Number of events per page (default: 20)
   * @returns Array of CalendarEvent domain models from followed sources
   */
  async getEventsFromFollowedSources(calendar: Calendar, page?: number, pageSize?: number): Promise<CalendarEvent[]> {
    return this.eventService.getEventsFromFollowedSources(calendar, page, pageSize);
  }

  /**
   * Record that a local account has been granted editor access to a remote calendar.
   * Idempotent — if membership already exists, returns the existing one.
   *
   * @param accountId - The local account ID
   * @param calendarActorId - The CalendarActorEntity ID for the remote calendar
   * @returns The CalendarMember domain model
   */
  async grantRemoteEditorAccess(accountId: string, calendarActorId: string): Promise<CalendarMember> {
    return this.calendarService.recordRemoteCalendarMembership(accountId, calendarActorId);
  }

  /**
   * Remove a local account's editor access record for a remote calendar.
   * Returns true if a membership was found and deleted, false if none existed.
   *
   * @param accountId - The local account ID
   * @param calendarActorId - The CalendarActorEntity ID for the remote calendar
   * @returns True if a membership was deleted, false otherwise
   */
  async removeRemoteEditorAccess(accountId: string, calendarActorId: string): Promise<boolean> {
    return this.calendarService.removeRemoteCalendarMembership(accountId, calendarActorId);
  }

  // Import source operations

  /**
   * List all import sources for a calendar.
   *
   * @param account - The requesting account (must own or edit the calendar)
   * @param calendarId - The calendar UUID
   * @returns Array of ImportSource models (verification token NOT included)
   */
  async listImportSources(account: Account, calendarId: string): Promise<ImportSource[]> {
    return this.importSourceService.listSources(account, calendarId);
  }

  /**
   * Create a new import source for a calendar.
   *
   * @param account - The requesting account (must own or edit the calendar)
   * @param calendarId - The calendar UUID
   * @param url - The ICS feed URL (HTTPS, non-private, SSRF-checked)
   * @returns The persisted ImportSource in `verification_state='pending'`
   */
  async createImportSource(account: Account, calendarId: string, url: string): Promise<ImportSource> {
    return this.importSourceService.createSource(account, calendarId, url);
  }

  /**
   * Get a single import source by id, scoped to the calendar.
   *
   * @param account - The requesting account (must own or edit the calendar)
   * @param calendarId - The calendar UUID
   * @param id - The import source UUID
   * @returns The matching ImportSource model
   */
  async getImportSource(account: Account, calendarId: string, id: string): Promise<ImportSource> {
    return this.importSourceService.getSource(account, calendarId, id);
  }

  /**
   * Delete an import source. DB cascade handles import_run rows; event
   * references are nulled out via ON DELETE SET NULL.
   *
   * @param account - The requesting account (must own or edit the calendar)
   * @param calendarId - The calendar UUID
   * @param id - The import source UUID
   */
  async deleteImportSource(account: Account, calendarId: string, id: string): Promise<void> {
    return this.importSourceService.deleteSource(account, calendarId, id);
  }

  /**
   * Issue the verification challenge token for an import source. The
   * token is the owner-only secret that must appear in the
   * `pavillion-verify=v1:{host}:{token}` TXT record (DNS) or in the
   * well-known URL referenced by a `<a rel="me">` backlink (rel-me).
   *
   * When `verificationType` is supplied and differs from the persisted
   * value, the source's verification mechanism is updated and any prior
   * `verified_at` proof is cleared so the source must re-enter the verify
   * gate under the new mechanism.
   *
   * @param account - The requesting account (must own or edit the calendar)
   * @param calendarId - The calendar UUID
   * @param id - The import source UUID
   * @param verificationType - Optional verification mechanism to set on the
   *   source. When omitted, the persisted type is preserved.
   * @returns The opaque verification token
   */
  async issueImportSourceChallenge(
    account: Account,
    calendarId: string,
    id: string,
    verificationType?: ImportSourceVerificationType,
  ): Promise<string> {
    return this.importSourceService.issueVerificationChallenge(
      account,
      calendarId,
      id,
      verificationType,
    );
  }

  /**
   * Run ownership verification for an import source and persist the outcome.
   *
   * Dispatches in the service layer based on the source's
   * `verificationType` discriminator: DNS TXT lookup for `'dns-txt'`
   * sources, rel="me" backlink check for `'rel-me'` sources.
   *
   * @param account - The requesting account (must own or edit the calendar)
   * @param calendarId - The calendar UUID
   * @param id - The import source UUID
   * @param verificationPageUrl - For `'rel-me'` sources only: the URL of
   *   the page hosting the `<a rel="me">` backlink. Required for rel-me;
   *   ignored otherwise. Validated in the service layer.
   * @returns The updated ImportSource model
   */
  async verifyImportSource(
    account: Account,
    calendarId: string,
    id: string,
    verificationPageUrl?: string,
  ): Promise<ImportSource> {
    return this.importSourceService.verifySource(
      account,
      calendarId,
      id,
      verificationPageUrl,
    );
  }

  /**
   * Trigger a manual sync run for an import source.
   *
   * @param account - The requesting account (must own or edit the calendar)
   * @param calendarId - The calendar UUID
   * @param id - The import source UUID
   * @returns Summary of the sync run
   */
  async syncImportSource(
    account: Account,
    calendarId: string,
    id: string,
  ): Promise<SyncResult> {
    return this.importSourceService.syncSource(account, calendarId, id);
  }

}
