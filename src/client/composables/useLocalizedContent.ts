import i18next from 'i18next';
import type { EventLocationSpace } from '@/common/model/location';

/**
 * Client-side composable for resolving localized content from translated models.
 *
 * Uses `i18next.language` directly (the client app's i18n integration), with
 * fallback to the first available language on the model. The site app has its
 * own equivalent at `src/site/composables/useLocalizedContent.ts` that uses
 * Vue's `useI18n` instead — keep them separate.
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
