import { describe, test, expect } from 'vitest';
import { EventLocationContent } from '@/common/model/location';

describe('EventLocationContent Model', () => {
  test('creates a valid content model', () => {
    const content = new EventLocationContent(
      'en',
      'Wheelchair accessible paths throughout the venue. Quiet rest area available.',
    );

    expect(content.language).toBe('en');
    expect(content.accessibilityInfo).toBe('Wheelchair accessible paths throughout the venue. Quiet rest area available.');
  });

  test('creates content with default empty accessibility info', () => {
    const content = new EventLocationContent('en');

    expect(content.language).toBe('en');
    expect(content.accessibilityInfo).toBe('');
  });

  test('validates correctly for valid content', () => {
    const content = new EventLocationContent('en', 'Elevator access to all floors.');

    expect(content.isValid()).toBe(true);
  });

  test('validates correctly for invalid content with empty language', () => {
    const content = new EventLocationContent('', 'Accessible parking available.');

    expect(content.isValid()).toBe(false);
  });

  test('isEmpty works correctly for content with no accessibility info', () => {
    const emptyContent = new EventLocationContent('en', '');
    const nonEmptyContent = new EventLocationContent('en', 'ASL interpreter available.');

    expect(emptyContent.isEmpty()).toBe(true);
    expect(nonEmptyContent.isEmpty()).toBe(false);
  });

  test('isEmpty works correctly for whitespace-only accessibility info', () => {
    const whitespaceContent = new EventLocationContent('en', '   ');

    expect(whitespaceContent.isEmpty()).toBe(true);
  });

  test('serializes to object correctly', () => {
    const content = new EventLocationContent('es', 'Acceso para sillas de ruedas disponible.');

    const obj = content.toObject();

    expect(obj.language).toBe('es');
    expect(obj.accessibilityInfo).toBe('Acceso para sillas de ruedas disponible.');
  });

  test('deserializes from object correctly', () => {
    const obj = {
      language: 'fr',
      accessibilityInfo: 'Ascenseur disponible pour tous les étages.',
    };

    const content = EventLocationContent.fromObject(obj);

    expect(content.language).toBe('fr');
    expect(content.accessibilityInfo).toBe('Ascenseur disponible pour tous les étages.');
  });

  test('deserializes from object with missing accessibilityInfo', () => {
    const obj = {
      language: 'en',
    };

    const content = EventLocationContent.fromObject(obj);

    expect(content.language).toBe('en');
    expect(content.accessibilityInfo).toBe('');
  });

  test('round-trip conversion preserves data', () => {
    const original = new EventLocationContent('de', 'Rollstuhlgerechte Eingänge.');
    const obj = original.toObject();
    const roundTrip = EventLocationContent.fromObject(obj);

    expect(roundTrip.language).toBe(original.language);
    expect(roundTrip.accessibilityInfo).toBe(original.accessibilityInfo);
  });
});
