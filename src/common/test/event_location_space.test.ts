import { describe, test, expect } from 'vitest';
import { EventLocationSpace, EventLocationSpaceContent } from '@/common/model/location';

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

describe('EventLocationSpace Model', () => {
  test('initializes with id and placeId', () => {
    const space = new EventLocationSpace('space-uuid', 'place-uuid');

    expect(space.id).toBe('space-uuid');
    expect(space.placeId).toBe('place-uuid');
    expect(Object.keys(space._content)).toHaveLength(0);
  });

  test('initializes with default empty id and placeId', () => {
    const space = new EventLocationSpace();

    expect(space.id).toBe('');
    expect(space.placeId).toBe('');
    expect(Object.keys(space._content)).toHaveLength(0);
  });

  test('createContent (via content()) returns EventLocationSpaceContent for the language', () => {
    const space = new EventLocationSpace();
    const content = space.content('en');

    expect(content).toBeInstanceOf(EventLocationSpaceContent);
    expect(content.language).toBe('en');
  });

  test('toObject emits id, placeId, and per-language content map', () => {
    const space = new EventLocationSpace('s1', 'p1');
    space.addContent(new EventLocationSpaceContent('en', 'Pacific Room', 'Hearing loop'));
    space.addContent(new EventLocationSpaceContent('fr', 'Salle Pacifique', 'Boucle auditive'));

    const obj = space.toObject();

    expect(obj.id).toBe('s1');
    expect(obj.placeId).toBe('p1');
    expect(obj.content.en.name).toBe('Pacific Room');
    expect(obj.content.en.accessibilityInfo).toBe('Hearing loop');
    expect(obj.content.fr.name).toBe('Salle Pacifique');
    expect(obj.content.fr.accessibilityInfo).toBe('Boucle auditive');
  });

  test('fromObject reconstructs space across multiple languages', () => {
    const obj = {
      id: 's1',
      placeId: 'p1',
      content: {
        en: { name: 'Pacific Room', accessibilityInfo: 'Hearing loop' },
        fr: { name: 'Salle Pacifique', accessibilityInfo: 'Boucle auditive' },
      },
    };

    const restored = EventLocationSpace.fromObject(obj);

    expect(restored.id).toBe('s1');
    expect(restored.placeId).toBe('p1');
    expect(restored.content('en').name).toBe('Pacific Room');
    expect(restored.content('en').accessibilityInfo).toBe('Hearing loop');
    expect(restored.content('fr').name).toBe('Salle Pacifique');
    expect(restored.content('fr').accessibilityInfo).toBe('Boucle auditive');
  });

  test('multilingual round-trip preserves content for every language', () => {
    const original = new EventLocationSpace('s1', 'p1');
    original.addContent(new EventLocationSpaceContent('en', 'Pacific Room', 'Hearing loop'));
    original.addContent(new EventLocationSpaceContent('es', 'Sala Pacífico', 'Acceso para sillas de ruedas'));
    original.addContent(new EventLocationSpaceContent('de', 'Pazifikraum', 'Rollstuhlgerechte Eingänge'));

    const restored = EventLocationSpace.fromObject(original.toObject());

    expect(restored.id).toBe(original.id);
    expect(restored.placeId).toBe(original.placeId);
    expect(restored.getLanguages().sort()).toEqual(['de', 'en', 'es']);
    expect(restored.content('en').name).toBe('Pacific Room');
    expect(restored.content('es').name).toBe('Sala Pacífico');
    expect(restored.content('de').name).toBe('Pazifikraum');
    expect(restored.content('en').accessibilityInfo).toBe('Hearing loop');
    expect(restored.content('es').accessibilityInfo).toBe('Acceso para sillas de ruedas');
    expect(restored.content('de').accessibilityInfo).toBe('Rollstuhlgerechte Eingänge');
  });
});
