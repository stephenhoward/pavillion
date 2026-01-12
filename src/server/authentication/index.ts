import { Application } from 'express';
import { EventEmitter } from 'events';
import AuthenticationInterface from './interface';
import { AuthenticationEventHandlers } from './events';
import AuthenticationAPI from './api/v1';
import AccountsInterface from '../accounts/interface';
import EmailInterface from '../email/interface';


/**
 * Authentication Domain entry point.
 * Manages authentication services and provides the internal API.
 */
export default class AuthenticationDomain {
  public interface: AuthenticationInterface;
  private readonly eventBus: EventEmitter;
  private readonly accountsInterface: AccountsInterface;

  constructor(eventBus: EventEmitter, accountsInterface: AccountsInterface, emailInterface: EmailInterface) {
    this.eventBus = eventBus;
    this.accountsInterface = accountsInterface;
    this.interface = new AuthenticationInterface(eventBus, accountsInterface, emailInterface);
  }

  public initialize(app: Application): void {
    this.installAPI(app);
    this.installEventHandlers();
  }

  public installAPI(app: Application) {
    AuthenticationAPI.install(app, this.interface, this.accountsInterface);
  }

  public installEventHandlers() {
    new AuthenticationEventHandlers(this.interface).install(this.eventBus);
  }

}
