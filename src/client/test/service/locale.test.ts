import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import i18next from 'i18next';

// We need to isolate tests from the real i18next state
vi.mock('i18next', () => {
  const mockI18next = {
    language: 'en',
    use: vi.fn().mockReturnThis(),
    init: vi.fn().mockResolvedValue(undefined),
    changeLanguage: vi.fn().mockImplementation(async (lang: string) => {
      mockI18next.language = lang;
    }),
  };
  return { default: mockI18next };
});

vi.mock('@/common/i18n/cookie', () => ({
  readLocaleCookie: vi.fn().mockReturnValue(null),
  writeLocaleCookie: vi.fn(),
}));

vi.mock('@/common/i18n/config', () => ({
  createI18nConfig: vi.fn().mockImplementation((opts) => opts),
}));

import { readLocaleCookie, writeLocaleCookie } from '@/common/i18n/cookie';
import { detectLanguage, initI18Next, applyAccountLanguage, changeLanguage } from '@/client/service/locale';

describe('locale service', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    vi.clearAllMocks();
    // Reset i18next mock state
    (i18next as any).language = 'en';
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('detectLanguage', () => {
    describe('cookie takes priority over browser and instance default', () => {
      it('should return cookie language when cookie is set and valid', () => {
        vi.mocked(readLocaleCookie).mockReturnValue('es');
        // Simulate browser language
        Object.defineProperty(navigator, 'languages', {
          value: ['en', 'en-US'],
          configurable: true,
        });

        const result = detectLanguage('en');
        expect(result).toBe('es');
      });

      it('should skip invalid cookie values', () => {
        vi.mocked(readLocaleCookie).mockReturnValue('xx');

        const result = detectLanguage('en');
        // Falls through to browser or instance default
        expect(result).toBe('en');
      });

      it('should skip null cookie value', () => {
        vi.mocked(readLocaleCookie).mockReturnValue(null);

        const result = detectLanguage('en');
        expect(result).toBe('en');
      });
    });

    describe('browser language is second priority', () => {
      beforeEach(() => {
        vi.mocked(readLocaleCookie).mockReturnValue(null);
      });

      it('should return browser language when no cookie and browser language is valid', () => {
        Object.defineProperty(navigator, 'languages', {
          value: ['es-MX', 'es'],
          configurable: true,
        });

        const result = detectLanguage('en');
        expect(result).toBe('es');
      });

      it('should extract base language from browser locale variants', () => {
        Object.defineProperty(navigator, 'languages', {
          value: ['es-419'],
          configurable: true,
        });

        const result = detectLanguage('en');
        expect(result).toBe('es');
      });

      it('should skip unsupported browser languages and use instance default', () => {
        Object.defineProperty(navigator, 'languages', {
          value: ['fr-FR', 'fr'],
          configurable: true,
        });

        const result = detectLanguage('es');
        expect(result).toBe('es');
      });
    });

    describe('instance default is third priority', () => {
      beforeEach(() => {
        vi.mocked(readLocaleCookie).mockReturnValue(null);
        Object.defineProperty(navigator, 'languages', {
          value: [],
          configurable: true,
        });
      });

      it('should return instance default when no cookie, no matching browser language', () => {
        const result = detectLanguage('es');
        expect(result).toBe('es');
      });

      it('should skip invalid instance default language', () => {
        const result = detectLanguage('xx');
        expect(result).toBe('en');
      });

      it('should skip undefined instance default language', () => {
        const result = detectLanguage(undefined);
        expect(result).toBe('en');
      });
    });

    describe('English fallback is last resort', () => {
      beforeEach(() => {
        vi.mocked(readLocaleCookie).mockReturnValue(null);
        Object.defineProperty(navigator, 'languages', {
          value: [],
          configurable: true,
        });
      });

      it('should return "en" when all other options fail', () => {
        const result = detectLanguage();
        expect(result).toBe('en');
      });

      it('should return "en" when instance default is not provided', () => {
        const result = detectLanguage(undefined);
        expect(result).toBe('en');
      });
    });

    describe('detection chain priority order', () => {
      it('cookie beats browser language', () => {
        vi.mocked(readLocaleCookie).mockReturnValue('es');
        Object.defineProperty(navigator, 'languages', {
          value: ['en'],
          configurable: true,
        });

        expect(detectLanguage('en')).toBe('es');
      });

      it('browser language beats instance default', () => {
        vi.mocked(readLocaleCookie).mockReturnValue(null);
        Object.defineProperty(navigator, 'languages', {
          value: ['es'],
          configurable: true,
        });

        expect(detectLanguage('en')).toBe('es');
      });

      it('instance default beats English fallback', () => {
        vi.mocked(readLocaleCookie).mockReturnValue(null);
        Object.defineProperty(navigator, 'languages', {
          value: [],
          configurable: true,
        });

        expect(detectLanguage('es')).toBe('es');
      });
    });
  });

  describe('initI18Next', () => {
    it('should call i18next.init with detected language', () => {
      vi.mocked(readLocaleCookie).mockReturnValue('es');

      initI18Next('en');

      expect(i18next.init).toHaveBeenCalled();
    });

    it('should use instance default when no cookie or browser preference', () => {
      vi.mocked(readLocaleCookie).mockReturnValue(null);
      Object.defineProperty(navigator, 'languages', {
        value: [],
        configurable: true,
      });

      initI18Next('es');

      expect(i18next.init).toHaveBeenCalled();
    });

    it('should return the i18next instance', () => {
      const result = initI18Next('en');
      expect(result).toBe(i18next);
    });
  });

  describe('applyAccountLanguage', () => {
    it('should change language when account language differs from current', async () => {
      (i18next as any).language = 'en';

      await applyAccountLanguage('es');

      expect(i18next.changeLanguage).toHaveBeenCalledWith('es');
    });

    it('should not change language when account language matches current', async () => {
      (i18next as any).language = 'es';

      await applyAccountLanguage('es');

      expect(i18next.changeLanguage).not.toHaveBeenCalled();
    });

    it('should not change language when account language is invalid', async () => {
      (i18next as any).language = 'en';

      await applyAccountLanguage('xx');

      expect(i18next.changeLanguage).not.toHaveBeenCalled();
    });

    it('should not change language when account language is empty string', async () => {
      (i18next as any).language = 'en';

      await applyAccountLanguage('');

      expect(i18next.changeLanguage).not.toHaveBeenCalled();
    });
  });

  describe('changeLanguage', () => {
    it('should update i18next, write cookie, and call persistToApi', async () => {
      const persistToApi = vi.fn().mockResolvedValue(undefined);

      await changeLanguage('es', persistToApi);

      expect(i18next.changeLanguage).toHaveBeenCalledWith('es');
      expect(writeLocaleCookie).toHaveBeenCalledWith('es');
      expect(persistToApi).toHaveBeenCalledWith('es');
    });

    it('should update i18next and write cookie without persistToApi', async () => {
      await changeLanguage('es');

      expect(i18next.changeLanguage).toHaveBeenCalledWith('es');
      expect(writeLocaleCookie).toHaveBeenCalledWith('es');
    });

    it('should not change language for invalid code', async () => {
      const persistToApi = vi.fn();

      await changeLanguage('xx', persistToApi);

      expect(i18next.changeLanguage).not.toHaveBeenCalled();
      expect(writeLocaleCookie).not.toHaveBeenCalled();
      expect(persistToApi).not.toHaveBeenCalled();
    });

    it('should not change language for empty string', async () => {
      await changeLanguage('');

      expect(i18next.changeLanguage).not.toHaveBeenCalled();
      expect(writeLocaleCookie).not.toHaveBeenCalled();
    });

    it('should update i18next first, then write cookie, then persist to API', async () => {
      const callOrder: string[] = [];

      // Use type assertion to avoid TypeScript issues with complex i18next function signature
      (i18next.changeLanguage as ReturnType<typeof vi.fn>).mockImplementation(async (lang: string) => {
        callOrder.push('i18next');
        (i18next as any).language = lang;
      });

      vi.mocked(writeLocaleCookie).mockImplementation(() => {
        callOrder.push('cookie');
      });

      const persistToApi = vi.fn().mockImplementation(async () => {
        callOrder.push('api');
      });

      await changeLanguage('es', persistToApi);

      expect(callOrder).toEqual(['i18next', 'cookie', 'api']);
    });
  });
});
