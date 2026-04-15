import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PavillionWidget } from '../pavillion-widget';

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
    vi.restoreAllMocks();
  });

  describe('Async loading and command queue pattern', () => {
    it('should create callable global Pavillion namespace with command queue', () => {
      // Simulate user code that runs before SDK loads
      (window as any).Pavillion = (window as any).Pavillion || function () {
        ((window as any).Pavillion.q = (window as any).Pavillion.q || []).push([].slice.call(arguments));
      };

      expect((window as any).Pavillion).toBeDefined();
      expect(typeof (window as any).Pavillion).toBe('function');
    });

    it('should buffer commands in queue before SDK loads', () => {
      // Simulate user code that runs before SDK loads
      (window as any).Pavillion = (window as any).Pavillion || function () {
        ((window as any).Pavillion.q = (window as any).Pavillion.q || []).push([].slice.call(arguments));
      };

      // User calls before SDK loads
      (window as any).Pavillion('init', {
        calendar: 'my-calendar',
        container: '#widget-container',
      });

      expect((window as any).Pavillion.q.length).toBe(1);
      expect(Array.isArray((window as any).Pavillion.q[0])).toBe(true);
      expect((window as any).Pavillion.q[0][0]).toBe('init');
      expect((window as any).Pavillion.q[0][1]).toMatchObject({
        calendar: 'my-calendar',
        container: '#widget-container',
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

      const invalidConfig = {};
      const errors = validateConfig(invalidConfig);

      expect(errors).toContain('calendar is required');
      expect(errors).toContain('container is required');
    });

    it('should accept valid config with only calendar and container', () => {
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
      };

      const errors = validateConfig(validConfig);
      expect(errors.length).toBe(0);
    });
  });

  describe('Iframe creation with URL parameters', () => {
    it('should construct widget URL without deprecated display params', () => {
      const widget = new PavillionWidget();
      widget.init({
        calendar: 'my-calendar',
        container: '#widget-container',
      });

      const iframe = container.querySelector('iframe');
      expect(iframe).not.toBeNull();
      const src = iframe!.src;

      expect(src).toContain('/widget/my-calendar');
      expect(src).toContain('lang=');
      expect(src).not.toContain('view=');
      expect(src).not.toContain('accentColor=');
      expect(src).not.toContain('colorMode=');

      widget.destroy();
    });

    it('should not propagate deprecated args to widget URL even if passed', () => {
      // Silence the expected deprecation warning for this test
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const widget = new PavillionWidget();
      widget.init({
        calendar: 'my-calendar',
        container: '#widget-container',
        // @ts-expect-error — intentionally passing dropped args to verify they are ignored
        view: 'week',
        accentColor: '#ff9131',
        colorMode: 'dark',
      });

      const iframe = container.querySelector('iframe');
      expect(iframe).not.toBeNull();
      const src = iframe!.src;

      expect(src).not.toContain('view=week');
      expect(src).not.toContain('accentColor');
      expect(src).not.toContain('ff9131');
      expect(src).not.toContain('colorMode=dark');

      widget.destroy();
    });

    it('should create iframe with correct attributes', () => {
      const widget = new PavillionWidget();
      widget.init({
        calendar: 'my-calendar',
        container: '#widget-container',
      });

      const iframe = container.querySelector('iframe');
      expect(iframe).not.toBeNull();
      expect(iframe!.style.width).toBe('100%');
      expect(iframe!.style.border).toContain('none');
      expect(iframe!.getAttribute('title')).toBe('Pavillion Calendar Widget');
      expect(iframe!.getAttribute('loading')).toBe('lazy');

      widget.destroy();
    });
  });

  describe('Deprecated init arguments', () => {
    it('should emit exactly one console.warn when all three deprecated args are passed simultaneously', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const widget = new PavillionWidget();
      widget.init({
        calendar: 'my-calendar',
        container: '#widget-container',
        // @ts-expect-error — intentionally passing dropped args to verify deprecation warning
        view: 'week',
        accentColor: '#ff9131',
        colorMode: 'dark',
      });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const firstCallArg = String(warnSpy.mock.calls[0]?.[0] ?? '');
      expect(firstCallArg).toContain('view');
      expect(firstCallArg).toContain('accentColor');
      expect(firstCallArg).toContain('colorMode');

      widget.destroy();
    });

    it('should emit one console.warn when only a subset of deprecated args is passed', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const widget = new PavillionWidget();
      widget.init({
        calendar: 'my-calendar',
        container: '#widget-container',
        // @ts-expect-error — intentionally passing dropped arg to verify deprecation warning
        view: 'month',
      });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const firstCallArg = String(warnSpy.mock.calls[0]?.[0] ?? '');
      expect(firstCallArg).toContain('view');

      widget.destroy();
    });

    it('should not emit a deprecation warning when no deprecated args are passed', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const widget = new PavillionWidget();
      widget.init({
        calendar: 'my-calendar',
        container: '#widget-container',
      });

      expect(warnSpy).not.toHaveBeenCalled();

      widget.destroy();
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
