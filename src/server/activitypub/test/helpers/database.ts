/**
 * Ephemeral database setup helper for ActivityPub unit tests
 *
 * This helper provides lightweight, ephemeral database setup for unit tests
 * that need ActivityPub database tables (ap_following, ap_shared_event, etc.)
 *
 * Usage pattern (ephemeral approach for unit tests):
 * ```typescript
 * beforeEach(async () => {
 *   await setupActivityPubSchema();
 * });
 *
 * afterEach(async () => {
 *   await teardownActivityPubSchema();
 * });
 * ```
 *
 * Note: Uses db.sync() to create tables from Sequelize models.
 * This approach is ephemeral - tables are created fresh for each test.
 */

import db from '@/server/common/entity/db';
import {
  FollowingCalendarEntity,
  FollowerCalendarEntity,
  SharedEventEntity,
  EventActivityEntity,
  ActivityPubInboxMessageEntity,
  ActivityPubOutboxMessageEntity,
} from '@/server/activitypub/entity/activitypub';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { EventEntity } from '@/server/calendar/entity/event';

/**
 * Setup ActivityPub database schema for unit tests
 * Creates all ActivityPub-related tables using Sequelize sync
 *
 * This is an ephemeral setup - call in beforeEach hooks
 */
export async function setupActivityPubSchema(): Promise<void> {
  // Sync only the ActivityPub models (and their dependencies)
  // This creates the tables without needing migrations
  await FollowingCalendarEntity.sync({ force: true });
  await FollowerCalendarEntity.sync({ force: true });
  await SharedEventEntity.sync({ force: true });
  await EventActivityEntity.sync({ force: true });
  await ActivityPubInboxMessageEntity.sync({ force: true });
  await ActivityPubOutboxMessageEntity.sync({ force: true });

  // Also sync CalendarEntity and EventEntity as they're referenced by ActivityPub tables
  await CalendarEntity.sync({ force: true });
  await EventEntity.sync({ force: true });
}

/**
 * Teardown ActivityPub database schema after unit tests
 * Drops all ActivityPub-related tables to ensure clean state
 *
 * This is an ephemeral teardown - call in afterEach hooks
 */
export async function teardownActivityPubSchema(): Promise<void> {
  // Drop tables in reverse order of dependencies
  await EventActivityEntity.drop();
  await SharedEventEntity.drop();
  await ActivityPubOutboxMessageEntity.drop();
  await ActivityPubInboxMessageEntity.drop();
  await FollowerCalendarEntity.drop();
  await FollowingCalendarEntity.drop();
  await EventEntity.drop();
  await CalendarEntity.drop();
}

/**
 * Create minimal test data for ActivityPub tests
 * Returns references to created entities for use in test assertions
 *
 * @param calendarId - Local calendar UUID
 * @param remoteCalendarId - Remote calendar ActivityPub URL
 * @param autoRepostOriginals - Whether to auto-repost originals (default: false)
 * @param autoRepostReposts - Whether to auto-repost reposts (default: false)
 * @returns The created FollowingCalendarEntity
 */
export async function createFollowingRelationship(
  calendarId: string,
  remoteCalendarId: string,
  autoRepostOriginals: boolean = false,
  autoRepostReposts: boolean = false,
): Promise<FollowingCalendarEntity> {
  return await FollowingCalendarEntity.create({
    id: `follow-${calendarId}-${Date.now()}`,
    calendar_id: calendarId,
    remote_calendar_id: remoteCalendarId,
    auto_repost_originals: autoRepostOriginals,
    auto_repost_reposts: autoRepostReposts,
  });
}

/**
 * Create a shared event record for testing
 *
 * @param eventId - Event ActivityPub URL
 * @param calendarId - Calendar UUID that shared the event
 * @param autoPosted - Whether this was auto-posted (default: false)
 * @returns The created SharedEventEntity
 */
export async function createSharedEvent(
  eventId: string,
  calendarId: string,
  autoPosted: boolean = false,
): Promise<SharedEventEntity> {
  return await SharedEventEntity.create({
    id: `share-${calendarId}-${Date.now()}`,
    event_id: eventId,
    calendar_id: calendarId,
    auto_posted: autoPosted,
  });
}
