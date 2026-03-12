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
import CalendarService from '../service/calendar';
import EventService from '../service/events';
import LocationService from '../service/locations';
import CategoryService from '../service/categories';
import CategoryMappingService from '@/server/calendar/service/category_mapping';
import WidgetDomainService from '../service/widget_domain';
import { EventEmitter } from 'events';
import EventInstanceService from '../service/event_instance';
import SeriesService from '../service/series';
import CalendarEventInstance from '@/common/model/event_instance';
import AccountsInterface from '@/server/accounts/interface';
import EmailInterface from '@/server/email/interface';
import SubscriptionInterface from '@/server/subscription/interface';
import type MediaInterface from '@/server/media/interface';
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
  private categoryMappingService: CategoryMappingService;
  private seriesService: SeriesService;

  constructor(
    eventBus: EventEmitter,
    accountsInterface?: AccountsInterface,
    emailInterface?: EmailInterface,
    subscriptionInterface?: SubscriptionInterface,
  ) {
    this.calendarService = new CalendarService(accountsInterface, emailInterface, eventBus, subscriptionInterface);
    this.eventService = new EventService(eventBus);
    this.locationService = new LocationService();
    this.eventInstanceService = new EventInstanceService(eventBus);
    this.categoryService = new CategoryService(this.calendarService);
    this.widgetDomainService = new WidgetDomainService();
    this.categoryMappingService = new CategoryMappingService();
    this.seriesService = new SeriesService(this.calendarService, eventBus);
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

  // Event operations
  async listEvents(calendar: Calendar, options?: {
    search?: string;
    categories?: string[];
  }): Promise<CalendarEvent[]> {
    return this.eventService.listEvents(calendar, options);
  }

  async getEventById(eventId: string): Promise<CalendarEvent> {
    return this.eventService.getEventById(eventId);
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
   * Augments the event with pre-computed recurrenceText.
   *
   * @param instanceId - The UUID of the event instance
   * @returns The event instance augmented with schedule detail and recurrence text,
   *          or null if not found
   */
  async getEventInstanceWithDetails(instanceId: string): Promise<CalendarEventInstance | null> {
    return this.eventInstanceService.getEventInstanceWithDetails(instanceId);
  }

  /**
   * Builds event instances for a reposting calendar. Idempotent: removes any
   * existing repost instances for this (event, calendar) pair, then recreates
   * them from the event's schedules.
   *
   * @param event - The event to create instances for
   * @param repostCalendarId - The calendar ID that is reposting the event
   */
  async buildRepostInstances(event: CalendarEvent, repostCalendarId: string): Promise<void> {
    return this.eventInstanceService.buildRepostInstances(event, repostCalendarId);
  }

  /**
   * Rebuilds event instances for all local calendars that repost the given event.
   * Queries both manual reposts and federation shares, deduplicates, and rebuilds.
   *
   * @param event - The event whose repost instances should be rebuilt
   */
  async rebuildAllRepostInstances(event: CalendarEvent): Promise<void> {
    return this.eventInstanceService.rebuildAllRepostInstances(event);
  }

  /**
   * Removes all event instances for a specific (event, reposter calendar) pair.
   * Note: This method is NOT exposed through CalendarInterface for cross-domain use.
   * It is only used internally via event handlers. Exposed here for handler access.
   *
   * @param eventId - The event ID whose repost instances should be removed
   * @param calendarId - The reposting calendar ID
   */
  async removeRepostInstances(eventId: string, calendarId: string): Promise<void> {
    return this.eventInstanceService.removeRepostInstances(eventId, calendarId);
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

  async getEventCategories(eventId: string): Promise<EventCategory[]> {
    return this.categoryService.getEventCategories(eventId);
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

  // Calendar settings operations
  async updateCalendarSettings(
    account: Account,
    calendarId: string,
    settings: {
      defaultDateRange?: DefaultDateRange;
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

}
