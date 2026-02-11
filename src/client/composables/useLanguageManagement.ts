import { ref, Ref } from 'vue';
import iso6391 from 'iso-639-1-dir';
import { CalendarEvent } from '@/common/model/events';

export interface LanguageManagement {
  languages: Ref<string[]>;
  availableLanguages: Ref<string[]>;
  currentLanguage: Ref<string>;
  showLanguagePicker: Ref<boolean>;
  addLanguage: (language: string, event: CalendarEvent) => void;
  removeLanguage: (language: string, event: CalendarEvent) => void;
  initializeLanguages: (event: CalendarEvent) => void;
  openLanguagePicker: () => void;
  closeLanguagePicker: () => void;
}

/**
 * Composable for managing language selection and content languages in events.
 *
 * Manages:
 * - Active languages list for the current event
 * - Available languages (all ISO 639-1 codes)
 * - Current language selection
 * - Language picker modal state
 */
export function useLanguageManagement(): LanguageManagement {
  const defaultLanguage = 'en';

  // Active languages for the current event
  const languages = ref<string[]>([defaultLanguage]);

  // All available languages (default + all ISO 639-1 codes)
  const allLanguages = iso6391.getAllCodes();
  const availableLanguages = ref<string[]>([...new Set([defaultLanguage, ...allLanguages])]);

  // Current language selection
  const currentLanguage = ref<string>(defaultLanguage);

  // Language picker modal state
  const showLanguagePicker = ref<boolean>(false);

  /**
   * Add a language to the event.
   * Creates content for the language and sets it as current.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const addLanguage = (language: string, event: CalendarEvent): void => {
    languages.value = [...new Set(languages.value.concat(language))];
    currentLanguage.value = language;
  };

  /**
   * Remove a language from the event.
   * Drops the content for that language and switches to the first available language.
   */
  const removeLanguage = (language: string, event: CalendarEvent): void => {
    if (event) {
      event.dropContent(language);
    }
    languages.value = languages.value.filter(l => l !== language);
    currentLanguage.value = languages.value[0];
  };

  /**
   * Initialize languages from an event.
   * Extracts all languages from the event and ensures default language is included.
   */
  const initializeLanguages = (event: CalendarEvent): void => {
    if (event) {
      const eventLanguages = event.getLanguages();
      eventLanguages.unshift(defaultLanguage);
      languages.value = [...new Set(eventLanguages)];
    }
  };

  /**
   * Open the language picker modal
   */
  const openLanguagePicker = (): void => {
    showLanguagePicker.value = true;
  };

  /**
   * Close the language picker modal
   */
  const closeLanguagePicker = (): void => {
    showLanguagePicker.value = false;
  };

  return {
    languages,
    availableLanguages,
    currentLanguage,
    showLanguagePicker,
    addLanguage,
    removeLanguage,
    initializeLanguages,
    openLanguagePicker,
    closeLanguagePicker,
  };
}
