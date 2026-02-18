import { describe, it, expect } from 'vitest';
import {
  AVAILABLE_LANGUAGES,
  DEFAULT_LANGUAGE_CODE,
  PRIMARY_THRESHOLD,
  BETA_THRESHOLD,
  isValidLanguageCode,
  getLanguage,
  getLanguageCompleteness,
  type Language,
  type LanguageCompleteness,
} from '@/common/i18n/languages';

describe('AVAILABLE_LANGUAGES', () => {
  it('should be a non-empty array', () => {
    expect(Array.isArray(AVAILABLE_LANGUAGES)).toBe(true);
    expect(AVAILABLE_LANGUAGES.length).toBeGreaterThan(0);
  });

  it('should include English', () => {
    const en = AVAILABLE_LANGUAGES.find(lang => lang.code === 'en');
    expect(en).toBeDefined();
  });

  it('each entry should have code, nativeName, fallbackChain, and direction', () => {
    for (const lang of AVAILABLE_LANGUAGES) {
      expect(typeof lang.code).toBe('string');
      expect(lang.code.length).toBeGreaterThan(0);

      expect(typeof lang.nativeName).toBe('string');
      expect(lang.nativeName.length).toBeGreaterThan(0);

      expect(Array.isArray(lang.fallbackChain)).toBe(true);

      expect(['ltr', 'rtl']).toContain(lang.direction);
    }
  });

  it('should have correct native names for present languages', () => {
    const en = AVAILABLE_LANGUAGES.find(lang => lang.code === 'en');
    expect(en?.nativeName).toBe('English');

    const es = AVAILABLE_LANGUAGES.find(lang => lang.code === 'es');
    expect(es?.nativeName).toBe('Español');
  });

  it('English should have an empty fallback chain', () => {
    const en = AVAILABLE_LANGUAGES.find(lang => lang.code === 'en');
    expect(en?.fallbackChain).toEqual([]);
  });

  it('non-English languages should have fallback chains ending with "en"', () => {
    const nonEnglish = AVAILABLE_LANGUAGES.filter(lang => lang.code !== 'en');
    for (const lang of nonEnglish) {
      const chain = lang.fallbackChain;
      expect(chain.length).toBeGreaterThan(0);
      expect(chain[chain.length - 1]).toBe('en');
    }
  });

  it('fallback chains should not contain the language itself', () => {
    for (const lang of AVAILABLE_LANGUAGES) {
      expect(lang.fallbackChain).not.toContain(lang.code);
    }
  });

  it('should have no duplicate language codes', () => {
    const codes = AVAILABLE_LANGUAGES.map(lang => lang.code);
    const uniqueCodes = [...new Set(codes)];
    expect(codes).toEqual(uniqueCodes);
  });

  it('should have ltr direction for Latin-script languages', () => {
    const ltrCodes = ['en', 'es'];
    for (const code of ltrCodes) {
      const lang = AVAILABLE_LANGUAGES.find(l => l.code === code);
      if (lang) {
        expect(lang.direction).toBe('ltr');
      }
    }
  });
});

describe('DEFAULT_LANGUAGE_CODE', () => {
  it('should be "en"', () => {
    expect(DEFAULT_LANGUAGE_CODE).toBe('en');
  });

  it('should correspond to an entry in AVAILABLE_LANGUAGES', () => {
    const found = AVAILABLE_LANGUAGES.find(lang => lang.code === DEFAULT_LANGUAGE_CODE);
    expect(found).toBeDefined();
  });
});

describe('PRIMARY_THRESHOLD and BETA_THRESHOLD', () => {
  it('PRIMARY_THRESHOLD should be 0.8', () => {
    expect(PRIMARY_THRESHOLD).toBe(0.8);
  });

  it('BETA_THRESHOLD should be 0.5', () => {
    expect(BETA_THRESHOLD).toBe(0.5);
  });

  it('PRIMARY_THRESHOLD should be greater than BETA_THRESHOLD', () => {
    expect(PRIMARY_THRESHOLD).toBeGreaterThan(BETA_THRESHOLD);
  });

  it('both thresholds should be between 0 and 1', () => {
    expect(PRIMARY_THRESHOLD).toBeGreaterThan(0);
    expect(PRIMARY_THRESHOLD).toBeLessThanOrEqual(1);
    expect(BETA_THRESHOLD).toBeGreaterThan(0);
    expect(BETA_THRESHOLD).toBeLessThanOrEqual(1);
  });
});

describe('isValidLanguageCode', () => {
  it('should return true for supported language codes', () => {
    for (const lang of AVAILABLE_LANGUAGES) {
      expect(isValidLanguageCode(lang.code)).toBe(true);
    }
  });

  it('should return false for unsupported codes', () => {
    expect(isValidLanguageCode('xx')).toBe(false);
    expect(isValidLanguageCode('zz')).toBe(false);
    expect(isValidLanguageCode('')).toBe(false);
  });

  it('should return false for locale variants not explicitly listed', () => {
    expect(isValidLanguageCode('en-US')).toBe(false);
    expect(isValidLanguageCode('es-MX')).toBe(false);
  });
});

describe('getLanguage', () => {
  it('should return the Language object for a valid code', () => {
    const lang: Language | undefined = getLanguage('en');
    expect(lang).toBeDefined();
    expect(lang?.code).toBe('en');
    expect(lang?.nativeName).toBe('English');
  });

  it('should return undefined for an invalid code', () => {
    expect(getLanguage('xx')).toBeUndefined();
  });

  it('should return objects with all required fields', () => {
    for (const entry of AVAILABLE_LANGUAGES) {
      const lang = getLanguage(entry.code);
      expect(lang).toBeDefined();
      expect(lang).toHaveProperty('code');
      expect(lang).toHaveProperty('nativeName');
      expect(lang).toHaveProperty('fallbackChain');
      expect(lang).toHaveProperty('direction');
    }
  });
});

describe('getLanguageCompleteness', () => {
  it('should return "primary" for English', () => {
    const result: LanguageCompleteness = getLanguageCompleteness('en');
    expect(result).toBe('primary');
  });

  it('should return "incomplete" for unsupported codes', () => {
    expect(getLanguageCompleteness('xx')).toBe('incomplete');
    expect(getLanguageCompleteness('zz')).toBe('incomplete');
    expect(getLanguageCompleteness('')).toBe('incomplete');
  });

  it('should return a valid LanguageCompleteness value for all supported languages', () => {
    const validValues: LanguageCompleteness[] = ['primary', 'beta', 'incomplete'];
    for (const lang of AVAILABLE_LANGUAGES) {
      const result = getLanguageCompleteness(lang.code);
      expect(validValues).toContain(result);
    }
  });

  it('should never return "incomplete" for a supported language', () => {
    for (const lang of AVAILABLE_LANGUAGES) {
      expect(getLanguageCompleteness(lang.code)).not.toBe('incomplete');
    }
  });
});
