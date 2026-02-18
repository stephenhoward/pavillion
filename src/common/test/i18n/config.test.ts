import { describe, it, expect, vi, afterEach } from 'vitest';
import { createI18nConfig, buildFallbackLng } from '@/common/i18n/config';
import { AVAILABLE_LANGUAGES, DEFAULT_LANGUAGE_CODE } from '@/common/i18n/languages';

describe('buildFallbackLng', () => {
  it('should return an object', () => {
    const result = buildFallbackLng();
    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
  });

  it('should always include a "default" key pointing to the default language', () => {
    const result = buildFallbackLng();
    expect(result['default']).toEqual([DEFAULT_LANGUAGE_CODE]);
    expect(result['default']).toEqual(['en']);
  });

  it('should include fallback chains for non-English languages', () => {
    const result = buildFallbackLng();
    const nonEnglish = AVAILABLE_LANGUAGES.filter(lang => lang.code !== 'en' && lang.fallbackChain.length > 0);

    for (const lang of nonEnglish) {
      expect(result[lang.code]).toBeDefined();
      expect(result[lang.code]).toEqual(lang.fallbackChain);
    }
  });

  it('should not include English in the map (it is the ultimate fallback)', () => {
    const result = buildFallbackLng();
    // English has an empty fallbackChain and should not appear as a key
    // (only 'default' should point to English)
    expect(result['en']).toBeUndefined();
  });

  it('should include "es" with ["en"] as fallback chain', () => {
    const result = buildFallbackLng();
    const esLang = AVAILABLE_LANGUAGES.find(lang => lang.code === 'es');

    if (esLang) {
      expect(result['es']).toEqual(esLang.fallbackChain);
      expect(result['es']).toEqual(['en']);
    }
  });

  it('should produce chains that all end with the default language', () => {
    const result = buildFallbackLng();

    for (const [key, chain] of Object.entries(result)) {
      if (key === 'default') continue;
      expect(chain[chain.length - 1]).toBe(DEFAULT_LANGUAGE_CODE);
    }
  });

  it('should handle a language with a multi-step fallback chain', () => {
    // This test verifies that if a language like pt with ['es', 'en'] is added,
    // buildFallbackLng correctly maps pt -> ['es', 'en']
    const result = buildFallbackLng();

    // Verify structure: every non-default key should match its language's fallbackChain
    for (const [key, chain] of Object.entries(result)) {
      if (key === 'default') continue;
      const lang = AVAILABLE_LANGUAGES.find(l => l.code === key);
      expect(lang).toBeDefined();
      expect(chain).toEqual(lang!.fallbackChain);
    }
  });
});

describe('createI18nConfig', () => {
  describe('enforced settings', () => {
    it('should enforce returnEmptyString: false', () => {
      const config = createI18nConfig();
      expect(config.returnEmptyString).toBe(false);
    });

    it('should enforce nonExplicitSupportedLngs: true', () => {
      const config = createI18nConfig();
      expect(config.nonExplicitSupportedLngs).toBe(true);
    });

    it('should enforce load: "languageOnly"', () => {
      const config = createI18nConfig();
      expect(config.load).toBe('languageOnly');
    });

    it('should include fallbackLng built from AVAILABLE_LANGUAGES', () => {
      const config = createI18nConfig();
      const expected = buildFallbackLng();
      expect(config.fallbackLng).toEqual(expected);
    });

    it('should not allow callers to override returnEmptyString', () => {
      const config = createI18nConfig({ returnEmptyString: true } as any);
      expect(config.returnEmptyString).toBe(false);
    });

    it('should not allow callers to override nonExplicitSupportedLngs', () => {
      const config = createI18nConfig({ nonExplicitSupportedLngs: false } as any);
      expect(config.nonExplicitSupportedLngs).toBe(true);
    });

    it('should not allow callers to override load', () => {
      const config = createI18nConfig({ load: 'all' } as any);
      expect(config.load).toBe('languageOnly');
    });

    it('should not allow callers to override fallbackLng', () => {
      const config = createI18nConfig({ fallbackLng: 'fr' } as any);
      expect(config.fallbackLng).toEqual(buildFallbackLng());
    });
  });

  describe('debug setting', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('should set debug: true in development mode', () => {
      vi.stubEnv('NODE_ENV', 'development');
      const config = createI18nConfig();
      expect(config.debug).toBe(true);
    });

    it('should set debug: false in production mode', () => {
      vi.stubEnv('NODE_ENV', 'production');
      const config = createI18nConfig();
      expect(config.debug).toBe(false);
    });

    it('should set debug: false in test mode', () => {
      vi.stubEnv('NODE_ENV', 'test');
      const config = createI18nConfig();
      expect(config.debug).toBe(false);
    });
  });

  describe('backend option', () => {
    it('should include backend config when provided', () => {
      const backend = { loadPath: '/locales/{{lng}}/{{ns}}.json' };
      const config = createI18nConfig({ backend });
      expect(config.backend).toEqual(backend);
    });

    it('should not include backend key when not provided', () => {
      const config = createI18nConfig();
      expect(config).not.toHaveProperty('backend');
    });

    it('should pass backend config through unchanged', () => {
      const backend = {
        loadPath: '/locales/{{lng}}/{{ns}}.json',
        addPath: '/locales/add/{{lng}}/{{ns}}',
      };
      const config = createI18nConfig({ backend });
      expect(config.backend).toEqual(backend);
    });
  });

  describe('detection option', () => {
    it('should include detection config when provided without localStorage', () => {
      const detection = { order: ['navigator', 'htmlTag'] };
      const config = createI18nConfig({ detection });
      expect(config.detection).toEqual(detection);
    });

    it('should not include detection key when not provided', () => {
      const config = createI18nConfig();
      expect(config).not.toHaveProperty('detection');
    });

    it('should strip localStorage from detection order', () => {
      const detection = { order: ['localStorage', 'navigator'] };
      const config = createI18nConfig({ detection });
      const resultOrder = (config.detection as any)?.order;
      expect(resultOrder).not.toContain('localStorage');
      expect(resultOrder).toContain('navigator');
    });

    it('should strip localStorage from detection caches', () => {
      const detection = { order: ['navigator'], caches: ['localStorage'] };
      const config = createI18nConfig({ detection });
      const resultCaches = (config.detection as any)?.caches;
      expect(resultCaches).not.toContain('localStorage');
    });

    it('should preserve other detection cache entries after stripping localStorage', () => {
      const detection = { order: ['navigator'], caches: ['localStorage', 'cookie'] };
      const config = createI18nConfig({ detection });
      const resultCaches = (config.detection as any)?.caches;
      expect(resultCaches).toContain('cookie');
      expect(resultCaches).not.toContain('localStorage');
    });

    it('should warn when localStorage is stripped from order', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const detection = { order: ['localStorage', 'navigator'] };

      createI18nConfig({ detection });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('localStorage'),
      );

      warnSpy.mockRestore();
    });

    it('should warn when localStorage is stripped from caches', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const detection = { order: ['navigator'], caches: ['localStorage'] };

      createI18nConfig({ detection });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('localStorage'),
      );

      warnSpy.mockRestore();
    });

    it('should not warn when no localStorage is present in detection', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const detection = { order: ['navigator'], caches: [] };

      createI18nConfig({ detection });

      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe('additional options', () => {
    it('should pass through additional options to the config', () => {
      const config = createI18nConfig({ ns: ['common', 'system'], defaultNS: 'common' });
      expect(config.ns).toEqual(['common', 'system']);
      expect(config.defaultNS).toBe('common');
    });

    it('should work with no options (defaults only)', () => {
      const config = createI18nConfig();
      expect(config).toBeDefined();
      expect(config.returnEmptyString).toBe(false);
      expect(config.nonExplicitSupportedLngs).toBe(true);
      expect(config.load).toBe('languageOnly');
      expect(config.fallbackLng).toBeDefined();
    });

    it('should work when called with undefined', () => {
      const config = createI18nConfig(undefined);
      expect(config).toBeDefined();
      expect(config.returnEmptyString).toBe(false);
    });

    it('should allow passing resources for in-memory translation bundles', () => {
      const resources = { en: { system: { hello: 'Hello' } } };
      const config = createI18nConfig({ resources });
      expect(config.resources).toEqual(resources);
    });
  });

  describe('return value shape', () => {
    it('should return a plain object', () => {
      const config = createI18nConfig();
      expect(typeof config).toBe('object');
      expect(config).not.toBeNull();
    });

    it('should always contain the four enforced keys', () => {
      const config = createI18nConfig();
      expect(config).toHaveProperty('returnEmptyString');
      expect(config).toHaveProperty('nonExplicitSupportedLngs');
      expect(config).toHaveProperty('load');
      expect(config).toHaveProperty('fallbackLng');
    });
  });
});
