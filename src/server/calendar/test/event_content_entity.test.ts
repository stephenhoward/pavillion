import { describe, test, expect, beforeEach } from 'vitest';
import { CalendarEventContent } from '@/common/model/events';
import { EventContentEntity } from '@/server/calendar/entity/event';

describe('EventContentEntity', () => {
  let sampleData: Record<string, any>;

  beforeEach(() => {
    sampleData = {
      id: 'content-123',
      event_id: 'event-456',
      language: 'en',
      name: 'Test Event',
      description: 'A test event description',
      accessibility_info: 'Wheelchair accessible entrance on the east side.',
    };
  });

  test('converts entity to model with accessibilityInfo', () => {
    const entity = EventContentEntity.build(sampleData);
    const model = entity.toModel();

    expect(model).toBeInstanceOf(CalendarEventContent);
    expect(model.language).toBe('en');
    expect(model.name).toBe('Test Event');
    expect(model.description).toBe('A test event description');
    expect(model.accessibilityInfo).toBe('Wheelchair accessible entrance on the east side.');
  });

  test('creates entity from model with accessibilityInfo', () => {
    const model = new CalendarEventContent(
      'es',
      'Evento de prueba',
      'Una descripcion',
      'Acceso para sillas de ruedas disponible.',
    );
    const entity = EventContentEntity.fromModel(model);

    expect(entity.language).toBe('es');
    expect(entity.name).toBe('Evento de prueba');
    expect(entity.description).toBe('Una descripcion');
    expect(entity.accessibility_info).toBe('Acceso para sillas de ruedas disponible.');
  });

  test('round-trip conversion preserves accessibilityInfo', () => {
    const originalModel = new CalendarEventContent(
      'fr',
      'Événement',
      'Description',
      'Ascenseur disponible pour tous les étages.',
    );
    const entity = EventContentEntity.fromModel(originalModel);
    const convertedModel = entity.toModel();

    expect(convertedModel.language).toBe(originalModel.language);
    expect(convertedModel.name).toBe(originalModel.name);
    expect(convertedModel.description).toBe(originalModel.description);
    expect(convertedModel.accessibilityInfo).toBe(originalModel.accessibilityInfo);
  });

  test('handles empty accessibility_info', () => {
    const entity = EventContentEntity.build({
      ...sampleData,
      accessibility_info: '',
    });
    const model = entity.toModel();

    expect(model.accessibilityInfo).toBe('');
  });

  test('handles null accessibility_info by converting to empty string', () => {
    const entity = EventContentEntity.build({
      ...sampleData,
      accessibility_info: null,
    });
    const model = entity.toModel();

    expect(model.accessibilityInfo).toBe('');
  });
});
