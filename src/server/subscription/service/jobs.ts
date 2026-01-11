import { EventEmitter } from 'events';
import SubscriptionService from './subscription';

/**
 * Shared event bus for subscription jobs
 */
const eventBus = new EventEmitter();

/**
 * Shared subscription service instance for jobs
 */
const subscriptionService = new SubscriptionService(eventBus);

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
  } catch (error) {
    console.error('[SubscriptionJobs] Error checking grace period expiry:', error);
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
      console.error('[SubscriptionJobs] Grace period check failed:', error);
    });
  }, 60 * 60 * 1000); // 1 hour in milliseconds

  // Run initial check on startup (after 10 seconds to allow system to stabilize)
  setTimeout(() => {
    checkGracePeriodExpiry().catch((error) => {
      console.error('[SubscriptionJobs] Initial grace period check failed:', error);
    });
  }, 10000);

  // Return cleanup function
  return () => {
    console.log('[SubscriptionJobs] Stopping scheduled jobs');
    clearInterval(gracePeriodInterval);
  };
}
