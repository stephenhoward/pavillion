import { Application } from 'express';
import { EventEmitter } from 'events';

import CalendarInterface from '@/server/calendar/interface';
import NotificationService from '@/server/notifications/service/notification';
import NotificationsInterface from '@/server/notifications/interface';
import NotificationEventHandlers from '@/server/notifications/events';
import NotificationAPI from '@/server/notifications/api/v1';

export default class NotificationsDomain {
  public readonly interface: NotificationsInterface;
  private readonly eventBus: EventEmitter;
  private readonly calendarInterface: CalendarInterface;
  private readonly service: NotificationService;

  constructor(eventBus: EventEmitter, calendarInterface: CalendarInterface) {
    this.eventBus = eventBus;
    this.calendarInterface = calendarInterface;
    this.service = new NotificationService();
    this.interface = new NotificationsInterface(this.service);
  }

  public initialize(app: Application): void {
    this.installAPI(app);
    this.installEventHandlers();
  }

  public installAPI(app: Application): void {
    NotificationAPI.install(app, this.interface);
  }

  public installEventHandlers(): void {
    new NotificationEventHandlers(this.service, this.calendarInterface).install(this.eventBus);
  }
}
