#!/usr/bin/env tsx

/**
 * Backfill script to generate UserActor entities for existing accounts
 *
 * This script generates RSA-2048 keypairs and UserActor records for all accounts
 * that don't have an associated UserActor yet.
 *
 * Usage: tsx src/server/activitypub/scripts/backfill-user-actors.ts
 */

import config from 'config';
import db from '@/server/common/entity/db';
import { AccountEntity } from '@/server/common/entity/account';
import UserActorService from '@/server/activitypub/service/user_actor';
import CalendarInterface from '@/server/calendar/interface';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('activitypub');

/**
 * Backfills UserActor entities for all accounts that don't have one
 * @param domain - The domain to use for actor URIs
 * @param verbose - Whether to log detailed progress (default: true)
 * @returns Object containing counts of created, skipped, and errored accounts
 */
export async function backfillUserActors(domain?: string, verbose: boolean = true): Promise<{ created: number; skipped: number; errors: number }> {
  if (verbose) {
    logger.info('Starting UserActor backfill');
  }

  try {
    // Get domain from parameter or configuration
    const domainToUse = domain || (config.get('domain') as string);
    if (!domainToUse) {
      throw new Error('Domain not configured. Please set domain in config or pass as parameter.');
    }

    if (verbose) {
      logger.info({ domain: domainToUse }, 'Using domain');
    }

    // Retrieve all accounts
    const accounts = await AccountEntity.findAll();
    if (verbose) {
      logger.info({ count: accounts.length }, 'Found total accounts');
    }

    // Track progress
    let createdCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    const userActorService = new UserActorService({} as CalendarInterface);

    // Process each account
    for (const accountEntity of accounts) {
      const account = accountEntity.toModel();

      // Skip accounts without username
      if (!account.username || account.username.trim() === '') {
        if (verbose) {
          logger.warn({ accountId: account.id, email: account.email }, 'Skipped account: no username set');
        }
        skippedCount++;
        continue;
      }

      try {
        // Check if UserActor already exists
        const existingActor = await userActorService.getActorByAccountId(account.id);
        if (existingActor) {
          if (verbose) {
            logger.info({ username: account.username }, 'Skipped account: UserActor already exists');
          }
          skippedCount++;
          continue;
        }

        // Create UserActor with keypair
        const userActor = await userActorService.createActor(account, domainToUse);

        if (verbose) {
          logger.info({ username: account.username, actorUri: userActor.actorUri }, 'Created UserActor');
        }
        createdCount++;
      }
      catch (error) {
        logger.error({ err: error, username: account.username }, 'Error creating UserActor');
        errorCount++;
      }
    }

    // Print summary
    if (verbose) {
      logger.info({
        totalAccounts: accounts.length,
        created: createdCount,
        skipped: skippedCount,
        errors: errorCount,
      }, 'UserActor backfill summary');

      if (errorCount > 0) {
        logger.warn({ errorCount }, 'Some accounts failed to generate UserActors');
      }
      else if (createdCount > 0) {
        logger.info('Backfill completed successfully');
      }
      else {
        logger.info('No new UserActors needed');
      }
    }

    return { created: createdCount, skipped: skippedCount, errors: errorCount };
  }
  catch (error) {
    logger.error({ err: error }, 'Fatal error during backfill');
    throw error;
  }
}

/**
 * Standalone script execution - runs backfill and exits with appropriate code
 */
async function runBackfillScript() {
  try {
    // Initialize database connection
    await db.sync();

    const result = await backfillUserActors();

    if (result.errors > 0) {
      process.exit(1);
    }
    else {
      process.exit(0);
    }
  }
  catch (error) {
    logger.error({ err: error }, 'Fatal error during backfill');
    process.exit(1);
  }
}

// Run the backfill when executed as a script
if (import.meta.url === `file://${process.argv[1]}`) {
  runBackfillScript();
}
