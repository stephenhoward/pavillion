import { describe, test, expect, beforeEach } from 'vitest';
import { EventSeriesContentEntity } from '@/server/calendar/entity/event_series';
import { EventSeriesContent } from '@/common/model/event_series_content';

describe('EventSeriesContentEntity', () => {
  let sampleData: any;

  beforeEach(() => {
    sampleData = {
      id: 'content-123',
      series_id: 'series-456',
      language: 'en',
      name: 'Summer Concert Series',
      description: 'A series of outdoor concerts every weekend',
    };
  });

  test('converts entity to model correctly', () => {
    const entity = EventSeriesContentEntity.build(sampleData);
    const model = entity.toModel();

    expect(model).toBeInstanceOf(EventSeriesContent);
    expect(model.language).toBe(sampleData.language);
    expect(model.name).toBe(sampleData.name);
    expect(model.description).toBe(sampleData.description);
  });

  test('creates entity from model correctly', () => {
    const model = new EventSeriesContent('en', 'Summer Concert Series', 'A series of outdoor concerts every weekend');
    const entity = EventSeriesContentEntity.fromModel(model);

    expect(entity.language).toBe(model.language);
    expect(entity.name).toBe(model.name);
    expect(entity.description).toBe(model.description);
  });

  test('round-trip conversion preserves data integrity', () => {
    const originalModel = new EventSeriesContent('en', 'Summer Concert Series', 'A series of outdoor concerts every weekend');

    // Model -> Entity -> Model
    const entity = EventSeriesContentEntity.fromModel(originalModel);
    const convertedModel = entity.toModel();

    expect(convertedModel.language).toBe(originalModel.language);
    expect(convertedModel.name).toBe(originalModel.name);
    expect(convertedModel.description).toBe(originalModel.description);
  });

  test('handles empty description correctly', () => {
    const model = new EventSeriesContent('en', 'Summer Concert Series', '');
    const entity = EventSeriesContentEntity.fromModel(model);
    const convertedModel = entity.toModel();

    expect(convertedModel.name).toBe('Summer Concert Series');
    expect(convertedModel.description).toBe('');
  });

  test('handles null description correctly', () => {
    const entityData = { ...sampleData, description: null };
    const entity = EventSeriesContentEntity.build(entityData);
    const model = entity.toModel();

    expect(model.name).toBe(sampleData.name);
    expect(model.description).toBe('');
  });

  test('validates content is valid with name', () => {
    const model = new EventSeriesContent('en', 'Concert Series');
    expect(model.isValid()).toBe(true);
  });

  test('validates content is invalid without name', () => {
    const emptyModel = new EventSeriesContent('en', '');
    expect(emptyModel.isValid()).toBe(false);
  });
});
