import { describe, test, expect } from 'vitest';
import { CalendarContent } from '@/common/model/calendar';

describe('CalendarContent', () => {
  test('creates content with the supplied fields', () => {
    const content = new CalendarContent('en', 'Town Calendar', 'Events around town');

    expect(content.language).toBe('en');
    expect(content.name).toBe('Town Calendar');
    expect(content.description).toBe('Events around town');
  });

  test('creates content with defaults for optional fields', () => {
    const content = new CalendarContent('en');

    expect(content.name).toBe('');
    expect(content.description).toBe('');
    expect(content.imageAlt).toBe('');
  });

  test('serializes name and description in toObject', () => {
    const content = new CalendarContent('en', 'Town Calendar', 'Events around town');
    const obj = content.toObject();

    expect(obj.language).toBe('en');
    expect(obj.name).toBe('Town Calendar');
    expect(obj.description).toBe('Events around town');
  });

  test('deserializes name and description from fromObject', () => {
    const content = CalendarContent.fromObject({
      language: 'es',
      name: 'Calendario',
      description: 'Eventos del pueblo',
    });

    expect(content.language).toBe('es');
    expect(content.name).toBe('Calendario');
    expect(content.description).toBe('Eventos del pueblo');
  });

  test('isEmpty returns true when name and description are both empty', () => {
    const content = new CalendarContent('en');

    expect(content.isEmpty()).toBe(true);
  });

  test('isEmpty returns false when name is set', () => {
    const content = new CalendarContent('en', 'Town Calendar');

    expect(content.isEmpty()).toBe(false);
  });

  test('isEmpty returns false when description is set', () => {
    const content = new CalendarContent('en', '', 'Events around town');

    expect(content.isEmpty()).toBe(false);
  });

  test('serializes imageAlt in toObject', () => {
    const content = new CalendarContent('en', 'Town Calendar', 'Events around town', 'A crowd dancing in a park');

    expect(content.toObject().imageAlt).toBe('A crowd dancing in a park');
  });

  test('deserializes imageAlt from fromObject', () => {
    const content = CalendarContent.fromObject({
      language: 'en',
      name: 'Town Calendar',
      description: 'Events around town',
      imageAlt: 'A poster for the calendar',
    });

    expect(content.imageAlt).toBe('A poster for the calendar');
  });

  test('fromObject treats null imageAlt as empty string', () => {
    const content = CalendarContent.fromObject({
      language: 'en',
      name: 'Town Calendar',
      description: 'Events around town',
      imageAlt: null,
    });

    expect(content.imageAlt).toBe('');
  });

  test('fromObject handles missing imageAlt', () => {
    const content = CalendarContent.fromObject({
      language: 'en',
      name: 'Town Calendar',
      description: 'Events around town',
    });

    expect(content.imageAlt).toBe('');
  });

  test('round-trip serialization preserves imageAlt', () => {
    const original = new CalendarContent('fr', 'Calendrier', 'Description', 'Une affiche du calendrier');

    const restored = CalendarContent.fromObject(original.toObject());

    expect(restored.imageAlt).toBe(original.imageAlt);
  });

  test('isEmpty returns false when only imageAlt is set', () => {
    const content = new CalendarContent('en', '', '', 'A photo of the venue');

    expect(content.isEmpty()).toBe(false);
  });

  test('isEmpty returns true when imageAlt is empty along with every other field', () => {
    const content = new CalendarContent('en', '', '', '');

    expect(content.isEmpty()).toBe(true);
  });
});
