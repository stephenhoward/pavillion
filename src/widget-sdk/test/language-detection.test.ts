import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { detectWidgetLanguage } from '../pavillion-widget';

/**
 * Creates a mock script element with a given src (without triggering a network request)
 * and an optional data-lang attribute.
 */
function createMockWidgetScript(dataLang?: string): HTMLScriptElement {
  const el = document.createElement('script');
  // Use Object.defineProperty to set src without triggering happy-dom fetch
  Object.defineProperty(el, 'src', {
    value: 'https://calendar.example.com/widget/pavillion-widget.js',
    writable: false,
    configurable: true,
  });
  if (dataLang !== undefined) {
    el.setAttribute('data-lang', dataLang);
  }
  return el;
}

describe('detectWidgetLanguage', () => {
  let mockScripts: HTMLScriptElement[] = [];

  beforeEach(() => {
    mockScripts = [];
    // Spy on getElementsByTagName to control which scripts are visible
    vi.spyOn(document, 'getElementsByTagName').mockImplementation((tag: string) => {
      if (tag === 'script') {
        return mockScripts as unknown as HTMLCollectionOf<HTMLScriptElement>;
      }
      return document.getElementsByTagName(tag);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.removeAttribute('lang');
  });

  describe('data-lang attribute on widget script tag', () => {
    it('should use data-lang when set to a valid language code', () => {
      mockScripts = [createMockWidgetScript('es')];

      expect(detectWidgetLanguage()).toBe('es');
    });

    it('should ignore data-lang when set to an unsupported language code', () => {
      mockScripts = [createMockWidgetScript('xx')];

      // Falls through to html lang check (none set), then configLang (none), then 'en'
      expect(detectWidgetLanguage()).toBe('en');
    });

    it('should take priority over html lang attribute', () => {
      document.documentElement.setAttribute('lang', 'es');
      mockScripts = [createMockWidgetScript('en')];

      expect(detectWidgetLanguage()).toBe('en');
    });
  });

  describe('parent page <html lang> attribute fallback', () => {
    it('should use html lang when no widget script data-lang is set', () => {
      document.documentElement.setAttribute('lang', 'es');
      // No data-lang on script
      mockScripts = [createMockWidgetScript()];

      expect(detectWidgetLanguage()).toBe('es');
    });

    it('should use html lang when no widget script is present', () => {
      document.documentElement.setAttribute('lang', 'es');

      expect(detectWidgetLanguage()).toBe('es');
    });

    it('should use base language from hyphenated html lang', () => {
      document.documentElement.setAttribute('lang', 'es-MX');

      expect(detectWidgetLanguage()).toBe('es');
    });

    it('should ignore unsupported html lang and fall through', () => {
      document.documentElement.setAttribute('lang', 'xx');

      expect(detectWidgetLanguage()).toBe('en');
    });
  });

  describe('instance default language from config', () => {
    it('should use configLang when no data-lang or html lang is set', () => {
      expect(detectWidgetLanguage('es')).toBe('es');
    });

    it('should ignore unsupported configLang and fall back to English', () => {
      expect(detectWidgetLanguage('xx')).toBe('en');
    });

    it('should be overridden by html lang if present', () => {
      document.documentElement.setAttribute('lang', 'es');

      expect(detectWidgetLanguage('en')).toBe('es');
    });
  });

  describe('English fallback', () => {
    it('should return English when no language cues are present', () => {
      expect(detectWidgetLanguage()).toBe('en');
    });

    it('should return English when all cues are invalid', () => {
      document.documentElement.setAttribute('lang', 'xx');
      mockScripts = [createMockWidgetScript('zz')];

      expect(detectWidgetLanguage('yy')).toBe('en');
    });
  });
});
