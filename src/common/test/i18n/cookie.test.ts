// @vitest-environment-options { "url": "https://localhost" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readLocaleCookie, writeLocaleCookie, LOCALE_COOKIE_NAME } from '@/common/i18n/cookie';

describe('Locale cookie utilities', () => {

  describe('LOCALE_COOKIE_NAME', () => {

    it('should export the correct cookie name', () => {
      expect(LOCALE_COOKIE_NAME).toBe('pavilion_locale');
    });
  });

  describe('readLocaleCookie', () => {

    beforeEach(() => {
      // Clear all cookies before each test
      document.cookie.split(';').forEach((cookie) => {
        const name = cookie.split('=')[0].trim();
        document.cookie = `${name}=; max-age=0`;
      });
    });

    it('should return null when no locale cookie is set', () => {
      expect(readLocaleCookie()).toBeNull();
    });

    it('should return the locale value when the cookie is set', () => {
      document.cookie = `${LOCALE_COOKIE_NAME}=en`;
      expect(readLocaleCookie()).toBe('en');
    });

    it('should return the correct value when multiple cookies are present', () => {
      document.cookie = 'other_cookie=foo';
      document.cookie = `${LOCALE_COOKIE_NAME}=es`;
      document.cookie = 'another_cookie=bar';
      expect(readLocaleCookie()).toBe('es');
    });

    it('should return null when only unrelated cookies are present', () => {
      document.cookie = 'some_other_cookie=value';
      expect(readLocaleCookie()).toBeNull();
    });

    it('should decode URI-encoded locale values', () => {
      // Simulate a URI-encoded value in the cookie
      document.cookie = `${LOCALE_COOKIE_NAME}=${encodeURIComponent('zh-TW')}`;
      expect(readLocaleCookie()).toBe('zh-TW');
    });

    it('should return null when document is undefined', () => {
      const originalDocument = globalThis.document;

      try {
        // @ts-expect-error: testing undefined document
        globalThis.document = undefined;
        expect(readLocaleCookie()).toBeNull();
      }
      finally {
        globalThis.document = originalDocument;
      }
    });
  });

  describe('writeLocaleCookie', () => {

    beforeEach(() => {
      // Clear all cookies before each test
      document.cookie.split(';').forEach((cookie) => {
        const name = cookie.split('=')[0].trim();
        document.cookie = `${name}=; max-age=0`;
      });
    });

    it('should write the locale cookie so it can be read back', () => {
      writeLocaleCookie('en');
      expect(readLocaleCookie()).toBe('en');
    });

    it('should write different locale values correctly', () => {
      writeLocaleCookie('es');
      expect(readLocaleCookie()).toBe('es');
    });

    it('should overwrite an existing locale cookie value', () => {
      writeLocaleCookie('en');
      expect(readLocaleCookie()).toBe('en');

      writeLocaleCookie('es');
      expect(readLocaleCookie()).toBe('es');
    });

    it('should URI-encode the locale value when writing', () => {
      const documentCookieSpy = vi.spyOn(document, 'cookie', 'set');

      writeLocaleCookie('zh-TW');

      expect(documentCookieSpy).toHaveBeenCalledWith(
        expect.stringContaining(`${LOCALE_COOKIE_NAME}=${encodeURIComponent('zh-TW')}`),
      );

      documentCookieSpy.mockRestore();
    });

    it('should include SameSite=Lax in the cookie string', () => {
      const documentCookieSpy = vi.spyOn(document, 'cookie', 'set');

      writeLocaleCookie('en');

      expect(documentCookieSpy).toHaveBeenCalledWith(
        expect.stringContaining('SameSite=Lax'),
      );

      documentCookieSpy.mockRestore();
    });

    it('should include Secure attribute in the cookie string', () => {
      const documentCookieSpy = vi.spyOn(document, 'cookie', 'set');

      writeLocaleCookie('en');

      expect(documentCookieSpy).toHaveBeenCalledWith(
        expect.stringContaining('Secure'),
      );

      documentCookieSpy.mockRestore();
    });

    it('should include a 1-year max-age in the cookie string', () => {
      const documentCookieSpy = vi.spyOn(document, 'cookie', 'set');

      writeLocaleCookie('en');

      expect(documentCookieSpy).toHaveBeenCalledWith(
        expect.stringContaining('max-age=31536000'),
      );

      documentCookieSpy.mockRestore();
    });

    it('should not throw when document is undefined', () => {
      const originalDocument = globalThis.document;

      try {
        // @ts-expect-error: testing undefined document
        globalThis.document = undefined;
        expect(() => writeLocaleCookie('en')).not.toThrow();
      }
      finally {
        globalThis.document = originalDocument;
      }
    });
  });

  describe('round-trip read and write', () => {

    beforeEach(() => {
      // Clear all cookies before each test
      document.cookie.split(';').forEach((cookie) => {
        const name = cookie.split('=')[0].trim();
        document.cookie = `${name}=; max-age=0`;
      });
    });

    afterEach(() => {
      // Clear all cookies after each test
      document.cookie.split(';').forEach((cookie) => {
        const name = cookie.split('=')[0].trim();
        document.cookie = `${name}=; max-age=0`;
      });
    });

    it('should write and read back simple locale codes', () => {
      const locales = ['en', 'es', 'fr', 'de'];

      for (const locale of locales) {
        writeLocaleCookie(locale);
        expect(readLocaleCookie()).toBe(locale);
      }
    });

    it('should write and read back locale codes with region subtags', () => {
      writeLocaleCookie('zh-TW');
      expect(readLocaleCookie()).toBe('zh-TW');
    });

    it('should start with null before writing', () => {
      expect(readLocaleCookie()).toBeNull();
    });
  });
});
