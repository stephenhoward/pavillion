import { defineStore } from 'pinia';
import { DateTime } from 'luxon';

export type ViewMode = 'week' | 'month' | 'list';
export type ColorMode = 'auto' | 'light' | 'dark';

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

export const useWidgetStore = defineStore('widget', {
  state: (): WidgetState => ({
    viewMode: 'list',
    accentColor: '',
    colorMode: 'auto',
    calendarUrlName: null,
    currentWeekStart: null,
    currentMonthStart: null,
  }),

  actions: {
    /**
     * Parse configuration from URL parameters
     *
     * @param urlParams - URLSearchParams object containing widget configuration
     */
    parseConfig(urlParams: URLSearchParams) {
      // Parse view mode
      const view = urlParams.get('view');
      if (view === 'week' || view === 'month' || view === 'list') {
        this.viewMode = view;
      }

      // Parse accent color (URL decoded)
      const accentColor = urlParams.get('accentColor');
      if (accentColor) {
        this.accentColor = decodeURIComponent(accentColor);
      }

      // Parse color mode
      const colorMode = urlParams.get('colorMode');
      if (colorMode === 'auto' || colorMode === 'light' || colorMode === 'dark') {
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
     * Inject accent color as CSS custom property on root element
     *
     * @param rootElement - DOM element to inject CSS property on
     */
    injectAccentColor(rootElement: HTMLElement) {
      if (this.accentColor) {
        rootElement.style.setProperty('--widget-accent-color', this.accentColor);
      }
    },

    /**
     * Apply color mode class to root element
     *
     * @param rootElement - DOM element to apply class to
     */
    applyColorMode(rootElement: HTMLElement) {
      // Remove existing theme classes
      rootElement.classList.remove('widget-theme-light', 'widget-theme-dark');

      // Apply theme class based on color mode (auto uses prefers-color-scheme)
      if (this.colorMode === 'light') {
        rootElement.classList.add('widget-theme-light');
      }
      else if (this.colorMode === 'dark') {
        rootElement.classList.add('widget-theme-dark');
      }
      // For 'auto', no class is added - CSS will use prefers-color-scheme
    },

    /**
     * Send resize notification to parent window via postMessage
     *
     * @param height - New height of widget content in pixels
     */
    notifyResize(height: number) {
      if (window.parent !== window) {
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
