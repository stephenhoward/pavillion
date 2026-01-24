import { RemoteCalendarEntity, RemoteCalendar } from '@/server/activitypub/entity/remote_calendar';

/**
 * Service for managing remote calendar references.
 *
 * This service provides methods for creating, retrieving, and updating
 * cached metadata for remote calendars discovered through ActivityPub federation.
 */
export default class RemoteCalendarService {

  /**
   * Find an existing remote calendar by its ActivityPub actor URI
   *
   * @param actorUri - The ActivityPub actor URI (e.g., https://example.com/calendars/events)
   * @returns The RemoteCalendar if found, null otherwise
   */
  async getByActorUri(actorUri: string): Promise<RemoteCalendar | null> {
    const entity = await RemoteCalendarEntity.findOne({
      where: { actor_uri: actorUri },
    });

    return entity ? entity.toModel() : null;
  }

  /**
   * Find an existing remote calendar by its local UUID
   *
   * @param id - The local UUID reference
   * @returns The RemoteCalendar if found, null otherwise
   */
  async getById(id: string): Promise<RemoteCalendar | null> {
    const entity = await RemoteCalendarEntity.findByPk(id);
    return entity ? entity.toModel() : null;
  }

  /**
   * Find or create a remote calendar reference by actor URI.
   *
   * This is the primary method for obtaining a RemoteCalendar reference.
   * If the remote calendar doesn't exist in our database, it creates a new
   * entry with minimal information. The caller can then update the metadata
   * after fetching the full actor profile.
   *
   * @param actorUri - The ActivityPub actor URI
   * @returns The existing or newly created RemoteCalendar
   */
  async findOrCreateByActorUri(actorUri: string): Promise<RemoteCalendar> {
    // Check if already exists
    const existing = await this.getByActorUri(actorUri);
    if (existing) {
      return existing;
    }

    // Create new entry with minimal information
    const entity = await RemoteCalendarEntity.create({
      actor_uri: actorUri,
    });

    return entity.toModel();
  }

  /**
   * Update cached metadata for a remote calendar.
   *
   * Call this after fetching the actor profile from the remote server
   * to cache the relevant information locally.
   *
   * @param actorUri - The ActivityPub actor URI
   * @param metadata - The metadata to update
   * @returns The updated RemoteCalendar, or null if not found
   */
  async updateMetadata(
    actorUri: string,
    metadata: {
      displayName?: string | null;
      inboxUrl?: string | null;
      sharedInboxUrl?: string | null;
      publicKey?: string | null;
    },
  ): Promise<RemoteCalendar | null> {
    const entity = await RemoteCalendarEntity.findOne({
      where: { actor_uri: actorUri },
    });

    if (!entity) {
      return null;
    }

    // Update fields that are provided
    if (metadata.displayName !== undefined) {
      entity.display_name = metadata.displayName;
    }
    if (metadata.inboxUrl !== undefined) {
      entity.inbox_url = metadata.inboxUrl;
    }
    if (metadata.sharedInboxUrl !== undefined) {
      entity.shared_inbox_url = metadata.sharedInboxUrl;
    }
    if (metadata.publicKey !== undefined) {
      entity.public_key = metadata.publicKey;
    }

    // Update last_fetched timestamp
    entity.last_fetched = new Date();

    await entity.save();

    return entity.toModel();
  }

  /**
   * Update metadata by ID instead of actor URI.
   *
   * @param id - The local UUID reference
   * @param metadata - The metadata to update
   * @returns The updated RemoteCalendar, or null if not found
   */
  async updateMetadataById(
    id: string,
    metadata: {
      displayName?: string | null;
      inboxUrl?: string | null;
      sharedInboxUrl?: string | null;
      publicKey?: string | null;
    },
  ): Promise<RemoteCalendar | null> {
    const entity = await RemoteCalendarEntity.findByPk(id);

    if (!entity) {
      return null;
    }

    // Update fields that are provided
    if (metadata.displayName !== undefined) {
      entity.display_name = metadata.displayName;
    }
    if (metadata.inboxUrl !== undefined) {
      entity.inbox_url = metadata.inboxUrl;
    }
    if (metadata.sharedInboxUrl !== undefined) {
      entity.shared_inbox_url = metadata.sharedInboxUrl;
    }
    if (metadata.publicKey !== undefined) {
      entity.public_key = metadata.publicKey;
    }

    // Update last_fetched timestamp
    entity.last_fetched = new Date();

    await entity.save();

    return entity.toModel();
  }

  /**
   * Check if cached metadata is stale and should be refreshed.
   *
   * @param remoteCalendar - The remote calendar to check
   * @param maxAgeMs - Maximum age in milliseconds before considering stale (default: 1 hour)
   * @returns true if metadata should be refreshed
   */
  isMetadataStale(remoteCalendar: RemoteCalendar, maxAgeMs: number = 3600000): boolean {
    if (!remoteCalendar.lastFetched) {
      return true;
    }

    const age = Date.now() - remoteCalendar.lastFetched.getTime();
    return age > maxAgeMs;
  }

  /**
   * Delete a remote calendar reference.
   *
   * Use with caution - this should only be done when cleaning up
   * orphaned references or when the remote calendar no longer exists.
   *
   * @param actorUri - The ActivityPub actor URI
   * @returns true if deleted, false if not found
   */
  async deleteByActorUri(actorUri: string): Promise<boolean> {
    const deleted = await RemoteCalendarEntity.destroy({
      where: { actor_uri: actorUri },
    });

    return deleted > 0;
  }

  /**
   * Get all remote calendars, optionally filtered by staleness.
   *
   * Useful for batch refresh operations.
   *
   * @param onlyStale - If true, only return calendars with stale metadata
   * @param maxAgeMs - Maximum age for staleness check (default: 1 hour)
   * @returns Array of RemoteCalendar objects
   */
  async getAll(onlyStale: boolean = false, maxAgeMs: number = 3600000): Promise<RemoteCalendar[]> {
    const entities = await RemoteCalendarEntity.findAll();
    const models = entities.map(e => e.toModel());

    if (onlyStale) {
      return models.filter(m => this.isMetadataStale(m, maxAgeMs));
    }

    return models;
  }
}
