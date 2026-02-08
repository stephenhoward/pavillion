import express, { Application } from 'express';
import ModerationInterface from './interface';
import ModerationEventHandlers from './events';
import PublicReportRoutes from './api/v1/public-report-routes';
import AuthenticatedReportRoutes from './api/v1/authenticated-report-routes';
import VerifyRoutes from './api/v1/verify-routes';
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
  private readonly calendarInterface: CalendarInterface;
  private readonly emailInterface: EmailInterface;

  constructor(
    eventBus: EventEmitter,
    calendarInterface: CalendarInterface,
    accountsInterface: AccountsInterface,
    emailInterface: EmailInterface,
  ) {
    this.eventBus = eventBus;
    this.calendarInterface = calendarInterface;
    this.emailInterface = emailInterface;
    this.interface = new ModerationInterface(eventBus, calendarInterface, accountsInterface, emailInterface);
  }

  public initialize(app: Application): void {
    this.installEventHandlers();
    this.installAPI(app);
  }

  public installEventHandlers() {
    new ModerationEventHandlers(this.interface, this.calendarInterface, this.emailInterface)
      .install(this.eventBus);
  }

  public installAPI(app: Application): void {
    app.use(express.json());

    const publicReportRoutes = new PublicReportRoutes(this.interface);
    publicReportRoutes.installHandlers(app, '/api/public/v1');

    const authenticatedReportRoutes = new AuthenticatedReportRoutes(this.interface);
    authenticatedReportRoutes.installHandlers(app, '/api/v1');

    const verifyRoutes = new VerifyRoutes(this.interface);
    verifyRoutes.installHandlers(app, '/api/public/v1');
  }
}
