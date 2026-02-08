import { Application } from 'express';
import ModerationInterface from './interface';
import ModerationEventHandlers from './events';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import EmailInterface from '@/server/email/interface';
import { EventEmitter } from 'events';

/**
 * Moderation domain entry point.
 *
 * Manages the report lifecycle including creation, verification,
 * status transitions, and escalation for content moderation.
 */
export default class ModerationDomain {
  public readonly interface: ModerationInterface;
  private readonly eventBus: EventEmitter;

  constructor(
    eventBus: EventEmitter,
    calendarInterface: CalendarInterface,
    accountsInterface: AccountsInterface,
    emailInterface: EmailInterface,
  ) {
    this.eventBus = eventBus;
    this.interface = new ModerationInterface(eventBus, calendarInterface, accountsInterface, emailInterface);
  }

  public initialize(_app: Application): void {
    this.installEventHandlers();
  }

  public installEventHandlers() {
    new ModerationEventHandlers(this.interface).install(this.eventBus);
  }
}
