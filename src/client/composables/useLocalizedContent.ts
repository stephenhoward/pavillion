import i18next from 'i18next';
import type { EventLocationSpace } from '@/common/model/location';

/**
 * Client-side composable for resolving localized content from translated models.
 *
 * Uses `i18next.language` directly (the client app's i18n integration), with
 * fallback to the first available language on the model.
 *
 * The shared equivalent is `src/common/ui/composables/useLocalizedContent.ts`,
 * which the public site and the widget both consume. It reads the language
 * through `useLocale`, which derives the locale from a locale-prefixed route
 * (`/es/my-calendar`). The client app has no such routes, so it reads
 * `i18next.language` instead and the two stay separate. Reconciling them is
 * part of the open client-consumer question on pv-z1in.
 */
export function useLocalizedContent() {
  /**
   * Returns the Space's name in the current i18n language, falling back to the
   * first available language with content. Returns `''` when the input is
   * null/undefined or has no populated content.
   */
  function spaceDisplayName(space: EventLocationSpace | null | undefined): string {
    if (!space) return '';
    const lang = i18next.language || 'en';
    const languages = space.getLanguages();
    if (languages.length === 0) return '';
    const preferred = languages.includes(lang) ? lang : languages[0];
    return space.content(preferred).name ?? '';
  }

  return { spaceDisplayName };
}
