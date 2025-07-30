import { describe, test, expect } from 'vitest';
import { EventCategory } from '@/common/model/event_category';
import { EventCategoryContent } from '@/common/model/event_category_content';

describe('EventCategoryModel', () => {
  test('creates a valid category model', () => {
    const category = new EventCategory(
      'cat-123',
      'cal-456',
    );

    // Add content using the TranslatedModel API
    const content = new EventCategoryContent('en', 'Meeting');
    category.addContent(content);

    expect(category.id).toBe('cat-123');
    expect(category.calendarId).toBe('cal-456');
    expect(category.getLanguages()).toHaveLength(1);
    expect(category.content('en').name).toBe('Meeting');
    expect(category.content('en').language).toBe('en');
  });

  test('validates correctly for valid category', () => {
    const category = new EventCategory(
      'cat-123',
      'cal-456',
    );

    // Add content using TranslatedModel API
    const content = new EventCategoryContent('en', 'Meeting');
    category.addContent(content);

    expect(category.isValid()).toBe(true);
  });

  test('validates correctly for invalid category with empty content', () => {
    const category = new EventCategory(
      'cat-123',
      'cal-456',
    );
    // No content added

    expect(category.isValid()).toBe(false);
  });

  test('validates correctly for invalid category with invalid content', () => {
    const category = new EventCategory(
      'cat-123',
      'cal-456',
    );

    // Add invalid content (empty name)
    const invalidContent = new EventCategoryContent('en', '');
    category.addContent(invalidContent);

    expect(category.isValid()).toBe(false);
  });

  test('serializes to object correctly', () => {
    const category = new EventCategory(
      'cat-123',
      'cal-456',
    );

    const content = new EventCategoryContent('en', 'Meeting');
    category.addContent(content);

    const obj = category.toObject();

    expect(obj.id).toBe('cat-123');
    expect(obj.calendarId).toBe('cal-456');
    expect(obj.content).toHaveProperty('en');
    expect(obj.content.en.name).toBe('Meeting');
    expect(obj.content.en.language).toBe('en');
  });

  test('deserializes from object correctly', () => {
    const obj = {
      id: 'cat-123',
      calendarId: 'cal-456',
      createdAt: '2023-01-01',
      updatedAt: '2023-01-02',
      content: {
        en: {
          language: 'en',
          name: 'Meeting',
        },
      },
    };

    const category = EventCategory.fromObject(obj);

    expect(category.id).toBe('cat-123');
    expect(category.calendarId).toBe('cal-456');
    expect(category.getLanguages()).toHaveLength(1);
    expect(category.content('en').name).toBe('Meeting');
    expect(category.content('en').language).toBe('en');
  });

  test('manages content in multiple languages', () => {
    const category = new EventCategory(
      'cat-123',
      'cal-456',
    );

    const enContent = new EventCategoryContent('en', 'Meeting');
    const esContent = new EventCategoryContent('es', 'Reunión');
    category.addContent(enContent);
    category.addContent(esContent);

    expect(category.getLanguages()).toHaveLength(2);
    expect(category.content('en').name).toBe('Meeting');
    expect(category.content('es').name).toBe('Reunión');
    expect(category.hasContent('en')).toBe(true);
    expect(category.hasContent('es')).toBe(true);
    expect(category.hasContent('fr')).toBe(false);
  });

  test('creates content automatically when accessed', () => {
    const category = new EventCategory(
      'cat-123',
      'cal-456',
    );

    // Accessing content for a language that doesn't exist should create it
    const content = category.content('en');
    expect(content).toBeInstanceOf(EventCategoryContent);
    expect(content.language).toBe('en');
    expect(content.name).toBe(''); // Should be empty initially
    expect(category.getLanguages()).toHaveLength(1);
  });

  test('drops content for specified language', () => {
    const category = new EventCategory(
      'cat-123',
      'cal-456',
    );

    const enContent = new EventCategoryContent('en', 'Meeting');
    const esContent = new EventCategoryContent('es', 'Reunión');
    category.addContent(enContent);
    category.addContent(esContent);

    expect(category.getLanguages()).toHaveLength(2);

    category.dropContent('en');
    expect(category.getLanguages()).toHaveLength(1);
    expect(category.hasContent('en')).toBe(false);
    expect(category.hasContent('es')).toBe(true);
  });

  test('handles empty calendar ID validation', () => {
    const category = new EventCategory(
      'cat-123',
      '', // Empty calendar ID
    );

    const content = new EventCategoryContent('en', 'Meeting');
    category.addContent(content);

    expect(category.isValid()).toBe(false);
  });
});
