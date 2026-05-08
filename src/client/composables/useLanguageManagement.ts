import { ref, computed, ComputedRef, Ref } from 'vue';
import iso6391 from 'iso-639-1-dir';
import { DEFAULT_LANGUAGE_CODE } from '@/common/i18n/languages';

export interface LanguageManagementOptions {
  /**
   * Synchronous factory invoked once at construction to seed the active
   * languages list. Defaults to () => [DEFAULT_LANGUAGE_CODE].
   *
   * Async-loaded callers should leave this default and re-seed the
   * languages ref directly via `languages.value = ...` after their data
   * has loaded.
   */
  initialLanguages?: () => string[];
  /**
   * Optional callback fired AFTER a language has been added to the
   * active list. Caller owns hook safety.
   */
  onLanguageAdded?: (language: string) => void;
  /**
   * Optional callback fired AFTER a language has been removed from the
   * active list. NOT invoked when removeLanguage is a no-op (last
   * language guard or language not in the list).
   */
  onLanguageRemoved?: (language: string) => void;
}

export interface LanguageManagement {
  languages: Ref<string[]>;
  availableLanguages: ComputedRef<string[]>;
  currentLanguage: Ref<string>;
  showLanguagePicker: Ref<boolean>;
  addLanguage: (language: string) => void;
  removeLanguage: (language: string) => void;
  openLanguagePicker: () => void;
  closeLanguagePicker: () => void;
}

/**
 * Composable for managing language selection and content languages in
 * translatable-content editors.
 *
 * Manages:
 * - Active languages list (writable ref, callers may assign directly)
 * - Available languages (ComputedRef of ISO 639-1 codes NOT yet active)
 * - Current language selection
 * - Language picker modal state
 *
 * Side effects on the underlying entity (e.g. `event.dropContent(lang)`)
 * are wired by the caller via the optional `onLanguageAdded` and
 * `onLanguageRemoved` hooks.
 */
export function useLanguageManagement(
  options: LanguageManagementOptions = {},
): LanguageManagement {
  const {
    initialLanguages = () => [DEFAULT_LANGUAGE_CODE],
    onLanguageAdded,
    onLanguageRemoved,
  } = options;

  // Active languages for the current entity. Writable so async-loaded
  // callers can re-seed via `languages.value = ...` after load.
  const languages = ref<string[]>([...initialLanguages()]);

  // All ISO 639-1 codes (read once at construction; the universe of
  // language codes is static for the composable's lifetime).
  const allISOCodes = iso6391.getAllCodes();

  // Languages NOT yet active. Reactive to `languages` mutations so the
  // language picker reflects the current selection.
  const availableLanguages = computed<string[]>(() =>
    allISOCodes.filter((code: string) => !languages.value.includes(code)),
  );

  // Current language selection
  const currentLanguage = ref<string>(languages.value[0] ?? DEFAULT_LANGUAGE_CODE);

  // Language picker modal state
  const showLanguagePicker = ref<boolean>(false);

  /**
   * Add a language to the active list and select it as current. Hook is
   * invoked AFTER state mutation so state stays consistent if the hook
   * throws.
   */
  const addLanguage = (language: string): void => {
    languages.value = [...new Set(languages.value.concat(language))];
    currentLanguage.value = language;
    onLanguageAdded?.(language);
  };

  /**
   * Remove a language from the active list and switch current to the
   * first remaining language. No-op (and hook NOT invoked) when:
   *   - languages.length <= 1 (last-language guard), OR
   *   - the language is not currently active.
   *
   * Hook is invoked AFTER state mutation so state stays consistent if
   * the hook throws.
   */
  const removeLanguage = (language: string): void => {
    if (languages.value.length <= 1) return;
    if (!languages.value.includes(language)) return;
    languages.value = languages.value.filter((l: string) => l !== language);
    currentLanguage.value = languages.value[0];
    onLanguageRemoved?.(language);
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
    openLanguagePicker,
    closeLanguagePicker,
  };
}
