import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useWidgetStore } from '../stores/widgetStore';
import { WIDGET_CONFIG_DEFAULTS } from '@/common/model/widget_config';

describe('widgetStore — server-side config + admin-preview override', () => {
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('applyServerConfig (API-sourced authoritative config)', () => {
    it('loads view/accentColor/colorMode from API response when no URL params', () => {
      const store = useWidgetStore();

      store.applyServerConfig({
        view: 'month',
        accentColor: '#00ff00',
        colorMode: 'dark',
      });

      expect(store.viewMode).toBe('month');
      expect(store.accentColor).toBe('#00ff00');
      expect(store.colorMode).toBe('dark');
    });

    it('falls back to defaults when widgetConfig is null/undefined', () => {
      const store = useWidgetStore();

      store.applyServerConfig(null);

      expect(store.viewMode).toBe(WIDGET_CONFIG_DEFAULTS.view);
      expect(store.accentColor).toBe(WIDGET_CONFIG_DEFAULTS.accentColor);
      expect(store.colorMode).toBe(WIDGET_CONFIG_DEFAULTS.colorMode);
    });

    it('falls back to default accentColor AND warns when server returns invalid value', () => {
      const store = useWidgetStore();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      store.applyServerConfig({
        view: 'week',
        accentColor: 'zzzzzz', // invalid — not hex
        colorMode: 'light',
      });

      expect(store.accentColor).toBe(WIDGET_CONFIG_DEFAULTS.accentColor);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('accentColor');
      // Other valid fields still take effect.
      expect(store.viewMode).toBe('week');
      expect(store.colorMode).toBe('light');
    });

    it('warns and falls back when server returns invalid view (unknown enum)', () => {
      const store = useWidgetStore();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      store.applyServerConfig({
        view: 'year', // future-unknown enum
        accentColor: '#ff9131',
        colorMode: 'auto',
      });

      expect(store.viewMode).toBe(WIDGET_CONFIG_DEFAULTS.view);
      expect(warnSpy).toHaveBeenCalled();
      expect(warnSpy.mock.calls.some(call => String(call[0]).includes("'view'"))).toBe(true);
    });

    it('accepts shorthand hex as invalid (strict 6-digit hex only)', () => {
      const store = useWidgetStore();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      store.applyServerConfig({
        view: 'list',
        accentColor: '#fff', // shorthand — rejected
        colorMode: 'auto',
      });

      expect(store.accentColor).toBe(WIDGET_CONFIG_DEFAULTS.accentColor);
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('parseConfig (URL-param override for admin preview)', () => {
    it('URL params override API values when both present', () => {
      const store = useWidgetStore();

      // API says week view
      store.applyServerConfig({
        view: 'week',
        accentColor: '#ff9131',
        colorMode: 'auto',
      });
      expect(store.viewMode).toBe('week');

      // Admin preview overrides via query string: view=month
      const urlParams = new URLSearchParams('view=month');
      store.parseConfig(urlParams);

      expect(store.viewMode).toBe('month');
      // Other fields untouched.
      expect(store.accentColor).toBe('#ff9131');
      expect(store.colorMode).toBe('auto');
    });

    it('URL override with all three fields present replaces server config', () => {
      const store = useWidgetStore();

      store.applyServerConfig({
        view: 'list',
        accentColor: '#000000',
        colorMode: 'light',
      });

      const urlParams = new URLSearchParams('view=week&accentColor=%23abcdef&colorMode=dark');
      store.parseConfig(urlParams);

      expect(store.viewMode).toBe('week');
      expect(store.accentColor).toBe('#abcdef');
      expect(store.colorMode).toBe('dark');
    });

    it('invalid URL params are silently ignored (server values preserved)', () => {
      const store = useWidgetStore();

      store.applyServerConfig({
        view: 'week',
        accentColor: '#ff9131',
        colorMode: 'dark',
      });

      const urlParams = new URLSearchParams('view=bogus&accentColor=javascript:alert(1)&colorMode=purple');
      store.parseConfig(urlParams);

      // Server values preserved — invalid URL params rejected.
      expect(store.viewMode).toBe('week');
      expect(store.accentColor).toBe('#ff9131');
      expect(store.colorMode).toBe('dark');
    });
  });

  describe('safe accentColor DOM application', () => {
    it('applies accent color via style.setProperty — not via innerHTML', () => {
      const store = useWidgetStore();
      const rootElement = document.createElement('div');
      document.body.appendChild(rootElement);

      store.applyServerConfig({
        view: 'list',
        accentColor: '#ff9131',
        colorMode: 'auto',
      });

      // Spy on the setProperty call to prove it's used.
      const setPropertySpy = vi.spyOn(rootElement.style, 'setProperty');

      store.injectAccentColor(rootElement);

      expect(setPropertySpy).toHaveBeenCalledWith('--widget-accent-color', '#ff9131');

      // The CSS custom property is readable from the style attribute, and
      // the element's innerHTML remains empty (no <style> block injected).
      expect(rootElement.style.getPropertyValue('--widget-accent-color')).toBe('#ff9131');
      expect(rootElement.innerHTML).toBe('');

      document.body.removeChild(rootElement);
    });

    it('a malicious-looking server value never reaches the DOM (falls back to default)', () => {
      const store = useWidgetStore();
      const rootElement = document.createElement('div');
      document.body.appendChild(rootElement);

      vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Server returns an injection-style payload. Validation rejects it,
      // store falls back to the default, and injection never happens.
      store.applyServerConfig({
        view: 'list',
        accentColor: 'red; } body { background: url(evil) } .x {',
        colorMode: 'auto',
      });

      store.injectAccentColor(rootElement);

      // Only the safe default hex reaches the DOM.
      expect(rootElement.style.getPropertyValue('--widget-accent-color')).toBe(WIDGET_CONFIG_DEFAULTS.accentColor);

      document.body.removeChild(rootElement);
    });
  });
});
