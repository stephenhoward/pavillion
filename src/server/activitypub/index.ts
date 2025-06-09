import { Application } from 'express';
import ActivityPubInterface from '@/server/activitypub/interface';
import ActivityPubEventHandlers from '@/server/activitypub/events';
import ActivityPubAPI from '@/server/activitypub/api/v1';
import { EventEmitter } from 'stream';
import CalendarInterface from '../calendar/interface';

/**
 * ActivityPub domain entry point
 * Manages social federation protocols and ActivityPub message handling
 */
export default class ActivityPubDomain {
  public readonly interface: ActivityPubInterface;
  private readonly calendarInterface: CalendarInterface;
  private readonly eventBus: EventEmitter;

  constructor(eventBus: EventEmitter) {
    this.eventBus = eventBus;
    this.interface = new ActivityPubInterface(eventBus);
    this.calendarInterface = new CalendarInterface(eventBus);
  }

  public initialize(app: Application): void {
    this.installAPI(app);
    this.installEventHandlers();
  }

  public installAPI(app: Application) {
    ActivityPubAPI.install(app, this.interface, this.calendarInterface);
  }

  public installEventHandlers() {
    new ActivityPubEventHandlers(this.interface).install(this.eventBus);
  }

}
