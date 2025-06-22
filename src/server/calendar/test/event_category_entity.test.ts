import { describe, test, expect, beforeEach } from 'vitest';
import { EventCategoryEntity, EventCategoryContentEntity } from '@/server/calendar/entity/event_category';
import { EventCategoryModel } from '@/common/model/event_category';
import { EventCategoryContentModel } from '@/common/model/event_category_content';

describe('EventCategoryEntity', () => {
  let sampleData: any;

  beforeEach(() => {
    sampleData = {
      id: 'cat-123',
      calendar_id: 'cal-456',
      created_at: new Date('2023-01-01'),
      updated_at: new Date('2023-01-02'),
    };
  });

  test('converts entity to model correctly', () => {
    const entity = EventCategoryEntity.build(sampleData);

    // Mock content relationship
    const contentEntity = EventCategoryContentEntity.build({
      id: 'content-1',
      category_id: 'cat-123',
      language: 'en',
      name: 'Meeting',
    });
    entity.content = [contentEntity];

    const model = entity.toModel();

    expect(model).toBeInstanceOf(EventCategoryModel);
    expect(model.id).toBe(sampleData.id);
    expect(model.calendarId).toBe(sampleData.calendar_id);
    expect(model.getLanguages()).toHaveLength(1);
    expect(model.content('en').language).toBe('en');
    expect(model.content('en').name).toBe('Meeting');
  });

  test('creates entity from model correctly', () => {
    const model = new EventCategoryModel(
      'cat-123',
      'cal-456',
    );

    // Add content using TranslatedModel API
    const contentModel = new EventCategoryContentModel('en', 'Meeting');
    model.addContent(contentModel);

    const entity = EventCategoryEntity.fromModel(model);

    expect(entity.id).toBe(model.id);
    expect(entity.calendar_id).toBe(model.calendarId);
  });

  test('round-trip conversion preserves data integrity', () => {
    const originalModel = new EventCategoryModel(
      'cat-123',
      'cal-456',
    );

    // Add content using TranslatedModel API
    const contentModel = new EventCategoryContentModel('en', 'Meeting');
    originalModel.addContent(contentModel);

    // Model -> Entity -> Model
    const entity = EventCategoryEntity.fromModel(originalModel);

    // Simulate loading content from database
    const contentEntity = EventCategoryContentEntity.build({
      id: 'content-1',
      category_id: 'cat-123',
      language: 'en',
      name: 'Meeting',
    });
    entity.content = [contentEntity];

    const convertedModel = entity.toModel();

    expect(convertedModel.id).toBe(originalModel.id);
    expect(convertedModel.calendarId).toBe(originalModel.calendarId);
    expect(convertedModel.getLanguages()).toHaveLength(1);
    expect(convertedModel.content('en').language).toBe('en');
    expect(convertedModel.content('en').name).toBe('Meeting');
  });

  test('handles empty content array', () => {
    const entity = EventCategoryEntity.build(sampleData);
    entity.content = []; // No content

    const model = entity.toModel();

    expect(model.getLanguages()).toHaveLength(0);
  });

  test('handles multiple language content', () => {
    const entity = EventCategoryEntity.build(sampleData);

    // Mock multiple content entities
    const enContent = EventCategoryContentEntity.build({
      id: 'content-1',
      category_id: 'cat-123',
      language: 'en',
      name: 'Meeting',
    });
    const esContent = EventCategoryContentEntity.build({
      id: 'content-2',
      category_id: 'cat-123',
      language: 'es',
      name: 'Reunión',
    });
    entity.content = [enContent, esContent];

    const model = entity.toModel();

    expect(model.getLanguages()).toHaveLength(2);
    expect(model.content('en').name).toBe('Meeting');
    expect(model.content('es').name).toBe('Reunión');
  });
});
