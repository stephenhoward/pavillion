import { describe, it, expect } from 'vitest';
import { EventLocation, validateLocationHierarchy } from '@/common/model/location';

describe('validateLocationHierarchy', () => {
  it('should allow name-only location as valid', () => {
    const location = new EventLocation('id', 'Event Venue');
    const errors = validateLocationHierarchy(location);
    expect(errors).toEqual([]);
  });

  it('should reject city without address', () => {
    const location = new EventLocation('id', 'Event Venue', '', 'San Francisco');
    const errors = validateLocationHierarchy(location);
    expect(errors).toContain('LOCATION_CITY_REQUIRES_ADDRESS');
    expect(errors.length).toBe(1);
  });

  it('should reject state without city', () => {
    const location = new EventLocation('id', 'Event Venue', '123 Main St', '', 'California');
    const errors = validateLocationHierarchy(location);
    expect(errors).toContain('LOCATION_STATE_REQUIRES_CITY');
  });

  it('should reject state without address', () => {
    const location = new EventLocation('id', 'Event Venue', '', 'San Francisco', 'California');
    const errors = validateLocationHierarchy(location);
    expect(errors).toContain('LOCATION_STATE_REQUIRES_ADDRESS');
  });

  it('should reject postal code without state', () => {
    const location = new EventLocation('id', 'Event Venue', '123 Main St', 'San Francisco', '', '94102');
    const errors = validateLocationHierarchy(location);
    expect(errors).toContain('LOCATION_POSTAL_CODE_REQUIRES_STATE');
  });

  it('should reject postal code without city', () => {
    const location = new EventLocation('id', 'Event Venue', '123 Main St', '', 'California', '94102');
    const errors = validateLocationHierarchy(location);
    expect(errors).toContain('LOCATION_POSTAL_CODE_REQUIRES_CITY');
  });

  it('should reject postal code without address', () => {
    const location = new EventLocation('id', 'Event Venue', '', 'San Francisco', 'California', '94102');
    const errors = validateLocationHierarchy(location);
    expect(errors).toContain('LOCATION_POSTAL_CODE_REQUIRES_ADDRESS');
  });

  it('should allow valid complete location', () => {
    const location = new EventLocation('id', 'Event Venue', '123 Main St', 'San Francisco', 'California', '94102');
    const errors = validateLocationHierarchy(location);
    expect(errors).toEqual([]);
  });

  it('should allow location with address and city', () => {
    const location = new EventLocation('id', 'Event Venue', '123 Main St', 'San Francisco');
    const errors = validateLocationHierarchy(location);
    expect(errors).toEqual([]);
  });

  it('should return multiple errors for invalid postal code', () => {
    const location = new EventLocation('id', 'Event Venue', '', '', '', '94102');
    const errors = validateLocationHierarchy(location);
    expect(errors).toContain('LOCATION_POSTAL_CODE_REQUIRES_STATE');
    expect(errors).toContain('LOCATION_POSTAL_CODE_REQUIRES_CITY');
    expect(errors).toContain('LOCATION_POSTAL_CODE_REQUIRES_ADDRESS');
    expect(errors.length).toBe(3);
  });
});
