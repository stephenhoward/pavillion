import { v4 as uuidv4 } from 'uuid';
import { Calendar } from '@/common/model/calendar';
import { EventLocation, EventLocationSpace } from '@/common/model/location';
import { LocationValidationError } from '@/common/exceptions/calendar';
import { LocationEntity, LocationContentEntity } from '@/server/calendar/entity/location';
import { LocationSpaceEntity, LocationSpaceContentEntity } from '@/server/calendar/entity/location_space';
import { EventEntity } from '@/server/calendar/entity/event';
import db from '@/server/common/entity/db';

export default class LocationService {
  /**
   * Get all locations for a calendar with their content.
   *
   * @param calendar - The calendar to get locations for
   * @returns Array of EventLocation models with accessibility content
   */
  async getLocationsForCalendar(calendar: Calendar): Promise<EventLocation[]> {
    const entities = await LocationEntity.findAll({
      where: {
        calendar_id: calendar.id,
      },
      include: [LocationContentEntity],
      order: [['name', 'ASC']],
    });

    return entities.map(entity => entity.toModel());
  }

  /**
   * Get a specific location by ID with content.
   * Returns null if location doesn't exist or doesn't belong to the calendar.
   *
   * @param calendar - The calendar that should own the location
   * @param locationId - The location ID to fetch
   * @returns EventLocation model or null
   */
  async getLocationById(calendar: Calendar, locationId: string): Promise<EventLocation | null> {
    const entity = await LocationEntity.findByPk(locationId, {
      include: [LocationContentEntity],
    });

    if (!entity || entity.calendar_id !== calendar.id) {
      return null;
    }

    return entity.toModel();
  }

  /**
   * Find an existing location by ID or matching attributes.
   *
   * If location has an ID, searches by primary key and verifies calendar ownership.
   * Otherwise, searches for exact match on all location attributes (name, address, city, state, postal code, country).
   *
   * @param calendar - The calendar that should own the location
   * @param location - The location to search for (by ID or attributes)
   * @returns Matching EventLocation model or null if not found
   */
  async findLocation(calendar: Calendar, location: EventLocation): Promise<EventLocation|null> {

    if ( location.id ) {
      let entity = await LocationEntity.findByPk(location.id);
      if ( entity && entity.calendar_id === calendar.id ) {
        return entity.toModel();
      }
    }
    else {
      let entity = await LocationEntity.findOne({
        where: {
          calendar_id: calendar.id,
          name: location.name,
          address: location.address,
          city: location.city,
          state: location.state,
          postal_code: location.postalCode,
          country: location.country,
        },
      });
      if ( entity ) {
        return entity.toModel();
      }
    }
    return null;
  }

  /**
   * Create a new location with optional accessibility content.
   *
   * @param calendar - The calendar that will own the location
   * @param location - The location model to create (with optional content)
   * @returns Created EventLocation model
   * @throws LocationValidationError if location name is empty
   */
  async createLocation(calendar: Calendar, location: EventLocation): Promise<EventLocation> {
    // Validate required fields
    if (!location.name || location.name.trim().length === 0) {
      throw new LocationValidationError(['Location name is required']);
    }

    // Create location entity
    const entity = LocationEntity.fromModel(location);
    entity.id = uuidv4();
    entity.calendar_id = calendar.id;
    await entity.save();

    // Create content entities if location has content
    const languages = location.getLanguages();
    if (languages.length > 0) {
      for (const language of languages) {
        const content = location.content(language);
        if (!content.isEmpty()) {
          const contentEntity = LocationContentEntity.fromModel(entity.id, content);
          await contentEntity.save();
        }
      }
    }

    // Return the created location with content
    return this.getLocationById(calendar, entity.id) as Promise<EventLocation>;
  }

  /**
   * Update an existing location's fields and content.
   *
   * @param calendar - The calendar that should own the location
   * @param locationId - The ID of the location to update
   * @param location - The location model with updated data
   * @returns Updated EventLocation model, or null if not found or not owned by calendar
   * @throws LocationValidationError if location name is empty
   */
  async updateLocation(calendar: Calendar, locationId: string, location: EventLocation): Promise<EventLocation | null> {
    const entity = await LocationEntity.findByPk(locationId);

    if (!entity || entity.calendar_id !== calendar.id) {
      return null;
    }

    // Validate required fields
    if (!location.name || location.name.trim().length === 0) {
      throw new LocationValidationError(['Location name is required']);
    }

    // Update location fields
    await entity.update({
      name: location.name,
      address: location.address,
      city: location.city,
      state: location.state,
      postal_code: location.postalCode,
      country: location.country,
    });

    // Replace content: delete existing, then create new
    await LocationContentEntity.destroy({
      where: { location_id: locationId },
    });

    const languages = location.getLanguages();
    if (languages.length > 0) {
      for (const language of languages) {
        const content = location.content(language);
        if (!content.isEmpty()) {
          const contentEntity = LocationContentEntity.fromModel(locationId, content);
          await contentEntity.save();
        }
      }
    }

    return this.getLocationById(calendar, locationId);
  }

  /**
   * Delete a Place (LocationEntity) and cascade-delete its Spaces.
   *
   * Cascade behaviour, all inside a single transaction so a failure rolls
   * the whole chain back:
   *
   *   1. Nullify BOTH `location_id` AND `space_id` on every Event row that
   *      references this Place. The where-clause is scoped by `location_id`
   *      (not `space_id`) so events sitting on a child Space — which are by
   *      definition also attached to this Place — also get their `space_id`
   *      cleared in the same statement.
   *   2. Find every Space under this Place; if any exist, destroy their
   *      content rows and then the Space rows themselves. The `IN`-list
   *      destroy on `LocationSpaceContentEntity` is paired with a single
   *      `LocationSpaceEntity.destroy({ where: { place_id } })` so both
   *      table sweeps are O(1) statements regardless of Space count.
   *   3. Destroy the Place's own content rows.
   *   4. Destroy the Place row.
   *
   * @param calendar - The calendar that should own the Place
   * @param locationId - The ID of the Place to delete
   * @returns True if the Place was deleted, false if not found or not owned by calendar
   */
  async deleteLocation(calendar: Calendar, locationId: string): Promise<boolean> {
    const entity = await LocationEntity.findByPk(locationId);

    if (!entity || entity.calendar_id !== calendar.id) {
      return false;
    }

    await db.transaction(async (tx) => {
      // Nullify both FKs on associated events. Scoping by location_id (not
      // space_id) catches every event under this Place, including those
      // attached to one of its Spaces — those rows are about to lose their
      // Space anyway, so clearing both columns in one statement keeps the
      // event row valid (no orphaned space_id pointing at a destroyed Space).
      await EventEntity.update(
        { location_id: null, space_id: null },
        { where: { location_id: locationId }, transaction: tx },
      );

      // Cascade-delete Spaces and their content
      const spaces = await LocationSpaceEntity.findAll({
        where: { place_id: locationId },
        transaction: tx,
      });
      if (spaces.length > 0) {
        const spaceIds = spaces.map(s => s.id);
        await LocationSpaceContentEntity.destroy({
          where: { space_id: spaceIds },
          transaction: tx,
        });
        await LocationSpaceEntity.destroy({
          where: { place_id: locationId },
          transaction: tx,
        });
      }

      // Delete Place content entities
      await LocationContentEntity.destroy({
        where: { location_id: locationId },
        transaction: tx,
      });

      // Delete the Place entity
      await entity.destroy({ transaction: tx });
    });

    return true;
  }

  /**
   * Get all Spaces belonging to a Place.
   *
   * Verifies that the Place exists and belongs to the caller's calendar before
   * looking up its Spaces. Returns an empty array when the Place is missing or
   * owned by a different calendar (matching the "silent empty" semantics used
   * elsewhere in this service for unauthorized lookups).
   *
   * @param calendar - The calendar that should own the parent Place
   * @param placeId - The ID of the parent Place (LocationEntity)
   * @returns Array of EventLocationSpace models with multilingual content;
   *          empty if the Place does not exist or is not owned by the calendar
   */
  async getSpacesForPlace(calendar: Calendar, placeId: string): Promise<EventLocationSpace[]> {
    const place = await LocationEntity.findByPk(placeId);
    if (!place || place.calendar_id !== calendar.id) {
      return [];
    }

    const entities = await LocationSpaceEntity.findAll({
      where: { place_id: placeId },
      include: [LocationSpaceContentEntity],
    });

    return entities.map(entity => entity.toModel());
  }

  /**
   * Create a new Space within a Place owned by the caller's calendar.
   *
   * Verifies that the parent Place exists and belongs to the caller's calendar,
   * then creates the Space row plus one content row per supplied language.
   * Returns the populated EventLocationSpace (re-loaded with content rows
   * attached so callers receive the full multilingual model).
   *
   * @param calendar - The calendar that should own the parent Place
   * @param placeId - The ID of the parent Place
   * @param contentByLang - Map of language code to {name, accessibilityInfo}
   * @returns Newly created EventLocationSpace populated with content
   * @throws LocationValidationError if the Place does not exist or is not
   *         owned by the caller's calendar
   */
  async createSpace(
    calendar: Calendar,
    placeId: string,
    contentByLang: Record<string, { name: string; accessibilityInfo: string }>,
  ): Promise<EventLocationSpace> {
    const place = await LocationEntity.findByPk(placeId);
    if (!place || place.calendar_id !== calendar.id) {
      throw new LocationValidationError(['Place not found or not owned by calendar']);
    }

    const spaceId = uuidv4();
    await LocationSpaceEntity.create({
      id: spaceId,
      place_id: placeId,
    });

    for (const [language, content] of Object.entries(contentByLang)) {
      await LocationSpaceContentEntity.create({
        space_id: spaceId,
        language,
        name: content.name,
        accessibility_info: content.accessibilityInfo,
      });
    }

    const fetched = await LocationSpaceEntity.findByPk(spaceId, {
      include: [LocationSpaceContentEntity],
    });
    return fetched!.toModel();
  }

  /**
   * Update an existing Space's multilingual content.
   *
   * Verifies that the Space exists and that its parent Place belongs to the
   * caller's calendar (eager-loading `place` so the auth chain
   * `space.place.calendar_id` is safe to dereference). Replaces all existing
   * content rows with the supplied set (destroy-then-create), then reloads
   * the Space with content rows attached.
   *
   * @param calendar - The calendar that should own the Space (via its Place)
   * @param spaceId - The ID of the Space to update
   * @param contentByLang - Map of language code to {name, accessibilityInfo}
   * @returns Reloaded EventLocationSpace populated with new content, or null
   *          if the Space does not exist, has no loadable place association,
   *          or is not owned by the caller's calendar
   */
  async updateSpace(
    calendar: Calendar,
    spaceId: string,
    contentByLang: Record<string, { name: string; accessibilityInfo: string }>,
  ): Promise<EventLocationSpace | null> {
    const space = await LocationSpaceEntity.findByPk(spaceId, {
      include: [{ model: LocationEntity, as: 'place' }],
    });
    if (!space || !space.place || space.place.calendar_id !== calendar.id) {
      return null;
    }

    // Replace content: delete existing, then create new
    await LocationSpaceContentEntity.destroy({
      where: { space_id: spaceId },
    });

    for (const [language, content] of Object.entries(contentByLang)) {
      await LocationSpaceContentEntity.create({
        space_id: spaceId,
        language,
        name: content.name,
        accessibility_info: content.accessibilityInfo,
      });
    }

    const reloaded = await LocationSpaceEntity.findByPk(spaceId, {
      include: [LocationSpaceContentEntity],
    });
    return reloaded!.toModel();
  }

  /**
   * Delete a Space and nullify event.space_id on referencing events.
   *
   * Verifies that the Space exists and that its parent Place belongs to the
   * caller's calendar (eager-loading `place` so the auth chain
   * `space.place.calendar_id` is safe to dereference). On success, runs the
   * three side effects inside a single `db.transaction` so a failure mid-way
   * rolls the entire chain back:
   *
   *   1. Set `space_id = null` on every Event row that references this Space,
   *      leaving `location_id` untouched (the event remains attached to the
   *      parent Place as a "whole-venue" event).
   *   2. Destroy the Space's content rows.
   *   3. Destroy the Space row itself.
   *
   * The auth check (findByPk + place ownership) runs OUTSIDE the transaction
   * because it is a read-only gate; the transaction wraps only the writes.
   *
   * Cross-calendar isolation is enforced structurally by the FK invariant
   * (Space → Place → Calendar): a Space owned by a different calendar is
   * rejected by the auth chain before any side effects run.
   *
   * @param calendar - The calendar that should own the Space (via its Place)
   * @param spaceId - The ID of the Space to delete
   * @returns True if the Space was deleted; false if not found, not owned by
   *          the calendar, or missing a loadable place association
   */
  async deleteSpace(calendar: Calendar, spaceId: string): Promise<boolean> {
    const space = await LocationSpaceEntity.findByPk(spaceId, {
      include: [{ model: LocationEntity, as: 'place' }],
    });
    if (!space || !space.place || space.place.calendar_id !== calendar.id) {
      return false;
    }

    await db.transaction(async (tx) => {
      // Nullify event.space_id only; leave event.location_id intact so the
      // event becomes a whole-venue event on the parent Place.
      await EventEntity.update(
        { space_id: null },
        { where: { space_id: spaceId }, transaction: tx },
      );

      await LocationSpaceContentEntity.destroy({
        where: { space_id: spaceId },
        transaction: tx,
      });

      await space.destroy({ transaction: tx });
    });

    return true;
  }

  /**
   * Find an existing location or create a new one if not found.
   *
   * Attempts to find a matching location by ID or attributes. If no match is found,
   * creates a new location with the provided parameters. This is useful for deduplicating
   * locations when processing event data.
   *
   * @param calendar - The calendar that should own the location
   * @param locationParams - Raw location data object (will be converted to EventLocation)
   * @returns Existing or newly created EventLocation model
   * @throws LocationValidationError if location name is empty when creating
   */
  async findOrCreateLocation(calendar: Calendar, locationParams: Record<string,any>): Promise<EventLocation> {
    let location = await this.findLocation(calendar, EventLocation.fromObject(locationParams));
    if ( ! location ) {
      location = await this.createLocation(calendar, EventLocation.fromObject(locationParams));
    }
    return location;
  }

  /**
   * Find or create a Place keyed on its AP origin URI.
   *
   * Receiver-side dedup helper for the AP inbox path (pv-ix7v.9): when an
   * inbound activity references a Place by its source-instance identity hint
   * (origin_uri), this lookup either returns the previously-mirrored Place
   * for this calendar or creates a new one with the supplied data and the
   * origin_uri stamped on it.
   *
   * Lookup is scoped per-calendar — the same source Place mirrored onto two
   * different local calendars produces two independent rows, preserving the
   * per-calendar isolation invariant established by DEC-008 (no cross-calendar
   * leakage of identity hints or dedup state).
   *
   * @param calendar - The calendar that should own the Place
   * @param originUri - The AP source URI used to identify the Place
   * @param data - EventLocation model carrying the fields and content to use
   *               on the create branch (ignored if a match already exists)
   * @returns Existing or newly created EventLocation populated with content
   */
  async findOrCreatePlaceByOriginUri(
    calendar: Calendar,
    originUri: string,
    data: EventLocation,
  ): Promise<EventLocation> {
    const existing = await LocationEntity.findOne({
      where: {
        calendar_id: calendar.id,
        origin_uri: originUri,
      },
      include: [LocationContentEntity],
    });

    if (existing) {
      return existing.toModel();
    }

    // Create branch: build a Place row with origin_uri stamped on it, write
    // any content rows, then re-load through getLocationById so the returned
    // model has its content rows attached.
    const entity = LocationEntity.fromModel(data);
    entity.id = uuidv4();
    entity.calendar_id = calendar.id;
    entity.origin_uri = originUri;
    await entity.save();

    const languages = data.getLanguages();
    if (languages.length > 0) {
      for (const language of languages) {
        const content = data.content(language);
        if (!content.isEmpty()) {
          const contentEntity = LocationContentEntity.fromModel(entity.id, content);
          await contentEntity.save();
        }
      }
    }

    return this.getLocationById(calendar, entity.id) as Promise<EventLocation>;
  }

  /**
   * Find or create a Space keyed on its AP origin URI within a Place.
   *
   * Receiver-side dedup helper for the AP inbox path (pv-ix7v.9). The parent
   * Place is supplied by the caller (typically just resolved via
   * findOrCreatePlaceByOriginUri) so that Space scoping is anchored on a
   * concrete place_id. Lookup is keyed on (place_id, origin_uri); the parent
   * Place's calendar ownership is established by the caller and is not
   * re-checked here (the auth chain Place → Calendar already gates which
   * Spaces this helper can touch).
   *
   * @param _calendar - The calendar that owns the Place (kept in the signature
   *                    for symmetry with findOrCreatePlaceByOriginUri and to
   *                    document the expected ownership chain; not used directly
   *                    because Space scoping is anchored on the supplied Place)
   * @param place - The parent Place this Space belongs to (must have an id)
   * @param originUri - The AP source URI used to identify the Space
   * @param contentByLang - Map of language code to {name, accessibilityInfo};
   *                        used only on the create branch
   * @returns Existing or newly created EventLocationSpace populated with content
   */
  async findOrCreateSpaceByOriginUri(
    _calendar: Calendar,
    place: EventLocation,
    originUri: string,
    contentByLang: Record<string, { name: string; accessibilityInfo: string }>,
  ): Promise<EventLocationSpace> {
    const existing = await LocationSpaceEntity.findOne({
      where: {
        place_id: place.id,
        origin_uri: originUri,
      },
      include: [LocationSpaceContentEntity],
    });

    if (existing) {
      return existing.toModel();
    }

    const spaceId = uuidv4();
    await LocationSpaceEntity.create({
      id: spaceId,
      place_id: place.id,
      origin_uri: originUri,
    });

    for (const [language, content] of Object.entries(contentByLang)) {
      await LocationSpaceContentEntity.create({
        space_id: spaceId,
        language,
        name: content.name,
        accessibility_info: content.accessibilityInfo,
      });
    }

    const fetched = await LocationSpaceEntity.findByPk(spaceId, {
      include: [LocationSpaceContentEntity],
    });
    return fetched!.toModel();
  }
}
