import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { Account } from '@/common/model/account';
import { EventLocation } from '@/common/model/location';
import { CalendarEditor } from '@/common/model/calendar_editor';
import { EventCategory } from '@/common/model/event_category';
import { EventCategoryAssignmentModel } from '@/common/model/event_category_assignment';
import AccountInvitation from '@/common/model/invitation';
import CalendarService from '../service/calendar';
import EventService from '../service/events';
import LocationService from '../service/locations';
import CategoryService from '../service/categories';
import { EventEmitter } from 'events';
import EventInstanceService from '../service/event_instance';
import CalendarEventInstance from '@/common/model/event_instance';
import AccountsInterface from '@/server/accounts/interface';
import ConfigurationInterface from '@/server/configuration/interface';

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

  constructor(
    eventBus: EventEmitter,
    accountsInterface?: AccountsInterface,
    configurationInterface?: ConfigurationInterface,
  ) {
    this.calendarService = new CalendarService(accountsInterface, configurationInterface);
    this. eventService = new EventService(eventBus);
    this. locationService = new LocationService();
    this.eventInstanceService = new EventInstanceService(eventBus);
    this.categoryService = new CategoryService();
  }

  // Calendar operations
  async getCalendar(id: string): Promise<Calendar | null> {
    return this.calendarService.getCalendar(id);
  }

  async getCalendarByName(name: string): Promise<Calendar | null> {
    return this.calendarService.getCalendarByName(name);
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

  async getPrimaryCalendarForUser(account: Account): Promise<Calendar | null> {
    return this.calendarService.getPrimaryCalendarForUser(account);
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

  async deleteEvent(account: Account, eventId: string): Promise<void> {
    return this.eventService.deleteEvent(account, eventId);
  }

  async addRemoteEvent(calendar: Calendar, eventParams: Record<string, any>): Promise<CalendarEvent> {
    return this.eventService.addRemoteEvent(calendar, eventParams);
  }

  // Location operations
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

  async listEventInstancesForCalendar(calendar: Calendar): Promise<CalendarEventInstance[]> {
    return this.eventInstanceService.listEventInstancesForCalendar(calendar);
  }

  async getEventInstanceById(instanceId: string): Promise<CalendarEventInstance | null> {
    return this.eventInstanceService.getEventInstanceById(instanceId);
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

  async deleteCategory(account: Account, categoryId: string, calendarId?: string): Promise<void> {
    return this.categoryService.deleteCategory(account, categoryId, calendarId);
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

}
