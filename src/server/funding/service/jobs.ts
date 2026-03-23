import { EventEmitter } from 'events';
import FundingService from './funding';
import { logError } from '@/server/common/helper/error-logger';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('funding');

/**
 * Shared event bus for funding plan jobs
 */
const eventBus = new EventEmitter();

/**
 * Shared funding service instance for jobs
 */
const fundingService = new FundingService(eventBus);

/**
 * Check for funding plans that have exceeded their grace period
 * and transition them to suspended status.
 *
 * This job should be run on a regular schedule (e.g., hourly).
 */
export async function checkGracePeriodExpiry(): Promise<void> {
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
export async function checkGrantExpiration(): Promise<void> {
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
 * @returns Function to stop all jobs
 */
export function startScheduledJobs(): () => void {
  logger.info('Starting scheduled jobs');

  // Run grace period check every hour
  const gracePeriodInterval = setInterval(() => {
    checkGracePeriodExpiry().catch((error) => {
      logError(error, '[FundingJobs] Grace period check failed');
    });
  }, 60 * 60 * 1000); // 1 hour in milliseconds

  // Run grant expiration check every hour
  const grantExpirationInterval = setInterval(() => {
    checkGrantExpiration().catch((error) => {
      logError(error, '[FundingJobs] Grant expiration check failed');
    });
  }, 60 * 60 * 1000); // 1 hour in milliseconds

  // Run initial checks on startup (after 10 seconds to allow system to stabilize)
  setTimeout(() => {
    checkGracePeriodExpiry().catch((error) => {
      logError(error, '[FundingJobs] Initial grace period check failed');
    });
    checkGrantExpiration().catch((error) => {
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
