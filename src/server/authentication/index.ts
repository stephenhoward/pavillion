import { Application } from 'express';
import { EventEmitter } from 'events';
import { DomainDependencies } from '@/server/common/types/domain';
import AuthenticationInterface from './interface';
import { AuthenticationEventHandlers } from './events';
import AuthenticationAPI from './api/v1';
import AccountsInterface from '../accounts/interface';


/**
 * Authentication Domain entry point.
 * Manages authentication services and provides the internal API.
 */
export default class AuthenticationDomain {
  public interface: AuthenticationInterface;
  private accountInterface: AccountsInterface;
  private readonly eventBus: EventEmitter;

  constructor(eventBus: EventEmitter) {
    this.eventBus = eventBus;
    this.interface = new AuthenticationInterface(eventBus);
    this.accountInterface = new AccountsInterface(eventBus);
  }

  public initialize(app: Application): void {
    this.installAPI(app);
    this.installEventHandlers();
  }

  public installAPI(app: Application) {
    AuthenticationAPI.install(app, this.interface, this.accountInterface);
  }

  public installEventHandlers() {
    new AuthenticationEventHandlers(this.interface).install(this.eventBus);
  }

}
