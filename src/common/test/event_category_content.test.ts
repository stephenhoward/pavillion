import { describe, test, expect } from 'vitest';
import { EventCategoryContent } from '@/common/model/event_category_content';

describe('EventCategoryContentModel', () => {
  test('creates a valid content model', () => {
    const content = new EventCategoryContent('en', 'Meeting');

    expect(content.language).toBe('en');
    expect(content.name).toBe('Meeting');
  });

  test('validates correctly for valid content', () => {
    const content = new EventCategoryContent('en', 'Meeting');

    expect(content.isValid()).toBe(true);
  });

  test('validates correctly for invalid content with empty language', () => {
    const content = new EventCategoryContent('', 'Meeting');

    expect(content.isValid()).toBe(false);
  });

  test('validates correctly for invalid content with empty name', () => {
    const content = new EventCategoryContent('en', '');

    expect(content.isValid()).toBe(false);
  });

  test('validates correctly for invalid content with long name', () => {
    const longName = 'A'.repeat(101); // 101 characters, exceeding the limit
    const content = new EventCategoryContent('en', longName);

    expect(content.isValid()).toBe(false);
  });

  test('isEmpty works correctly', () => {
    const emptyContent = new EventCategoryContent('en', '');
    const nonEmptyContent = new EventCategoryContent('en', 'Meeting');

    expect(emptyContent.isEmpty()).toBe(true);
    expect(nonEmptyContent.isEmpty()).toBe(false);
  });

  test('serializes to object correctly', () => {
    const content = new EventCategoryContent('en', 'Meeting');

    const obj = content.toObject();

    expect(obj.language).toBe('en');
    expect(obj.name).toBe('Meeting');
  });

  test('deserializes from object correctly', () => {
    const obj = {
      language: 'en',
      name: 'Meeting',
    };

    const content = EventCategoryContent.fromObject(obj);

    expect(content.language).toBe('en');
    expect(content.name).toBe('Meeting');
  });
});
