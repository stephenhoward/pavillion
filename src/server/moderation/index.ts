import express, { Application } from 'express';
import ModerationInterface from './interface';
import ModerationEventHandlers from './events';
import EscalationScheduler from './service/escalation-scheduler';
import PublicReportRoutes from './api/v1/public-report-routes';
import AuthenticatedReportRoutes from './api/v1/authenticated-report-routes';
import VerifyRoutes from './api/v1/verify-routes';
import OwnerReportRoutes from './api/v1/owner-report-routes';
import AdminReportRoutes from './api/v1/admin-report-routes';
import AdminSettingsRoutes from './api/v1/admin-settings-routes';
import AdminInstanceRoutes from './api/v1/admin-instance-routes';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import EmailInterface from '@/server/email/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import { EventEmitter } from 'events';

/**
 * Moderation domain entry point.
 *
 * Manages the report lifecycle including creation, verification,
 * status transitions, and escalation for content moderation.
 * Includes a scheduled task for automatic escalation of overdue reports.
 */
export default class ModerationDomain {
  public readonly interface: ModerationInterface;
  private readonly eventBus: EventEmitter;
  private readonly calendarInterface: CalendarInterface;
  private readonly accountsInterface: AccountsInterface;
  private readonly emailInterface: EmailInterface;
  private readonly configurationInterface: ConfigurationInterface;
  private scheduler: EscalationScheduler | null = null;

  constructor(
    eventBus: EventEmitter,
    calendarInterface: CalendarInterface,
    accountsInterface: AccountsInterface,
    emailInterface: EmailInterface,
    configurationInterface: ConfigurationInterface,
  ) {
    this.eventBus = eventBus;
    this.calendarInterface = calendarInterface;
    this.accountsInterface = accountsInterface;
    this.emailInterface = emailInterface;
    this.configurationInterface = configurationInterface;
    this.interface = new ModerationInterface(eventBus, calendarInterface, accountsInterface, emailInterface, configurationInterface);
  }

  public initialize(app: Application): void {
    this.installEventHandlers();
    this.installAPI(app);
    this.startScheduler();
  }

  public installEventHandlers() {
    new ModerationEventHandlers(
      this.interface,
      this.calendarInterface,
      this.accountsInterface,
      this.emailInterface,
    ).install(this.eventBus);
  }

  public installAPI(app: Application): void {
    app.use(express.json());

    const publicReportRoutes = new PublicReportRoutes(this.interface);
    publicReportRoutes.installHandlers(app, '/api/public/v1');

    const authenticatedReportRoutes = new AuthenticatedReportRoutes(this.interface);
    authenticatedReportRoutes.installHandlers(app, '/api/v1');

    const verifyRoutes = new VerifyRoutes(this.interface);
    verifyRoutes.installHandlers(app, '/api/public/v1');

    const ownerReportRoutes = new OwnerReportRoutes(this.interface, this.calendarInterface);
    ownerReportRoutes.installHandlers(app, '/api/v1');

    const adminReportRoutes = new AdminReportRoutes(this.interface);
    adminReportRoutes.installHandlers(app, '/api/v1');

    const adminSettingsRoutes = new AdminSettingsRoutes(this.interface);
    adminSettingsRoutes.installHandlers(app, '/api/v1');

    const adminInstanceRoutes = new AdminInstanceRoutes(this.interface);
    adminInstanceRoutes.installHandlers(app, '/api/v1');
  }

  /**
   * Starts the escalation scheduler for periodic deadline checks.
   * The scheduler is not started in test environments.
   */
  private startScheduler(): void {
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    this.scheduler = new EscalationScheduler(
      this.interface.getModerationService(),
      this.eventBus,
    );
    this.scheduler.start();
  }

  /**
   * Gracefully shuts down the moderation domain.
   * Stops the escalation scheduler if running.
   */
  public shutdown(): void {
    if (this.scheduler) {
      this.scheduler.stop();
      this.scheduler = null;
    }
  }
}
