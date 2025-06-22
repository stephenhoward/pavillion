import { describe, test, expect, beforeEach } from 'vitest';
import { EventCategoryAssignmentEntity } from '@/server/calendar/entity/event_category_assignment';
import { EventCategoryAssignmentModel } from '@/common/model/event_category_assignment';

describe('EventCategoryAssignmentEntity', () => {
  let sampleData: any;

  beforeEach(() => {
    sampleData = {
      id: 'assign-123',
      event_id: 'event-456',
      category_id: 'cat-789',
      created_at: new Date('2023-01-01'),
    };
  });

  test('converts entity to model correctly', () => {
    const entity = EventCategoryAssignmentEntity.build(sampleData);
    const model = entity.toModel();

    expect(model).toBeInstanceOf(EventCategoryAssignmentModel);
    expect(model.id).toBe(sampleData.id);
    expect(model.eventId).toBe(sampleData.event_id);
    expect(model.categoryId).toBe(sampleData.category_id);
    expect(model.createdAt).toEqual(sampleData.created_at);
  });

  test('creates entity from model correctly', () => {
    const model = new EventCategoryAssignmentModel(
      'assign-123',
      'event-456',
      'cat-789',
      new Date('2023-01-01'),
    );

    const entity = EventCategoryAssignmentEntity.fromModel(model);

    expect(entity.id).toBe(model.id);
    expect(entity.event_id).toBe(model.eventId);
    expect(entity.category_id).toBe(model.categoryId);
    expect(entity.created_at).toEqual(model.createdAt);
  });

  test('round-trip conversion preserves data integrity', () => {
    const originalModel = new EventCategoryAssignmentModel(
      'assign-123',
      'event-456',
      'cat-789',
      new Date('2023-01-01'),
    );

    // Model -> Entity -> Model
    const entity = EventCategoryAssignmentEntity.fromModel(originalModel);
    const convertedModel = entity.toModel();

    expect(convertedModel.id).toBe(originalModel.id);
    expect(convertedModel.eventId).toBe(originalModel.eventId);
    expect(convertedModel.categoryId).toBe(originalModel.categoryId);
    expect(convertedModel.createdAt).toEqual(originalModel.createdAt);
  });
});
