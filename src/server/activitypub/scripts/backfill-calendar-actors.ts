#!/usr/bin/env tsx

/**
 * Backfill script to generate CalendarActor entities for existing calendars
 *
 * This script generates RSA-2048 keypairs and CalendarActor records for all calendars
 * that don't have an associated CalendarActor yet.
 *
 * Usage: tsx src/server/activitypub/scripts/backfill-calendar-actors.ts
 */

import config from 'config';
import db from '@/server/common/entity/db';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import CalendarActorService from '@/server/activitypub/service/calendar_actor';

/**
 * Backfills CalendarActor entities for all calendars that don't have one
 * @param domain - The domain to use for actor URIs
 * @param verbose - Whether to log detailed progress (default: true)
 * @returns Object containing counts of created, skipped, and errored calendars
 */
export async function backfillCalendarActors(domain?: string, verbose: boolean = true): Promise<{ created: number; skipped: number; errors: number }> {
  if (verbose) {
    console.log('Starting CalendarActor backfill...\n');
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

    // Retrieve all calendars
    const calendars = await CalendarEntity.findAll();
    if (verbose) {
      console.log(`Found ${calendars.length} total calendars\n`);
    }

    // Track progress
    let createdCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    const calendarActorService = new CalendarActorService();

    // Process each calendar
    for (const calendarEntity of calendars) {
      const calendar = calendarEntity.toModel();

      // Skip calendars without URL name
      if (!calendar.urlName || calendar.urlName.trim() === '') {
        if (verbose) {
          console.log(`⚠️  Skipped calendar ${calendar.id}: No URL name set`);
        }
        skippedCount++;
        continue;
      }

      try {
        // Check if CalendarActor already exists
        const existingActor = await calendarActorService.getActorByCalendarId(calendar.id);
        if (existingActor) {
          if (verbose) {
            console.log(`✓  Skipped calendar ${calendar.urlName}: CalendarActor already exists`);
          }
          skippedCount++;
          continue;
        }

        // Create CalendarActor with keypair
        const calendarActor = await calendarActorService.createActor(calendar, domainToUse);

        if (verbose) {
          console.log(`✓  Created CalendarActor for ${calendar.urlName} (${calendarActor.actorUri})`);
        }
        createdCount++;
      }
      catch (error) {
        console.error(`✗  Error creating CalendarActor for ${calendar.urlName}:`, error);
        errorCount++;
      }
    }

    // Print summary
    if (verbose) {
      console.log('\n' + '='.repeat(60));
      console.log('Backfill Summary:');
      console.log('='.repeat(60));
      console.log(`Total calendars processed: ${calendars.length}`);
      console.log(`CalendarActors created: ${createdCount}`);
      console.log(`Calendars skipped: ${skippedCount}`);
      console.log(`Errors: ${errorCount}`);
      console.log('='.repeat(60));

      if (errorCount > 0) {
        console.log('\n⚠️  Some calendars failed to generate CalendarActors. Review errors above.');
      }
      else if (createdCount > 0) {
        console.log('\n✅ Backfill completed successfully!');
      }
      else {
        console.log('\n✅ No new CalendarActors needed.');
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

    const result = await backfillCalendarActors();

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
