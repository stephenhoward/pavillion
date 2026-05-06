import { describe, test, expect } from 'vitest';
import { EventLocationSpaceContent } from '@/common/model/location';

describe('EventLocationSpaceContent Model', () => {
  test('creates a valid content model', () => {
    const content = new EventLocationSpaceContent(
      'en',
      'Pacific Room',
      'Wheelchair accessible. Hearing loop available.',
    );

    expect(content.language).toBe('en');
    expect(content.name).toBe('Pacific Room');
    expect(content.accessibilityInfo).toBe('Wheelchair accessible. Hearing loop available.');
  });

  test('creates content with default empty name and accessibility info', () => {
    const content = new EventLocationSpaceContent('en');

    expect(content.language).toBe('en');
    expect(content.name).toBe('');
    expect(content.accessibilityInfo).toBe('');
  });

  test('isValid returns true when language and name are non-empty', () => {
    const content = new EventLocationSpaceContent('en', 'Pacific Room');

    expect(content.isValid()).toBe(true);
  });

  test('isValid returns false when language is empty', () => {
    const content = new EventLocationSpaceContent('', 'Pacific Room');

    expect(content.isValid()).toBe(false);
  });

  test('isValid returns false when name is empty', () => {
    const content = new EventLocationSpaceContent('en');

    expect(content.isValid()).toBe(false);
  });

  test('isValid returns false when name is only whitespace', () => {
    const content = new EventLocationSpaceContent('en', '   ');

    expect(content.isValid()).toBe(false);
  });

  test('isEmpty returns true when both name and accessibilityInfo are blank', () => {
    const content = new EventLocationSpaceContent('en', '', '');

    expect(content.isEmpty()).toBe(true);
  });

  test('isEmpty returns true when both name and accessibilityInfo are whitespace', () => {
    const content = new EventLocationSpaceContent('en', '  ', '   ');

    expect(content.isEmpty()).toBe(true);
  });

  test('isEmpty returns false when name is set', () => {
    const content = new EventLocationSpaceContent('en', 'Pacific Room', '');

    expect(content.isEmpty()).toBe(false);
  });

  test('isEmpty returns false when accessibilityInfo is set', () => {
    const content = new EventLocationSpaceContent('en', '', 'ASL interpreter available.');

    expect(content.isEmpty()).toBe(false);
  });

  test('serializes to object correctly', () => {
    const content = new EventLocationSpaceContent('es', 'Sala Pacífico', 'Acceso para sillas de ruedas disponible.');

    const obj = content.toObject();

    expect(obj.language).toBe('es');
    expect(obj.name).toBe('Sala Pacífico');
    expect(obj.accessibilityInfo).toBe('Acceso para sillas de ruedas disponible.');
  });

  test('deserializes from object correctly', () => {
    const obj = {
      language: 'fr',
      name: 'Salle Pacifique',
      accessibilityInfo: 'Ascenseur disponible pour tous les étages.',
    };

    const content = EventLocationSpaceContent.fromObject(obj);

    expect(content.language).toBe('fr');
    expect(content.name).toBe('Salle Pacifique');
    expect(content.accessibilityInfo).toBe('Ascenseur disponible pour tous les étages.');
  });

  test('deserializes from object with missing name and accessibilityInfo', () => {
    const obj = {
      language: 'en',
    };

    const content = EventLocationSpaceContent.fromObject(obj);

    expect(content.language).toBe('en');
    expect(content.name).toBe('');
    expect(content.accessibilityInfo).toBe('');
  });

  test('round-trip conversion preserves data', () => {
    const original = new EventLocationSpaceContent('de', 'Pazifikraum', 'Rollstuhlgerechte Eingänge.');
    const obj = original.toObject();
    const roundTrip = EventLocationSpaceContent.fromObject(obj);

    expect(roundTrip.language).toBe(original.language);
    expect(roundTrip.name).toBe(original.name);
    expect(roundTrip.accessibilityInfo).toBe(original.accessibilityInfo);
  });
});
