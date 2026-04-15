import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { WidgetConfig } from '@/common/model/widget_config';
import { CalendarWidgetConfigEntity } from '@/server/calendar/entity/calendar_widget_config';

describe('CalendarWidgetConfigEntity', () => {

  describe('fromModel', () => {
    it('should create entity from a WidgetConfig domain model', () => {
      const id = uuidv4();
      const calendarId = uuidv4();
      const model = new WidgetConfig('week', '#abcdef', 'dark');

      const entity = CalendarWidgetConfigEntity.fromModel(model, id, calendarId);

      expect(entity.id).toBe(id);
      expect(entity.calendar_id).toBe(calendarId);
      expect(entity.view).toBe('week');
      expect(entity.accent_color).toBe('#abcdef');
      expect(entity.color_mode).toBe('dark');
    });
  });

  describe('toModel', () => {
    it('should convert an entity to a WidgetConfig domain model', () => {
      const id = uuidv4();
      const calendarId = uuidv4();
      const entity = CalendarWidgetConfigEntity.build({
        id,
        calendar_id: calendarId,
        view: 'month',
        accent_color: '#123456',
        color_mode: 'light',
      });

      const model = entity.toModel();

      expect(model).toBeInstanceOf(WidgetConfig);
      expect(model.view).toBe('month');
      expect(model.accentColor).toBe('#123456');
      expect(model.colorMode).toBe('light');
    });
  });

  describe('round-trip conversion', () => {
    it('should maintain data integrity through model-entity-model', () => {
      const id = uuidv4();
      const calendarId = uuidv4();
      const original = new WidgetConfig('list', '#ff9131', 'auto');

      const entity = CalendarWidgetConfigEntity.fromModel(original, id, calendarId);
      const roundTrip = entity.toModel();

      expect(roundTrip.view).toBe(original.view);
      expect(roundTrip.accentColor).toBe(original.accentColor);
      expect(roundTrip.colorMode).toBe(original.colorMode);
    });
  });
});
