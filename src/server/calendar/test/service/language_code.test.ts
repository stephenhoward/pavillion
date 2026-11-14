import { describe, it, expect } from 'vitest';

import { ValidationError } from '@/common/exceptions/base';
import {
  isContentLanguageCode,
  validateContentLanguage,
  validateContentLanguages,
  foldContentLanguages,
} from '@/server/calendar/service/language_code';

describe('isContentLanguageCode', () => {
  it('accepts bare ISO 639-1 codes beyond the UI languages', () => {
    for (const code of ['en', 'es', 'fr', 'cy', 'zh']) {
      expect(isContentLanguageCode(code)).toBe(true);
    }
  });

  it('rejects prototype keys, regional tags, unknown codes and non-strings', () => {
    for (const code of ['__proto__', 'constructor', 'fr-CA', 'zz', 'und', 'EN', '', 5, null, undefined]) {
      expect(isContentLanguageCode(code)).toBe(false);
    }
  });
});

describe('validateContentLanguage', () => {
  it('returns a valid code', () => {
    expect(validateContentLanguage('cy')).toBe('cy');
  });

  it('throws a ValidationError carrying fields.language', () => {
    try {
      validateContentLanguage('__proto__');
      expect.unreachable();
    }
    catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).fields).toHaveProperty('language');
    }
  });
});

describe('validateContentLanguages', () => {
  it('skips absent and non-object content', () => {
    expect(() => validateContentLanguages(undefined)).not.toThrow();
    expect(() => validateContentLanguages('x')).not.toThrow();
  });

  it('accepts a map of valid codes', () => {
    expect(() => validateContentLanguages({ en: {}, cy: null })).not.toThrow();
  });

  it('rejects a map with one invalid key, including an own __proto__ key', () => {
    expect(() => validateContentLanguages({ en: {}, constructor: {} })).toThrow(ValidationError);
    expect(() => validateContentLanguages(JSON.parse('{"__proto__": {}}'))).toThrow(ValidationError);
    expect(() => validateContentLanguages({ en: {}, 'fr-CA': {} })).toThrow(ValidationError);
  });
});

describe('foldContentLanguages', () => {
  it('folds a regional tag to its base subtag', () => {
    expect({ ...foldContentLanguages({ 'fr-CA': 'a', en: 'b' }) }).toEqual({ fr: 'a', en: 'b' });
    expect({ ...foldContentLanguages({ 'zh-Hant': 'a' }) }).toEqual({ zh: 'a' });
  });

  it('lets an exact key beat a folded one in either key order', () => {
    expect({ ...foldContentLanguages({ 'fr-CA': 'folded', fr: 'exact' }) }).toEqual({ fr: 'exact' });
    expect({ ...foldContentLanguages({ fr: 'exact', 'fr-CA': 'folded' }) }).toEqual({ fr: 'exact' });
  });

  it('drops prototype keys and unknown codes', () => {
    const input = JSON.parse('{"__proto__": "x", "constructor": "x", "zz": "x", "und": "x", "en": "ok"}');
    const out = foldContentLanguages(input);
    expect(Object.keys(out)).toEqual(['en']);
  });

  it('preserves null values', () => {
    const out = foldContentLanguages({ en: null, 'fr-CA': null });
    expect(out.en).toBeNull();
    expect('fr' in out).toBe(true);
    expect(out.fr).toBeNull();
  });

  it('returns a null-prototype map, and an empty one for non-objects', () => {
    expect(Object.getPrototypeOf(foldContentLanguages({ en: 1 }))).toBeNull();
    expect(Object.keys(foldContentLanguages(undefined))).toEqual([]);
    expect(Object.keys(foldContentLanguages([1]))).toEqual([]);
  });
});
