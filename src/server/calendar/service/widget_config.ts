import { v4 as uuidv4 } from 'uuid';
import pino from 'pino';

import { Account } from '@/common/model/account';
import {
  WidgetConfig,
  WIDGET_CONFIG_DEFAULTS,
  isValidWidgetView,
  isValidWidgetAccentColor,
  isValidWidgetColorMode,
  WidgetView,
  WidgetColorMode,
} from '@/common/model/widget_config';
import { ValidationError } from '@/common/exceptions/base';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';
import { CalendarEditorPermissionError } from '@/common/exceptions/editor';
import { CalendarWidgetConfigEntity } from '@/server/calendar/entity/calendar_widget_config';
import { createLogger } from '@/server/common/helper/logger';
import CalendarService from './calendar';

const logger = createLogger('calendar');

/**
 * Service for managing per-calendar widget display configuration.
 *
 * Stores the widget view mode, accent color, and color mode that were
 * previously passed as embed-snippet query-string arguments. Keeps the
 * persistence concern out of CalendarService to avoid that service
 * growing further.
 */
class WidgetConfigService {

  constructor(private calendarService?: CalendarService, private logOverride?: pino.Logger) {
    // calendarService is optional for backward compatibility.
    // logOverride is used by tests to spy on warning emissions.
  }

  /**
   * Get widget config for the public widget-serving path.
   * Looks up by calendar URL name (what the iframe knows). Returns a
   * fresh defaults WidgetConfig when no row exists — lazy creation means
   * we never materialize a row until the owner saves one.
   *
   * NO permission check: this path is used anonymously by the widget
   * iframe after origin validation has already happened at a higher layer.
   *
   * @param calendarUrlName - The calendar's URL name (as the iframe knows it)
   * @returns The stored WidgetConfig, or a fresh defaults WidgetConfig
   * @throws CalendarNotFoundError if no calendar matches the URL name
   */
  async getWidgetConfig(calendarUrlName: string): Promise<WidgetConfig> {
    const calendar = await this.getCalendarByName(calendarUrlName);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    const entity = await CalendarWidgetConfigEntity.findOne({
      where: { calendar_id: calendar.id },
    });

    if (!entity) {
      return new WidgetConfig();
    }

    return this.toSafeModel(entity, calendar.id);
  }

  /**
   * Editor-permission-checked widget config read for the admin UI.
   * Returns a fresh defaults WidgetConfig when no row exists so the admin
   * form has something to populate from.
   *
   * @param account - The requesting account
   * @param calendarId - The calendar UUID
   * @returns The stored WidgetConfig, or a fresh defaults WidgetConfig
   * @throws CalendarNotFoundError if the calendar does not exist
   * @throws CalendarEditorPermissionError if the account lacks edit access
   */
  async getWidgetConfigForEditor(account: Account, calendarId: string): Promise<WidgetConfig> {
    await this.assertEditorAccess(account, calendarId);

    const entity = await CalendarWidgetConfigEntity.findOne({
      where: { calendar_id: calendarId },
    });

    if (!entity) {
      return new WidgetConfig();
    }

    return this.toSafeModel(entity, calendarId);
  }

  /**
   * Upsert widget config for a calendar. Editor permission required.
   * Not subscription-gated — owners can edit draft config even on a free
   * instance; the subscription gate applies at the widget-serving boundary.
   *
   * Validates all three fields up front and throws ValidationError with a
   * `fields` map keyed by the camelCase request-body names
   * (view / accentColor / colorMode) — never the snake_case DB columns.
   *
   * @param account - The requesting account
   * @param calendarId - The calendar UUID
   * @param config - Partial WidgetConfig; missing fields fall back to defaults
   * @returns The persisted WidgetConfig
   * @throws CalendarNotFoundError if the calendar does not exist
   * @throws CalendarEditorPermissionError if the account lacks edit access
   * @throws ValidationError if any field is invalid
   */
  async setWidgetConfig(
    account: Account,
    calendarId: string,
    config: Partial<WidgetConfig>,
  ): Promise<WidgetConfig> {
    await this.assertEditorAccess(account, calendarId);

    const view = config.view ?? WIDGET_CONFIG_DEFAULTS.view;
    const accentColor = config.accentColor ?? WIDGET_CONFIG_DEFAULTS.accentColor;
    const colorMode = config.colorMode ?? WIDGET_CONFIG_DEFAULTS.colorMode;

    const fieldErrors: Record<string, string[]> = {};

    if (!isValidWidgetView(view)) {
      fieldErrors.view = ['Invalid widget view'];
    }
    if (!isValidWidgetAccentColor(accentColor)) {
      fieldErrors.accentColor = ['Invalid accent color'];
    }
    if (!isValidWidgetColorMode(colorMode)) {
      fieldErrors.colorMode = ['Invalid color mode'];
    }

    if (Object.keys(fieldErrors).length > 0) {
      throw new ValidationError('Invalid widget configuration', fieldErrors);
    }

    const validConfig = new WidgetConfig(
      view as WidgetView,
      accentColor,
      colorMode as WidgetColorMode,
    );

    const existing = await CalendarWidgetConfigEntity.findOne({
      where: { calendar_id: calendarId },
    });

    if (existing) {
      await existing.update({
        view: validConfig.view,
        accent_color: validConfig.accentColor,
        color_mode: validConfig.colorMode,
      });
    }
    else {
      const entity = CalendarWidgetConfigEntity.fromModel(validConfig, uuidv4(), calendarId);
      await entity.save();
    }

    return validConfig;
  }

  /**
   * Convert a persisted entity to a WidgetConfig, re-validating each field
   * on read. Any corrupt stored value falls back to the default for that
   * field and emits a warning. This is defense-in-depth against a bad row
   * (or a schema migration drift) reaching the widget DOM.
   */
  private toSafeModel(entity: CalendarWidgetConfigEntity, calendarId: string): WidgetConfig {
    const warnings: Record<string, unknown> = {};

    let view: WidgetView = WIDGET_CONFIG_DEFAULTS.view;
    if (isValidWidgetView(entity.view)) {
      view = entity.view;
    }
    else {
      warnings.view = entity.view;
    }

    let accentColor: string = WIDGET_CONFIG_DEFAULTS.accentColor;
    if (isValidWidgetAccentColor(entity.accent_color)) {
      accentColor = entity.accent_color;
    }
    else {
      warnings.accentColor = entity.accent_color;
    }

    let colorMode: WidgetColorMode = WIDGET_CONFIG_DEFAULTS.colorMode;
    if (isValidWidgetColorMode(entity.color_mode)) {
      colorMode = entity.color_mode;
    }
    else {
      warnings.colorMode = entity.color_mode;
    }

    if (Object.keys(warnings).length > 0) {
      this.getLogger().warn(
        { calendarId, invalidFields: warnings },
        'Corrupt widget config fields fell back to defaults',
      );
    }

    return new WidgetConfig(view, accentColor, colorMode);
  }

  /**
   * Verify the account has edit access to the calendar. Throws
   * CalendarNotFoundError if missing and CalendarEditorPermissionError
   * if the account lacks access.
   */
  private async assertEditorAccess(account: Account, calendarId: string): Promise<void> {
    const calendar = await this.getCalendar(calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    const canModify = this.calendarService
      ? await this.calendarService.userCanModifyCalendar(account, calendar)
      : false;

    if (!canModify) {
      throw new CalendarEditorPermissionError();
    }
  }

  private async getCalendar(id: string) {
    if (this.calendarService) {
      return this.calendarService.getCalendar(id);
    }
    const { CalendarEntity } = await import('@/server/calendar/entity/calendar');
    const entity = await CalendarEntity.findByPk(id);
    return entity ? entity.toModel() : null;
  }

  private async getCalendarByName(urlName: string) {
    if (this.calendarService) {
      return this.calendarService.getCalendarByName(urlName);
    }
    const { CalendarEntity } = await import('@/server/calendar/entity/calendar');
    const entity = await CalendarEntity.findOne({ where: { url_name: urlName } });
    return entity ? entity.toModel() : null;
  }

  private getLogger(): pino.Logger {
    return this.logOverride ?? logger;
  }
}

export default WidgetConfigService;
