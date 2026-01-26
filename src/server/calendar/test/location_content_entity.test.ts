import { describe, test, expect, beforeEach } from 'vitest';
import { EventLocationContent } from '@/common/model/location';
import { LocationContentEntity } from '@/server/calendar/entity/location';

describe('LocationContentEntity', () => {
  let sampleData: Record<string, any>;

  beforeEach(() => {
    sampleData = {
      id: 'content-123',
      location_id: 'loc-456',
      language: 'en',
      accessibility_info: 'Wheelchair accessible paths throughout the venue.',
    };
  });

  test('converts entity to model correctly', () => {
    const entity = LocationContentEntity.build(sampleData);
    const model = entity.toModel();

    expect(model).toBeInstanceOf(EventLocationContent);
    expect(model.language).toBe('en');
    expect(model.accessibilityInfo).toBe('Wheelchair accessible paths throughout the venue.');
  });

  test('creates entity from model correctly', () => {
    const model = new EventLocationContent(
      'es',
      'Acceso para sillas de ruedas disponible.',
    );
    const entity = LocationContentEntity.fromModel('loc-789', model);

    expect(entity.location_id).toBe('loc-789');
    expect(entity.language).toBe('es');
    expect(entity.accessibility_info).toBe('Acceso para sillas de ruedas disponible.');
  });

  test('round-trip conversion preserves data integrity', () => {
    const originalModel = new EventLocationContent(
      'fr',
      'Ascenseur disponible pour tous les étages.',
    );
    const entity = LocationContentEntity.fromModel('loc-111', originalModel);
    const convertedModel = entity.toModel();

    expect(convertedModel.language).toBe(originalModel.language);
    expect(convertedModel.accessibilityInfo).toBe(originalModel.accessibilityInfo);
  });

  test('handles empty accessibility info', () => {
    const entity = LocationContentEntity.build({
      id: 'content-222',
      location_id: 'loc-333',
      language: 'de',
      accessibility_info: '',
    });
    const model = entity.toModel();

    expect(model.language).toBe('de');
    expect(model.accessibilityInfo).toBe('');
    expect(model.isEmpty()).toBe(true);
  });

  test('handles null accessibility info by converting to empty string', () => {
    const entity = LocationContentEntity.build({
      id: 'content-333',
      location_id: 'loc-444',
      language: 'ja',
      accessibility_info: null,
    });
    const model = entity.toModel();

    expect(model.language).toBe('ja');
    expect(model.accessibilityInfo).toBe('');
  });
});
