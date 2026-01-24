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

/**
 * Backfills UserActor entities for all accounts that don't have one
 * @param domain - The domain to use for actor URIs
 * @param verbose - Whether to log detailed progress (default: true)
 * @returns Object containing counts of created, skipped, and errored accounts
 */
export async function backfillUserActors(domain?: string, verbose: boolean = true): Promise<{ created: number; skipped: number; errors: number }> {
  if (verbose) {
    console.log('Starting UserActor backfill...\n');
  }

  try {
    // Get domain from parameter or configuration
    const domainToUse = domain || (config.get('domain') as string);
    if (!domainToUse) {
      throw new Error('Domain not configured. Please set domain in config or pass as parameter.');
    }

    if (verbose) {
      console.log(`Domain: ${domainToUse}`);
    }

    // Retrieve all accounts
    const accounts = await AccountEntity.findAll();
    if (verbose) {
      console.log(`Found ${accounts.length} total accounts\n`);
    }

    // Track progress
    let createdCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    const userActorService = new UserActorService();

    // Process each account
    for (const accountEntity of accounts) {
      const account = accountEntity.toModel();

      // Skip accounts without username
      if (!account.username || account.username.trim() === '') {
        if (verbose) {
          console.log(`⚠️  Skipped account ${account.id} (${account.email}): No username set`);
        }
        skippedCount++;
        continue;
      }

      try {
        // Check if UserActor already exists
        const existingActor = await userActorService.getActorByAccountId(account.id);
        if (existingActor) {
          if (verbose) {
            console.log(`✓  Skipped account ${account.username}: UserActor already exists`);
          }
          skippedCount++;
          continue;
        }

        // Create UserActor with keypair
        const userActor = await userActorService.createActor(account, domainToUse);

        if (verbose) {
          console.log(`✓  Created UserActor for ${account.username} (${userActor.actorUri})`);
        }
        createdCount++;
      }
      catch (error) {
        console.error(`✗  Error creating UserActor for ${account.username}:`, error);
        errorCount++;
      }
    }

    // Print summary
    if (verbose) {
      console.log('\n' + '='.repeat(60));
      console.log('Backfill Summary:');
      console.log('='.repeat(60));
      console.log(`Total accounts processed: ${accounts.length}`);
      console.log(`UserActors created: ${createdCount}`);
      console.log(`Accounts skipped: ${skippedCount}`);
      console.log(`Errors: ${errorCount}`);
      console.log('='.repeat(60));

      if (errorCount > 0) {
        console.log('\n⚠️  Some accounts failed to generate UserActors. Review errors above.');
      }
      else if (createdCount > 0) {
        console.log('\n✅ Backfill completed successfully!');
      }
      else {
        console.log('\n✅ No new UserActors needed.');
      }
    }

    return { created: createdCount, skipped: skippedCount, errors: errorCount };
  }
  catch (error) {
    console.error('\n✗ Fatal error during backfill:', error);
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
    console.error('\n✗ Fatal error during backfill:', error);
    process.exit(1);
  }
}

// Run the backfill when executed as a script
if (import.meta.url === `file://${process.argv[1]}`) {
  runBackfillScript();
}
