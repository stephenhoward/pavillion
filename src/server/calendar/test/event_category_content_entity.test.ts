import { describe, test, expect, beforeEach } from 'vitest';
import { EventCategoryContentEntity } from '@/server/calendar/entity/event_category';
import { EventCategoryContentModel } from '@/common/model/event_category_content';

describe('EventCategoryContentEntity', () => {
  let sampleData: any;

  beforeEach(() => {
    sampleData = {
      id: 'content-123',
      category_id: 'cat-456',
      language: 'en',
      name: 'Meeting',
    };
  });

  test('converts entity to model correctly', () => {
    const entity = EventCategoryContentEntity.build(sampleData);
    const model = entity.toModel();

    expect(model).toBeInstanceOf(EventCategoryContentModel);
    expect(model.language).toBe(sampleData.language);
    expect(model.name).toBe(sampleData.name);
  });

  test('creates entity from model correctly', () => {
    const model = new EventCategoryContentModel('en', 'Meeting');
    const entity = EventCategoryContentEntity.fromModel(model);

    expect(entity.language).toBe(model.language);
    expect(entity.name).toBe(model.name);
  });

  test('round-trip conversion preserves data integrity', () => {
    const originalModel = new EventCategoryContentModel('en', 'Meeting');

    // Model -> Entity -> Model
    const entity = EventCategoryContentEntity.fromModel(originalModel);
    const convertedModel = entity.toModel();

    expect(convertedModel.language).toBe(originalModel.language);
    expect(convertedModel.name).toBe(originalModel.name);
  });

  test('handles empty name correctly', () => {
    const model = new EventCategoryContentModel('en', '');
    const entity = EventCategoryContentEntity.fromModel(model);
    const convertedModel = entity.toModel();

    expect(convertedModel.name).toBe('');
    expect(convertedModel.isEmpty()).toBe(true);
  });

  test('validates content is not empty', () => {
    const model = new EventCategoryContentModel('en', 'Meeting');
    expect(model.isValid()).toBe(true);

    const emptyModel = new EventCategoryContentModel('en', '');
    expect(emptyModel.isValid()).toBe(false);
  });
});
