import { describe, test, expect } from 'vitest';
import { EventSeries } from '@/common/model/event_series';
import { EventSeriesContent } from '@/common/model/event_series_content';

describe('EventSeries', () => {
  test('creates a valid series model', () => {
    const series = new EventSeries('series-123', 'cal-456', 'summer_concerts');

    expect(series.id).toBe('series-123');
    expect(series.calendarId).toBe('cal-456');
    expect(series.urlName).toBe('summer_concerts');
    expect(series.mediaId).toBeNull();
  });

  test('creates series with mediaId', () => {
    const series = new EventSeries('series-123', 'cal-456', 'summer_concerts', 'media-789');

    expect(series.mediaId).toBe('media-789');
  });

  test('creates series with default values', () => {
    const series = new EventSeries('series-123', 'cal-456');

    expect(series.urlName).toBe('');
    expect(series.mediaId).toBeNull();
  });

  test('validates correctly for valid series', () => {
    const series = new EventSeries('series-123', 'cal-456', 'summer_concerts');
    const content = new EventSeriesContent('en', 'Summer Concerts');
    series.addContent(content);

    expect(series.isValid()).toBe(true);
  });

  test('validates correctly for invalid series with empty calendarId', () => {
    const series = new EventSeries('series-123', '', 'summer_concerts');
    const content = new EventSeriesContent('en', 'Summer Concerts');
    series.addContent(content);

    expect(series.isValid()).toBe(false);
  });

  test('validates correctly for invalid series with no content', () => {
    const series = new EventSeries('series-123', 'cal-456', 'summer_concerts');

    expect(series.isValid()).toBe(false);
  });

  test('validates correctly for invalid series with invalid urlName - leading underscore', () => {
    const series = new EventSeries('series-123', 'cal-456', '_invalid');
    const content = new EventSeriesContent('en', 'Summer Concerts');
    series.addContent(content);

    expect(series.isValid()).toBe(false);
  });

  test('validates correctly for invalid series with urlName too short', () => {
    const series = new EventSeries('series-123', 'cal-456', 'ab');
    const content = new EventSeriesContent('en', 'Summer Concerts');
    series.addContent(content);

    expect(series.isValid()).toBe(false);
  });

  test('validates correctly for invalid series with urlName too long', () => {
    const series = new EventSeries('series-123', 'cal-456', 'a'.repeat(25));
    const content = new EventSeriesContent('en', 'Summer Concerts');
    series.addContent(content);

    expect(series.isValid()).toBe(false);
  });

  test('validates correctly for urlName with spaces', () => {
    const series = new EventSeries('series-123', 'cal-456', 'has spaces');
    const content = new EventSeriesContent('en', 'Summer Concerts');
    series.addContent(content);

    expect(series.isValid()).toBe(false);
  });

  test('validates valid urlName at minimum length (3 characters)', () => {
    const series = new EventSeries('series-123', 'cal-456', 'abc');
    const content = new EventSeriesContent('en', 'Summer Concerts');
    series.addContent(content);

    expect(series.isValid()).toBe(true);
  });

  test('validates valid urlName at maximum length (24 characters)', () => {
    const series = new EventSeries('series-123', 'cal-456', 'a'.repeat(24));
    const content = new EventSeriesContent('en', 'Summer Concerts');
    series.addContent(content);

    expect(series.isValid()).toBe(true);
  });

  test('content is accessible via TranslatedModel API', () => {
    const series = new EventSeries('series-123', 'cal-456', 'summer_concerts');
    const content = new EventSeriesContent('en', 'Summer Concerts');
    series.addContent(content);

    expect(series.getLanguages()).toHaveLength(1);
    expect(series.content('en').name).toBe('Summer Concerts');
    expect(series.content('en').language).toBe('en');
  });

  test('manages content in multiple languages', () => {
    const series = new EventSeries('series-123', 'cal-456', 'summer_concerts');
    const enContent = new EventSeriesContent('en', 'Summer Concerts');
    const esContent = new EventSeriesContent('es', 'Conciertos de Verano');
    series.addContent(enContent);
    series.addContent(esContent);

    expect(series.getLanguages()).toHaveLength(2);
    expect(series.content('en').name).toBe('Summer Concerts');
    expect(series.content('es').name).toBe('Conciertos de Verano');
    expect(series.hasContent('en')).toBe(true);
    expect(series.hasContent('es')).toBe(true);
    expect(series.hasContent('fr')).toBe(false);
  });

  test('creates content automatically when accessed', () => {
    const series = new EventSeries('series-123', 'cal-456', 'summer_concerts');

    const content = series.content('en');
    expect(content).toBeInstanceOf(EventSeriesContent);
    expect(content.language).toBe('en');
    expect(content.name).toBe('');
    expect(series.getLanguages()).toHaveLength(1);
  });

  test('drops content for specified language', () => {
    const series = new EventSeries('series-123', 'cal-456', 'summer_concerts');
    series.addContent(new EventSeriesContent('en', 'Summer Concerts'));
    series.addContent(new EventSeriesContent('es', 'Conciertos de Verano'));

    series.dropContent('en');

    expect(series.getLanguages()).toHaveLength(1);
    expect(series.hasContent('en')).toBe(false);
    expect(series.hasContent('es')).toBe(true);
  });

  test('serializes to object correctly', () => {
    const series = new EventSeries('series-123', 'cal-456', 'summer_concerts', 'media-789');
    series.addContent(new EventSeriesContent('en', 'Summer Concerts', 'Outdoor concert series.'));

    const obj = series.toObject();

    expect(obj.id).toBe('series-123');
    expect(obj.calendarId).toBe('cal-456');
    expect(obj.urlName).toBe('summer_concerts');
    expect(obj.mediaId).toBe('media-789');
    expect(obj.content).toHaveProperty('en');
    expect(obj.content.en.name).toBe('Summer Concerts');
    expect(obj.content.en.description).toBe('Outdoor concert series.');
    expect(obj.content.en.language).toBe('en');
  });

  test('deserializes from object correctly', () => {
    const obj = {
      id: 'series-123',
      calendarId: 'cal-456',
      urlName: 'summer_concerts',
      mediaId: 'media-789',
      content: {
        en: {
          language: 'en',
          name: 'Summer Concerts',
          description: 'Outdoor concert series.',
        },
      },
    };

    const series = EventSeries.fromObject(obj);

    expect(series.id).toBe('series-123');
    expect(series.calendarId).toBe('cal-456');
    expect(series.urlName).toBe('summer_concerts');
    expect(series.mediaId).toBe('media-789');
    expect(series.getLanguages()).toHaveLength(1);
    expect(series.content('en').name).toBe('Summer Concerts');
    expect(series.content('en').description).toBe('Outdoor concert series.');
  });

  test('deserializes from object with null mediaId', () => {
    const obj = {
      id: 'series-123',
      calendarId: 'cal-456',
      urlName: 'summer_concerts',
      mediaId: null,
      content: {
        en: {
          language: 'en',
          name: 'Summer Concerts',
          description: '',
        },
      },
    };

    const series = EventSeries.fromObject(obj);

    expect(series.mediaId).toBeNull();
  });

  test('round-trip serialization preserves all fields', () => {
    const original = new EventSeries('series-123', 'cal-456', 'summer_concerts', 'media-789');
    original.addContent(new EventSeriesContent('en', 'Summer Concerts', 'Outdoor concert series.'));
    original.addContent(new EventSeriesContent('es', 'Conciertos de Verano', 'Serie de conciertos al aire libre.'));

    const restored = EventSeries.fromObject(original.toObject());

    expect(restored.id).toBe(original.id);
    expect(restored.calendarId).toBe(original.calendarId);
    expect(restored.urlName).toBe(original.urlName);
    expect(restored.mediaId).toBe(original.mediaId);
    expect(restored.getLanguages()).toHaveLength(2);
    expect(restored.content('en').name).toBe(original.content('en').name);
    expect(restored.content('en').description).toBe(original.content('en').description);
    expect(restored.content('es').name).toBe(original.content('es').name);
  });
});
