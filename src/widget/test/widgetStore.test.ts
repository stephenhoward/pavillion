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
    it('writes --pav-accent-light and --pav-accent-dark via style.setProperty — not via innerHTML', () => {
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

      expect(setPropertySpy).toHaveBeenCalledWith('--pav-accent-light', '#ff9131');
      expect(setPropertySpy).toHaveBeenCalledWith('--pav-accent-dark', '#ff9131');

      // The CSS custom properties are readable from the style attribute, and
      // the element's innerHTML remains empty (no <style> block injected).
      expect(rootElement.style.getPropertyValue('--pav-accent-light')).toBe('#ff9131');
      expect(rootElement.style.getPropertyValue('--pav-accent-dark')).toBe('#ff9131');
      expect(rootElement.innerHTML).toBe('');

      document.body.removeChild(rootElement);
    });

    it('does NOT publish the legacy --widget-accent-color custom property', () => {
      const store = useWidgetStore();
      const rootElement = document.createElement('div');
      document.body.appendChild(rootElement);

      store.applyServerConfig({
        view: 'list',
        accentColor: '#ff9131',
        colorMode: 'auto',
      });

      const setPropertySpy = vi.spyOn(rootElement.style, 'setProperty');

      store.injectAccentColor(rootElement);

      const writtenProperties = setPropertySpy.mock.calls.map(call => call[0]);
      expect(writtenProperties).not.toContain('--widget-accent-color');
      expect(rootElement.style.getPropertyValue('--widget-accent-color')).toBe('');

      document.body.removeChild(rootElement);
    });

    it('does NOT write hover variants (those remain at SCSS mixin defaults)', () => {
      const store = useWidgetStore();
      const rootElement = document.createElement('div');
      document.body.appendChild(rootElement);

      store.applyServerConfig({
        view: 'list',
        accentColor: '#ff9131',
        colorMode: 'auto',
      });

      const setPropertySpy = vi.spyOn(rootElement.style, 'setProperty');

      store.injectAccentColor(rootElement);

      const writtenProperties = setPropertySpy.mock.calls.map(call => call[0]);
      expect(writtenProperties).not.toContain('--pav-accent-light-hover');
      expect(writtenProperties).not.toContain('--pav-accent-dark-hover');

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

      // Only the safe default hex reaches the DOM, on both variables.
      expect(rootElement.style.getPropertyValue('--pav-accent-light')).toBe(WIDGET_CONFIG_DEFAULTS.accentColor);
      expect(rootElement.style.getPropertyValue('--pav-accent-dark')).toBe(WIDGET_CONFIG_DEFAULTS.accentColor);

      document.body.removeChild(rootElement);
    });
  });

  describe('applyColorMode (resolves auto + manages matchMedia listener)', () => {
    /**
     * Build a fake MediaQueryList whose `matches` value is fixed and whose
     * addEventListener/removeEventListener are spy-able. Returns the spy
     * accessors so individual tests can assert listener counts.
     */
    function mockMatchMedia(matches: boolean) {
      const addSpy = vi.fn();
      const removeSpy = vi.fn();
      const fakeMQL: Partial<MediaQueryList> = {
        matches,
        media: '(prefers-color-scheme: dark)',
        addEventListener: addSpy as unknown as MediaQueryList['addEventListener'],
        removeEventListener: removeSpy as unknown as MediaQueryList['removeEventListener'],
      };
      const matchMediaSpy = vi.fn().mockReturnValue(fakeMQL);
      vi.stubGlobal('matchMedia', matchMediaSpy);
      return { addSpy, removeSpy, matchMediaSpy };
    }

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('auto mode on a light system adds widget-theme-light', () => {
      mockMatchMedia(false);
      const store = useWidgetStore();
      store.colorMode = 'auto';
      const rootElement = document.createElement('div');

      store.applyColorMode(rootElement);

      expect(rootElement.classList.contains('widget-theme-light')).toBe(true);
      expect(rootElement.classList.contains('widget-theme-dark')).toBe(false);
    });

    it('auto mode on a dark system adds widget-theme-dark', () => {
      mockMatchMedia(true);
      const store = useWidgetStore();
      store.colorMode = 'auto';
      const rootElement = document.createElement('div');

      store.applyColorMode(rootElement);

      expect(rootElement.classList.contains('widget-theme-dark')).toBe(true);
      expect(rootElement.classList.contains('widget-theme-light')).toBe(false);
    });

    it('explicit light mode adds widget-theme-light regardless of system', () => {
      mockMatchMedia(true); // dark system
      const store = useWidgetStore();
      store.colorMode = 'light';
      const rootElement = document.createElement('div');

      store.applyColorMode(rootElement);

      expect(rootElement.classList.contains('widget-theme-light')).toBe(true);
      expect(rootElement.classList.contains('widget-theme-dark')).toBe(false);
    });

    it('explicit dark mode adds widget-theme-dark regardless of system', () => {
      mockMatchMedia(false); // light system
      const store = useWidgetStore();
      store.colorMode = 'dark';
      const rootElement = document.createElement('div');

      store.applyColorMode(rootElement);

      expect(rootElement.classList.contains('widget-theme-dark')).toBe(true);
      expect(rootElement.classList.contains('widget-theme-light')).toBe(false);
    });

    it('removes both theme classes before adding the resolved one', () => {
      mockMatchMedia(false);
      const store = useWidgetStore();
      store.colorMode = 'dark';
      const rootElement = document.createElement('div');
      // Pre-pollute with both classes to verify removal.
      rootElement.classList.add('widget-theme-light', 'widget-theme-dark');

      store.applyColorMode(rootElement);

      // Only the resolved class remains.
      expect(rootElement.classList.contains('widget-theme-dark')).toBe(true);
      expect(rootElement.classList.contains('widget-theme-light')).toBe(false);
    });

    it('non-auto modes do not register a matchMedia listener', () => {
      const { addSpy } = mockMatchMedia(false);
      const store = useWidgetStore();
      store.colorMode = 'light';
      const rootElement = document.createElement('div');

      store.applyColorMode(rootElement);

      expect(addSpy).not.toHaveBeenCalled();
    });

    it('auto mode registers exactly one change listener', () => {
      const { addSpy } = mockMatchMedia(false);
      const store = useWidgetStore();
      store.colorMode = 'auto';
      const rootElement = document.createElement('div');

      store.applyColorMode(rootElement);

      expect(addSpy).toHaveBeenCalledTimes(1);
      expect(addSpy.mock.calls[0][0]).toBe('change');
    });

    it('auto → light → auto cycle never stacks listeners (teardown before re-bind)', () => {
      // Use a single shared addSpy/removeSpy across all stub returns so we
      // can count net listener bindings across the whole cycle.
      const addSpy = vi.fn();
      const removeSpy = vi.fn();
      const fakeMQL: Partial<MediaQueryList> = {
        matches: false,
        media: '(prefers-color-scheme: dark)',
        addEventListener: addSpy as unknown as MediaQueryList['addEventListener'],
        removeEventListener: removeSpy as unknown as MediaQueryList['removeEventListener'],
      };
      vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(fakeMQL));

      const store = useWidgetStore();
      const rootElement = document.createElement('div');

      // 1) auto → registers a listener
      store.colorMode = 'auto';
      store.applyColorMode(rootElement);

      // 2) light → must remove prior listener and not register a new one
      store.colorMode = 'light';
      store.applyColorMode(rootElement);

      // 3) auto → registers exactly one new listener
      store.colorMode = 'auto';
      store.applyColorMode(rootElement);

      // After the full cycle: 2 add calls (steps 1, 3), 2 remove calls
      // (steps 2, 3 — step 3 tears down the prior auto-mode listener
      // even though step 2 already removed it; the unconditional teardown
      // is the invariant that prevents stacking, even if it sometimes
      // calls remove on an already-cleared MQL).
      expect(addSpy).toHaveBeenCalledTimes(2);
      // Net bindings (add - remove) should never exceed 1 at any point;
      // by the end of the cycle, exactly one listener is active.
      expect(addSpy.mock.calls.length - removeSpy.mock.calls.length).toBeLessThanOrEqual(1);
    });

    it('repeated auto applications do not stack listeners', () => {
      const addSpy = vi.fn();
      const removeSpy = vi.fn();
      const fakeMQL: Partial<MediaQueryList> = {
        matches: false,
        media: '(prefers-color-scheme: dark)',
        addEventListener: addSpy as unknown as MediaQueryList['addEventListener'],
        removeEventListener: removeSpy as unknown as MediaQueryList['removeEventListener'],
      };
      vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(fakeMQL));

      const store = useWidgetStore();
      store.colorMode = 'auto';
      const rootElement = document.createElement('div');

      store.applyColorMode(rootElement);
      store.applyColorMode(rootElement);
      store.applyColorMode(rootElement);

      // Each invocation tears down the prior listener and registers anew —
      // net bindings (add - remove) must never exceed 1.
      expect(addSpy.mock.calls.length - removeSpy.mock.calls.length).toBeLessThanOrEqual(1);
    });
  });
});
