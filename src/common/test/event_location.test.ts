import { describe, it, expect } from 'vitest';
import { EventLocation, EventLocationSpace, EventLocationSpaceContent } from '@/common/model/location';

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

describe('EventLocation Model - spaces field', () => {
  it('defaults spaces to an empty array on a freshly constructed model', () => {
    const location = new EventLocation('id-1', 'Local Place');

    expect(location.spaces).toEqual([]);
  });

  it('toObject emits an empty spaces array when no spaces are present', () => {
    const location = new EventLocation('id-1', 'Local Place');

    const obj = location.toObject();

    expect(obj.spaces).toEqual([]);
  });

  it('toObject emits spaces as an array of plain objects', () => {
    const location = new EventLocation('p1', 'Venue');
    const space = new EventLocationSpace('s1', 'p1');
    space.addContent(new EventLocationSpaceContent('en', 'Pacific Room'));
    location.spaces = [space];

    const obj = location.toObject();

    expect(Array.isArray(obj.spaces)).toBe(true);
    expect(obj.spaces).toHaveLength(1);
    expect(obj.spaces[0].id).toBe('s1');
    expect(obj.spaces[0].placeId).toBe('p1');
    expect(obj.spaces[0].content.en.name).toBe('Pacific Room');
  });

  it('fromObject reads spaces array and constructs EventLocationSpace instances', () => {
    const obj = {
      id: 'p1',
      name: 'Venue',
      spaces: [
        {
          id: 's1',
          placeId: 'p1',
          content: {
            en: { name: 'Pacific Room', accessibilityInfo: 'Hearing loop' },
          },
        },
        {
          id: 's2',
          placeId: 'p1',
          content: {
            en: { name: 'Atlantic Room' },
          },
        },
      ],
    };

    const location = EventLocation.fromObject(obj);

    expect(location.spaces).toHaveLength(2);
    expect(location.spaces[0]).toBeInstanceOf(EventLocationSpace);
    expect(location.spaces[0].id).toBe('s1');
    expect(location.spaces[0].content('en').name).toBe('Pacific Room');
    expect(location.spaces[1].id).toBe('s2');
    expect(location.spaces[1].content('en').name).toBe('Atlantic Room');
  });

  it('fromObject leaves spaces empty when obj.spaces is absent', () => {
    const obj = {
      id: 'p1',
      name: 'Venue',
    };

    const location = EventLocation.fromObject(obj);

    expect(location.spaces).toEqual([]);
  });

  it('spaces round-trip through toObject and fromObject', () => {
    const original = new EventLocation('p1', 'Venue');
    const s1 = new EventLocationSpace('s1', 'p1');
    s1.addContent(new EventLocationSpaceContent('en', 'Pacific Room', 'Hearing loop'));
    const s2 = new EventLocationSpace('s2', 'p1');
    s2.addContent(new EventLocationSpaceContent('fr', 'Salle Atlantique', 'Boucle auditive'));
    original.spaces = [s1, s2];

    const restored = EventLocation.fromObject(original.toObject());

    expect(restored.spaces).toHaveLength(2);
    expect(restored.spaces[0].id).toBe('s1');
    expect(restored.spaces[0].content('en').name).toBe('Pacific Room');
    expect(restored.spaces[1].id).toBe('s2');
    expect(restored.spaces[1].content('fr').name).toBe('Salle Atlantique');
  });
});
