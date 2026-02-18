import config from 'config';
import ServiceSettingEntity from "@/server/configuration/entity/settings";
import type { DefaultDateRange } from '@/common/model/calendar';
import { isValidLanguageCode, DEFAULT_LANGUAGE_CODE, AVAILABLE_LANGUAGES, BETA_THRESHOLD } from '@/common/i18n/languages';

type LocaleDetectionMethods = {
  urlPrefix: boolean;
  cookie: boolean;
  acceptLanguage: boolean;
};

type Config = {
  registrationMode: 'open' | 'apply' | 'invitation' | 'closed';
  siteTitle: string;
  eventInstanceMonths: number;
  defaultDateRange: DefaultDateRange;
  defaultLanguage: string;
  enabledLanguages: string[];
  forceLanguage: string | null;
  localeDetectionMethods: LocaleDetectionMethods;
};

/**
 * Returns the default list of enabled language codes.
 * Includes all languages meeting the BETA_THRESHOLD completeness requirement.
 */
function defaultEnabledLanguages(): string[] {
  return AVAILABLE_LANGUAGES
    .filter(lang => lang.completeness >= BETA_THRESHOLD)
    .map(lang => lang.code);
}

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
      enabledLanguages: defaultEnabledLanguages(),
      forceLanguage: null,
      localeDetectionMethods: {
        urlPrefix: true,
        cookie: true,
        acceptLanguage: true,
      },
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
      if ( entity.parameter == 'localeDetectionMethods' ) {
        try {
          const parsed = JSON.parse(entity.value);
          if (parsed && typeof parsed === 'object') {
            this.config.localeDetectionMethods = {
              urlPrefix: typeof parsed.urlPrefix === 'boolean' ? parsed.urlPrefix : true,
              cookie: typeof parsed.cookie === 'boolean' ? parsed.cookie : true,
              acceptLanguage: typeof parsed.acceptLanguage === 'boolean' ? parsed.acceptLanguage : true,
            };
          }
        }
        catch {
          // Invalid JSON — keep default
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
   * Returns the locale detection methods configuration.
   */
  getLocaleDetectionMethods(): LocaleDetectionMethods {
    return this.config.localeDetectionMethods;
  }

  /**
   * Returns the list of enabled language codes for this instance.
   */
  getEnabledLanguages(): string[] {
    return this.config.enabledLanguages;
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
        console.error('Invalid registration mode:', value);
        return false;
      }
    }

    // Validate the defaultDateRange
    if ( parameter == 'defaultDateRange' ) {
      if (!['1week', '2weeks', '1month'].includes(value as string)) {
        console.error('Invalid default date range:', value);
        return false;
      }
    }

    // Validate the defaultLanguage
    if ( parameter == 'defaultLanguage' ) {
      if (!isValidLanguageCode(value as string)) {
        console.error('Invalid default language:', value);
        return false;
      }
    }

    // Validate enabledLanguages (stored as JSON string)
    if ( parameter == 'enabledLanguages' ) {
      try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isValidLanguageCode)) {
          console.error('Invalid enabledLanguages:', value);
          return false;
        }
      }
      catch {
        console.error('Invalid enabledLanguages JSON:', value);
        return false;
      }
    }

    // Validate forceLanguage
    if ( parameter == 'forceLanguage' ) {
      const strValue = value as string;
      if (strValue !== '' && strValue !== 'null' && !isValidLanguageCode(strValue)) {
        console.error('Invalid forceLanguage:', value);
        return false;
      }
    }

    // Validate localeDetectionMethods (stored as JSON string)
    if ( parameter == 'localeDetectionMethods' ) {
      try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        if (!parsed || typeof parsed !== 'object') {
          console.error('Invalid localeDetectionMethods:', value);
          return false;
        }
      }
      catch {
        console.error('Invalid localeDetectionMethods JSON:', value);
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
          console.error('Invalid registration mode:', value);
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
          console.error('Invalid event instance months:', value);
          return false;
        }
        break;
      case 'defaultDateRange':
        if (['1week', '2weeks', '1month'].includes(value as string)) {
          this.config.defaultDateRange = value as DefaultDateRange;
        }
        else {
          console.error('Invalid default date range:', value);
          return false;
        }
        break;
      case 'defaultLanguage':
        if (isValidLanguageCode(value as string)) {
          this.config.defaultLanguage = value as string;
        }
        else {
          console.error('Invalid default language:', value);
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
      case 'localeDetectionMethods': {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        this.config.localeDetectionMethods = {
          urlPrefix: typeof parsed.urlPrefix === 'boolean' ? parsed.urlPrefix : true,
          cookie: typeof parsed.cookie === 'boolean' ? parsed.cookie : true,
          acceptLanguage: typeof parsed.acceptLanguage === 'boolean' ? parsed.acceptLanguage : true,
        };
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
        console.error('Invalid moderation.autoEscalationThreshold: must be a number, got', typeof value);
        return false;
      }
      if (!Number.isInteger(value)) {
        console.error('Invalid moderation.autoEscalationThreshold: must be an integer, got', value);
        return false;
      }
      if (value < 0) {
        console.error('Invalid moderation.autoEscalationThreshold: must be >= 0, got', value);
        return false;
      }
    }

    // Validate moderation.ipHashRetentionDays
    if (parameter === 'moderation.ipHashRetentionDays') {
      if (typeof value !== 'number') {
        console.error('Invalid moderation.ipHashRetentionDays: must be a number, got', typeof value);
        return false;
      }
      if (!Number.isInteger(value)) {
        console.error('Invalid moderation.ipHashRetentionDays: must be an integer, got', value);
        return false;
      }
      if (value <= 0) {
        console.error('Invalid moderation.ipHashRetentionDays: must be > 0, got', value);
        return false;
      }
    }

    // Validate moderation.ipSubnetRetentionDays
    if (parameter === 'moderation.ipSubnetRetentionDays') {
      if (typeof value !== 'number') {
        console.error('Invalid moderation.ipSubnetRetentionDays: must be a number, got', typeof value);
        return false;
      }
      if (!Number.isInteger(value)) {
        console.error('Invalid moderation.ipSubnetRetentionDays: must be an integer, got', value);
        return false;
      }
      if (value <= 0) {
        console.error('Invalid moderation.ipSubnetRetentionDays: must be > 0, got', value);
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
