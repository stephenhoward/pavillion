import { describe, test, expect } from 'vitest';
import { EventSeriesContent } from '@/common/model/event_series_content';

describe('EventSeriesContent', () => {
  test('creates a valid content model', () => {
    const content = new EventSeriesContent('en', 'Summer Concert Series', 'A weekly outdoor concert.');

    expect(content.language).toBe('en');
    expect(content.name).toBe('Summer Concert Series');
    expect(content.description).toBe('A weekly outdoor concert.');
  });

  test('creates content with defaults for optional fields', () => {
    const content = new EventSeriesContent('en');

    expect(content.language).toBe('en');
    expect(content.name).toBe('');
    expect(content.description).toBe('');
  });

  test('validates correctly for valid content', () => {
    const content = new EventSeriesContent('en', 'Summer Concert Series');

    expect(content.isValid()).toBe(true);
  });

  test('validates correctly for invalid content with empty language', () => {
    const content = new EventSeriesContent('', 'Summer Concert Series');

    expect(content.isValid()).toBe(false);
  });

  test('validates correctly for invalid content with empty name', () => {
    const content = new EventSeriesContent('en', '');

    expect(content.isValid()).toBe(false);
  });

  test('validates correctly for invalid content with name exceeding 255 characters', () => {
    const longName = 'A'.repeat(256);
    const content = new EventSeriesContent('en', longName);

    expect(content.isValid()).toBe(false);
  });

  test('validates correctly for name at exactly 255 characters', () => {
    const maxName = 'A'.repeat(255);
    const content = new EventSeriesContent('en', maxName);

    expect(content.isValid()).toBe(true);
  });

  test('validates correctly for invalid content with description exceeding 5000 characters', () => {
    const longDescription = 'A'.repeat(5001);
    const content = new EventSeriesContent('en', 'Valid Name', longDescription);

    expect(content.isValid()).toBe(false);
  });

  test('validates correctly for description at exactly 5000 characters', () => {
    const maxDescription = 'A'.repeat(5000);
    const content = new EventSeriesContent('en', 'Valid Name', maxDescription);

    expect(content.isValid()).toBe(true);
  });

  test('isEmpty returns true when name and description are both empty', () => {
    const content = new EventSeriesContent('en');

    expect(content.isEmpty()).toBe(true);
  });

  test('isEmpty returns false when name is set', () => {
    const content = new EventSeriesContent('en', 'Summer Concert Series');

    expect(content.isEmpty()).toBe(false);
  });

  test('isEmpty returns false when description is set', () => {
    const content = new EventSeriesContent('en', '', 'A description');

    expect(content.isEmpty()).toBe(false);
  });

  test('serializes to object correctly', () => {
    const content = new EventSeriesContent('en', 'Summer Concert Series', 'A weekly outdoor concert.');

    const obj = content.toObject();

    expect(obj.language).toBe('en');
    expect(obj.name).toBe('Summer Concert Series');
    expect(obj.description).toBe('A weekly outdoor concert.');
  });

  test('deserializes from object correctly', () => {
    const obj = {
      language: 'en',
      name: 'Summer Concert Series',
      description: 'A weekly outdoor concert.',
    };

    const content = EventSeriesContent.fromObject(obj);

    expect(content.language).toBe('en');
    expect(content.name).toBe('Summer Concert Series');
    expect(content.description).toBe('A weekly outdoor concert.');
  });

  test('round-trip serialization preserves all fields', () => {
    const original = new EventSeriesContent('es', 'Serie de Conciertos', 'Conciertos al aire libre.');

    const restored = EventSeriesContent.fromObject(original.toObject());

    expect(restored.language).toBe(original.language);
    expect(restored.name).toBe(original.name);
    expect(restored.description).toBe(original.description);
  });
});
