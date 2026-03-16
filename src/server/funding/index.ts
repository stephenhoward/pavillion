import { Application } from 'express';
import { EventEmitter } from 'events';
import FundingInterface from '@/server/funding/interface';
import FundingEventHandlers from '@/server/funding/events';
import FundingApiV1 from '@/server/funding/api/v1';
import { startScheduledJobs } from '@/server/funding/service/jobs';
import type CalendarInterface from '@/server/calendar/interface';

/**
 * Funding Domain entry point.
 * Manages funding services and payment provider integrations.
 */
export default class FundingDomain {
  private readonly eventBus: EventEmitter;
  public readonly interface: FundingInterface;
  private readonly eventHandlers: FundingEventHandlers;
  private stopJobs?: () => void;

  constructor(eventBus: EventEmitter) {
    this.eventBus = eventBus;
    this.interface = new FundingInterface(eventBus);
    this.eventHandlers = new FundingEventHandlers();
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

  public initialize(app: Application): void {
    // Install event handlers
    this.eventHandlers.install(this.eventBus);

    // Install API routes
    this.installAPI(app);

    // Start scheduled jobs (grace period check)
    this.stopJobs = startScheduledJobs();
  }

  public installAPI(app: Application): void {
    // Install v1 API routes (admin, user, webhooks, provider connection)
    FundingApiV1.install(app, this.interface, this.eventBus);
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
