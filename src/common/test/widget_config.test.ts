import { describe, it, expect } from 'vitest';
import {
  WidgetConfig,
  WIDGET_CONFIG_DEFAULTS,
  WIDGET_CONFIG_ALLOWED_VIEWS,
  WIDGET_CONFIG_ALLOWED_COLOR_MODES,
  isValidWidgetView,
  isValidWidgetColorMode,
  isValidWidgetAccentColor,
} from '@/common/model/widget_config';

describe('WidgetConfig', () => {
  describe('defaults', () => {
    it('exposes default values for view, accentColor, and colorMode', () => {
      expect(WIDGET_CONFIG_DEFAULTS.view).toBe('list');
      expect(WIDGET_CONFIG_DEFAULTS.accentColor).toBe('#ff9131');
      expect(WIDGET_CONFIG_DEFAULTS.colorMode).toBe('auto');
    });

    it('constructs with default values when no args are provided', () => {
      const config = new WidgetConfig();

      expect(config.view).toBe('list');
      expect(config.accentColor).toBe('#ff9131');
      expect(config.colorMode).toBe('auto');
    });

    it('enumerates allowed view values', () => {
      expect(WIDGET_CONFIG_ALLOWED_VIEWS).toEqual(['list', 'week', 'month']);
    });

    it('enumerates allowed color mode values', () => {
      expect(WIDGET_CONFIG_ALLOWED_COLOR_MODES).toEqual(['auto', 'light', 'dark']);
    });
  });

  describe('constructor', () => {
    it('accepts all three fields', () => {
      const config = new WidgetConfig('week', '#123abc', 'dark');

      expect(config.view).toBe('week');
      expect(config.accentColor).toBe('#123abc');
      expect(config.colorMode).toBe('dark');
    });
  });

  describe('toObject()', () => {
    it('returns camelCase keys with current values', () => {
      const config = new WidgetConfig('month', '#AABBCC', 'light');

      expect(config.toObject()).toEqual({
        view: 'month',
        accentColor: '#AABBCC',
        colorMode: 'light',
      });
    });

    it('returns defaults when constructed with no args', () => {
      const config = new WidgetConfig();

      expect(config.toObject()).toEqual({
        view: 'list',
        accentColor: '#ff9131',
        colorMode: 'auto',
      });
    });
  });

  describe('fromObject()', () => {
    it('deserializes a complete object', () => {
      const config = WidgetConfig.fromObject({
        view: 'week',
        accentColor: '#112233',
        colorMode: 'dark',
      });

      expect(config.view).toBe('week');
      expect(config.accentColor).toBe('#112233');
      expect(config.colorMode).toBe('dark');
    });

    it('applies defaults for missing fields', () => {
      const config = WidgetConfig.fromObject({});

      expect(config.view).toBe('list');
      expect(config.accentColor).toBe('#ff9131');
      expect(config.colorMode).toBe('auto');
    });

    it('round-trips through toObject/fromObject', () => {
      const original = new WidgetConfig('month', '#deadbe', 'light');
      const roundTripped = WidgetConfig.fromObject(original.toObject());

      expect(roundTripped.toObject()).toEqual(original.toObject());
    });
  });

  describe('isValidWidgetView', () => {
    it('accepts allowed values', () => {
      expect(isValidWidgetView('list')).toBe(true);
      expect(isValidWidgetView('week')).toBe(true);
      expect(isValidWidgetView('month')).toBe(true);
    });

    it('rejects values outside the allowed set', () => {
      expect(isValidWidgetView('day')).toBe(false);
      expect(isValidWidgetView('')).toBe(false);
      expect(isValidWidgetView('LIST')).toBe(false);
      expect(isValidWidgetView('grid')).toBe(false);
    });

    it('rejects non-string values', () => {
      expect(isValidWidgetView(undefined)).toBe(false);
      expect(isValidWidgetView(null)).toBe(false);
      expect(isValidWidgetView(42)).toBe(false);
    });
  });

  describe('isValidWidgetColorMode', () => {
    it('accepts allowed values', () => {
      expect(isValidWidgetColorMode('auto')).toBe(true);
      expect(isValidWidgetColorMode('light')).toBe(true);
      expect(isValidWidgetColorMode('dark')).toBe(true);
    });

    it('rejects values outside the allowed set', () => {
      expect(isValidWidgetColorMode('system')).toBe(false);
      expect(isValidWidgetColorMode('')).toBe(false);
      expect(isValidWidgetColorMode('AUTO')).toBe(false);
    });

    it('rejects non-string values', () => {
      expect(isValidWidgetColorMode(undefined)).toBe(false);
      expect(isValidWidgetColorMode(null)).toBe(false);
      expect(isValidWidgetColorMode(0)).toBe(false);
    });
  });

  describe('isValidWidgetAccentColor', () => {
    it('accepts strict 6-digit hex with lowercase letters', () => {
      expect(isValidWidgetAccentColor('#ff9131')).toBe(true);
      expect(isValidWidgetAccentColor('#abcdef')).toBe(true);
      expect(isValidWidgetAccentColor('#000000')).toBe(true);
      expect(isValidWidgetAccentColor('#ffffff')).toBe(true);
    });

    it('accepts strict 6-digit hex with uppercase letters', () => {
      expect(isValidWidgetAccentColor('#FF9131')).toBe(true);
      expect(isValidWidgetAccentColor('#ABCDEF')).toBe(true);
    });

    it('accepts mixed-case 6-digit hex', () => {
      expect(isValidWidgetAccentColor('#aAbBcC')).toBe(true);
    });

    it('rejects 3-digit shorthand hex', () => {
      expect(isValidWidgetAccentColor('#fff')).toBe(false);
      expect(isValidWidgetAccentColor('#f91')).toBe(false);
    });

    it('rejects 8-digit hex with alpha channel', () => {
      expect(isValidWidgetAccentColor('#ff9131ff')).toBe(false);
      expect(isValidWidgetAccentColor('#00000000')).toBe(false);
    });

    it('rejects hex without the leading #', () => {
      expect(isValidWidgetAccentColor('ff9131')).toBe(false);
      expect(isValidWidgetAccentColor('abcdef')).toBe(false);
    });

    it('rejects strings with invalid hex characters', () => {
      expect(isValidWidgetAccentColor('#gggggg')).toBe(false);
      expect(isValidWidgetAccentColor('#ff91zz')).toBe(false);
    });

    it('rejects named colors and non-hex formats', () => {
      expect(isValidWidgetAccentColor('red')).toBe(false);
      expect(isValidWidgetAccentColor('rgb(255, 145, 49)')).toBe(false);
      expect(isValidWidgetAccentColor('')).toBe(false);
    });

    it('rejects values with surrounding whitespace', () => {
      expect(isValidWidgetAccentColor(' #ff9131')).toBe(false);
      expect(isValidWidgetAccentColor('#ff9131 ')).toBe(false);
    });

    it('rejects non-string values', () => {
      expect(isValidWidgetAccentColor(undefined)).toBe(false);
      expect(isValidWidgetAccentColor(null)).toBe(false);
      expect(isValidWidgetAccentColor(0xff9131)).toBe(false);
    });
  });
});
