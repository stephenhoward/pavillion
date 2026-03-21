#!/usr/bin/env tsx

/**
 * Backfill script to generate CalendarActor entities for existing calendars
 *
 * This script generates RSA-2048 keypairs and CalendarActor records for all calendars
 * that don't have an associated CalendarActor yet.
 *
 * Usage: tsx src/server/activitypub/scripts/backfill-calendar-actors.ts
 */

import { EventEmitter } from 'events';
import config from 'config';
import db from '@/server/common/entity/db';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import CalendarActorService from '@/server/activitypub/service/calendar_actor';
import CalendarInterface from '@/server/calendar/interface';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('activitypub');

/**
 * Backfills CalendarActor entities for all calendars that don't have one
 * @param domain - The domain to use for actor URIs
 * @param verbose - Whether to log detailed progress (default: true)
 * @returns Object containing counts of created, skipped, and errored calendars
 */
export async function backfillCalendarActors(domain?: string, verbose: boolean = true): Promise<{ created: number; skipped: number; errors: number }> {
  if (verbose) {
    logger.info('Starting CalendarActor backfill');
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

    // Retrieve all calendars
    const calendars = await CalendarEntity.findAll();
    if (verbose) {
      logger.info({ count: calendars.length }, 'Found total calendars');
    }

    // Track progress
    let createdCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    const calendarInterface = new CalendarInterface(new EventEmitter());
    const calendarActorService = new CalendarActorService(calendarInterface);

    // Process each calendar
    for (const calendarEntity of calendars) {
      const calendar = calendarEntity.toModel();

      // Skip calendars without URL name
      if (!calendar.urlName || calendar.urlName.trim() === '') {
        if (verbose) {
          logger.warn({ calendarId: calendar.id }, 'Skipped calendar: no URL name set');
        }
        skippedCount++;
        continue;
      }

      try {
        // Check if CalendarActor already exists
        const existingActor = await calendarActorService.getActorByCalendarId(calendar.id);
        if (existingActor) {
          if (verbose) {
            logger.info({ urlName: calendar.urlName }, 'Skipped calendar: CalendarActor already exists');
          }
          skippedCount++;
          continue;
        }

        // Create CalendarActor with keypair
        const calendarActor = await calendarActorService.createActor(calendar, domainToUse);

        if (verbose) {
          logger.info({ urlName: calendar.urlName, actorUri: calendarActor.actorUri }, 'Created CalendarActor');
        }
        createdCount++;
      }
      catch (error) {
        logger.error({ err: error, urlName: calendar.urlName }, 'Error creating CalendarActor');
        errorCount++;
      }
    }

    // Print summary
    if (verbose) {
      logger.info({
        totalCalendars: calendars.length,
        created: createdCount,
        skipped: skippedCount,
        errors: errorCount,
      }, 'CalendarActor backfill summary');

      if (errorCount > 0) {
        logger.warn({ errorCount }, 'Some calendars failed to generate CalendarActors');
      }
      else if (createdCount > 0) {
        logger.info('Backfill completed successfully');
      }
      else {
        logger.info('No new CalendarActors needed');
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

    const result = await backfillCalendarActors();

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
