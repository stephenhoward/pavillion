import { describe, test, expect } from 'vitest';
import { EventLocation, EventLocationContent } from '@/common/model/location';

describe('EventLocation Model - Translated Content', () => {
  test('creates a valid location with translatable content', () => {
    const location = new EventLocation(
      'loc-123',
      'Washington Park',
      '4033 SW Canyon Rd',
      'Portland',
      'OR',
      '97221',
      'United States',
    );

    // Add accessibility content
    const enContent = new EventLocationContent('en', 'Wheelchair accessible paths.');
    location.addContent(enContent);

    expect(location.id).toBe('loc-123');
    expect(location.name).toBe('Washington Park');
    expect(location.getLanguages()).toHaveLength(1);
    expect(location.content('en').accessibilityInfo).toBe('Wheelchair accessible paths.');
  });

  test('manages content in multiple languages', () => {
    const location = new EventLocation(
      'loc-456',
      'Community Center',
    );

    const enContent = new EventLocationContent('en', 'Elevator access to all floors.');
    const esContent = new EventLocationContent('es', 'Acceso de ascensor a todos los pisos.');
    location.addContent(enContent);
    location.addContent(esContent);

    expect(location.getLanguages()).toHaveLength(2);
    expect(location.content('en').accessibilityInfo).toBe('Elevator access to all floors.');
    expect(location.content('es').accessibilityInfo).toBe('Acceso de ascensor a todos los pisos.');
    expect(location.hasContent('en')).toBe(true);
    expect(location.hasContent('es')).toBe(true);
    expect(location.hasContent('fr')).toBe(false);
  });

  test('creates content automatically when accessed', () => {
    const location = new EventLocation(
      'loc-789',
      'City Hall',
    );

    // Accessing content for a language that doesn't exist should create it
    const content = location.content('en');
    expect(content).toBeInstanceOf(EventLocationContent);
    expect(content.language).toBe('en');
    expect(content.accessibilityInfo).toBe(''); // Should be empty initially
    expect(location.getLanguages()).toHaveLength(1);
  });

  test('serializes to object with content correctly', () => {
    const location = new EventLocation(
      'loc-123',
      'Theater District',
      '123 Main St',
      'Portland',
      'OR',
      '97201',
    );

    const enContent = new EventLocationContent('en', 'Accessible seating available.');
    location.addContent(enContent);

    const obj = location.toObject();

    expect(obj.id).toBe('loc-123');
    expect(obj.name).toBe('Theater District');
    expect(obj.address).toBe('123 Main St');
    expect(obj.content).toHaveProperty('en');
    expect(obj.content.en.accessibilityInfo).toBe('Accessible seating available.');
  });

  test('deserializes from object with content correctly', () => {
    const obj = {
      id: 'loc-456',
      name: 'Convention Center',
      address: '777 Convention Way',
      city: 'Portland',
      state: 'OR',
      postalCode: '97204',
      country: 'United States',
      content: {
        en: {
          language: 'en',
          accessibilityInfo: 'Wheelchair ramps at all entrances.',
        },
        es: {
          language: 'es',
          accessibilityInfo: 'Rampas para sillas de ruedas en todas las entradas.',
        },
      },
    };

    const location = EventLocation.fromObject(obj);

    expect(location.id).toBe('loc-456');
    expect(location.name).toBe('Convention Center');
    expect(location.getLanguages()).toHaveLength(2);
    expect(location.content('en').accessibilityInfo).toBe('Wheelchair ramps at all entrances.');
    expect(location.content('es').accessibilityInfo).toBe('Rampas para sillas de ruedas en todas las entradas.');
  });

  test('round-trip conversion with content preserves data', () => {
    const original = new EventLocation(
      'loc-789',
      'Library',
      '456 Book St',
      'Seattle',
      'WA',
      '98101',
    );

    const enContent = new EventLocationContent('en', 'Quiet study areas available.');
    original.addContent(enContent);

    const obj = original.toObject();
    const roundTrip = EventLocation.fromObject(obj);

    expect(roundTrip.id).toBe(original.id);
    expect(roundTrip.name).toBe(original.name);
    expect(roundTrip.getLanguages()).toHaveLength(1);
    expect(roundTrip.content('en').accessibilityInfo).toBe('Quiet study areas available.');
  });

  test('drops content for specified language', () => {
    const location = new EventLocation(
      'loc-999',
      'Museum',
    );

    const enContent = new EventLocationContent('en', 'Audio guides available.');
    const frContent = new EventLocationContent('fr', 'Guides audio disponibles.');
    location.addContent(enContent);
    location.addContent(frContent);

    expect(location.getLanguages()).toHaveLength(2);

    location.dropContent('en');
    expect(location.getLanguages()).toHaveLength(1);
    expect(location.hasContent('en')).toBe(false);
    expect(location.hasContent('fr')).toBe(true);
  });

  test('deserializes from object without content', () => {
    const obj = {
      id: 'loc-111',
      name: 'Park',
      address: '789 Nature Ave',
      city: 'Bend',
      state: 'OR',
      postalCode: '97701',
    };

    const location = EventLocation.fromObject(obj);

    expect(location.id).toBe('loc-111');
    expect(location.name).toBe('Park');
    expect(location.getLanguages()).toHaveLength(0);
  });

  test('location without content serializes correctly', () => {
    const location = new EventLocation(
      'loc-222',
      'Coffee Shop',
      '321 Brew St',
    );

    const obj = location.toObject();

    expect(obj.id).toBe('loc-222');
    expect(obj.name).toBe('Coffee Shop');
    expect(obj.content).toEqual({});
  });
});
