import { describe, it, expect } from 'vitest';
import { CalendarEditor } from '@/common/model/calendar_editor';

describe('CalendarEditor Model', () => {

  it('should create instance with all required properties', () => {
    const editor = new CalendarEditor(
      'test-id',
      'calendar-id',
      'email@pavillion.dev',
    );

    expect(editor.id).toBe('test-id');
    expect(editor.calendarId).toBe('calendar-id');
    expect(editor.email).toBe('email@pavillion.dev');
    expect(editor.displayName).toBeNull();
    expect(editor.username).toBeNull();
  });

  it('should create instance with optional displayName and username', () => {
    const editor = new CalendarEditor(
      'test-id',
      'calendar-id',
      'email@pavillion.dev',
      'Test User',
      'testuser',
    );

    expect(editor.id).toBe('test-id');
    expect(editor.calendarId).toBe('calendar-id');
    expect(editor.email).toBe('email@pavillion.dev');
    expect(editor.displayName).toBe('Test User');
    expect(editor.username).toBe('testuser');
  });

  it('toObject: should return proper object with all fields', () => {
    const editor = new CalendarEditor(
      'test-id',
      'calendar-id',
      'email@pavillion.dev',
    );

    const obj = editor.toObject();

    expect(obj).toEqual({
      id: 'test-id',
      calendarId: 'calendar-id',
      email: 'email@pavillion.dev',
      displayName: null,
      username: null,
    });
  });

  it('toObject: should include displayName and username when set', () => {
    const editor = new CalendarEditor(
      'test-id',
      'calendar-id',
      'email@pavillion.dev',
      'Test User',
      'testuser',
    );

    const obj = editor.toObject();

    expect(obj).toEqual({
      id: 'test-id',
      calendarId: 'calendar-id',
      email: 'email@pavillion.dev',
      displayName: 'Test User',
      username: 'testuser',
    });
  });

  it('fromObject: should create instance from object correctly', () => {

    const obj = {
      id: 'test-id',
      calendarId: 'calendar-id',
      email: 'email@pavillion.dev',
    };

    const editor = CalendarEditor.fromObject(obj);

    expect(editor.id).toBe('test-id');
    expect(editor.calendarId).toBe('calendar-id');
    expect(editor.email).toBe('email@pavillion.dev');
    expect(editor.displayName).toBeNull();
    expect(editor.username).toBeNull();
  });

  it('fromObject: should create instance with displayName and username', () => {

    const obj = {
      id: 'test-id',
      calendarId: 'calendar-id',
      email: 'email@pavillion.dev',
      displayName: 'Test User',
      username: 'testuser',
    };

    const editor = CalendarEditor.fromObject(obj);

    expect(editor.id).toBe('test-id');
    expect(editor.calendarId).toBe('calendar-id');
    expect(editor.email).toBe('email@pavillion.dev');
    expect(editor.displayName).toBe('Test User');
    expect(editor.username).toBe('testuser');
  });

  it('should maintain data integrity through toObject-fromObject conversion', () => {
    const original = new CalendarEditor(
      'round-trip-id',
      'calendar-id',
      'email@pavillion.dev',
      'Round Trip User',
      'roundtripuser',
    );

    const obj = original.toObject();
    const roundTrip = CalendarEditor.fromObject(obj);

    expect(roundTrip.id).toBe(original.id);
    expect(roundTrip.calendarId).toBe(original.calendarId);
    expect(roundTrip.email).toBe(original.email);
    expect(roundTrip.displayName).toBe(original.displayName);
    expect(roundTrip.username).toBe(original.username);
  });
});
