import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { useWidgetStore } from '../stores/widgetStore';

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
        { path: '/widget/:urlName/events/:eventId', name: 'event', component: { template: '<div>Event</div>' } },
      ],
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

      expect(store.viewMode).toBe('list');
      expect(store.accentColor).toBe('');
      expect(store.colorMode).toBe('auto');
    });
  });

  describe('Accent Color CSS Injection', () => {
    it('should set CSS custom property when accent color is provided', () => {
      // Create a mock root element
      const mockRoot = document.createElement('div');
      mockRoot.id = 'widget-root';
      document.body.appendChild(mockRoot);

      const store = useWidgetStore(pinia);
      const urlParams = new URLSearchParams('accentColor=%23ff9131');
      store.parseConfig(urlParams);

      // Inject the color
      store.injectAccentColor(mockRoot);

      expect(mockRoot.style.getPropertyValue('--widget-accent-color')).toBe('#ff9131');

      // Cleanup
      document.body.removeChild(mockRoot);
    });

    it('should not set CSS property when accent color is empty', () => {
      const mockRoot = document.createElement('div');
      mockRoot.id = 'widget-root';
      document.body.appendChild(mockRoot);

      const store = useWidgetStore(pinia);
      store.injectAccentColor(mockRoot);

      expect(mockRoot.style.getPropertyValue('--widget-accent-color')).toBe('');

      document.body.removeChild(mockRoot);
    });
  });

  describe('Color Mode Class Application', () => {
    it('should apply light theme class when colorMode is light', () => {
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

    it('should not apply theme class when colorMode is auto', () => {
      const mockRoot = document.createElement('div');
      mockRoot.id = 'widget-root';
      document.body.appendChild(mockRoot);

      const store = useWidgetStore(pinia);
      const urlParams = new URLSearchParams('colorMode=auto');
      store.parseConfig(urlParams);

      store.applyColorMode(mockRoot);

      expect(mockRoot.classList.contains('widget-theme-light')).toBe(false);
      expect(mockRoot.classList.contains('widget-theme-dark')).toBe(false);

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
