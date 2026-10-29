import { describe, it, expect, vi, afterEach } from 'vitest';
import { languageDisplayName } from '@/common/i18n/language-names';

describe('languageDisplayName', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('names the language in the UI locale', () => {
    expect(languageDisplayName('en', 'fr')).toBe('anglais');
    expect(languageDisplayName('en', 'es')).toBe('inglés');
    expect(languageDisplayName('fr', 'en')).toBe('French');
  });

  it('falls back to the English name when the UI locale is invalid', () => {
    expect(languageDisplayName('fr', 'not a locale!')).toBe('French');
  });

  it('falls back to the English name when Intl.DisplayNames throws', () => {
    vi.spyOn(Intl, 'DisplayNames').mockImplementation(() => {
      throw new RangeError('unsupported');
    });
    expect(languageDisplayName('de', 'fr')).toBe('German');
  });

  it('falls back to the code when no name is known', () => {
    vi.spyOn(Intl, 'DisplayNames').mockImplementation(() => {
      throw new RangeError('unsupported');
    });
    expect(languageDisplayName('zz', 'fr')).toBe('zz');
  });

  it('falls back to the code when the code is not a valid language tag', () => {
    expect(languageDisplayName('!!', 'en')).toBe('!!');
  });
});
