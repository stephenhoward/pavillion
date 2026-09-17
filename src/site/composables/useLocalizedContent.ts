import { TranslatedModel, TranslatedContentModel } from '@/common/model/model';
import type { EventLocationSpace } from '@/common/model/location';
import type { Calendar } from '@/common/model/calendar';
import type { CalendarEvent } from '@/common/model/events';
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
   * Each step asks `hasContent`, which selects a row on the fields read off a
   * selected row and not on "does this row hold anything at all" — a language
   * whose row carries only alt text is skipped here rather than chosen and
   * rendered blank. See {@link TranslatedContentModel.hasDisplayContent}; the
   * alt text itself is resolved by {@link localizedField}.
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

  /**
   * Returns the best available value for a *single* translated field.
   *
   * Unlike {@link localizedContent}, which picks one content row and then
   * reads every field off it, this resolves per field. A content row that
   * exists for the visitor's locale but leaves this particular field empty
   * falls through to the next language rather than yielding ''. Without
   * that, an image with alt text in English but a French row carrying only
   * a name would be decorative for a French visitor and described for an
   * English one — the same image, two different accessibility contracts.
   *
   * Resolution order:
   * 1. Current locale (from URL / i18next)
   * 2. Default language (English)
   * 3. The first language whose value for this field is non-empty
   * 4. '' when no language has a value
   *
   * A whitespace-only value counts as empty (matching
   * {@link TranslatedModel.displayName}), but the selected value is
   * returned exactly as stored: this is a selector, not a normalizer.
   * Normalization is owned by the write path.
   *
   * Languages absent from the model are never read, so resolution does not
   * materialize empty content rows as a side effect.
   *
   * @param model - A TranslatedModel instance, or null/undefined
   * @param field - The content field to resolve
   * @returns The best available value, or '' when none is populated
   */
  function localizedField<T extends TranslatedContentModel>(
    model: TranslatedModel<T> | null | undefined,
    field: keyof T & string,
  ): string {
    if (!model) return '';

    const languages = model.getLanguages();

    const valueFor = (language: string): string => {
      if (!languages.includes(language)) return '';
      const value = model.content(language)[field];
      if (typeof value !== 'string' || value.trim() === '') return '';
      return value;
    };

    const localeValue = valueFor(currentLocale.value);
    if (localeValue) return localeValue;

    const defaultValue = valueFor(DEFAULT_LANGUAGE_CODE);
    if (defaultValue) return defaultValue;

    for (const language of languages) {
      const value = valueFor(language);
      if (value) return value;
    }

    return '';
  }

  /**
   * Resolves the alt text for the image an event surface is about to render,
   * picking the alt that belongs to the image actually being shown.
   *
   * The event's own media wins; when the event has none and the caller is
   * showing the calendar's default image, the calendar's alt is used. When
   * no image is shown — or the caller deliberately suppressed the calendar
   * default, as the event card does for reposts — the result is '', which
   * is the decorative contract.
   *
   * `usesCalendarDefault` is supplied by the caller rather than recomputed
   * here because the rule differs per surface: the event card withholds the
   * local calendar's default image from reposted events, the widget week
   * view shows no default image at all. Each caller must derive the flag
   * from the same expression that chose the media it is rendering.
   *
   * @param event - The event being rendered, or null/undefined
   * @param calendar - The calendar whose default image may be shown
   * @param usesCalendarDefault - True when the calendar default image is the one on screen
   * @returns The resolved alt text, or '' when the image is decorative
   */
  function resolveImageAlt(
    event: CalendarEvent | null | undefined,
    calendar: Calendar | null | undefined,
    usesCalendarDefault: boolean,
  ): string {
    if (event?.media) {
      return localizedField(event, 'imageAlt');
    }

    if (usesCalendarDefault) {
      return localizedField(calendar, 'imageAlt');
    }

    return '';
  }

  function spaceDisplayName(space: EventLocationSpace | null | undefined): string {
    if (!space) return '';
    return localizedContent(space)?.name ?? '';
  }

  function spaceAccessibilityInfo(space: EventLocationSpace | null | undefined): string {
    if (!space) return '';
    return localizedContent(space)?.accessibilityInfo ?? '';
  }

  return {
    localizedContent,
    localizedField,
    resolveImageAlt,
    spaceDisplayName,
    spaceAccessibilityInfo,
  };
}
