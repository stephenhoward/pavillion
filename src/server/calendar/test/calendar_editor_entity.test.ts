import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CalendarEditorEntity } from '../entity/calendar_editor';
import { CalendarEditor } from '@/common/model/calendar_editor';

describe('CalendarEditorEntity', () => {
  let calendarEditor: CalendarEditor;
  let calendarEditorEntity: CalendarEditorEntity;

  beforeEach(() => {
    // Create a model instance
    calendarEditor = new CalendarEditor(
      'test-editor-id',
      'test-calendar-id',
      'test-account-id',
    );

    // Create entity from model
    calendarEditorEntity = CalendarEditorEntity.fromModel(calendarEditor);
  });

  afterEach(() => {
    // Clean up any test data if needed
  });

  it('should convert entity to model correctly', () => {
    const model = calendarEditorEntity.toModel();

    expect(model).toBeInstanceOf(CalendarEditor);
    expect(model.id).toBe('test-editor-id');
    expect(model.calendarId).toBe('test-calendar-id');
    expect(model.accountId).toBe('test-account-id');
  });

  it('should create entity from model correctly', () => {
    const entity = CalendarEditorEntity.fromModel(calendarEditor);

    expect(entity.id).toBe('test-editor-id');
    expect(entity.calendar_id).toBe('test-calendar-id');
    expect(entity.account_id).toBe('test-account-id');
  });

  it('should maintain data integrity through model-entity-model conversion', () => {
    const originalModel = new CalendarEditor(
      'round-trip-id',
      'calendar-id',
      'account-id',
    );

    // Convert to entity and back to model
    const entity = CalendarEditorEntity.fromModel(originalModel);
    const roundTripModel = entity.toModel();

    expect(roundTripModel.id).toBe(originalModel.id);
    expect(roundTripModel.calendarId).toBe(originalModel.calendarId);
    expect(roundTripModel.accountId).toBe(originalModel.accountId);
  });
});
