import { Application } from 'express';
import { EventEmitter } from 'events';
import FundingInterface from '@/server/funding/interface';
import FundingEventHandlers from '@/server/funding/events';
import FundingApiV1 from '@/server/funding/api/v1';
import { startScheduledJobs } from '@/server/funding/service/jobs';
import type CalendarInterface from '@/server/calendar/interface';
import type AccountsInterface from '@/server/accounts/interface';
import type ConfigurationInterface from '@/server/configuration/interface';
import type EmailInterface from '@/server/email/interface';

/**
 * Funding Domain entry point.
 * Manages funding services and payment provider integrations.
 */
export default class FundingDomain {
  private readonly eventBus: EventEmitter;
  public readonly interface: FundingInterface;
  private readonly eventHandlers: FundingEventHandlers;
  private stopJobs?: () => void;

  /**
   * @param eventBus - The shared domain event bus
   * @param emailInterface - Sends the plan owner's dunning emails; optional so
   *   test harnesses that need no email can construct the domain without it
   */
  constructor(eventBus: EventEmitter, emailInterface?: EmailInterface) {
    this.eventBus = eventBus;
    this.interface = new FundingInterface(eventBus);
    this.eventHandlers = new FundingEventHandlers(emailInterface);
  }

  /**
   * Injects CalendarInterface into the funding service for cross-domain
   * calendar ownership and existence checks. Called after CalendarDomain is
   * initialized to avoid circular construction dependencies.
   *
   * @param calendarInterface - The CalendarInterface instance from the calendar domain
   */
  setCalendarInterface(calendarInterface: CalendarInterface): void {
    this.interface.setCalendarInterface(calendarInterface);
  }

  /**
   * Injects ConfigurationInterface into the funding service so the provider
   * product name can follow the instance title.
   *
   * @param configurationInterface - The ConfigurationInterface from the configuration domain
   */
  setConfigurationInterface(configurationInterface: ConfigurationInterface): void {
    this.interface.setConfigurationInterface(configurationInterface);
  }

  /**
   * Injects AccountsInterface into the funding service for cross-domain
   * account role checks (admin exemption from funding gates), and into the
   * event handlers to resolve a plan owner's address for dunning emails.
   *
   * @param accountsInterface - The AccountsInterface instance from the accounts domain
   */
  setAccountsInterface(accountsInterface: AccountsInterface): void {
    this.interface.setAccountsInterface(accountsInterface);
    this.eventHandlers.setAccountsInterface(accountsInterface);
  }

  public initialize(app: Application): void {
    // Install event handlers
    this.eventHandlers.install(this.eventBus);

    // Install API routes
    this.installAPI(app);

    // Start scheduled jobs (grace period check)
    this.stopJobs = startScheduledJobs(this.eventBus);
  }

  public installAPI(app: Application): void {
    // Install v1 API routes (admin, user, webhooks, provider connection)
    FundingApiV1.install(app, this.interface);
  }

  /**
   * Cleanup function to stop scheduled jobs
   * Call this during graceful shutdown
   */
  public shutdown(): void {
    if (this.stopJobs) {
      this.stopJobs();
    }
  }
}
