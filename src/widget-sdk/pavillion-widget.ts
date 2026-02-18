/**
 * Pavillion Widget SDK
 *
 * Embeddable calendar widget using hybrid SDK + iframe architecture.
 * Implements async loading pattern with command queue.
 *
 * Usage:
 * <script async src="https://calendar.example.com/widget/pavillion-widget.js" data-lang="es"></script>
 * <script>
 *   window.Pavillion = window.Pavillion || { q: [] };
 *   Pavillion('init', {
 *     calendar: 'my-calendar',
 *     container: '#calendar-widget',
 *     view: 'week',
 *     accentColor: '#ff9131',
 *     colorMode: 'auto'
 *   });
 * </script>
 */

import { isValidLanguageCode } from '@/common/i18n/languages';

interface WidgetConfig {
  calendar: string;
  container: string;
  view?: 'week' | 'month' | 'list';
  accentColor?: string;
  colorMode?: 'auto' | 'light' | 'dark';
  lang?: string;
  onResize?: (height: number) => void;
  onEventClick?: (eventId: string) => void;
  onNavigate?: (url: string) => void;
}

interface PavillionMessage {
  type: 'pavillion:resize' | 'pavillion:navigate' | 'pavillion:eventClick';
  height?: number;
  url?: string;
  eventId?: string;
}

class PavillionWidget {
  private config: WidgetConfig | null = null;
  private iframe: HTMLIFrameElement | null = null;
  private container: HTMLElement | null = null;
  private widgetOrigin: string;

  constructor() {
    // Determine widget origin from script tag by finding our widget script
    // This works even with async loading, unlike relying on script order
    const scripts = Array.from(document.getElementsByTagName('script'));
    const widgetScript = scripts.find(s => s.src.includes('pavillion-widget.js'));
    const scriptSrc = widgetScript?.src || '';

    if (scriptSrc) {
      try {
        const url = new URL(scriptSrc, window.location.href);
        this.widgetOrigin = url.origin;
      }
      catch (e) {
        // Fallback to current origin if script src cannot be parsed
        this.widgetOrigin = window.location.origin;
      }
    }
    else {
      this.widgetOrigin = window.location.origin;
    }

    // Listen for postMessage from widget iframe
    window.addEventListener('message', this.handleMessage.bind(this));
  }

  /**
   * Initialize widget with configuration
   */
  init(config: WidgetConfig): void {
    // Validate configuration
    const errors = this.validateConfig(config);
    if (errors.length > 0) {
      console.error('[Pavillion Widget] Configuration errors:', errors);
      return;
    }

    this.config = {
      view: 'list',
      colorMode: 'auto',
      ...config,
    };

    // Find container element
    this.container = document.querySelector(this.config.container);
    if (!this.container) {
      console.error(`[Pavillion Widget] Container not found: ${this.config.container}`);
      return;
    }

    // Create and mount iframe
    this.createIframe();
  }

  /**
   * Validate widget configuration
   */
  private validateConfig(config: WidgetConfig): string[] {
    const errors: string[] = [];

    if (!config.calendar) {
      errors.push('calendar is required');
    }
    if (!config.container) {
      errors.push('container is required');
    }
    if (config.view && !['week', 'month', 'list'].includes(config.view)) {
      errors.push('view must be "week", "month", or "list"');
    }
    if (config.colorMode && !['auto', 'light', 'dark'].includes(config.colorMode)) {
      errors.push('colorMode must be "auto", "light", or "dark"');
    }

    return errors;
  }

  /**
   * Build widget URL with parameters
   */
  private buildWidgetUrl(): string {
    if (!this.config) {
      return '';
    }

    const url = new URL(`/widget/${this.config.calendar}`, this.widgetOrigin);

    if (this.config.view) {
      url.searchParams.set('view', this.config.view);
    }
    if (this.config.accentColor) {
      url.searchParams.set('accentColor', this.config.accentColor);
    }
    if (this.config.colorMode) {
      url.searchParams.set('colorMode', this.config.colorMode);
    }

    // Detect and set widget language
    const lang = detectWidgetLanguage(this.config.lang);
    url.searchParams.set('lang', lang);

    return url.toString();
  }

  /**
   * Create iframe element and append to container
   */
  private createIframe(): void {
    if (!this.container || !this.config) {
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.src = this.buildWidgetUrl();
    iframe.style.width = '100%';
    iframe.style.border = 'none';
    iframe.style.display = 'block';
    iframe.style.overflow = 'hidden';
    iframe.setAttribute('title', 'Pavillion Calendar Widget');
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('scrolling', 'no');

    // Set initial height (will be adjusted by resize messages)
    iframe.style.height = '600px';

    this.container.appendChild(iframe);
    this.iframe = iframe;
  }

  /**
   * Handle postMessage from widget iframe
   */
  private handleMessage(event: MessageEvent<PavillionMessage>): void {
    // Validate origin
    if (event.origin !== this.widgetOrigin) {
      return;
    }

    const message = event.data;

    // Handle resize message
    if (message.type === 'pavillion:resize' && message.height !== undefined) {
      this.handleResize(message.height);
    }

    // Handle navigation message
    if (message.type === 'pavillion:navigate' && message.url) {
      this.handleNavigate(message.url);
    }

    // Handle event click message
    if (message.type === 'pavillion:eventClick' && message.eventId) {
      this.handleEventClick(message.eventId);
    }
  }

  /**
   * Handle resize event from widget
   */
  private handleResize(height: number): void {
    if (this.iframe) {
      this.iframe.style.height = `${height}px`;
    }

    if (this.config?.onResize) {
      this.config.onResize(height);
    }
  }

  /**
   * Handle navigation event from widget
   */
  private handleNavigate(url: string): void {
    if (this.config?.onNavigate) {
      this.config.onNavigate(url);
    }
  }

  /**
   * Handle event click from widget
   */
  private handleEventClick(eventId: string): void {
    if (this.config?.onEventClick) {
      this.config.onEventClick(eventId);
    }
  }

  /**
   * Destroy widget and clean up
   */
  destroy(): void {
    if (this.iframe && this.iframe.parentNode) {
      this.iframe.parentNode.removeChild(this.iframe);
    }
    this.iframe = null;
    this.container = null;
    this.config = null;
  }
}

// Initialize SDK
(function() {
  // Create widget instance
  const widget = new PavillionWidget();

  // Process any queued commands
  const existingQueue = ((window as any).Pavillion as any)?.q || [];

  // Create command processor function
  const Pavillion = function(command: string, ...args: any[]): void {
    if (command === 'init' && args[0]) {
      widget.init(args[0] as WidgetConfig);
    }
    else if (command === 'destroy') {
      widget.destroy();
    }
    else {
      console.warn(`[Pavillion Widget] Unknown command: ${command}`);
    }
  };

  // Attach to window
  (window as any).Pavillion = Pavillion;

  // Process queued commands
  existingQueue.forEach((args: any[]) => {
    if (args.length > 0) {
      Pavillion(args[0], ...args.slice(1));
    }
  });
})();

/**
 * Detects the appropriate display language for the widget.
 *
 * Priority order:
 * 1. `data-lang` attribute on the widget's own script tag
 * 2. The base language from the page's `<html lang>` attribute
 * 3. The `configLang` parameter (instance default)
 * 4. English ('en') as the ultimate fallback
 *
 * Each value is validated against supported language codes before use.
 *
 * @param configLang - Optional instance-configured default language code
 * @returns A supported language code string
 */
export function detectWidgetLanguage(configLang?: string): string {
  // Check data-lang on the widget script tag
  const scripts = Array.from(document.getElementsByTagName('script'));
  const widgetScript = scripts.find(s => s.src.includes('pavillion-widget.js'));
  if (widgetScript) {
    const dataLang = widgetScript.getAttribute('data-lang');
    if (dataLang && isValidLanguageCode(dataLang)) {
      return dataLang;
    }
  }

  // Check <html lang> attribute, using only the base language code
  const htmlLang = document.documentElement.lang;
  if (htmlLang) {
    const baseLang = htmlLang.split('-')[0];
    if (baseLang && isValidLanguageCode(baseLang)) {
      return baseLang;
    }
  }

  // Fall back to instance-configured language
  if (configLang && isValidLanguageCode(configLang)) {
    return configLang;
  }

  return 'en';
}

// Export for TypeScript consumers
export type { WidgetConfig, PavillionMessage };
export { PavillionWidget };
