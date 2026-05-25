import { Application } from 'express';
import { EventEmitter } from 'events';

import AccountsInterface from '@/server/accounts/interface';
import CalendarInterface from '@/server/calendar/interface';
import NotificationService from '@/server/notifications/service/notification';
import NotificationsInterface from '@/server/notifications/interface';
import NotificationEventHandlers from '@/server/notifications/events';
import NotificationAPI from '@/server/notifications/api/v1';

export default class NotificationsDomain {
  public readonly interface: NotificationsInterface;
  private readonly eventBus: EventEmitter;
  private readonly calendarInterface: CalendarInterface;
  private readonly accountsInterface: AccountsInterface;
  private readonly service: NotificationService;

  constructor(
    eventBus: EventEmitter,
    calendarInterface: CalendarInterface,
    accountsInterface: AccountsInterface,
  ) {
    this.eventBus = eventBus;
    this.calendarInterface = calendarInterface;
    this.accountsInterface = accountsInterface;
    // `recordActivity` needs both calendar and accounts interfaces injected
    // to resolve role-based audiences. The
    // dependencies are bundled in `RoleResolverDeps`; passing them here
    // keeps the composition root as the only place that wires concrete
    // domain interfaces into the notifications service.
    this.service = new NotificationService({
      calendarInterface,
      accountsInterface,
    });
    this.interface = new NotificationsInterface(this.service);
  }

  public initialize(app: Application): void {
    this.installAPI(app);
    this.installEventHandlers();
  }

  public installAPI(app: Application): void {
    // The read endpoint delegates the recipient+activity query and wire-
    // shape projection to the service through the domain interface,
    // matching the convention used by every other domain API. See
    //.getNotifications`.
    NotificationAPI.install(app, this.interface);
  }

  /**
   * Wires the seven-event subscriber. The handler needs both
   * `CalendarInterface` and `AccountsInterface` to resolve the `Flag`
   * audience (owners + admins combined) locally before calling
   * `recordActivity` — see `NotificationEventHandlers` for the
   * audience-routing rules.
   */
  public installEventHandlers(): void {
    new NotificationEventHandlers(
      this.service,
      this.calendarInterface,
      this.accountsInterface,
    ).install(this.eventBus);
  }
}
