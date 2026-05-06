import { v4 as uuidv4 } from 'uuid';
import { Calendar } from '@/common/model/calendar';
import { EventLocation, EventLocationSpace } from '@/common/model/location';
import { LocationValidationError } from '@/common/exceptions/calendar';
import { LocationEntity, LocationContentEntity } from '@/server/calendar/entity/location';
import { LocationSpaceEntity, LocationSpaceContentEntity } from '@/server/calendar/entity/location_space';
import { EventEntity } from '@/server/calendar/entity/event';

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
   * Delete a location and nullify location_id on associated events.
   *
   * @param calendar - The calendar that should own the location
   * @param locationId - The ID of the location to delete
   * @returns True if the location was deleted, false if not found or not owned by calendar
   */
  async deleteLocation(calendar: Calendar, locationId: string): Promise<boolean> {
    const entity = await LocationEntity.findByPk(locationId);

    if (!entity || entity.calendar_id !== calendar.id) {
      return false;
    }

    // Nullify location_id on associated events
    await EventEntity.update(
      { location_id: null },
      { where: { location_id: locationId } },
    );

    // Delete content entities
    await LocationContentEntity.destroy({
      where: { location_id: locationId },
    });

    // Delete the location entity
    await entity.destroy();

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
}
