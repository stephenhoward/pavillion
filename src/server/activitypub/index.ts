import { Application } from 'express';
import ActivityPubInterface from '@/server/activitypub/interface';
import ActivityPubEventHandlers from '@/server/activitypub/events';
import ActivityPubAPI from '@/server/activitypub/api/v1';
import { EventEmitter } from 'stream';
import CalendarInterface from '../calendar/interface';
import AccountsInterface from '../accounts/interface';
import ModerationInterface from '../moderation/interface';

/**
 * ActivityPub domain entry point
 * Manages social federation protocols and ActivityPub message handling
 */
export default class ActivityPubDomain {
  public readonly interface: ActivityPubInterface;
  private readonly calendarInterface: CalendarInterface;
  private readonly accountsInterface: AccountsInterface;
  private readonly moderationInterface?: ModerationInterface;
  private readonly eventBus: EventEmitter;

  constructor(
    eventBus: EventEmitter,
    calendarInterface: CalendarInterface,
    accountsInterface: AccountsInterface,
    moderationInterface?: ModerationInterface,
  ) {
    this.eventBus = eventBus;
    this.calendarInterface = calendarInterface;
    this.accountsInterface = accountsInterface;
    this.moderationInterface = moderationInterface;
    this.interface = new ActivityPubInterface(eventBus, calendarInterface, accountsInterface, moderationInterface);
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
