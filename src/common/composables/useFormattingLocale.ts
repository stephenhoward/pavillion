import { ref } from 'vue';
import { Settings } from 'luxon';

/**
 * Module-level reactive state shared across all useFormattingLocale() callers.
 * Ensures a single source of truth for the active formatting locale.
 */
const formattingLocale = ref<string>('en');

/**
 * Synchronises the Luxon Settings.defaultLocale with the given locale string.
 *
 * @param locale - A valid BCP 47 locale tag (e.g. 'en', 'de', 'en-US')
 */
function applyToLuxon(locale: string): void {
  Settings.defaultLocale = locale;
}

/**
 * Reset formatting locale state. Exported for testing purposes only.
 */
export function resetFormattingLocaleState(): void {
  formattingLocale.value = 'en';
  Settings.defaultLocale = 'en';
}

/**
 * Composable for managing the active formatting locale used by Luxon.
 *
 * The formatting locale controls how dates and numbers are rendered
 * (e.g. month/day order, decimal separator) independently of the UI language.
 *
 * Uses module-level reactive state so all components share the same locale.
 * Setting the locale from any component (or from an app-level initializer)
 * immediately affects all Luxon date formatting calls.
 *
 * Usage in the authenticated client app:
 * ```ts
 * const { setFormattingLocale } = useFormattingLocale();
 * const account = await accountService.getProfile();
 * setFormattingLocale(account.effectiveFormattingLocale);
 * ```
 *
 * Usage in a template that wants to display the current locale:
 * ```ts
 * const { formattingLocale } = useFormattingLocale();
 * ```
 */
export function useFormattingLocale() {

  /**
   * Update the active formatting locale and propagate the change to Luxon.
   *
   * @param locale - A valid BCP 47 locale tag (e.g. 'en', 'de', 'en-US')
   */
  const setFormattingLocale = (locale: string): void => {
    formattingLocale.value = locale;
    applyToLuxon(locale);
  };

  return {
    /** Reactive ref containing the current formatting locale code */
    formattingLocale,
    setFormattingLocale,
  };
}
