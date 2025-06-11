import { Application } from 'express';
import MediaInterface from '@/server/media/interface';
import MediaEventHandlers from '@/server/media/events';
import MediaAPI from '@/server/media/api/v1';
import { EventEmitter } from 'events';

export default class MediaDomain {
  public readonly interface: MediaInterface;
  private readonly eventBus: EventEmitter;

  constructor(eventBus: EventEmitter) {
    this.eventBus = eventBus;
    this.interface = new MediaInterface(eventBus);
  }

  public initialize(app: Application): void {
    this.installAPI(app);
    this.installEventHandlers();
  }

  public installAPI(app: Application) {
    MediaAPI.install(app, this.interface);
  }

  public installEventHandlers() {
    new MediaEventHandlers(this.interface).install(this.eventBus);
  }
}

