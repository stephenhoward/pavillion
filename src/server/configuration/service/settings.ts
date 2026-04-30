import config from 'config';
import { Op } from 'sequelize';
import ServiceSettingEntity from "@/server/configuration/entity/settings";
import SettingsContentEntity from "@/server/configuration/entity/settings_content";
import type { DefaultDateRange } from '@/common/model/calendar';
import { isValidLanguageCode, DEFAULT_LANGUAGE_CODE, getDefaultEnabledLanguageCodes } from '@/common/i18n/languages';
import { renderPolicyMarkdown } from '@/common/utils/render-markdown';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('configuration');

const MAX_INSTANCE_DESCRIPTION_KEYS = 20;
const MAX_INSTANCE_POLICY_KEYS = 20;
const MAX_INSTANCE_POLICY_LENGTH_INPUT = 50_000;

type Config = {
  registrationMode: 'open' | 'apply' | 'invitation' | 'closed';
  siteTitle: string;
  eventInstanceMonths: number;
  defaultDateRange: DefaultDateRange;
  defaultLanguage: string;
  enabledLanguages: string[];
  forceLanguage: string | null;
};

class ServiceSettings {
  private static instance: ServiceSettings;
  private config: Config;

  private constructor() {
    this.config = {
      registrationMode: 'invitation',
      siteTitle: config.get('domain'),
      eventInstanceMonths: 6,
      defaultDateRange: '2weeks',
      defaultLanguage: DEFAULT_LANGUAGE_CODE,
      enabledLanguages: getDefaultEnabledLanguageCodes(),
      forceLanguage: null,
    };
  }

  async init() {
    let settings = await ServiceSettingEntity.findAll();

    settings.forEach(entity => {
      if ( entity.parameter == 'registrationMode' ) {
        if ( ['open', 'apply', 'invitation', 'closed'].includes(entity.value) ) {
          this.config[entity.parameter] = entity.value as 'open' | 'apply' | 'invitation' | 'closed';
        }
      }
      if( entity.parameter == 'siteTitle' ) {
        this.config.siteTitle = entity.value;
      }
      if ( entity.parameter == 'defaultDateRange' ) {
        if ( ['1week', '2weeks', '1month'].includes(entity.value) ) {
          this.config.defaultDateRange = entity.value as DefaultDateRange;
        }
      }
      if ( entity.parameter == 'defaultLanguage' ) {
        if ( isValidLanguageCode(entity.value) ) {
          this.config.defaultLanguage = entity.value;
        }
      }
      if ( entity.parameter == 'enabledLanguages' ) {
        try {
          const parsed = JSON.parse(entity.value);
          if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isValidLanguageCode)) {
            this.config.enabledLanguages = parsed;
          }
        }
        catch {
          // Invalid JSON — keep default
        }
      }
      if ( entity.parameter == 'forceLanguage' ) {
        if (entity.value === '' || entity.value === 'null') {
          this.config.forceLanguage = null;
        }
        else if (isValidLanguageCode(entity.value)) {
          this.config.forceLanguage = entity.value;
        }
      }
    });
  }

  static async getInstance(): Promise<ServiceSettings> {
    if (!ServiceSettings.instance) {
      ServiceSettings.instance = new ServiceSettings();
      await ServiceSettings.instance.init();
    }
    return ServiceSettings.instance;
  }

  get(key: string): string | number | undefined {
    if ( key in this.config) {
      return this.config[key as keyof Config] as string | number | undefined;
    }
  }

  /**
   * Returns the forced language override for all users, or null if not set.
   */
  getForceLanguage(): string | null {
    return this.config.forceLanguage;
  }

  /**
   * Returns the list of enabled language codes for this instance.
   */
  getEnabledLanguages(): string[] {
    return this.config.enabledLanguages;
  }

  /**
   * Returns the instance description as a language-keyed object,
   * loaded from the settings_content table. Filters out null / empty
   * description rows (which may exist if the row carries only a policy).
   */
  async getInstanceDescription(): Promise<Record<string, string>> {
    const rows = await SettingsContentEntity.findAll();
    const result: Record<string, string> = {};
    for (const row of rows) {
      if (row.description != null && row.description !== '') {
        result[row.language] = row.description;
      }
    }
    return result;
  }

  /**
   * Replaces instance descriptions with the provided language-keyed object.
   * Validates language codes and description length. For each present
   * language, the description column is set; for languages missing from the
   * input but present in existing rows, the description column is set to
   * NULL (the row is preserved because it may carry a policy). Rows where
   * both description and policy are null/empty are then cleaned up.
   *
   * @param descriptions - Language-keyed object of description strings
   * @returns true if update succeeded, false if validation failed
   */
  async setInstanceDescription(descriptions: Record<string, string>): Promise<boolean> {
    if (!descriptions || typeof descriptions !== 'object' || Array.isArray(descriptions)) {
      logger.error({ descriptions }, 'Invalid instanceDescription: must be an object');
      return false;
    }

    const keys = Object.keys(descriptions);
    if (keys.length > MAX_INSTANCE_DESCRIPTION_KEYS) {
      logger.error({ count: keys.length }, 'Invalid instanceDescription: too many language keys');
      return false;
    }

    for (const key of keys) {
      if (!isValidLanguageCode(key)) {
        logger.error({ key }, 'Invalid instanceDescription: invalid language code');
        return false;
      }
      const val = descriptions[key];
      if (typeof val !== 'string') {
        logger.error({ key, type: typeof val }, 'Invalid instanceDescription: value must be a string');
        return false;
      }
      if (val.length > 500) {
        logger.error({ key, length: val.length }, 'Invalid instanceDescription: value exceeds 500 characters');
        return false;
      }
    }

    // Treat empty-string values as "absent" — they should result in a NULL
    // description rather than persisting an empty string.
    const presentEntries = Object.entries(descriptions).filter(([, value]) => value !== '');
    const presentLanguages = new Set(presentEntries.map(([language]) => language));

    // Nullify-on-missing: for any existing row whose language is not in the
    // present set, set description = NULL (do NOT destroy — policy may exist).
    const existingRows = await SettingsContentEntity.findAll();
    for (const row of existingRows) {
      if (!presentLanguages.has(row.language) && row.description != null && row.description !== '') {
        row.description = null as unknown as string;
        await row.save();
      }
    }

    // Create or update rows for each present language.
    for (const [language, description] of presentEntries) {
      const [entity, created] = await SettingsContentEntity.findOrCreate({
        where: { language },
        defaults: { language, description },
      });

      if (!created) {
        entity.description = description;
        await entity.save();
      }
    }

    // Drop any orphan rows where both description and policy are empty.
    await this.cleanupOrphanSettingsContentRows();

    return true;
  }

  /**
   * Returns the instance policy as a language-keyed object of sanitized
   * HTML, loaded from the settings_content table. Filters out null / empty
   * policy rows so callers only see languages with a real policy set.
   */
  async getInstancePolicy(): Promise<Record<string, string>> {
    const rows = await SettingsContentEntity.findAll();
    const result: Record<string, string> = {};
    for (const row of rows) {
      if (row.policy != null && row.policy !== '') {
        result[row.language] = row.policy;
      }
    }
    return result;
  }

  /**
   * Replaces instance policies with the provided language-keyed object of
   * raw markdown source. Each value is rendered through `renderPolicyMarkdown`
   * (the sanitization pipeline) before being persisted; the policy column
   * NEVER receives unsanitized input. Languages absent from the input but
   * present in existing rows have their policy column set to NULL (the row
   * is preserved because description may exist). Rows where both columns are
   * null/empty are cleaned up at the end.
   *
   * @param policies - Language-keyed object of raw markdown source strings
   * @returns true if update succeeded, false if validation failed
   */
  async setInstancePolicy(policies: Record<string, string>): Promise<boolean> {
    if (!policies || typeof policies !== 'object' || Array.isArray(policies)) {
      logger.error({ policies }, 'Invalid instancePolicy: must be an object');
      return false;
    }

    const keys = Object.keys(policies);
    if (keys.length > MAX_INSTANCE_POLICY_KEYS) {
      logger.error({ count: keys.length }, 'Invalid instancePolicy: too many language keys');
      return false;
    }

    for (const key of keys) {
      // ReDoS-safe pre-checks: cap length and require printable ASCII before
      // invoking the language-code allowlist check.
      if (key.length > 20 || !/^[\x21-\x7E]+$/.test(key)) {
        logger.error({ key }, 'Invalid instancePolicy: malformed language code');
        return false;
      }
      if (!isValidLanguageCode(key)) {
        logger.error({ key }, 'Invalid instancePolicy: invalid language code');
        return false;
      }
      const val = policies[key];
      if (typeof val !== 'string') {
        logger.error({ key, type: typeof val }, 'Invalid instancePolicy: value must be a string');
        return false;
      }
      if (val.length > MAX_INSTANCE_POLICY_LENGTH_INPUT) {
        logger.error(
          { key, length: val.length },
          'Invalid instancePolicy: value exceeds maximum input length',
        );
        return false;
      }
    }

    // Treat empty-string values as "absent" — they should result in a NULL
    // policy rather than persisting an empty string.
    const presentEntries = Object.entries(policies).filter(([, value]) => value !== '');
    const presentLanguages = new Set(presentEntries.map(([language]) => language));

    // Render each present value through the sanitization pipeline. This is
    // the ONLY code path in this file that writes to the policy column;
    // every value flows through renderPolicyMarkdown before persistence.
    const sanitized: Array<[string, string]> = presentEntries.map(([language, source]) => [
      language,
      renderPolicyMarkdown(source),
    ]);

    // Nullify-on-missing: for any existing row whose language is not in the
    // present set, set policy = NULL (do NOT destroy — description may exist).
    const existingRows = await SettingsContentEntity.findAll();
    for (const row of existingRows) {
      if (!presentLanguages.has(row.language) && row.policy != null && row.policy !== '') {
        row.policy = null;
        await row.save();
      }
    }

    // Create or update rows for each present language using sanitized HTML.
    for (const [language, sanitizedHtml] of sanitized) {
      const [entity, created] = await SettingsContentEntity.findOrCreate({
        where: { language },
        defaults: { language, policy: sanitizedHtml },
      });

      if (!created) {
        entity.policy = sanitizedHtml;
        await entity.save();
      }
    }

    // Drop any orphan rows where both description and policy are empty.
    await this.cleanupOrphanSettingsContentRows();

    return true;
  }

  /**
   * Destroys settings_content rows where both `description` and `policy`
   * are null or empty. Shared between description and policy setters so
   * that nullifying the last remaining content column on a row does not
   * leave an empty placeholder behind.
   */
  private async cleanupOrphanSettingsContentRows(): Promise<void> {
    await SettingsContentEntity.destroy({
      where: {
        [Op.and]: [
          { [Op.or]: [{ description: null }, { description: '' }] },
          { [Op.or]: [{ policy: null }, { policy: '' }] },
        ],
      },
    });
  }

  /**
   * Updates a service setting.
   *
   * For known Config keys, validates the value and updates the in-memory cache.
   * For extension keys (e.g. moderation.*), persists directly to the database
   * without in-memory caching.
   *
   * @param parameter - Setting key
   * @param value - The new value for the setting
   * @returns Promise resolving to true if update was successful
   */
  async set(parameter: string, value: string|number): Promise<boolean> {
    // For known Config keys, validate and update in-memory cache
    if (parameter in this.config) {
      return this.setKnownParameter(parameter, value);
    }

    // For extension keys (e.g. moderation.*), persist directly to database
    return this.setExtensionParameter(parameter, value);
  }

  /**
   * Handles setting of known Config-typed parameters with validation.
   */
  private async setKnownParameter(parameter: string, value: string|number): Promise<boolean> {
    // Validate the mode
    if ( parameter == 'registrationMode' ) {
      if (!['open', 'apply', 'invitation', 'closed'].includes(value as string)) {
        logger.error({ value }, 'Invalid registration mode');
        return false;
      }
    }

    // Validate the defaultDateRange
    if ( parameter == 'defaultDateRange' ) {
      if (!['1week', '2weeks', '1month'].includes(value as string)) {
        logger.error({ value }, 'Invalid default date range');
        return false;
      }
    }

    // Validate the defaultLanguage
    if ( parameter == 'defaultLanguage' ) {
      if (!isValidLanguageCode(value as string)) {
        logger.error({ value }, 'Invalid default language');
        return false;
      }
    }

    // Validate enabledLanguages (stored as JSON string)
    if ( parameter == 'enabledLanguages' ) {
      try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isValidLanguageCode)) {
          logger.error({ value }, 'Invalid enabledLanguages');
          return false;
        }
      }
      catch {
        logger.error({ value }, 'Invalid enabledLanguages JSON');
        return false;
      }
    }

    // Validate forceLanguage
    if ( parameter == 'forceLanguage' ) {
      const strValue = value as string;
      if (strValue !== '' && strValue !== 'null' && !isValidLanguageCode(strValue)) {
        logger.error({ value }, 'Invalid forceLanguage');
        return false;
      }
    }

    // Update or create the setting in the database
    const [entity, created] = await ServiceSettingEntity.findOrCreate({
      where: { parameter },
      defaults: { parameter, value },
    });

    if (!created) {
      entity.value = value as string;
      await entity.save();
    }

    switch (parameter) {
      case 'registrationMode':
        if (['open', 'apply', 'invitation', 'closed'].includes(value as string)) {
          this.config.registrationMode = value as 'open' | 'apply' | 'invitation' | 'closed';
        }
        else {
          logger.error({ value }, 'Invalid registration mode');
          return false;
        }
        break;
      case 'siteTitle':
        this.config.siteTitle = value as string;
        break;
      case 'eventInstanceMonths':
        if (typeof value === 'number' && value > 0) {
          this.config.eventInstanceMonths = value as number;
        }
        else {
          logger.error({ value }, 'Invalid event instance months');
          return false;
        }
        break;
      case 'defaultDateRange':
        if (['1week', '2weeks', '1month'].includes(value as string)) {
          this.config.defaultDateRange = value as DefaultDateRange;
        }
        else {
          logger.error({ value }, 'Invalid default date range');
          return false;
        }
        break;
      case 'defaultLanguage':
        if (isValidLanguageCode(value as string)) {
          this.config.defaultLanguage = value as string;
        }
        else {
          logger.error({ value }, 'Invalid default language');
          return false;
        }
        break;
      case 'enabledLanguages': {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        this.config.enabledLanguages = parsed;
        break;
      }
      case 'forceLanguage': {
        const strValue = value as string;
        if (strValue === '' || strValue === 'null') {
          this.config.forceLanguage = null;
        }
        else {
          this.config.forceLanguage = strValue;
        }
        break;
      }
      default:
        break;
    }

    return true;
  }

  /**
   * Persists an extension parameter directly to the database.
   * Extension parameters (e.g. moderation.*) are not tracked in the
   * in-memory Config but are stored in the service_config table.
   *
   * Validates moderation-specific parameters before persisting.
   *
   * @param parameter - Extension setting key
   * @param value - The value to store
   * @returns Promise resolving to true if persisted successfully
   */
  private async setExtensionParameter(parameter: string, value: string|number): Promise<boolean> {
    // Validate moderation.autoEscalationThreshold
    if (parameter === 'moderation.autoEscalationThreshold') {
      if (typeof value !== 'number') {
        logger.error({ value, type: typeof value }, 'Invalid moderation.autoEscalationThreshold: must be a number');
        return false;
      }
      if (!Number.isInteger(value)) {
        logger.error({ value }, 'Invalid moderation.autoEscalationThreshold: must be an integer');
        return false;
      }
      if (value < 0) {
        logger.error({ value }, 'Invalid moderation.autoEscalationThreshold: must be >= 0');
        return false;
      }
    }

    // Validate moderation.ipHashRetentionDays
    if (parameter === 'moderation.ipHashRetentionDays') {
      if (typeof value !== 'number') {
        logger.error({ value, type: typeof value }, 'Invalid moderation.ipHashRetentionDays: must be a number');
        return false;
      }
      if (!Number.isInteger(value)) {
        logger.error({ value }, 'Invalid moderation.ipHashRetentionDays: must be an integer');
        return false;
      }
      if (value <= 0) {
        logger.error({ value }, 'Invalid moderation.ipHashRetentionDays: must be > 0');
        return false;
      }
    }

    // Validate moderation.ipSubnetRetentionDays
    if (parameter === 'moderation.ipSubnetRetentionDays') {
      if (typeof value !== 'number') {
        logger.error({ value, type: typeof value }, 'Invalid moderation.ipSubnetRetentionDays: must be a number');
        return false;
      }
      if (!Number.isInteger(value)) {
        logger.error({ value }, 'Invalid moderation.ipSubnetRetentionDays: must be an integer');
        return false;
      }
      if (value <= 0) {
        logger.error({ value }, 'Invalid moderation.ipSubnetRetentionDays: must be > 0');
        return false;
      }
    }

    const [entity, created] = await ServiceSettingEntity.findOrCreate({
      where: { parameter },
      defaults: { parameter, value: String(value) },
    });

    if (!created) {
      entity.value = String(value);
      await entity.save();
    }

    return true;
  }
}

export default ServiceSettings;
