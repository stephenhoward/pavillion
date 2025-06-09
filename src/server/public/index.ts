import { Application } from 'express';
import PublicCalendarAPI from './api/v1';
import { EventEmitter } from 'events';
import PublicCalendarInterface from './interface';
import CalendarDomain from '../calendar';

export default class PublicCalendarDomain {
  public readonly interface: PublicCalendarInterface;
  private readonly eventBus: EventEmitter;

  constructor(eventBus: EventEmitter, calendarDomain: CalendarDomain) {
    this.eventBus = eventBus;
    this.interface = new PublicCalendarInterface(eventBus, calendarDomain.interface);
  }

  public initialize(app: Application): void {
    this.installAPI(app);
  }

  public installAPI(app: Application) {
    PublicCalendarAPI.install(app, this.interface);
  }

}

