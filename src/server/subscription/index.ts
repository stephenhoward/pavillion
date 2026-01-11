import { Application } from 'express';
import { EventEmitter } from 'events';
import SubscriptionInterface from '@/server/subscription/interface';
import SubscriptionEventHandlers from '@/server/subscription/events';
import SubscriptionApiV1 from '@/server/subscription/api/v1';
import { startScheduledJobs } from '@/server/subscription/service/jobs';

/**
 * Subscription Domain entry point.
 * Manages subscription services and payment provider integrations.
 */
export default class SubscriptionDomain {
  private readonly eventBus: EventEmitter;
  public readonly interface: SubscriptionInterface;
  private readonly eventHandlers: SubscriptionEventHandlers;
  private stopJobs?: () => void;

  constructor(eventBus: EventEmitter) {
    this.eventBus = eventBus;
    this.interface = new SubscriptionInterface(eventBus);
    this.eventHandlers = new SubscriptionEventHandlers();
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
    SubscriptionApiV1.install(app, this.interface, this.eventBus);
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
