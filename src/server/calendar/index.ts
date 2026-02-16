import { Application } from 'express';
import CalendarInterface from './interface';
import CalendarEventHandlers from './events';
import CalendarAPI from './api/v1';
import AccountsInterface from '@/server/accounts/interface';
import EmailInterface from '@/server/email/interface';
import SubscriptionInterface from '@/server/subscription/interface';
import { EventEmitter } from 'events';

export default class CalendarDomain {
  public readonly interface: CalendarInterface;
  private readonly eventBus: EventEmitter;
  private accountsInterface?: AccountsInterface;

  constructor(
    eventBus: EventEmitter,
    accountsInterface?: AccountsInterface,
    emailInterface?: EmailInterface,
    subscriptionInterface?: SubscriptionInterface,
  ) {
    this.eventBus = eventBus;
    this.accountsInterface = accountsInterface;
    this.interface = new CalendarInterface(eventBus, accountsInterface, emailInterface, subscriptionInterface);
  }

  public initialize(app: Application): void {
    this.installAPI(app);
    this.installEventHandlers();
  }

  public installAPI(app: Application) {
    CalendarAPI.install(app, this.interface);
  }

  public installEventHandlers() {
    new CalendarEventHandlers(this.interface).install(this.eventBus);
  }
}
