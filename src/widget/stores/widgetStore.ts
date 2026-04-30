import { defineStore } from 'pinia';
import { DateTime } from 'luxon';
import {
  WIDGET_CONFIG_DEFAULTS,
  isValidWidgetView,
  isValidWidgetColorMode,
  isValidWidgetAccentColor,
  type WidgetView,
  type WidgetColorMode,
} from '@/common/model/widget_config';

export type ViewMode = WidgetView;
export type ColorMode = WidgetColorMode;

export interface WidgetState {
  // Configuration
  viewMode: ViewMode;
  accentColor: string;
  colorMode: ColorMode;
  calendarUrlName: string | null;

  // View state persistence
  currentWeekStart: string | null; // ISO date string
  currentMonthStart: string | null; // ISO date string
}

// Module-scope singletons for the auto-mode matchMedia listener.
// Stored at module scope (not as Pinia state) so we never re-bind on top of
// an existing listener; explicit teardown before each re-evaluation prevents
// stacked listeners across `auto → light → auto` toggles.
let mediaQueryList: MediaQueryList | null = null;
let mediaQueryListener: ((e: MediaQueryListEvent) => void) | null = null;

export const useWidgetStore = defineStore('widget', {
  state: (): WidgetState => ({
    viewMode: WIDGET_CONFIG_DEFAULTS.view,
    accentColor: WIDGET_CONFIG_DEFAULTS.accentColor,
    colorMode: WIDGET_CONFIG_DEFAULTS.colorMode,
    calendarUrlName: null,
    currentWeekStart: null,
    currentMonthStart: null,
  }),

  actions: {
    /**
     * Apply widget configuration received from the server API response
     * (`GET /api/widget/v1/calendars/:urlName` — `widgetConfig` property).
     *
     * This is the authoritative source of widget display configuration.
     * Each field is re-validated at read time as defense-in-depth against
     * corrupt or future-unknown enum values; invalid fields fall back to
     * the default and emit a single console.warn per invalid field.
     *
     * @param widgetConfig - Plain object with view, accentColor, colorMode keys
     */
    applyServerConfig(widgetConfig: Record<string, unknown> | null | undefined) {
      if (!widgetConfig || typeof widgetConfig !== 'object') {
        this.viewMode = WIDGET_CONFIG_DEFAULTS.view;
        this.accentColor = WIDGET_CONFIG_DEFAULTS.accentColor;
        this.colorMode = WIDGET_CONFIG_DEFAULTS.colorMode;
        return;
      }

      // view
      if (isValidWidgetView(widgetConfig.view)) {
        this.viewMode = widgetConfig.view;
      }
      else {
        if (widgetConfig.view !== undefined) {
          console.warn(
            `[widgetStore] Invalid 'view' received from server: ${String(widgetConfig.view)}. Falling back to default.`,
          );
        }
        this.viewMode = WIDGET_CONFIG_DEFAULTS.view;
      }

      // accentColor
      if (isValidWidgetAccentColor(widgetConfig.accentColor)) {
        this.accentColor = widgetConfig.accentColor;
      }
      else {
        if (widgetConfig.accentColor !== undefined) {
          console.warn(
            `[widgetStore] Invalid 'accentColor' received from server: ${String(widgetConfig.accentColor)}. Falling back to default.`,
          );
        }
        this.accentColor = WIDGET_CONFIG_DEFAULTS.accentColor;
      }

      // colorMode
      if (isValidWidgetColorMode(widgetConfig.colorMode)) {
        this.colorMode = widgetConfig.colorMode;
      }
      else {
        if (widgetConfig.colorMode !== undefined) {
          console.warn(
            `[widgetStore] Invalid 'colorMode' received from server: ${String(widgetConfig.colorMode)}. Falling back to default.`,
          );
        }
        this.colorMode = WIDGET_CONFIG_DEFAULTS.colorMode;
      }
    },

    /**
     * Parse configuration from URL parameters.
     *
     * NOTE: This URL-param override path is RETAINED SOLELY TO SUPPORT THE
     * ADMIN PREVIEW IFRAME (so unsaved changes in the admin UI can be
     * reflected in the embedded preview without a round-trip to the server).
     * It is NOT part of the public SDK contract — the SDK does not emit
     * these query-string arguments. Any embedder who appends these params
     * to the public iframe URL gets a bounded, local-only override
     * (cosmetic change on their own page only; does not affect stored
     * config or other embeds). This risk is accepted per the spec
     * (2026-04-14-server-side-widget-config-design.md — "Accepted risk").
     *
     * Values are validated with the common model helpers; invalid values
     * are silently ignored (no warn — these arrive from untrusted callers).
     *
     * Should be invoked AFTER `applyServerConfig()` so URL params override
     * the authoritative server values.
     *
     * @param urlParams - URLSearchParams object containing widget configuration
     */
    parseConfig(urlParams: URLSearchParams) {
      // Parse view mode
      const view = urlParams.get('view');
      if (view !== null && isValidWidgetView(view)) {
        this.viewMode = view;
      }

      // Parse accent color (URL decoded by URLSearchParams)
      const accentColor = urlParams.get('accentColor');
      if (accentColor !== null && isValidWidgetAccentColor(accentColor)) {
        this.accentColor = accentColor;
      }

      // Parse color mode
      const colorMode = urlParams.get('colorMode');
      if (colorMode !== null && isValidWidgetColorMode(colorMode)) {
        this.colorMode = colorMode;
      }
    },

    /**
     * Set the current calendar URL name
     *
     * @param urlName - Calendar URL name
     */
    setCalendarUrlName(urlName: string) {
      this.calendarUrlName = urlName;
    },

    /**
     * Inject accent color as CSS custom properties on root element.
     *
     * Writes `--pav-accent-light` and `--pav-accent-dark` from the user-chosen
     * value. Hover variants (`--pav-accent-light-hover` / `--pav-accent-dark-hover`)
     * are intentionally NOT written here — they remain at the SCSS-compiled
     * defaults emitted by the `public-accent-tokens` mixin on the root.
     *
     * SECURITY: The accent color MUST reach the DOM only via
     * `element.style.setProperty(...)`. Never interpolate the value into a
     * raw `<style>` block, `innerHTML`, or string-concatenated stylesheet —
     * those paths enable CSS/HTML injection. Combined with the strict hex
     * regex validation in `isValidWidgetAccentColor` and the re-validation in
     * `applyServerConfig()`/`parseConfig()`, this closes the injection vector.
     *
     * @param rootElement - DOM element to inject CSS properties on
     */
    injectAccentColor(rootElement: HTMLElement) {
      if (this.accentColor) {
        rootElement.style.setProperty('--pav-accent-light', this.accentColor);
        rootElement.style.setProperty('--pav-accent-dark', this.accentColor);
      }
    },

    /**
     * Apply color mode class to root element.
     *
     * Resolves `auto` to `light` or `dark` via
     * `window.matchMedia('(prefers-color-scheme: dark)')` so widget content
     * always carries exactly one explicit theme class. This lets the
     * `public-light-mode-override` mixin win over the dark-mode media query
     * branch via specificity when the user picks "Light" on a dark-OS system.
     *
     * For `auto` mode, registers a single `change` listener on the
     * MediaQueryList. The listener is stored at module scope and torn down
     * unconditionally on every invocation, preventing stacked listeners
     * across `auto → light → auto` toggles.
     *
     * @param rootElement - DOM element to apply class to
     */
    applyColorMode(rootElement: HTMLElement) {
      // Always tear down any prior listener before re-evaluating.
      if (mediaQueryList && mediaQueryListener) {
        mediaQueryList.removeEventListener('change', mediaQueryListener);
        mediaQueryList = null;
        mediaQueryListener = null;
      }

      // Always remove both theme classes, then add exactly one.
      rootElement.classList.remove('widget-theme-light', 'widget-theme-dark');

      const resolved = this.colorMode === 'auto'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : this.colorMode;
      rootElement.classList.add(resolved === 'dark' ? 'widget-theme-dark' : 'widget-theme-light');

      // For auto mode, listen for OS theme changes and re-apply.
      if (this.colorMode === 'auto') {
        mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)');
        mediaQueryListener = () => this.applyColorMode(rootElement);
        mediaQueryList.addEventListener('change', mediaQueryListener);
      }
    },

    /**
     * Send resize notification to parent window via postMessage
     *
     * @param height - New height of widget content in pixels
     */
    notifyResize(height: number) {
      if (window.parent !== window) {
        // Target origin is '*' because these messages contain no sensitive data —
        // only layout hints (height) and navigation paths. If this widget ever sends
        // messages containing user-specific or authenticated data, replace '*' with
        // the specific parent origin.
        window.parent.postMessage({
          type: 'pavillion:resize',
          height,
        }, '*');
      }
    },

    /**
     * Send navigation notification to parent window via postMessage
     *
     * @param path - New path within widget
     */
    notifyNavigation(path: string) {
      if (window.parent !== window) {
        // Target origin is '*' because these messages contain no sensitive data —
        // only layout hints (height) and navigation paths. If this widget ever sends
        // messages containing user-specific or authenticated data, replace '*' with
        // the specific parent origin.
        window.parent.postMessage({
          type: 'pavillion:navigate',
          path,
        }, '*');
      }
    },

    /**
     * Get or initialize the current week start date
     *
     * @returns DateTime object for the start of the current week
     */
    getCurrentWeekStart(): DateTime {
      if (this.currentWeekStart) {
        return DateTime.fromISO(this.currentWeekStart);
      }
      // Initialize to current week
      const now = DateTime.now().startOf('week');
      this.currentWeekStart = now.toISODate();
      return now;
    },

    /**
     * Set the current week start date
     *
     * @param date - DateTime object for the start of the week
     */
    setCurrentWeekStart(date: DateTime) {
      this.currentWeekStart = date.toISODate();
    },

    /**
     * Get or initialize the current month start date
     *
     * @returns DateTime object for the start of the current month
     */
    getCurrentMonthStart(): DateTime {
      if (this.currentMonthStart) {
        return DateTime.fromISO(this.currentMonthStart);
      }
      // Initialize to current month
      const now = DateTime.now().startOf('month');
      this.currentMonthStart = now.toISODate();
      return now;
    },

    /**
     * Set the current month start date
     *
     * @param date - DateTime object for the start of the month
     */
    setCurrentMonthStart(date: DateTime) {
      this.currentMonthStart = date.toISODate();
    },
  },
});
