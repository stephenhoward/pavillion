import { describe, test, expect, beforeEach } from 'vitest';
import { LocationEntity } from '@/server/calendar/entity/location';
import { LocationContentEntity } from '@/server/calendar/entity/location_content';
import { EventLocation, EventLocationContent } from '@/common/model/location';

describe('LocationEntity', () => {
  let sampleData: any;

  beforeEach(() => {
    sampleData = {
      id: 'https://pavillion.dev/places/loc-123',
      calendar_id: 'cal-456',
      name: 'Washington Park',
      address: '4033 SW Canyon Rd',
      city: 'Portland',
      state: 'OR',
      postal_code: '97221',
      country: 'United States',
    };
  });

  test('converts entity to model correctly without content', () => {
    const entity = LocationEntity.build(sampleData);
    entity.content = []; // No accessibility content

    const model = entity.toModel();

    expect(model).toBeInstanceOf(EventLocation);
    expect(model.id).toBe(sampleData.id);
    expect(model.name).toBe('Washington Park');
    expect(model.address).toBe('4033 SW Canyon Rd');
    expect(model.city).toBe('Portland');
    expect(model.state).toBe('OR');
    expect(model.postalCode).toBe('97221');
    expect(model.country).toBe('United States');
    expect(model.getLanguages()).toHaveLength(0);
  });

  test('converts entity to model correctly with content', () => {
    const entity = LocationEntity.build(sampleData);

    // Mock content relationship
    const contentEntity = LocationContentEntity.build({
      id: 'content-1',
      location_id: sampleData.id,
      language: 'en',
      accessibility_info: 'Wheelchair accessible paths throughout the venue.',
    });
    entity.content = [contentEntity];

    const model = entity.toModel();

    expect(model).toBeInstanceOf(EventLocation);
    expect(model.id).toBe(sampleData.id);
    expect(model.name).toBe('Washington Park');
    expect(model.getLanguages()).toHaveLength(1);
    expect(model.content('en').language).toBe('en');
    expect(model.content('en').accessibilityInfo).toBe('Wheelchair accessible paths throughout the venue.');
  });

  test('creates entity from model correctly without content', () => {
    const model = new EventLocation(
      'https://pavillion.dev/places/loc-789',
      'Community Center',
      '123 Main St',
      'Portland',
      'OR',
      '97201',
      'United States',
    );

    const entity = LocationEntity.fromModel(model);

    expect(entity.id).toBe(model.id);
    expect(entity.name).toBe(model.name);
    expect(entity.address).toBe(model.address);
    expect(entity.city).toBe(model.city);
    expect(entity.state).toBe(model.state);
    expect(entity.postal_code).toBe(model.postalCode);
    expect(entity.country).toBe(model.country);
  });

  test('round-trip conversion preserves data integrity', () => {
    const originalModel = new EventLocation(
      'https://pavillion.dev/places/loc-999',
      'Theater',
      '456 Broadway',
      'Portland',
      'OR',
      '97204',
    );

    // Add accessibility content
    const contentModel = new EventLocationContent('en', 'Accessible seating available.');
    originalModel.addContent(contentModel);

    // Model -> Entity -> Model
    const entity = LocationEntity.fromModel(originalModel);

    // Simulate loading content from database
    const contentEntity = LocationContentEntity.build({
      id: 'content-1',
      location_id: originalModel.id,
      language: 'en',
      accessibility_info: 'Accessible seating available.',
    });
    entity.content = [contentEntity];

    const convertedModel = entity.toModel();

    expect(convertedModel.id).toBe(originalModel.id);
    expect(convertedModel.name).toBe(originalModel.name);
    expect(convertedModel.address).toBe(originalModel.address);
    expect(convertedModel.getLanguages()).toHaveLength(1);
    expect(convertedModel.content('en').accessibilityInfo).toBe('Accessible seating available.');
  });

  test('handles multiple language content', () => {
    const entity = LocationEntity.build(sampleData);

    // Mock multiple content entities
    const enContent = LocationContentEntity.build({
      id: 'content-en',
      location_id: sampleData.id,
      language: 'en',
      accessibility_info: 'Elevator access to all floors.',
    });

    const esContent = LocationContentEntity.build({
      id: 'content-es',
      location_id: sampleData.id,
      language: 'es',
      accessibility_info: 'Acceso de ascensor a todos los pisos.',
    });

    entity.content = [enContent, esContent];

    const model = entity.toModel();

    expect(model.getLanguages()).toHaveLength(2);
    expect(model.content('en').accessibilityInfo).toBe('Elevator access to all floors.');
    expect(model.content('es').accessibilityInfo).toBe('Acceso de ascensor a todos los pisos.');
  });

  test('handles empty content array', () => {
    const entity = LocationEntity.build(sampleData);
    entity.content = []; // No content

    const model = entity.toModel();

    expect(model.getLanguages()).toHaveLength(0);
  });

  test('handles undefined content by treating as empty array', () => {
    const entity = LocationEntity.build(sampleData);
    // content is undefined (not loaded from database)

    const model = entity.toModel();

    expect(model.getLanguages()).toHaveLength(0);
  });
});
