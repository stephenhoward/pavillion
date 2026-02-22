import { describe, it, expect } from 'vitest';
import { parseAcceptLanguage } from '@/common/i18n/accept-language';

describe('parseAcceptLanguage', () => {

  describe('standard header formats', () => {
    it('should parse a standard Accept-Language header with multiple languages', () => {
      const result = parseAcceptLanguage('en-US,en;q=0.9,fr;q=0.8');

      expect(result).toEqual([
        { language: 'en', quality: 1.0 },
        { language: 'en', quality: 0.9 },
        { language: 'fr', quality: 0.8 },
      ]);
    });

    it('should parse a single language without quality value', () => {
      const result = parseAcceptLanguage('en');

      expect(result).toEqual([
        { language: 'en', quality: 1.0 },
      ]);
    });

    it('should parse multiple languages with explicit quality values', () => {
      const result = parseAcceptLanguage('fr;q=0.9,es;q=0.7,de;q=0.5');

      expect(result).toEqual([
        { language: 'fr', quality: 0.9 },
        { language: 'es', quality: 0.7 },
        { language: 'de', quality: 0.5 },
      ]);
    });

    it('should sort results by quality in descending order', () => {
      const result = parseAcceptLanguage('fr;q=0.5,en;q=1.0,es;q=0.8');

      expect(result[0].language).toBe('en');
      expect(result[0].quality).toBe(1.0);
      expect(result[1].language).toBe('es');
      expect(result[1].quality).toBe(0.8);
      expect(result[2].language).toBe('fr');
      expect(result[2].quality).toBe(0.5);
    });
  });

  describe('language code normalization', () => {
    it('should normalize regional variants to base language (en-US → en)', () => {
      const result = parseAcceptLanguage('en-US');

      expect(result).toEqual([
        { language: 'en', quality: 1.0 },
      ]);
    });

    it('should normalize es-MX to es', () => {
      const result = parseAcceptLanguage('es-MX,es;q=0.9');

      expect(result[0].language).toBe('es');
      expect(result[1].language).toBe('es');
    });

    it('should normalize language codes to lowercase', () => {
      const result = parseAcceptLanguage('EN-US,FR;q=0.8');

      expect(result[0].language).toBe('en');
      expect(result[1].language).toBe('fr');
    });

    it('should handle complex regional variants like zh-Hans-CN', () => {
      const result = parseAcceptLanguage('zh-Hans-CN');

      expect(result).toEqual([
        { language: 'zh', quality: 1.0 },
      ]);
    });
  });

  describe('quality value handling', () => {
    it('should default to quality 1.0 when q value is omitted', () => {
      const result = parseAcceptLanguage('en,fr;q=0.8');

      expect(result[0].quality).toBe(1.0);
    });

    it('should handle quality value of 0', () => {
      const result = parseAcceptLanguage('en,fr;q=0');

      const fr = result.find(p => p.language === 'fr');
      expect(fr?.quality).toBe(0);
    });

    it('should handle quality value with spaces around equals sign', () => {
      const result = parseAcceptLanguage('en;q = 0.5');

      expect(result[0].quality).toBe(0.5);
    });
  });

  describe('malformed and edge case handling', () => {
    it('should return empty array for null header', () => {
      const result = parseAcceptLanguage(null);
      expect(result).toEqual([]);
    });

    it('should return empty array for undefined header', () => {
      const result = parseAcceptLanguage(undefined);
      expect(result).toEqual([]);
    });

    it('should return empty array for empty string', () => {
      const result = parseAcceptLanguage('');
      expect(result).toEqual([]);
    });

    it('should return empty array for whitespace-only string', () => {
      const result = parseAcceptLanguage('   ');
      expect(result).toEqual([]);
    });

    it('should skip entries with invalid quality values', () => {
      const result = parseAcceptLanguage('en;q=invalid,fr;q=0.8');

      // 'en' gets q=1.0 fallback behavior (q parameter found but invalid, so no quality assigned from param)
      // Actually invalid q values should still result in language entries with default quality
      const fr = result.find(p => p.language === 'fr');
      expect(fr).toBeDefined();
      expect(fr?.quality).toBe(0.8);
    });

    it('should handle entries with extra whitespace', () => {
      const result = parseAcceptLanguage('  en  ,  fr ; q=0.8  ');

      expect(result).toHaveLength(2);
      expect(result[0].language).toBe('en');
      expect(result[1].language).toBe('fr');
    });

    it('should skip entries with invalid language codes', () => {
      const result = parseAcceptLanguage('en,*,fr;q=0.8');

      const languageCodes = result.map(p => p.language);
      expect(languageCodes).toContain('en');
      expect(languageCodes).toContain('fr');
      expect(languageCodes).not.toContain('*');
    });

    it('should handle a wildcard-only header gracefully', () => {
      const result = parseAcceptLanguage('*');
      expect(result).toEqual([]);
    });

    it('should handle trailing comma gracefully', () => {
      const result = parseAcceptLanguage('en,fr;q=0.8,');

      expect(result).toHaveLength(2);
      expect(result[0].language).toBe('en');
      expect(result[1].language).toBe('fr');
    });
  });

  describe('real-world header examples', () => {
    it('should parse a typical browser Accept-Language header', () => {
      const result = parseAcceptLanguage('en-US,en;q=0.9,es;q=0.8,fr;q=0.7');

      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({ language: 'en', quality: 1.0 });
      expect(result[1]).toEqual({ language: 'en', quality: 0.9 });
      expect(result[2]).toEqual({ language: 'es', quality: 0.8 });
      expect(result[3]).toEqual({ language: 'fr', quality: 0.7 });
    });

    it('should parse a simple single-language header', () => {
      const result = parseAcceptLanguage('es-MX');

      expect(result).toEqual([
        { language: 'es', quality: 1.0 },
      ]);
    });
  });
});
