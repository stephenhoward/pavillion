import { describe, it, expect } from 'vitest';
import {
  addLocalePrefix,
  stripLocalePrefix,
} from '@/common/i18n/locale-url';

describe('addLocalePrefix', () => {

  describe('default locale handling (as-needed strategy)', () => {
    it('should return path unchanged when locale matches default', () => {
      expect(addLocalePrefix('/@calendar', 'en', 'en')).toBe('/@calendar');
    });

    it('should return root path unchanged when locale matches default', () => {
      expect(addLocalePrefix('/', 'en', 'en')).toBe('/');
    });

    it('should add prefix for non-default locale', () => {
      expect(addLocalePrefix('/@calendar', 'es', 'en')).toBe('/es/@calendar');
    });

    it('should add prefix for non-default locale on root path', () => {
      expect(addLocalePrefix('/', 'es', 'en')).toBe('/es');
    });
  });

  describe('path normalization', () => {
    it('should handle paths without leading slash', () => {
      expect(addLocalePrefix('@calendar', 'es', 'en')).toBe('/es/@calendar');
    });

    it('should handle paths without leading slash for default locale', () => {
      expect(addLocalePrefix('@calendar', 'en', 'en')).toBe('@calendar');
    });
  });

  describe('avoiding double-prefixing', () => {
    it('should not double-prefix an already-prefixed path with the same locale', () => {
      expect(addLocalePrefix('/es/@calendar', 'es', 'en')).toBe('/es/@calendar');
    });

    it('should not double-prefix root locale path', () => {
      expect(addLocalePrefix('/es', 'es', 'en')).toBe('/es');
    });

    it('should not double-prefix locale path with trailing slash', () => {
      expect(addLocalePrefix('/es/', 'es', 'en')).toBe('/es/');
    });
  });

  describe('various path formats', () => {
    it('should prefix event paths', () => {
      expect(addLocalePrefix('/events', 'es', 'en')).toBe('/es/events');
    });

    it('should prefix nested paths', () => {
      expect(addLocalePrefix('/@calendar/event/123', 'es', 'en')).toBe('/es/@calendar/event/123');
    });
  });
});

describe('stripLocalePrefix', () => {

  describe('paths with valid locale prefix', () => {
    it('should strip a valid locale prefix and return locale and remaining path', () => {
      const result = stripLocalePrefix('/es/@calendar');
      expect(result.locale).toBe('es');
      expect(result.path).toBe('/@calendar');
    });

    it('should strip locale prefix from root locale path', () => {
      const result = stripLocalePrefix('/es');
      expect(result.locale).toBe('es');
      expect(result.path).toBe('/');
    });

    it('should strip locale prefix from root locale path with trailing slash', () => {
      const result = stripLocalePrefix('/es/');
      expect(result.locale).toBe('es');
      expect(result.path).toBe('/');
    });

    it('should strip locale prefix from nested paths', () => {
      const result = stripLocalePrefix('/es/events/123');
      expect(result.locale).toBe('es');
      expect(result.path).toBe('/events/123');
    });

    it('should strip French locale prefix and return locale and remaining path', () => {
      const result = stripLocalePrefix('/fr/events');
      expect(result.locale).toBe('fr');
      expect(result.path).toBe('/events');
    });
  });

  describe('paths without locale prefix', () => {
    it('should return null locale for paths with no locale prefix', () => {
      const result = stripLocalePrefix('/@calendar');
      expect(result.locale).toBeNull();
      expect(result.path).toBe('/@calendar');
    });

    it('should return null locale for root path', () => {
      const result = stripLocalePrefix('/');
      expect(result.locale).toBeNull();
      expect(result.path).toBe('/');
    });

    it('should return null locale and full path when segment looks like a locale but is not valid', () => {
      const result = stripLocalePrefix('/xx/events');
      expect(result.locale).toBeNull();
      expect(result.path).toBe('/xx/events');
    });

    it('should return null locale for paths starting with a known non-locale word', () => {
      const result = stripLocalePrefix('/events');
      expect(result.locale).toBeNull();
      expect(result.path).toBe('/events');
    });
  });

  describe('path normalization', () => {
    it('should handle paths without leading slash', () => {
      const result = stripLocalePrefix('es/@calendar');
      expect(result.locale).toBe('es');
      expect(result.path).toBe('/@calendar');
    });

    it('should normalize locale to lowercase', () => {
      const result = stripLocalePrefix('/ES/@calendar');
      // 'ES' lowercased to 'es', which is a valid locale
      expect(result.locale).toBe('es');
      expect(result.path).toBe('/@calendar');
    });
  });

  describe('invalid locale codes', () => {
    it('should not strip an unknown language code as a locale prefix', () => {
      const result = stripLocalePrefix('/de/events');
      // 'de' is not in AVAILABLE_LANGUAGES
      expect(result.locale).toBeNull();
      expect(result.path).toBe('/de/events');
    });

    it('should not treat numeric path segments as locale prefixes', () => {
      const result = stripLocalePrefix('/123/events');
      expect(result.locale).toBeNull();
      expect(result.path).toBe('/123/events');
    });
  });
});
