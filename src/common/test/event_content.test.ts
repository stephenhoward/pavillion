import { describe, test, expect } from 'vitest';
import { CalendarEventContent } from '@/common/model/events';

describe('CalendarEventContent Model', () => {
  test('creates content with all fields', () => {
    const content = new CalendarEventContent('en', 'Event Name', 'A description', 'Wheelchair accessible');

    expect(content.language).toBe('en');
    expect(content.name).toBe('Event Name');
    expect(content.description).toBe('A description');
    expect(content.accessibilityInfo).toBe('Wheelchair accessible');
  });

  test('creates content with default empty accessibilityInfo', () => {
    const content = new CalendarEventContent('en', 'Event Name', 'A description');

    expect(content.accessibilityInfo).toBe('');
  });

  test('serializes accessibilityInfo in toObject', () => {
    const content = new CalendarEventContent('en', 'Event Name', 'A description', 'ASL interpreter available');
    const obj = content.toObject();

    expect(obj.accessibilityInfo).toBe('ASL interpreter available');
    expect(obj.language).toBe('en');
    expect(obj.name).toBe('Event Name');
    expect(obj.description).toBe('A description');
  });

  test('deserializes accessibilityInfo from fromObject', () => {
    const obj = {
      language: 'en',
      name: 'Event Name',
      description: 'A description',
      accessibilityInfo: 'Elevator access to all floors',
    };

    const content = CalendarEventContent.fromObject(obj);

    expect(content.accessibilityInfo).toBe('Elevator access to all floors');
  });

  test('fromObject treats null accessibilityInfo as empty string', () => {
    const content = CalendarEventContent.fromObject({
      language: 'en',
      name: 'Event Name',
      description: 'A description',
      accessibilityInfo: null,
    });

    expect(content.accessibilityInfo).toBe('');
  });

  test('fromObject handles missing accessibilityInfo', () => {
    const obj = {
      language: 'en',
      name: 'Event Name',
      description: 'A description',
    };

    const content = CalendarEventContent.fromObject(obj);

    expect(content.accessibilityInfo).toBe('');
  });

  test('round-trip conversion preserves accessibilityInfo', () => {
    const original = new CalendarEventContent('fr', 'Nom', 'Description', 'Accès fauteuil roulant');
    const obj = original.toObject();
    const roundTrip = CalendarEventContent.fromObject(obj);

    expect(roundTrip.language).toBe(original.language);
    expect(roundTrip.name).toBe(original.name);
    expect(roundTrip.description).toBe(original.description);
    expect(roundTrip.accessibilityInfo).toBe(original.accessibilityInfo);
  });

  test('isEmpty returns false when only accessibilityInfo is set', () => {
    const content = new CalendarEventContent('en', '', '', 'Wheelchair ramp available');

    expect(content.isEmpty()).toBe(false);
  });

  test('isEmpty returns true when all fields are empty', () => {
    const content = new CalendarEventContent('en', '', '', '');

    expect(content.isEmpty()).toBe(true);
  });
});
