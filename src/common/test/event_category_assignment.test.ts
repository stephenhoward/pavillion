import { describe, test, expect } from 'vitest';
import { EventCategoryAssignmentModel } from '@/common/model/event_category_assignment';

describe('EventCategoryAssignmentModel', () => {
  test('creates a valid assignment model', () => {
    const assignment = new EventCategoryAssignmentModel(
      'assign-123',
      'event-456',
      'cat-789',
    );

    expect(assignment.id).toBe('assign-123');
    expect(assignment.eventId).toBe('event-456');
    expect(assignment.categoryId).toBe('cat-789');
    expect(assignment.createdAt).toBeInstanceOf(Date);
  });

  test('validates correctly for valid assignment', () => {
    const assignment = new EventCategoryAssignmentModel(
      'assign-123',
      'event-456',
      'cat-789',
    );

    expect(assignment.isValid()).toBe(true);
  });

  test('validates correctly for invalid assignment with empty eventId', () => {
    const assignment = new EventCategoryAssignmentModel(
      'assign-123',
      '',
      'cat-789',
    );

    expect(assignment.isValid()).toBe(false);
  });

  test('validates correctly for invalid assignment with empty categoryId', () => {
    const assignment = new EventCategoryAssignmentModel(
      'assign-123',
      'event-456',
      '',
    );

    expect(assignment.isValid()).toBe(false);
  });

  test('serializes to object correctly', () => {
    const assignment = new EventCategoryAssignmentModel(
      'assign-123',
      'event-456',
      'cat-789',
    );

    const obj = assignment.toObject();

    expect(obj.id).toBe('assign-123');
    expect(obj.eventId).toBe('event-456');
    expect(obj.categoryId).toBe('cat-789');
    expect(obj.createdAt).toBeInstanceOf(Date);
  });

  test('deserializes from object correctly', () => {
    const obj = {
      id: 'assign-123',
      eventId: 'event-456',
      categoryId: 'cat-789',
      createdAt: new Date('2023-01-01'),
    };

    const assignment = EventCategoryAssignmentModel.fromObject(obj);

    expect(assignment.id).toBe('assign-123');
    expect(assignment.eventId).toBe('event-456');
    expect(assignment.categoryId).toBe('cat-789');
    expect(assignment.createdAt).toEqual(new Date('2023-01-01'));
  });
});
