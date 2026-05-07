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
 * Represents translatable content for a Space within an event location.
 * Spaces can have a name and accessibility information in multiple languages.
 */
class EventLocationSpaceContent extends Model implements TranslatedContentModel {
  constructor(
    public language: string,
    public name: string = '',
    public accessibilityInfo: string = '',
  ) {
    super();
  }

  /**
   * Validates that the content has required information.
   * A Space requires a non-empty language and non-empty name.
   */
  isValid(): boolean {
    return this.language.length > 0 && this.name.trim().length > 0;
  }

  /**
   * Checks if the content is empty (no name and no accessibility info).
   */
  isEmpty(): boolean {
    return this.name.trim().length === 0 && this.accessibilityInfo.trim().length === 0;
  }

  /**
   * Convert to plain object for serialization.
   */
  toObject(): Record<string, any> {
    return {
      language: this.language,
      name: this.name,
      accessibilityInfo: this.accessibilityInfo,
    };
  }

  /**
   * Create from plain object.
   */
  static fromObject(obj: Record<string, any>): EventLocationSpaceContent {
    return new EventLocationSpaceContent(
      obj.language,
      obj.name ?? '',
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
  // Identity hint for AP-originated records (inbound dedup, pv-ix7v).
  // Null for locally-created Places.
  originUri: string | null = null;
  // Sub-areas (rooms, sections) of this Place. Populated by eager-load on the
  // server and by the client when editing; serialized as a nested array so
  // Place + Spaces can be saved atomically (pv-0pht).
  spaces: EventLocationSpace[] = [];

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
    if (obj.originUri !== undefined && obj.originUri !== null) {
      location.originUri = obj.originUri;
    }

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

    // Load nested spaces if present (pv-0pht atomic Place + Spaces wire contract)
    if (Array.isArray(obj.spaces)) {
      location.spaces = obj.spaces.map((spaceObj: Record<string, any>) => EventLocationSpace.fromObject(spaceObj));
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
    const obj: Record<string, any> = {
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
      // Always emit spaces (even when empty) so the wire contract is stable
      // for atomic Place + Spaces save (pv-0pht).
      spaces: this.spaces.map((space) => space.toObject()),
    };
    // Emit originUri only when non-null (data minimization, DEC-004 spirit)
    if (this.originUri !== null) {
      obj.originUri = this.originUri;
    }
    return obj;
  }
};

/**
 * Represents a Space within an EventLocation (Place).
 * A Space is a sub-area of a Place (e.g. a specific room within a venue) with
 * its own translatable name and accessibility information.
 */
class EventLocationSpace extends TranslatedModel<EventLocationSpaceContent> {
  _content: Record<string, EventLocationSpaceContent> = {};
  placeId: string = '';
  // Identity hint for AP-originated records (inbound dedup, pv-ix7v).
  // Null for locally-created Spaces.
  originUri: string | null = null;
  // Transient correlation token used by the client to match a freshly-saved
  // Space row back to its draft form entry during atomic Place + Spaces save.
  // NOT a row ID — set only on the wire while a Space is unsaved (pv-0pht).
  clientId?: string;
  // Read-only computed field reporting how many events on the parent Place
  // currently reference this Space. Populated by server eager-loads; never
  // sent in writes and never emitted by toObject (pv-0pht).
  eventCount?: number;

  /**
   * Constructor for EventLocationSpace.
   *
   * @param {string} [id] - Unique identifier for the space
   * @param {string} [placeId] - Identifier of the parent EventLocation (Place)
   */
  constructor(id?: string, placeId?: string) {
    super(id ?? '');
    this.placeId = placeId ?? '';
  }

  /**
   * Creates new content for a specified language.
   *
   * @param {string} language - The language code to create content for
   * @returns {EventLocationSpaceContent} New content instance for the specified language
   * @protected
   */
  protected createContent(language: string): EventLocationSpaceContent {
    return new EventLocationSpaceContent(language);
  }

  /**
   * Creates an EventLocationSpace instance from a plain object.
   *
   * @param {Record<string, any>} obj - Plain object containing space data
   * @returns {EventLocationSpace} A new EventLocationSpace instance
   */
  static fromObject(obj: Record<string, any>): EventLocationSpace {
    const space = new EventLocationSpace(obj.id, obj.placeId);
    if (obj.originUri !== undefined && obj.originUri !== null) {
      space.originUri = obj.originUri;
    }
    if (typeof obj.clientId === 'string') {
      space.clientId = obj.clientId;
    }
    if (typeof obj.eventCount === 'number') {
      space.eventCount = obj.eventCount;
    }

    // Load content if present
    if (obj.content) {
      for (const [language, contentObj] of Object.entries(obj.content)) {
        if (typeof contentObj === 'object' && contentObj !== null) {
          const contentData = contentObj as Record<string, any>;
          contentData.language = language; // Ensure language is set
          space.addContent(EventLocationSpaceContent.fromObject(contentData));
        }
      }
    }

    return space;
  }

  /**
   * Converts the space to a plain JavaScript object.
   *
   * @returns {Record<string, any>} Plain object representation of the space
   */
  toObject(): Record<string, any> {
    const obj: Record<string, any> = {
      id: this.id,
      placeId: this.placeId,
      content: Object.fromEntries(
        Object.entries(this._content)
          .map(([language, content]: [string, EventLocationSpaceContent]) => [language, content.toObject()]),
      ),
    };
    // Emit originUri only when non-null (data minimization, DEC-004 spirit)
    if (this.originUri !== null) {
      obj.originUri = this.originUri;
    }
    // Emit clientId only when set, mirroring the originUri precedent. Carries
    // the transient correlation token from client to server during atomic
    // Place + Spaces save (pv-0pht).
    if (this.clientId !== undefined) {
      obj.clientId = this.clientId;
    }
    // eventCount is intentionally omitted: it is a read-only computed field
    // populated by server eager-loads and must never round-trip into a write.
    // The API layer's GET serialization adds it back when present (see
    // server/calendar/api/v1/location.ts).
    return obj;
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

export { EventLocation, EventLocationContent, EventLocationSpace, EventLocationSpaceContent, validateLocationHierarchy };
