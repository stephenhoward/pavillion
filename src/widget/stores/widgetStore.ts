import { defineStore } from 'pinia';
import { DateTime } from 'luxon';
import type { LocationQuery } from 'vue-router';
import { type CalendarViewMode, isCalendarViewMode } from '@/common/model/calendar_view';
import {
  WIDGET_CONFIG_DEFAULTS,
  isValidWidgetColorMode,
  isValidWidgetAccentColor,
  type WidgetColorMode,
} from '@/common/model/widget_config';
import { VIEW_QUERY_KEY } from '@/common/routing/calendar-view-query';

export type ColorMode = WidgetColorMode;

export interface WidgetState {
  // Configuration
  viewMode: CalendarViewMode;
  accentColor: string;
  colorMode: ColorMode;
  calendarUrlName: string | null;
  // Calendar whose server config has been applied; the router guard skips
  // the fetch while navigation stays within this calendar.
  configLoadedForUrlName: string | null;
  // Query (filters, date range, lang) of the calendar list the visitor last
  // left for event detail; the detail's Back button restores it when it
  // cannot simply step back to the list's own history entry.
  lastListQuery: LocationQuery | null;

  // View state persistence
  currentWeekStart: string | null; // ISO date string
  currentMonthStart: string | null; // ISO date string
}

export const useWidgetStore = defineStore('widget', {
  state: (): WidgetState => ({
    viewMode: WIDGET_CONFIG_DEFAULTS.view,
    accentColor: WIDGET_CONFIG_DEFAULTS.accentColor,
    colorMode: WIDGET_CONFIG_DEFAULTS.colorMode,
    calendarUrlName: null,
    configLoadedForUrlName: null,
    lastListQuery: null,
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
      if (isCalendarViewMode(widgetConfig.view)) {
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
      const view = urlParams.get(VIEW_QUERY_KEY);
      if (view !== null && isCalendarViewMode(view)) {
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
     * Record that server config has been applied for a calendar, so the
     * router guard does not re-fetch it on every in-calendar navigation.
     *
     * @param urlName - Calendar URL name whose config is now in the store
     */
    setConfigLoadedForUrlName(urlName: string) {
      this.configLoadedForUrlName = urlName;
    },

    /**
     * Record the calendar list's query at the moment the visitor leaves the
     * list for event detail.
     *
     * @param query - The list route's query (filters, date range, lang)
     */
    setLastListQuery(query: LocationQuery) {
      this.lastListQuery = { ...query };
    },

    /**
     * Inject accent color as CSS custom properties on root element.
     *
     * Writes `--pav-accent-light` and `--pav-accent-dark` from the user-chosen
     * value, and derives `--pav-accent-light-hover` / `--pav-accent-dark-hover`
     * from it: 10% towards black for the light theme and 10% towards white for
     * the dark theme, the same direction the compiled defaults take
     * (`$public-accent-hover-*` shift lightness by 5% each way). Left unwritten,
     * the hover variants would stay at those compiled defaults, so a hovered
     * button or link would snap to the default orange.
     *
     * SECURITY: The accent color MUST reach the DOM only via
     * `element.style.setProperty(...)`. Never interpolate the value into a
     * raw `<style>` block, `innerHTML`, or string-concatenated stylesheet —
     * those paths enable CSS/HTML injection. `accentColor` has three writers,
     * each of which validates with the strict hex regex in
     * `isValidWidgetAccentColor`: `applyServerConfig()`, `parseConfig()`, and
     * the same-origin postMessage handler in `widget-container.vue`. This
     * method validates again at the sink, falling back to the default, so a
     * future writer that skips validation still cannot reach the DOM or the
     * interpolated `color-mix(...)` hover strings.
     *
     * @param rootElement - DOM element to inject CSS properties on
     */
    injectAccentColor(rootElement: HTMLElement) {
      const accent = isValidWidgetAccentColor(this.accentColor)
        ? this.accentColor
        : WIDGET_CONFIG_DEFAULTS.accentColor;

      rootElement.style.setProperty('--pav-accent-light', accent);
      rootElement.style.setProperty('--pav-accent-dark', accent);
      rootElement.style.setProperty('--pav-accent-light-hover', `color-mix(in srgb, ${accent} 90%, black)`);
      rootElement.style.setProperty('--pav-accent-dark-hover', `color-mix(in srgb, ${accent} 90%, white)`);
    },

    /**
     * Apply the color mode as `data-theme` on the widget document's root.
     *
     * `light` and `dark` set `<html data-theme="…">`, which the self-guarding
     * `public-dark-mode` mixin reads: `[data-theme="dark"]` forces the dark
     * branch, and `[data-theme="light"]` suppresses its OS media-query branch.
     * `auto` removes the attribute so that media query follows the visitor's
     * OS preference live, with no JavaScript listener involved.
     *
     * The widget is a same-origin iframe with its own document, so this never
     * reads or writes the host page's `<html>`.
     */
    applyColorMode() {
      const root = document.documentElement;
      if (this.colorMode === 'auto') {
        delete root.dataset.theme;
      }
      else {
        root.dataset.theme = this.colorMode;
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
