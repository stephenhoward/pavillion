import { TranslatedModel, TranslatedContentModel } from '@/common/model/model';
import { useLocale } from './useLocale';
import { DEFAULT_LANGUAGE_CODE } from '@/common/i18n/languages';

/**
 * Composable for retrieving translated content from a TranslatedModel
 * in the current locale, with fallback to the default language and
 * then to the first available language.
 *
 * Uses the useLocale composable to determine the active locale from
 * the URL / i18next state.
 */
export function useLocalizedContent() {
  const { currentLocale } = useLocale();

  /**
   * Returns the best available content for a translated model.
   *
   * Resolution order:
   * 1. Current locale (from URL / i18next)
   * 2. Default language (English)
   * 3. First available language on the model
   *
   * @param model - A TranslatedModel instance (Calendar, CalendarEvent, EventCategory, etc.)
   * @returns The translated content in the best available language
   */
  function localizedContent<T extends TranslatedContentModel>(
    model: TranslatedModel<T>,
  ): T {
    const locale = currentLocale.value;

    if (model.hasContent(locale)) {
      return model.content(locale);
    }

    if (locale !== DEFAULT_LANGUAGE_CODE && model.hasContent(DEFAULT_LANGUAGE_CODE)) {
      return model.content(DEFAULT_LANGUAGE_CODE);
    }

    const languages = model.getLanguages();
    if (languages.length > 0) {
      return model.content(languages[0]);
    }

    // Fall back to creating empty content for the current locale
    return model.content(locale);
  }

  return { localizedContent };
}
