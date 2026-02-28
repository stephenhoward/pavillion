import { describe, test, expect, beforeEach } from 'vitest';
import { EventSeriesEntity, EventSeriesContentEntity } from '@/server/calendar/entity/event_series';
import { EventSeries } from '@/common/model/event_series';
import { EventSeriesContent } from '@/common/model/event_series_content';

describe('EventSeriesEntity', () => {
  let sampleData: any;

  beforeEach(() => {
    sampleData = {
      id: 'series-123',
      calendar_id: 'cal-456',
      url_name: 'summer_concerts',
      media_id: null,
      created_at: new Date('2023-01-01'),
      updated_at: new Date('2023-01-02'),
    };
  });

  test('converts entity to model correctly', () => {
    const entity = EventSeriesEntity.build(sampleData);

    // Mock content relationship
    const contentEntity = EventSeriesContentEntity.build({
      id: 'content-1',
      series_id: 'series-123',
      language: 'en',
      name: 'Summer Concerts',
      description: 'Outdoor concerts every weekend',
    });
    entity.content = [contentEntity];

    const model = entity.toModel();

    expect(model).toBeInstanceOf(EventSeries);
    expect(model.id).toBe(sampleData.id);
    expect(model.calendarId).toBe(sampleData.calendar_id);
    expect(model.urlName).toBe(sampleData.url_name);
    expect(model.mediaId).toBeNull();
    expect(model.getLanguages()).toHaveLength(1);
    expect(model.content('en').language).toBe('en');
    expect(model.content('en').name).toBe('Summer Concerts');
    expect(model.content('en').description).toBe('Outdoor concerts every weekend');
  });

  test('converts entity with media_id to model correctly', () => {
    const entityData = { ...sampleData, media_id: 'media-789' };
    const entity = EventSeriesEntity.build(entityData);
    entity.content = [];

    const model = entity.toModel();

    expect(model.mediaId).toBe('media-789');
  });

  test('creates entity from model correctly', () => {
    const model = new EventSeries(
      'series-123',
      'cal-456',
      'summer_concerts',
      null,
    );

    const contentModel = new EventSeriesContent('en', 'Summer Concerts', 'Outdoor concerts every weekend');
    model.addContent(contentModel);

    const entity = EventSeriesEntity.fromModel(model);

    expect(entity.id).toBe(model.id);
    expect(entity.calendar_id).toBe(model.calendarId);
    expect(entity.url_name).toBe(model.urlName);
    expect(entity.media_id).toBeNull();
  });

  test('creates entity from model with media_id correctly', () => {
    const model = new EventSeries(
      'series-123',
      'cal-456',
      'summer_concerts',
      'media-789',
    );

    const entity = EventSeriesEntity.fromModel(model);

    expect(entity.media_id).toBe('media-789');
  });

  test('round-trip conversion preserves data integrity', () => {
    const originalModel = new EventSeries(
      'series-123',
      'cal-456',
      'summer_concerts',
      null,
    );

    const contentModel = new EventSeriesContent('en', 'Summer Concerts', 'Outdoor concerts every weekend');
    originalModel.addContent(contentModel);

    // Model -> Entity -> Model
    const entity = EventSeriesEntity.fromModel(originalModel);

    // Simulate loading content from database
    const contentEntity = EventSeriesContentEntity.build({
      id: 'content-1',
      series_id: 'series-123',
      language: 'en',
      name: 'Summer Concerts',
      description: 'Outdoor concerts every weekend',
    });
    entity.content = [contentEntity];

    const convertedModel = entity.toModel();

    expect(convertedModel.id).toBe(originalModel.id);
    expect(convertedModel.calendarId).toBe(originalModel.calendarId);
    expect(convertedModel.urlName).toBe(originalModel.urlName);
    expect(convertedModel.mediaId).toBe(originalModel.mediaId);
    expect(convertedModel.getLanguages()).toHaveLength(1);
    expect(convertedModel.content('en').language).toBe('en');
    expect(convertedModel.content('en').name).toBe('Summer Concerts');
    expect(convertedModel.content('en').description).toBe('Outdoor concerts every weekend');
  });

  test('handles empty content array', () => {
    const entity = EventSeriesEntity.build(sampleData);
    entity.content = [];

    const model = entity.toModel();

    expect(model.getLanguages()).toHaveLength(0);
  });

  test('handles multiple language content', () => {
    const entity = EventSeriesEntity.build(sampleData);

    const enContent = EventSeriesContentEntity.build({
      id: 'content-1',
      series_id: 'series-123',
      language: 'en',
      name: 'Summer Concerts',
      description: 'Outdoor concerts every weekend',
    });
    const esContent = EventSeriesContentEntity.build({
      id: 'content-2',
      series_id: 'series-123',
      language: 'es',
      name: 'Conciertos de Verano',
      description: 'Conciertos al aire libre cada fin de semana',
    });
    entity.content = [enContent, esContent];

    const model = entity.toModel();

    expect(model.getLanguages()).toHaveLength(2);
    expect(model.content('en').name).toBe('Summer Concerts');
    expect(model.content('es').name).toBe('Conciertos de Verano');
  });
});
