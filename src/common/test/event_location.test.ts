import { describe, it, expect } from 'vitest';
import { EventLocation } from '@/common/model/location';

describe('EventLocation Model - Country Field', () => {

  it('fromObject: should preserve country field when provided', () => {
    const obj = {
      id: 'test-id',
      name: 'Test Venue',
      address: '123 Main St',
      city: 'Portland',
      state: 'OR',
      postalCode: '97201',
      country: 'United States',
    };

    const location = EventLocation.fromObject(obj);

    expect(location.country).toBe('United States');
  });

  it('country field should round-trip through toObject and fromObject', () => {
    const original = new EventLocation(
      'round-trip-id',
      'Conference Center',
      '456 Tech Blvd',
      'San Francisco',
      'CA',
      '94105',
      'United States',
    );

    const obj = original.toObject();
    const roundTrip = EventLocation.fromObject(obj);

    expect(roundTrip.country).toBe(original.country);
    expect(roundTrip.country).toBe('United States');
  });

  it('country field should remain optional (can be undefined)', () => {
    const obj = {
      id: 'test-id',
      name: 'Local Cafe',
      address: '789 Oak Ave',
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
    };

    const location = EventLocation.fromObject(obj);

    expect(location.country).toBe('');
  });

  it('country field should handle empty string correctly', () => {
    const obj = {
      id: 'test-id',
      name: 'Community Center',
      address: '321 Elm St',
      city: 'Seattle',
      state: 'WA',
      postalCode: '98101',
      country: '',
    };

    const location = EventLocation.fromObject(obj);

    expect(location.country).toBe('');
  });
});
