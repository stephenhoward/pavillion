import { Model } from '@/common/model/model';

/**
 * Allowed values for the widget `view` field.
 */
export type WidgetView = 'list' | 'week' | 'month';

/**
 * Allowed values for the widget `colorMode` field.
 */
export type WidgetColorMode = 'auto' | 'light' | 'dark';

/**
 * Allowed view values (readonly, enumerated for validation + UI).
 */
export const WIDGET_CONFIG_ALLOWED_VIEWS: readonly WidgetView[] = ['list', 'week', 'month'];

/**
 * Allowed color mode values (readonly, enumerated for validation + UI).
 */
export const WIDGET_CONFIG_ALLOWED_COLOR_MODES: readonly WidgetColorMode[] = ['auto', 'light', 'dark'];

/**
 * Strict 6-digit hex color regex. No shorthand (#fff), no alpha (#rrggbbaa).
 */
const WIDGET_ACCENT_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Default widget configuration values.
 * Used when no stored config exists and as fallbacks for missing/invalid fields.
 */
export const WIDGET_CONFIG_DEFAULTS: {
  view: WidgetView;
  accentColor: string;
  colorMode: WidgetColorMode;
} = {
  view: 'list',
  accentColor: '#ff9131',
  colorMode: 'auto',
};

/**
 * Checks whether a value is an allowed widget view.
 *
 * @param value - The value to check
 * @returns True if the value is one of 'list', 'week', or 'month'
 */
export function isValidWidgetView(value: unknown): value is WidgetView {
  return typeof value === 'string'
    && (WIDGET_CONFIG_ALLOWED_VIEWS as readonly string[]).includes(value);
}

/**
 * Checks whether a value is an allowed widget color mode.
 *
 * @param value - The value to check
 * @returns True if the value is one of 'auto', 'light', or 'dark'
 */
export function isValidWidgetColorMode(value: unknown): value is WidgetColorMode {
  return typeof value === 'string'
    && (WIDGET_CONFIG_ALLOWED_COLOR_MODES as readonly string[]).includes(value);
}

/**
 * Checks whether a value is a valid widget accent color.
 * Requires a strict 6-digit hex string with a leading '#'.
 * Rejects shorthand (#fff) and alpha channel (#rrggbbaa) formats.
 *
 * @param value - The value to check
 * @returns True if the value matches /^#[0-9a-fA-F]{6}$/
 */
export function isValidWidgetAccentColor(value: unknown): value is string {
  return typeof value === 'string' && WIDGET_ACCENT_COLOR_REGEX.test(value);
}

/**
 * Plain domain model for per-calendar widget display configuration.
 *
 * Stores three presentation-layer settings that used to live in embed-snippet
 * query-string arguments: the default view mode, the accent color used by the
 * widget, and the color-mode (auto/light/dark) preference.
 *
 * Usable from both frontend (admin UI, widget app) and backend (service layer).
 */
export class WidgetConfig extends Model {
  view: WidgetView;
  accentColor: string;
  colorMode: WidgetColorMode;

  /**
   * Constructor for WidgetConfig.
   *
   * @param view - The default view mode for the widget
   * @param accentColor - The accent color in 6-digit hex format
   * @param colorMode - The color mode preference
   */
  constructor(
    view: WidgetView = WIDGET_CONFIG_DEFAULTS.view,
    accentColor: string = WIDGET_CONFIG_DEFAULTS.accentColor,
    colorMode: WidgetColorMode = WIDGET_CONFIG_DEFAULTS.colorMode,
  ) {
    super();
    this.view = view;
    this.accentColor = accentColor;
    this.colorMode = colorMode;
  }

  /**
   * Convert to plain object for serialization.
   * Returns camelCase keys matching the API request/response shape.
   *
   * @returns Plain object with view, accentColor, and colorMode
   */
  toObject(): Record<string, any> {
    return {
      view: this.view,
      accentColor: this.accentColor,
      colorMode: this.colorMode,
    };
  }

  /**
   * Create a WidgetConfig from a plain object.
   * Applies default values for any missing fields.
   *
   * @param obj - Plain object, potentially containing view, accentColor, colorMode
   * @returns A new WidgetConfig instance
   */
  static fromObject(obj: Record<string, any>): WidgetConfig {
    return new WidgetConfig(
      obj.view ?? WIDGET_CONFIG_DEFAULTS.view,
      obj.accentColor ?? WIDGET_CONFIG_DEFAULTS.accentColor,
      obj.colorMode ?? WIDGET_CONFIG_DEFAULTS.colorMode,
    );
  }

}
