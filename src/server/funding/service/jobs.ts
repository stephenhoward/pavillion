import { EventEmitter } from 'events';
import FundingService from './funding';
import { logError } from '@/server/common/helper/error-logger';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('funding');

/**
 * Check for funding plans that have exceeded their grace period
 * and transition them to suspended status.
 *
 * This job should be run on a regular schedule (e.g., hourly).
 *
 * @param fundingService - Service whose event bus carries the
 *   funding:plan:suspended events this emits to the domain's handlers
 */
export async function checkGracePeriodExpiry(fundingService: FundingService): Promise<void> {
  try {
    await fundingService.suspendExpiredFundingPlans();
    logger.info('Grace period check completed');
  }
  catch (error) {
    logError(error, '[FundingJobs] Error checking grace period expiry');
    throw error;
  }
}

/**
 * Check for complimentary grants that have passed their expiration date
 * and auto-revoke them.
 *
 * This job should be run on a regular schedule (e.g., hourly).
 */
export async function checkGrantExpiration(fundingService: FundingService): Promise<void> {
  try {
    await fundingService.revokeExpiredGrants();
    logger.info('Grant expiration check completed');
  }
  catch (error) {
    logError(error, '[FundingJobs] Error checking grant expiration');
    throw error;
  }
}

/**
 * Start all funding plan scheduled jobs
 *
 * The jobs emit lifecycle events (a grace-period suspension emails the plan
 * owner), so they must run on the domain's own event bus — the one its
 * handlers are installed on. A bus of their own has no listeners, and every
 * event they emit is silently dropped.
 *
 * @param eventBus - The funding domain's event bus
 * @returns Function to stop all jobs
 */
export function startScheduledJobs(eventBus: EventEmitter): () => void {
  logger.info('Starting scheduled jobs');
  const fundingService = new FundingService(eventBus);

  // Run grace period check every hour
  const gracePeriodInterval = setInterval(() => {
    checkGracePeriodExpiry(fundingService).catch((error) => {
      logError(error, '[FundingJobs] Grace period check failed');
    });
  }, 60 * 60 * 1000); // 1 hour in milliseconds

  // Run grant expiration check every hour
  const grantExpirationInterval = setInterval(() => {
    checkGrantExpiration(fundingService).catch((error) => {
      logError(error, '[FundingJobs] Grant expiration check failed');
    });
  }, 60 * 60 * 1000); // 1 hour in milliseconds

  // Run initial checks on startup (after 10 seconds to allow system to stabilize)
  setTimeout(() => {
    checkGracePeriodExpiry(fundingService).catch((error) => {
      logError(error, '[FundingJobs] Initial grace period check failed');
    });
    checkGrantExpiration(fundingService).catch((error) => {
      logError(error, '[FundingJobs] Initial grant expiration check failed');
    });
  }, 10000);

  // Return cleanup function
  return () => {
    logger.info('Stopping scheduled jobs');
    clearInterval(gracePeriodInterval);
    clearInterval(grantExpirationInterval);
  };
}
