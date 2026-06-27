import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { useWidgetStore } from '../stores/widgetStore';

/**
 * Build a fake MediaQueryList whose `matches` value is fixed and whose
 * addEventListener/removeEventListener are spy-able. Mirrors the pattern
 * established in widgetStore.test.ts (pv-16wd.1.2) so all widget tests
 * share a single matchMedia mocking approach.
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

describe('Widget App Infrastructure', () => {
  let pinia: ReturnType<typeof createPinia>;
  let router: Router;

  beforeEach(() => {
    pinia = createPinia();

    // Create minimal router for testing
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/widget/:urlName', name: 'widget', component: { template: '<div>Widget</div>' } },
        { path: '/widget/:urlName/events/:eventId/:startTime(\\d{8}-\\d{4})?', name: 'event', component: { template: '<div>Event</div>' } },
      ],
    });
  });

  describe('Event Detail Route Matching', () => {
    it('should match event-detail URL without startTime slug (legacy embed)', async () => {
      await router.push('/widget/my-cal/events/abc123');
      await router.isReady();

      const current = router.currentRoute.value;
      expect(current.name).toBe('event');
      expect(current.params.urlName).toBe('my-cal');
      expect(current.params.eventId).toBe('abc123');
      expect(current.params.startTime).toBe('');
    });

    it('should match event-detail URL with startTime slug (occurrence deep link)', async () => {
      await router.push('/widget/my-cal/events/abc123/20260422-1830');
      await router.isReady();

      const current = router.currentRoute.value;
      expect(current.name).toBe('event');
      expect(current.params.urlName).toBe('my-cal');
      expect(current.params.eventId).toBe('abc123');
      expect(current.params.startTime).toBe('20260422-1830');
    });

    it('should reject malformed startTime slug (wrong length)', async () => {
      // '12345' doesn't match yyyymmdd-hhmm; router should not match the event route.
      await router.push('/widget/my-cal/events/abc123/12345');
      await router.isReady();

      const current = router.currentRoute.value;
      expect(current.name).not.toBe('event');
    });
  });

  describe('URL Parameter Parsing', () => {
    it('should parse view parameter from URL', async () => {
      const store = useWidgetStore(pinia);

      const urlParams = new URLSearchParams('view=week&accentColor=%23ff9131&colorMode=light');
      store.parseConfig(urlParams);

      expect(store.viewMode).toBe('week');
    });

    it('should parse accentColor parameter from URL', () => {
      const store = useWidgetStore(pinia);

      const urlParams = new URLSearchParams('accentColor=%23ff9131');
      store.parseConfig(urlParams);

      expect(store.accentColor).toBe('#ff9131');
    });

    it('should parse colorMode parameter from URL', () => {
      const store = useWidgetStore(pinia);

      const urlParams = new URLSearchParams('colorMode=dark');
      store.parseConfig(urlParams);

      expect(store.colorMode).toBe('dark');
    });

    it('should use default values when parameters are missing', () => {
      const store = useWidgetStore(pinia);

      const urlParams = new URLSearchParams('');
      store.parseConfig(urlParams);

      // Defaults come from WIDGET_CONFIG_DEFAULTS (common/model/widget_config).
      expect(store.viewMode).toBe('list');
      expect(store.accentColor).toBe('#ff9131');
      expect(store.colorMode).toBe('auto');
    });
  });

  describe('Accent Color CSS Injection', () => {
    it('should set --pav-accent-light and --pav-accent-dark when accent color is provided', () => {
      // Create a mock root element
      const mockRoot = document.createElement('div');
      mockRoot.id = 'widget-root';
      document.body.appendChild(mockRoot);

      const store = useWidgetStore(pinia);
      const urlParams = new URLSearchParams('accentColor=%23ff9131');
      store.parseConfig(urlParams);

      // Inject the color
      store.injectAccentColor(mockRoot);

      expect(mockRoot.style.getPropertyValue('--pav-accent-light')).toBe('#ff9131');
      expect(mockRoot.style.getPropertyValue('--pav-accent-dark')).toBe('#ff9131');

      // Cleanup
      document.body.removeChild(mockRoot);
    });

    it('should not set CSS properties when accent color is empty', () => {
      const mockRoot = document.createElement('div');
      mockRoot.id = 'widget-root';
      document.body.appendChild(mockRoot);

      const store = useWidgetStore(pinia);
      // Explicitly clear the default to simulate the empty case.
      store.accentColor = '';
      store.injectAccentColor(mockRoot);

      expect(mockRoot.style.getPropertyValue('--pav-accent-light')).toBe('');
      expect(mockRoot.style.getPropertyValue('--pav-accent-dark')).toBe('');

      document.body.removeChild(mockRoot);
    });
  });

  describe('Color Mode Class Application', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should apply light theme class when colorMode is light', () => {
      // Even on a dark system, explicit light must win.
      mockMatchMedia(true);
      const mockRoot = document.createElement('div');
      mockRoot.id = 'widget-root';
      document.body.appendChild(mockRoot);

      const store = useWidgetStore(pinia);
      const urlParams = new URLSearchParams('colorMode=light');
      store.parseConfig(urlParams);

      store.applyColorMode(mockRoot);

      expect(mockRoot.classList.contains('widget-theme-light')).toBe(true);
      expect(mockRoot.classList.contains('widget-theme-dark')).toBe(false);

      document.body.removeChild(mockRoot);
    });

    it('should apply dark theme class when colorMode is dark', () => {
      // Even on a light system, explicit dark must win.
      mockMatchMedia(false);
      const mockRoot = document.createElement('div');
      mockRoot.id = 'widget-root';
      document.body.appendChild(mockRoot);

      const store = useWidgetStore(pinia);
      const urlParams = new URLSearchParams('colorMode=dark');
      store.parseConfig(urlParams);

      store.applyColorMode(mockRoot);

      expect(mockRoot.classList.contains('widget-theme-dark')).toBe(true);
      expect(mockRoot.classList.contains('widget-theme-light')).toBe(false);

      document.body.removeChild(mockRoot);
    });

    it('auto mode resolves to widget-theme-light on a light system', () => {
      mockMatchMedia(false);
      const mockRoot = document.createElement('div');
      mockRoot.id = 'widget-root';
      document.body.appendChild(mockRoot);

      const store = useWidgetStore(pinia);
      const urlParams = new URLSearchParams('colorMode=auto');
      store.parseConfig(urlParams);

      store.applyColorMode(mockRoot);

      expect(mockRoot.classList.contains('widget-theme-light')).toBe(true);
      expect(mockRoot.classList.contains('widget-theme-dark')).toBe(false);

      document.body.removeChild(mockRoot);
    });

    it('auto mode resolves to widget-theme-dark on a dark system', () => {
      mockMatchMedia(true);
      const mockRoot = document.createElement('div');
      mockRoot.id = 'widget-root';
      document.body.appendChild(mockRoot);

      const store = useWidgetStore(pinia);
      const urlParams = new URLSearchParams('colorMode=auto');
      store.parseConfig(urlParams);

      store.applyColorMode(mockRoot);

      expect(mockRoot.classList.contains('widget-theme-dark')).toBe(true);
      expect(mockRoot.classList.contains('widget-theme-light')).toBe(false);

      document.body.removeChild(mockRoot);
    });
  });

  describe('postMessage Communication', () => {
    it('should send resize message to parent window', () => {
      // Create a mock parent window
      const mockParent = {
        postMessage: vi.fn(),
      };

      // Temporarily override window.parent
      const originalParent = Object.getOwnPropertyDescriptor(window, 'parent');
      Object.defineProperty(window, 'parent', {
        configurable: true,
        writable: true,
        value: mockParent,
      });

      const store = useWidgetStore(pinia);
      store.notifyResize(500);

      expect(mockParent.postMessage).toHaveBeenCalledWith(
        { type: 'pavillion:resize', height: 500 },
        '*',
      );

      // Restore window.parent
      if (originalParent) {
        Object.defineProperty(window, 'parent', originalParent);
      }
    });

    it('should send navigation message to parent window', () => {
      // Create a mock parent window
      const mockParent = {
        postMessage: vi.fn(),
      };

      // Temporarily override window.parent
      const originalParent = Object.getOwnPropertyDescriptor(window, 'parent');
      Object.defineProperty(window, 'parent', {
        configurable: true,
        writable: true,
        value: mockParent,
      });

      const store = useWidgetStore(pinia);
      store.notifyNavigation('/widget/test-calendar/events/123');

      expect(mockParent.postMessage).toHaveBeenCalledWith(
        { type: 'pavillion:navigate', path: '/widget/test-calendar/events/123' },
        '*',
      );

      // Restore window.parent
      if (originalParent) {
        Object.defineProperty(window, 'parent', originalParent);
      }
    });
  });
});
