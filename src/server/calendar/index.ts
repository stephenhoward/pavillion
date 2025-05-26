import { Application } from 'express';
import CalendarInterface from './interface';
import CalendarEventHandlers from './events';
import CalendarAPI from './api/v1';
import { EventEmitter } from 'events';

export default class CalendarDomain {
  public readonly interface: CalendarInterface;
  private readonly eventBus: EventEmitter;

  constructor(eventBus: EventEmitter) {
    this.eventBus = eventBus;
    this.interface = new CalendarInterface(eventBus);
  }

  public initialize(app: Application): void {
    this.installAPI(app);
    this.installEventHandlers();
  }

  public installAPI(app: Application) {
    CalendarAPI.install(app, this.interface);
  }

  public installEventHandlers() {
    new CalendarEventHandlers().install(this.eventBus);
  }
}

