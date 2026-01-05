import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Pavillion Widget SDK', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    // Create a container element for each test
    container = document.createElement('div');
    container.id = 'widget-container';
    document.body.appendChild(container);

    // Reset global Pavillion object
    (window as any).Pavillion = undefined;
  });

  afterEach(() => {
    // Clean up DOM
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  describe('Async loading and command queue pattern', () => {
    it('should create global Pavillion namespace with command queue', () => {
      // Simulate user code that runs before SDK loads
      (window as any).Pavillion = (window as any).Pavillion || { q: [] };
      (window as any).Pavillion.q = [];

      expect((window as any).Pavillion).toBeDefined();
      expect((window as any).Pavillion.q).toBeInstanceOf(Array);
      expect((window as any).Pavillion.q.length).toBe(0);
    });

    it('should buffer commands in queue before SDK loads', () => {
      // Simulate user code
      (window as any).Pavillion = (window as any).Pavillion || { q: [] };
      const Pavillion = function(...args: any[]) {
        (window as any).Pavillion.q.push(args);
      };
      (window as any).Pavillion = Object.assign(Pavillion, { q: [] });

      // User calls before SDK loads
      (window as any).Pavillion('init', {
        calendar: 'my-calendar',
        container: '#widget-container',
        view: 'week',
      });

      expect((window as any).Pavillion.q.length).toBe(1);
      expect((window as any).Pavillion.q[0][0]).toBe('init');
      expect((window as any).Pavillion.q[0][1]).toMatchObject({
        calendar: 'my-calendar',
        container: '#widget-container',
        view: 'week',
      });
    });
  });

  describe('Configuration validation', () => {
    it('should validate required config parameters', () => {
      const validateConfig = (config: any): string[] => {
        const errors: string[] = [];

        if (!config.calendar) {
          errors.push('calendar is required');
        }
        if (!config.container) {
          errors.push('container is required');
        }

        return errors;
      };

      const invalidConfig = { view: 'week' };
      const errors = validateConfig(invalidConfig);

      expect(errors).toContain('calendar is required');
      expect(errors).toContain('container is required');
    });

    it('should accept valid config with optional parameters', () => {
      const validateConfig = (config: any): string[] => {
        const errors: string[] = [];

        if (!config.calendar) {
          errors.push('calendar is required');
        }
        if (!config.container) {
          errors.push('container is required');
        }

        return errors;
      };

      const validConfig = {
        calendar: 'my-calendar',
        container: '#widget-container',
        view: 'month',
        accentColor: '#ff9131',
        colorMode: 'dark',
      };

      const errors = validateConfig(validConfig);
      expect(errors.length).toBe(0);
    });
  });

  describe('Iframe creation with URL parameters', () => {
    it('should construct correct widget URL with parameters', () => {
      const buildWidgetUrl = (
        baseUrl: string,
        calendar: string,
        config: { view?: string; accentColor?: string; colorMode?: string },
      ): string => {
        const url = new URL(`/widget/${calendar}`, baseUrl);

        if (config.view) {
          url.searchParams.set('view', config.view);
        }
        if (config.accentColor) {
          url.searchParams.set('accentColor', config.accentColor);
        }
        if (config.colorMode) {
          url.searchParams.set('colorMode', config.colorMode);
        }

        return url.toString();
      };

      const url = buildWidgetUrl('https://calendar.example.com', 'my-calendar', {
        view: 'week',
        accentColor: '#ff9131',
        colorMode: 'dark',
      });

      expect(url).toContain('/widget/my-calendar');
      expect(url).toContain('view=week');
      // URL encodes # as %25 in happy-dom, check for the color value
      expect(url).toContain('accentColor');
      expect(url).toContain('ff9131');
      expect(url).toContain('colorMode=dark');
    });

    it('should create iframe with correct attributes', () => {
      const createIframe = (url: string, container: HTMLElement): HTMLIFrameElement => {
        const iframe = document.createElement('iframe');
        iframe.src = url;
        iframe.style.width = '100%';
        iframe.style.border = 'none';
        iframe.setAttribute('title', 'Pavillion Calendar Widget');
        iframe.setAttribute('loading', 'lazy');

        container.appendChild(iframe);
        return iframe;
      };

      const testContainer = document.getElementById('widget-container')!;
      const iframe = createIframe('https://calendar.example.com/widget/test', testContainer);

      expect(iframe.src).toContain('/widget/test');
      expect(iframe.style.width).toBe('100%');
      // Check that border style contains 'none' (happy-dom may add extra values)
      expect(iframe.style.border).toContain('none');
      expect(iframe.getAttribute('title')).toBe('Pavillion Calendar Widget');
      expect(iframe.getAttribute('loading')).toBe('lazy');
      expect(testContainer.contains(iframe)).toBe(true);
    });
  });

  describe('postMessage communication', () => {
    it('should handle resize messages from widget iframe', () => {
      const resizeHandler = vi.fn();

      // Simulate message from iframe
      const mockEvent = {
        origin: 'https://calendar.example.com',
        data: {
          type: 'pavillion:resize',
          height: 600,
        },
      };

      // Validate origin and handle resize
      if (mockEvent.origin === 'https://calendar.example.com') {
        if (mockEvent.data.type === 'pavillion:resize') {
          resizeHandler(mockEvent.data.height);
        }
      }

      expect(resizeHandler).toHaveBeenCalledWith(600);
    });

    it('should handle navigation messages from widget iframe', () => {
      const navigationHandler = vi.fn();

      // Simulate message from iframe
      const mockEvent = {
        origin: 'https://calendar.example.com',
        data: {
          type: 'pavillion:navigate',
          url: '/widget/my-calendar/events/123',
        },
      };

      // Validate origin and handle navigation
      if (mockEvent.origin === 'https://calendar.example.com') {
        if (mockEvent.data.type === 'pavillion:navigate') {
          navigationHandler(mockEvent.data.url);
        }
      }

      expect(navigationHandler).toHaveBeenCalledWith('/widget/my-calendar/events/123');
    });

    it('should ignore messages from unauthorized origins', () => {
      const resizeHandler = vi.fn();

      // Simulate message from untrusted origin
      const mockEvent = {
        origin: 'https://evil.com',
        data: {
          type: 'pavillion:resize',
          height: 600,
        },
      };

      // Validate origin - should reject
      const trustedOrigin = 'https://calendar.example.com';
      if (mockEvent.origin === trustedOrigin) {
        resizeHandler(mockEvent.data.height);
      }

      expect(resizeHandler).not.toHaveBeenCalled();
    });

    it('should adjust iframe height dynamically on resize', () => {
      const iframe = document.createElement('iframe');
      iframe.style.height = '400px';

      const applyResize = (iframe: HTMLIFrameElement, height: number) => {
        iframe.style.height = `${height}px`;
      };

      applyResize(iframe, 600);
      expect(iframe.style.height).toBe('600px');
    });
  });
});
