import { Application } from 'express';
import ConfigurationInterface from './interface';
import ConfigurationAPI from './api/v1';
import { EventEmitter } from 'stream';


/**
 * Configuration Domain entry point.
 * Manages configuration services and provides the internal API.
 */
export default class ConfigurationDomain {
  public readonly interface: ConfigurationInterface;
  private readonly eventBus: EventEmitter;

  constructor(eventBus: EventEmitter) {
    this.eventBus = eventBus;
    this.interface = new ConfigurationInterface(eventBus);
  }

  public initialize(app: Application): void {
    this.installAPI(app);
  }

  public installAPI(app: Application) {
    ConfigurationAPI.install(app, this.interface);
  }

}
