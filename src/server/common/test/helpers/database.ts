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

import { FollowingCalendarEntity, SharedEventEntity } from '@/server/activitypub/entity/activitypub';
import db from '@/server/common/entity/db';
import { CalendarActorEntity } from '@/server/activitypub/entity/calendar_actor';
// Imported for their side effect: each registers its models with db, which
// setupActivityPubSchema() syncs.
import '@/server/activitypub/entity/event_object';
import '@/server/calendar/entity/calendar';
import '@/server/calendar/entity/event';
import '@/server/media/entity/media';

/**
 * Setup ActivityPub database schema for unit tests
 * Creates all ActivityPub-related tables using Sequelize sync
 *
 * This is an ephemeral setup - call in beforeEach hooks
 */
export async function setupActivityPubSchema(): Promise<void> {
  // CalendarEntity and MediaEntity reference each other (calendar.default_event_image_id
  // and media.calendar_id), so no per-model sync order satisfies PostgreSQL's
  // foreign key checks. db.sync() resolves the cycle across all registered models.
  await db.sync({ force: true });
}

/**
 * Teardown ActivityPub database schema after unit tests
 * Drops all ActivityPub-related tables to ensure clean state
 *
 * This is an ephemeral teardown - call in afterEach hooks
 */
export async function teardownActivityPubSchema(): Promise<void> {
  // db.drop() orders drops by dependency, which per-model drop() cannot do
  // for the calendar/media cycle on PostgreSQL.
  await db.drop({ cascade: db.getDialect() === 'postgres' });
}

/**
 * Create or retrieve a CalendarActorEntity (remote type) for the given actor URI.
 * Uses atomic findOrCreate to avoid race conditions with concurrent requests.
 *
 * @param actorUri - The ActivityPub actor URI
 * @param displayName - Optional display name for the remote calendar
 * @returns The CalendarActorEntity
 */
export async function getOrCreateRemoteCalendarActor(
  actorUri: string,
  displayName?: string,
): Promise<CalendarActorEntity> {
  const [calendarActor] = await CalendarActorEntity.findOrCreate({
    where: { actor_uri: actorUri },
    defaults: {
      actor_type: 'remote',
      actor_uri: actorUri,
      calendar_id: null,
      remote_display_name: displayName || null,
      remote_domain: new URL(actorUri).hostname,
      private_key: null,
    },
  });

  return calendarActor;
}

/**
 * Create minimal test data for ActivityPub tests
 * Returns references to created entities for use in test assertions
 *
 * @param calendarId - Local calendar UUID
 * @param remoteActorUri - Remote calendar ActivityPub URL
 * @param autoRepostOriginals - Whether to auto-repost originals (default: false)
 * @param autoRepostReposts - Whether to auto-repost reposts (default: false)
 * @returns Object containing the created FollowingCalendarEntity and CalendarActorEntity
 */
export async function createFollowingRelationship(
  calendarId: string,
  remoteActorUri: string,
  autoRepostOriginals: boolean = false,
  autoRepostReposts: boolean = false,
): Promise<{ following: FollowingCalendarEntity; calendarActor: CalendarActorEntity }> {
  // First get or create the CalendarActorEntity (remote type)
  const calendarActor = await getOrCreateRemoteCalendarActor(remoteActorUri);

  // Create the following relationship with the UUID reference
  const following = await FollowingCalendarEntity.create({
    id: `follow-${calendarId}-${Date.now()}`,
    calendar_id: calendarId,
    calendar_actor_id: calendarActor.id,
    auto_repost_originals: autoRepostOriginals,
    auto_repost_reposts: autoRepostReposts,
  });

  return { following, calendarActor };
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
