import { ref, Ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import i18next from 'i18next';

import { addLocalePrefix, stripLocalePrefix } from '@/common/i18n/locale-url';
import { writeLocaleCookie } from '@/common/i18n/cookie';
import { DEFAULT_LANGUAGE_CODE } from '@/common/i18n/languages';

/**
 * Composable for managing locale switching in the public site app.
 *
 * Provides reactive access to the current locale and helpers to switch
 * locale (updating the URL prefix, cookie, and i18next language) and to
 * generate locale-prefixed paths.
 *
 * The currentLocale ref is initialised from the URL path: if the page was
 * loaded with a locale prefix (e.g. /es/@calendar) the router guard in
 * app.ts will have already called i18next.changeLanguage(), so reading
 * i18next.language gives the correct starting value.
 */
export function useLocale() {
  const router = useRouter();
  const route = useRoute();

  /**
   * Detect the current locale from the URL path, falling back to the
   * i18next language (which the router guard may have already set) and
   * ultimately to the default language code.
   */
  const detectCurrentLocale = (): string => {
    const { locale } = stripLocalePrefix(route.path);
    return locale ?? i18next.language ?? DEFAULT_LANGUAGE_CODE;
  };

  const currentLocale: Ref<string> = ref(detectCurrentLocale());

  /**
   * Generates a locale-prefixed path for a given route path.
   *
   * Uses the as-needed strategy: the default locale gets no prefix,
   * all other locales get a /{locale} prefix.
   *
   * @param path - The canonical route path (e.g. '/@calendar')
   * @param locale - The locale to prefix with; defaults to currentLocale
   * @returns The locale-prefixed path (e.g. '/es/@calendar')
   */
  function localizedPath(path: string, locale?: string): string {
    const targetLocale = locale ?? currentLocale.value;
    return addLocalePrefix(path, targetLocale, DEFAULT_LANGUAGE_CODE);
  }

  /**
   * Switches the application to the given locale.
   *
   * Steps performed (no full-page reload):
   * 1. Generates the new locale-prefixed URL for the current path using addLocalePrefix()
   * 2. Navigates to the new URL via Vue Router (the router guard will strip
   *    the prefix and call i18next.changeLanguage() automatically)
   * 3. Writes the pavilion_locale cookie so the server and future visits
   *    can honour the preference
   * 4. Updates the reactive currentLocale ref
   *
   * @param locale - The ISO 639-1 locale code to switch to (e.g. 'es')
   */
  function switchLocale(locale: string): void {
    // Derive the canonical path (without any existing locale prefix)
    const { path: canonicalPath } = stripLocalePrefix(route.path);

    // Build the new URL with the locale prefix
    const newPath = addLocalePrefix(canonicalPath, locale, DEFAULT_LANGUAGE_CODE);

    // Navigate via Vue Router — the beforeEach guard in app.ts will:
    //   a) detect the locale prefix
    //   b) call i18next.changeLanguage(locale)
    //   c) redirect to the canonical path for route matching
    router.push({ path: newPath, query: route.query, hash: route.hash });

    // Persist the preference in a cookie
    writeLocaleCookie(locale);

    // Update the reactive ref immediately so components reflect the change
    currentLocale.value = locale;
  }

  return { currentLocale, switchLocale, localizedPath };
}
