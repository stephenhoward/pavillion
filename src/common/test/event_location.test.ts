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

describe('EventLocation Model - originUri Field', () => {
  it('defaults originUri to null on a freshly constructed model', () => {
    const location = new EventLocation('id-1', 'Local Place');

    expect(location.originUri).toBeNull();
  });

  it('toObject omits originUri when null (data minimization)', () => {
    const location = new EventLocation('id-1', 'Local Place');

    const obj = location.toObject();

    expect(obj).not.toHaveProperty('originUri');
  });

  it('toObject emits originUri when set', () => {
    const location = new EventLocation('id-1', 'Federated Place');
    location.originUri = 'https://remote.example/places/abc';

    const obj = location.toObject();

    expect(obj.originUri).toBe('https://remote.example/places/abc');
  });

  it('fromObject reads originUri when present', () => {
    const obj = {
      id: 'id-1',
      name: 'Federated Place',
      originUri: 'https://remote.example/places/xyz',
    };

    const location = EventLocation.fromObject(obj);

    expect(location.originUri).toBe('https://remote.example/places/xyz');
  });

  it('fromObject leaves originUri as null when absent', () => {
    const obj = {
      id: 'id-1',
      name: 'Local Place',
    };

    const location = EventLocation.fromObject(obj);

    expect(location.originUri).toBeNull();
  });

  it('originUri round-trips through toObject and fromObject', () => {
    const original = new EventLocation('id-rt', 'Round Trip');
    original.originUri = 'https://remote.example/places/round-trip';

    const restored = EventLocation.fromObject(original.toObject());

    expect(restored.originUri).toBe('https://remote.example/places/round-trip');
  });
});
