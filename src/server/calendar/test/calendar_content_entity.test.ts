import { describe, test, expect, beforeEach } from 'vitest';
import { CalendarContent } from '@/common/model/calendar';
import { CalendarContentEntity } from '@/server/calendar/entity/calendar';

describe('CalendarContentEntity', () => {
  let sampleData: Record<string, any>;

  beforeEach(() => {
    sampleData = {
      id: 'content-123',
      calendar_id: 'calendar-456',
      language: 'en',
      name: 'Town Calendar',
      description: 'Events around town',
    };
  });

  test('converts entity to model correctly', () => {
    const entity = CalendarContentEntity.build(sampleData);
    const model = entity.toModel();

    expect(model).toBeInstanceOf(CalendarContent);
    expect(model.language).toBe('en');
    expect(model.name).toBe('Town Calendar');
    expect(model.description).toBe('Events around town');
  });

  test('creates entity from model correctly', () => {
    const model = new CalendarContent('es', 'Calendario', 'Eventos del pueblo');
    const entity = CalendarContentEntity.fromModel(model);

    expect(entity.language).toBe('es');
    expect(entity.name).toBe('Calendario');
    expect(entity.description).toBe('Eventos del pueblo');
  });

  test('converts entity to model with imageAlt', () => {
    const entity = CalendarContentEntity.build({
      ...sampleData,
      image_alt: 'A band playing on an outdoor stage.',
    });
    const model = entity.toModel();

    expect(model.imageAlt).toBe('A band playing on an outdoor stage.');
  });

  test('creates entity from model with imageAlt', () => {
    const model = new CalendarContent(
      'es',
      'Calendario',
      'Eventos del pueblo',
      'Un grupo tocando en un escenario al aire libre.',
    );
    const entity = CalendarContentEntity.fromModel(model);

    expect(entity.image_alt).toBe('Un grupo tocando en un escenario al aire libre.');
  });

  test('round-trip conversion preserves imageAlt', () => {
    const originalModel = new CalendarContent(
      'fr',
      'Calendrier',
      'Description',
      'Un groupe sur une scène en plein air.',
    );
    const convertedModel = CalendarContentEntity.fromModel(originalModel).toModel();

    expect(convertedModel.language).toBe(originalModel.language);
    expect(convertedModel.name).toBe(originalModel.name);
    expect(convertedModel.description).toBe(originalModel.description);
    expect(convertedModel.imageAlt).toBe(originalModel.imageAlt);
  });

  test('handles null image_alt by converting to empty string', () => {
    const entity = CalendarContentEntity.build({ ...sampleData, image_alt: null });
    const model = entity.toModel();

    expect(model.imageAlt).toBe('');
  });

  test('handles an absent image_alt column value as empty string', () => {
    const entity = CalendarContentEntity.build(sampleData);
    const model = entity.toModel();

    expect(model.imageAlt).toBe('');
  });
});
