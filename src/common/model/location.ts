import { Model, TranslatedModel, TranslatedContentModel } from '@/common/model/model';

/**
 * Represents translatable content for an event location.
 * Locations can have accessibility information in multiple languages.
 */
class EventLocationContent extends Model implements TranslatedContentModel {
  constructor(
    public language: string,
    public accessibilityInfo: string = '',
  ) {
    super();
  }

  /**
   * Validates that the content has required information.
   */
  isValid(): boolean {
    return this.language.length > 0;
  }

  /**
   * Checks if the content is empty (no accessibility info).
   */
  isEmpty(): boolean {
    return this.accessibilityInfo.trim().length === 0;
  }

  /**
   * Convert to plain object for serialization.
   */
  toObject(): Record<string, any> {
    return {
      language: this.language,
      accessibilityInfo: this.accessibilityInfo,
    };
  }

  /**
   * Create from plain object.
   */
  static fromObject(obj: Record<string, any>): EventLocationContent {
    return new EventLocationContent(
      obj.language,
      obj.accessibilityInfo ?? '',
    );
  }
}

/**
 * Represents a physical location where an event takes place.
 * Contains address information and multilingual accessibility details.
 */
class EventLocation extends TranslatedModel<EventLocationContent> {
  _content: Record<string, EventLocationContent> = {};
  name: string = '';
  address: string = '';
  city: string = '';
  state: string = '';
  postalCode: string = '';
  country: string = '';

  /**
   * Constructor for EventLocation.
   *
   * @param {string} [id] - Unique identifier for the location
   * @param {string} [name] - Name of the location (e.g., venue name)
   * @param {string} [address] - Street address
   * @param {string} [city] - City name
   * @param {string} [state] - State or province
   * @param {string} [postalCode] - ZIP or postal code
   * @param {string} [country] - Country name
   */
  constructor(id?: string, name?: string, address?: string, city?: string, state?: string, postalCode?: string, country?: string) {
    super(id ?? '');
    this.name = name ?? '';
    this.address = address ?? '';
    this.city = city ?? '';
    this.state = state ?? '';
    this.postalCode = postalCode ?? '';
    this.country = country ?? '';
  }

  /**
   * Creates new content for a specified language.
   *
   * @param {string} language - The language code to create content for
   * @returns {EventLocationContent} New content instance for the specified language
   * @protected
   */
  protected createContent(language: string): EventLocationContent {
    return new EventLocationContent(language);
  }

  /**
   * Creates an EventLocation instance from a plain object.
   *
   * @param {Record<string, any>} obj - Plain object containing location data
   * @returns {EventLocation} A new EventLocation instance
   */
  static fromObject(obj: Record<string, any>): EventLocation {
    const location = new EventLocation(obj.id, obj.name, obj.address, obj.city, obj.state, obj.postalCode, obj.country);

    // Load content if present
    if (obj.content) {
      for (const [language, contentObj] of Object.entries(obj.content)) {
        if (typeof contentObj === 'object' && contentObj !== null) {
          const contentData = contentObj as Record<string, any>;
          contentData.language = language; // Ensure language is set
          const content = EventLocationContent.fromObject(contentData);
          location.addContent(content);
        }
      }
    }

    return location;
  }

  /**
   * Converts the location to a plain JavaScript object.
   * Includes id field to ensure existing locations can be properly identified during updates.
   *
   * @returns {Record<string, any>} Plain object representation of the location
   */
  toObject(): Record<string, any> {
    return {
      id: this.id,  // Include id field to preserve location identity during event updates (LOC-003)
      name: this.name,
      address: this.address,
      city: this.city,
      state: this.state,
      postalCode: this.postalCode,
      country: this.country,
      content: Object.fromEntries(
        Object.entries(this._content)
          .map(([language, content]: [string, EventLocationContent]) => [language, content.toObject()]),
      ),
    };
  }
};

/**
 * Validates location field hierarchy.
 * Enforces bottom-up validation rules where more general location information
 * requires more specific information to be filled in first.
 *
 * Validation Rules:
 * - Name only: Valid
 * - City requires Address
 * - State requires City AND Address
 * - Postal Code requires State AND City AND Address
 *
 * @param {EventLocation} location - The location to validate
 * @returns {string[]} Array of error messages (empty if valid)
 */
function validateLocationHierarchy(location: EventLocation): string[] {
  const errors: string[] = [];

  // Check if fields have actual content (not empty strings)
  const hasAddress = location.address.trim().length > 0;
  const hasCity = location.city.trim().length > 0;
  const hasState = location.state.trim().length > 0;
  const hasPostalCode = location.postalCode.trim().length > 0;

  // City requires Address
  if (hasCity && !hasAddress) {
    errors.push('LOCATION_CITY_REQUIRES_ADDRESS');
  }

  // State requires City AND Address
  if (hasState) {
    if (!hasCity) {
      errors.push('LOCATION_STATE_REQUIRES_CITY');
    }
    if (!hasAddress) {
      errors.push('LOCATION_STATE_REQUIRES_ADDRESS');
    }
  }

  // Postal Code requires State AND City AND Address
  if (hasPostalCode) {
    if (!hasState) {
      errors.push('LOCATION_POSTAL_CODE_REQUIRES_STATE');
    }
    if (!hasCity) {
      errors.push('LOCATION_POSTAL_CODE_REQUIRES_CITY');
    }
    if (!hasAddress) {
      errors.push('LOCATION_POSTAL_CODE_REQUIRES_ADDRESS');
    }
  }

  return errors;
}

export { EventLocation, EventLocationContent, validateLocationHierarchy };
