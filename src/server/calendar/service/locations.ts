import { v4 as uuidv4 } from 'uuid';
import config from 'config';

import { Calendar } from '@/common/model/calendar';
import { EventLocation } from '@/common/model/location';
import { LocationEntity, LocationContentEntity } from '@/server/calendar/entity/location';

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
   * Generate a unique URL identifier for a new location.
   *
   * Creates a location URI using the configured domain and a random UUID.
   * Format: https://[domain]/places/[uuid]
   *
   * @returns Location URI string
   */
  generateLocationUrl(): string {
    const domain = config.get('domain');
    return 'https://' + domain + '/places/' + uuidv4();
  }

  /**
   * Create a new location with optional accessibility content.
   *
   * @param calendar - The calendar that will own the location
   * @param location - The location model to create (with optional content)
   * @returns Created EventLocation model
   * @throws Error if location name is empty
   */
  async createLocation(calendar: Calendar, location: EventLocation): Promise<EventLocation> {
    // Validate required fields
    if (!location.name || location.name.trim().length === 0) {
      throw new Error('Location name is required');
    }

    // Create location entity
    const entity = LocationEntity.fromModel(location);
    entity.id = this.generateLocationUrl();
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
   * Find an existing location or create a new one if not found.
   *
   * Attempts to find a matching location by ID or attributes. If no match is found,
   * creates a new location with the provided parameters. This is useful for deduplicating
   * locations when processing event data.
   *
   * @param calendar - The calendar that should own the location
   * @param locationParams - Raw location data object (will be converted to EventLocation)
   * @returns Existing or newly created EventLocation model
   * @throws Error if location name is empty when creating
   */
  async findOrCreateLocation(calendar: Calendar, locationParams: Record<string,any>): Promise<EventLocation> {
    let location = await this.findLocation(calendar, EventLocation.fromObject(locationParams));
    if ( ! location ) {
      location = await this.createLocation(calendar, EventLocation.fromObject(locationParams));
    }
    return location;
  }
}
