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
import { RemoteCalendarEntity } from '@/server/activitypub/entity/remote_calendar';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { EventEntity } from '@/server/calendar/entity/event';

/**
 * Setup ActivityPub database schema for unit tests
 * Creates all ActivityPub-related tables using Sequelize sync
 *
 * This is an ephemeral setup - call in beforeEach hooks
 */
export async function setupActivityPubSchema(): Promise<void> {
  // Sync CalendarEntity first as it's referenced by many other tables
  await CalendarEntity.sync({ force: true });

  // Sync RemoteCalendarEntity before tables that reference it
  await RemoteCalendarEntity.sync({ force: true });

  // Sync ActivityPub models that depend on CalendarEntity and RemoteCalendarEntity
  await FollowingCalendarEntity.sync({ force: true });
  await FollowerCalendarEntity.sync({ force: true });
  await SharedEventEntity.sync({ force: true });
  await EventActivityEntity.sync({ force: true });
  await ActivityPubInboxMessageEntity.sync({ force: true });
  await ActivityPubOutboxMessageEntity.sync({ force: true });

  // Sync EventEntity last
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
  await RemoteCalendarEntity.drop();
  await CalendarEntity.drop();
}

/**
 * Create or retrieve a RemoteCalendarEntity for the given actor URI
 *
 * @param actorUri - The ActivityPub actor URI
 * @param displayName - Optional display name for the remote calendar
 * @returns The RemoteCalendarEntity
 */
export async function getOrCreateRemoteCalendar(
  actorUri: string,
  displayName?: string,
): Promise<RemoteCalendarEntity> {
  let remoteCalendar = await RemoteCalendarEntity.findOne({
    where: { actor_uri: actorUri },
  });

  if (!remoteCalendar) {
    remoteCalendar = await RemoteCalendarEntity.create({
      actor_uri: actorUri,
      display_name: displayName || null,
    });
  }

  return remoteCalendar;
}

/**
 * Create minimal test data for ActivityPub tests
 * Returns references to created entities for use in test assertions
 *
 * @param calendarId - Local calendar UUID
 * @param remoteActorUri - Remote calendar ActivityPub URL
 * @param autoRepostOriginals - Whether to auto-repost originals (default: false)
 * @param autoRepostReposts - Whether to auto-repost reposts (default: false)
 * @returns Object containing the created FollowingCalendarEntity and RemoteCalendarEntity
 */
export async function createFollowingRelationship(
  calendarId: string,
  remoteActorUri: string,
  autoRepostOriginals: boolean = false,
  autoRepostReposts: boolean = false,
): Promise<{ following: FollowingCalendarEntity; remoteCalendar: RemoteCalendarEntity }> {
  // First get or create the RemoteCalendarEntity
  const remoteCalendar = await getOrCreateRemoteCalendar(remoteActorUri);

  // Create the following relationship with the UUID reference
  const following = await FollowingCalendarEntity.create({
    id: `follow-${calendarId}-${Date.now()}`,
    calendar_id: calendarId,
    remote_calendar_id: remoteCalendar.id,
    auto_repost_originals: autoRepostOriginals,
    auto_repost_reposts: autoRepostReposts,
  });

  return { following, remoteCalendar };
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
