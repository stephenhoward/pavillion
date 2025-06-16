import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { Account } from '@/common/model/account';
import { EventLocation } from '@/common/model/location';
import { CalendarEditor } from '@/common/model/calendar_editor';
import CalendarService from '../service/calendar';
import EventService from '../service/events';
import LocationService from '../service/locations';
import { EventEmitter } from 'events';
import EventInstanceService from '../service/event_instance';
import CalendarEventInstance from '@/common/model/event_instance';
import AccountsInterface from '@/server/accounts/interface';

export default class CalendarInterface {
  private calendarService: CalendarService;
  private eventService: EventService;
  private locationService: LocationService;
  private eventInstanceService: EventInstanceService;

  constructor(eventBus: EventEmitter, accountsInterface?: AccountsInterface) {
    this.calendarService = new CalendarService(accountsInterface);
    this. eventService = new EventService(eventBus);
    this. locationService = new LocationService();
    this.eventInstanceService = new EventInstanceService(eventBus);
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

  async userCanModifyCalendar(account: Account, calendar: Calendar): Promise<boolean> {
    return this.calendarService.userCanModifyCalendar(account, calendar);
  }

  async getPrimaryCalendarForUser(account: Account): Promise<Calendar | null> {
    return this.calendarService.getPrimaryCalendarForUser(account);
  }

  // Event operations
  async listEvents(calendar: Calendar): Promise<CalendarEvent[]> {
    return this.eventService.listEvents(calendar);
  }

  async getEventById(eventId: string): Promise<CalendarEvent> {
    return this.eventService.getEventById(eventId);
  }

  async createEvent(account: Account, calendar: Calendar, eventParams: Record<string, any>): Promise<CalendarEvent> {
    return this.eventService.createEvent(account, calendar, eventParams);
  }

  async updateEvent(account: Account, eventId: string, eventParams: Record<string, any>): Promise<CalendarEvent> {
    return this.eventService.updateEvent(account, eventId, eventParams);
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

  // Editor management operations
  async grantEditAccess(grantingAccount: Account, calendarId: string, editorAccountId: string): Promise<CalendarEditor> {
    return this.calendarService.grantEditAccess(grantingAccount, calendarId, editorAccountId);
  }

  async revokeEditAccess(revokingAccount: Account, calendarId: string, editorAccountId: string): Promise<boolean> {
    return this.calendarService.revokeEditAccess(revokingAccount, calendarId, editorAccountId);
  }

  async getCalendarEditors(calendarId: string): Promise<CalendarEditor[]> {
    return this.calendarService.getCalendarEditors(calendarId);
  }

  async canViewCalendarEditors(account: Account, calendarId: string): Promise<boolean> {
    return this.calendarService.canViewCalendarEditors(account, calendarId);
  }
}
