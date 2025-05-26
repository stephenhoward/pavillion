import { Application } from 'express';
import { EventEmitter } from 'events';
import AccountsInterface from './interface';
import AccountsEventHandlers from './events';
import AccountAPI from './api/v1';

export default class AccountsDomain {
  public readonly interface: AccountsInterface;
  private readonly eventBus: EventEmitter;

  constructor(eventBus: EventEmitter) {
    this.eventBus = eventBus;
    this.interface = new AccountsInterface(eventBus);
  }

  public initialize(app: Application): void {
    this.installAPI(app);
    this.installEventHandlers();
  }

  public installAPI(app: Application) {
    AccountAPI.install(app, this.interface);
  }

  public installEventHandlers() {
    new AccountsEventHandlers().install(this.eventBus);
  }
}
