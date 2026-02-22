import { watch, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';

import { AVAILABLE_LANGUAGES, BETA_THRESHOLD, DEFAULT_LANGUAGE_CODE } from '@/common/i18n/languages';
import { addLocalePrefix, stripLocalePrefix } from '@/common/i18n/locale-url';

/**
 * Returns the list of enabled language codes for hreflang annotations.
 *
 * Only languages with completeness >= BETA_THRESHOLD are included; incomplete
 * languages are excluded because they are hidden from the UI.
 *
 * @returns Array of language code strings
 */
export function getEnabledLanguageCodes(): string[] {
  return AVAILABLE_LANGUAGES
    .filter(lang => lang.completeness >= BETA_THRESHOLD)
    .map(lang => lang.code);
}

/**
 * Builds the list of hreflang link objects for all enabled languages.
 *
 * Each entry has:
 * - hreflang: the BCP 47 language tag (or "x-default" for the default language)
 * - href: the full URL for this language version of the given canonical path
 *
 * The x-default entry points to the unprefixed (default-language) URL.
 *
 * @param canonicalPath - The path without any locale prefix (e.g. "/@calendar")
 * @param defaultLocale - The instance default locale code
 * @param baseUrl - The site base URL (e.g. "https://example.com")
 * @returns Array of { hreflang, href } objects
 */
export function buildHreflangLinks(
  canonicalPath: string,
  defaultLocale: string,
  baseUrl: string,
): { hreflang: string; href: string }[] {
  const enabledCodes = getEnabledLanguageCodes();

  const links: { hreflang: string; href: string }[] = enabledCodes.map(code => ({
    hreflang: code,
    href: `${baseUrl}${addLocalePrefix(canonicalPath, code, defaultLocale)}`,
  }));

  // x-default points to the unprefixed (default locale) URL
  const defaultHref = `${baseUrl}${addLocalePrefix(canonicalPath, defaultLocale, defaultLocale)}`;
  links.push({ hreflang: 'x-default', href: defaultHref });

  return links;
}

/**
 * Removes all hreflang <link> elements from document.head.
 */
function removeHreflangLinks(): void {
  const existing = document.head.querySelectorAll('link[rel="alternate"][hreflang]');
  existing.forEach(el => el.remove());
}

/**
 * Inserts hreflang <link> elements into document.head.
 *
 * @param links - Array of { hreflang, href } objects to insert
 */
function insertHreflangLinks(links: { hreflang: string; href: string }[]): void {
  links.forEach(({ hreflang, href }) => {
    const el = document.createElement('link');
    el.rel = 'alternate';
    el.hreflang = hreflang;
    el.href = href;
    document.head.appendChild(el);
  });
}

/**
 * Updates the hreflang <link> tags in document.head for the given path.
 *
 * @param canonicalPath - The path without any locale prefix
 * @param defaultLocale - The instance default locale code
 * @param baseUrl - The site origin (e.g. "https://example.com")
 */
function updateHreflangTags(
  canonicalPath: string,
  defaultLocale: string,
  baseUrl: string,
): void {
  removeHreflangLinks();
  const links = buildHreflangLinks(canonicalPath, defaultLocale, baseUrl);
  insertHreflangLinks(links);
}

/**
 * Composable that manages hreflang <link> tags in document.head for SPA navigation.
 *
 * On each Vue Router navigation the canonical path is derived from the new route
 * and the hreflang tags are updated to reflect all enabled languages.  Any
 * existing hreflang tags (e.g. those rendered server-side on first load) are
 * replaced so there is never a duplicate set.
 *
 * Call this composable once, at the top level of the site app or a root
 * layout component.
 *
 * @param defaultLocale - The instance default locale code; defaults to DEFAULT_LANGUAGE_CODE
 * @param baseUrl - The site origin; defaults to window.location.origin
 */
export function useHead(
  defaultLocale: string = DEFAULT_LANGUAGE_CODE,
  baseUrl: string = typeof window !== 'undefined' ? window.location.origin : '',
): void {
  const route = useRoute();

  const updateTags = () => {
    const { path: canonicalPath } = stripLocalePrefix(route.path);
    updateHreflangTags(canonicalPath, defaultLocale, baseUrl);
  };

  // Watch for route changes and update hreflang tags on SPA navigation
  const stopWatch = watch(() => route.path, updateTags, { immediate: true });

  onUnmounted(() => {
    stopWatch();
  });
}
