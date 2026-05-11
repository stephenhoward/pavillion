import { describe, it, expect } from 'vitest';

import { Calendar, CalendarContent } from '@/common/model/calendar';
import { Media } from '@/common/model/media';

describe('Calendar Model', () => {

  describe('default values', () => {

    it('should create a Calendar with default null image fields', () => {
      const calendar = new Calendar('cal-1', 'my-calendar');

      expect(calendar.defaultEventImageId).toBeNull();
      expect(calendar.defaultEventImage).toBeNull();
    });
  });

  describe('toObject / fromObject round-trip', () => {

    it('should serialize and deserialize with null default image fields', () => {
      const calendar = new Calendar('cal-1', 'my-calendar');
      calendar.languages = ['en', 'fr'];
      calendar.defaultDateRange = '1week';
      calendar.widgetAllowedDomain = 'example.com';

      const obj = calendar.toObject();

      expect(obj.defaultEventImageId).toBeNull();
      expect(obj.defaultEventImage).toBeNull();

      const restored = Calendar.fromObject(obj);

      expect(restored.defaultEventImageId).toBeNull();
      expect(restored.defaultEventImage).toBeNull();
      expect(restored.urlName).toBe('my-calendar');
      expect(restored.languages).toEqual(['en', 'fr']);
      expect(restored.defaultDateRange).toBe('1week');
      expect(restored.widgetAllowedDomain).toBe('example.com');
    });

    it('should serialize and deserialize with a default event image', () => {
      const calendar = new Calendar('cal-2', 'art-events');
      calendar.languages = ['en'];
      calendar.defaultEventImageId = 'media-42';
      calendar.defaultEventImage = new Media(
        'media-42',
        'cal-2',
        'abc123hash',
        'banner.png',
        'image/png',
        204800,
        'approved',
      );

      const obj = calendar.toObject();

      expect(obj.defaultEventImageId).toBe('media-42');
      expect(obj.defaultEventImage).toBeDefined();
      expect(obj.defaultEventImage.id).toBe('media-42');
      expect(obj.defaultEventImage.originalFilename).toBe('banner.png');

      const restored = Calendar.fromObject(obj);

      expect(restored.defaultEventImageId).toBe('media-42');
      expect(restored.defaultEventImage).toBeInstanceOf(Media);
      expect(restored.defaultEventImage!.id).toBe('media-42');
      expect(restored.defaultEventImage!.mimeType).toBe('image/png');
      expect(restored.defaultEventImage!.fileSize).toBe(204800);
    });

    it('should preserve content through round-trip', () => {
      const calendar = new Calendar('cal-3', 'multi-lang');
      calendar.languages = ['en', 'es'];
      const enContent = new CalendarContent('en', 'English Name', 'English Desc');
      const esContent = new CalendarContent('es', 'Nombre', 'Descripcion');
      calendar.addContent(enContent);
      calendar.addContent(esContent);

      const obj = calendar.toObject();
      const restored = Calendar.fromObject(obj);

      expect(restored.content('en').name).toBe('English Name');
      expect(restored.content('es').name).toBe('Nombre');
    });

    it('should default `listed` to true and preserve it through round-trip', () => {
      const calendar = new Calendar('cal-listed-default', 'default-listed');
      calendar.languages = ['en'];

      // Default at construction time.
      expect(calendar.listed).toBe(true);

      const obj = calendar.toObject();
      expect(obj.listed).toBe(true);

      const restored = Calendar.fromObject(obj);
      expect(restored.listed).toBe(true);
    });

    it('should preserve explicit `listed: false` through round-trip', () => {
      const calendar = new Calendar('cal-unlisted', 'unlisted');
      calendar.languages = ['en'];
      calendar.listed = false;

      const obj = calendar.toObject();
      expect(obj.listed).toBe(false);

      const restored = Calendar.fromObject(obj);
      expect(restored.listed).toBe(false);
    });

    it('should default `listed` to true when the key is absent from fromObject input', () => {
      // Backward compatibility: serialized calendars from before the flag
      // existed must default to listed=true so they continue appearing on
      // public discovery exactly as they did pre-feature.
      const obj = {
        id: 'cal-legacy',
        urlName: 'legacy-calendar',
        languages: ['en'],
        description: '',
        defaultDateRange: null,
        widgetAllowedDomain: null,
        defaultEventImageId: null,
        defaultEventImage: null,
        content: {},
      };

      const calendar = Calendar.fromObject(obj);
      expect(calendar.listed).toBe(true);
    });

    it('should handle defaultEventImageId without object via fromObject', () => {
      const obj = {
        id: 'cal-4',
        urlName: 'orphan-id',
        languages: ['en'],
        description: '',
        defaultDateRange: null,
        widgetAllowedDomain: null,
        defaultEventImageId: 'media-99',
        defaultEventImage: null,
        content: {},
      };

      const calendar = Calendar.fromObject(obj);

      expect(calendar.defaultEventImageId).toBe('media-99');
      expect(calendar.defaultEventImage).toBeNull();
    });
  });

  describe('clone', () => {

    it('should deep-clone including default event image', () => {
      const calendar = new Calendar('cal-5', 'cloneable');
      calendar.languages = ['en'];
      calendar.defaultEventImageId = 'media-10';
      calendar.defaultEventImage = new Media(
        'media-10',
        'cal-5',
        'hash456',
        'photo.jpg',
        'image/jpeg',
        102400,
        'approved',
      );

      const cloned = calendar.clone();

      expect(cloned.defaultEventImageId).toBe('media-10');
      expect(cloned.defaultEventImage).toBeInstanceOf(Media);
      expect(cloned.defaultEventImage!.id).toBe('media-10');

      // Verify it is a true deep clone
      cloned.defaultEventImageId = 'media-99';
      expect(calendar.defaultEventImageId).toBe('media-10');
    });
  });
});
