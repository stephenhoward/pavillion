import { describe, it, expect } from 'vitest';
import { CalendarEditor } from '@/common/model/calendar_editor';

describe('CalendarEditor Model', () => {

  it('should create instance with all required properties', () => {
    const editor = new CalendarEditor(
      'test-id',
      'calendar-id',
      'account-id',
    );

    expect(editor.id).toBe('test-id');
    expect(editor.calendarId).toBe('calendar-id');
    expect(editor.accountId).toBe('account-id');
  });

  it('toObject: should return proper object with all fields', () => {
    const editor = new CalendarEditor(
      'test-id',
      'calendar-id',
      'account-id',
    );

    const obj = editor.toObject();

    expect(obj).toEqual({
      id: 'test-id',
      calendarId: 'calendar-id',
      accountId: 'account-id',
    });
  });

  it('fromObject: should create instance from object correctly', () => {

    const obj = {
      id: 'test-id',
      calendarId: 'calendar-id',
      accountId: 'account-id',
    };

    const editor = CalendarEditor.fromObject(obj);

    expect(editor.id).toBe('test-id');
    expect(editor.calendarId).toBe('calendar-id');
    expect(editor.accountId).toBe('account-id');
  });

  it('should maintain data integrity through toObject-fromObject conversion', () => {
    const original = new CalendarEditor(
      'round-trip-id',
      'calendar-id',
      'account-id',
    );

    const obj = original.toObject();
    const roundTrip = CalendarEditor.fromObject(obj);

    expect(roundTrip.id).toBe(original.id);
    expect(roundTrip.calendarId).toBe(original.calendarId);
    expect(roundTrip.accountId).toBe(original.accountId);
  });
});
