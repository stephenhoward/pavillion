import { describe, it, expect } from 'vitest';
import { EventLocation } from '@/common/model/location';
import { validateLocationHierarchy } from '@/common/model/location';

describe('Location Hierarchy Validation', () => {

  it('should validate name-only location as valid', () => {
    const location = new EventLocation('id-1', 'Community Center', '', '', '', '', '');
    const errors = validateLocationHierarchy(location);
    expect(errors).toEqual([]);
  });

  it('should reject city without address', () => {
    const location = new EventLocation('id-2', 'Community Center', '', 'Portland', '', '', '');
    const errors = validateLocationHierarchy(location);
    expect(errors).toContain('LOCATION_CITY_REQUIRES_ADDRESS');
  });

  it('should reject state without city AND address', () => {
    // State without both city and address
    const location1 = new EventLocation('id-3', 'Venue', '', '', 'Oregon', '', '');
    const errors1 = validateLocationHierarchy(location1);
    expect(errors1).toContain('LOCATION_STATE_REQUIRES_CITY');
    expect(errors1).toContain('LOCATION_STATE_REQUIRES_ADDRESS');

    // State with address but no city
    const location2 = new EventLocation('id-4', 'Venue', '123 Main St', '', 'Oregon', '', '');
    const errors2 = validateLocationHierarchy(location2);
    expect(errors2).toContain('LOCATION_STATE_REQUIRES_CITY');

    // State with city but no address
    const location3 = new EventLocation('id-5', 'Venue', '', 'Portland', 'Oregon', '', '');
    const errors3 = validateLocationHierarchy(location3);
    expect(errors3).toContain('LOCATION_STATE_REQUIRES_ADDRESS');
  });

  it('should reject postal code without state, city, AND address', () => {
    // Postal code without any other fields
    const location1 = new EventLocation('id-6', 'Venue', '', '', '', '97201', '');
    const errors1 = validateLocationHierarchy(location1);
    expect(errors1).toContain('LOCATION_POSTAL_CODE_REQUIRES_STATE');
    expect(errors1).toContain('LOCATION_POSTAL_CODE_REQUIRES_CITY');
    expect(errors1).toContain('LOCATION_POSTAL_CODE_REQUIRES_ADDRESS');

    // Postal code with only address
    const location2 = new EventLocation('id-7', 'Venue', '123 Main St', '', '', '97201', '');
    const errors2 = validateLocationHierarchy(location2);
    expect(errors2).toContain('LOCATION_POSTAL_CODE_REQUIRES_STATE');
    expect(errors2).toContain('LOCATION_POSTAL_CODE_REQUIRES_CITY');

    // Postal code with address and city but no state
    const location3 = new EventLocation('id-8', 'Venue', '123 Main St', 'Portland', '', '97201', '');
    const errors3 = validateLocationHierarchy(location3);
    expect(errors3).toContain('LOCATION_POSTAL_CODE_REQUIRES_STATE');
  });

  it('should accept valid location combinations', () => {
    // Name only
    const location1 = new EventLocation('id-9', 'Central Park', '', '', '', '', '');
    expect(validateLocationHierarchy(location1)).toEqual([]);

    // Name and address
    const location2 = new EventLocation('id-10', 'Central Park', '123 Park Ave', '', '', '', '');
    expect(validateLocationHierarchy(location2)).toEqual([]);

    // Name, address, and city
    const location3 = new EventLocation('id-11', 'Central Park', '123 Park Ave', 'Portland', '', '', '');
    expect(validateLocationHierarchy(location3)).toEqual([]);

    // Name, address, city, and state
    const location4 = new EventLocation('id-12', 'Central Park', '123 Park Ave', 'Portland', 'Oregon', '', '');
    expect(validateLocationHierarchy(location4)).toEqual([]);

    // Full address with all fields
    const location5 = new EventLocation('id-13', 'Central Park', '123 Park Ave', 'Portland', 'Oregon', '97201', '');
    expect(validateLocationHierarchy(location5)).toEqual([]);

    // Full address including country
    const location6 = new EventLocation('id-14', 'Central Park', '123 Park Ave', 'Portland', 'Oregon', '97201', 'United States');
    expect(validateLocationHierarchy(location6)).toEqual([]);
  });

  it('should return array of specific error messages', () => {
    const location = new EventLocation('id-15', 'Venue', '', '', 'Oregon', '97201', '');
    const errors = validateLocationHierarchy(location);

    expect(Array.isArray(errors)).toBe(true);
    expect(errors.length).toBeGreaterThan(0);
    errors.forEach(error => {
      expect(typeof error).toBe('string');
      expect(error.length).toBeGreaterThan(0);
    });
  });
});
