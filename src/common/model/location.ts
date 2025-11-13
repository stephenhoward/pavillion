import { PrimaryModel } from '@/common/model/model';

/**
 * Represents a physical location where an event takes place.
 * Contains address information and other location details.
 */
class EventLocation extends PrimaryModel {
  id: string = '';
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
    super();
    this.id=id ?? '';
    this.name = name ?? '';
    this.address = address ?? '';
    this.city = city ?? '';
    this.state = state ?? '';
    this.postalCode = postalCode ?? '';
    this.country = country ?? '';
  }

  /**
   * Creates an EventLocation instance from a plain object.
   *
   * @param {Record<string, any>} obj - Plain object containing location data
   * @returns {EventLocation} A new EventLocation instance
   */
  static fromObject(obj: Record<string, any>): EventLocation {
    return new EventLocation(obj.id, obj.name, obj.address, obj.city, obj.state, obj.postalCode, obj.country);
  }

  /**
   * Converts the location to a plain JavaScript object.
   *
   * @returns {Record<string, any>} Plain object representation of the location
   */
  toObject(): Record<string, any> {
    return {
      name: this.name,
      address: this.address,
      city: this.city,
      state: this.state,
      postalCode: this.postalCode,
      country: this.country,
    };
  }
};

export { EventLocation };
