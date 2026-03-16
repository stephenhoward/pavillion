import { EventEmitter } from 'events';
import FundingService from './funding';
import { logError } from '@/server/common/helper/error-logger';

/**
 * Shared event bus for subscription jobs
 */
const eventBus = new EventEmitter();

/**
 * Shared subscription service instance for jobs
 */
const subscriptionService = new FundingService(eventBus);

/**
 * Check for subscriptions that have exceeded their grace period
 * and transition them to suspended status.
 *
 * This job should be run on a regular schedule (e.g., hourly).
 */
export async function checkGracePeriodExpiry(): Promise<void> {
  try {
    await subscriptionService.suspendExpiredSubscriptions();
    console.log('[SubscriptionJobs] Grace period check completed');
  }
  catch (error) {
    logError(error, '[Subscription] Error checking grace period expiry');
    throw error;
  }
}

/**
 * Start all subscription scheduled jobs
 *
 * @returns Function to stop all jobs
 */
export function startScheduledJobs(): () => void {
  console.log('[SubscriptionJobs] Starting scheduled jobs');

  // Run grace period check every hour
  const gracePeriodInterval = setInterval(() => {
    checkGracePeriodExpiry().catch((error) => {
      logError(error, '[Subscription] Grace period check failed');
    });
  }, 60 * 60 * 1000); // 1 hour in milliseconds

  // Run initial check on startup (after 10 seconds to allow system to stabilize)
  setTimeout(() => {
    checkGracePeriodExpiry().catch((error) => {
      logError(error, '[Subscription] Initial grace period check failed');
    });
  }, 10000);

  // Return cleanup function
  return () => {
    console.log('[SubscriptionJobs] Stopping scheduled jobs');
    clearInterval(gracePeriodInterval);
  };
}
