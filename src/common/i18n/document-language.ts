import type { i18n } from 'i18next';

/**
 * Keeps `<html lang>` in step with the language an i18next instance renders in.
 *
 * Screen readers choose pronunciation rules from the document language
 * (WCAG 3.1.1), so a page whose UI switches language on the client must update
 * the attribute too — the server-rendered value only describes the first paint.
 *
 * Register before `init()`: i18next emits `languageChanged` during
 * initialization as well as on every later `changeLanguage()` call. The
 * resolved language is used so a regional request such as `es-MX` reports the
 * `es` bundle actually rendered.
 *
 * @param instance - The i18next instance whose language the document follows
 */
export function syncDocumentLanguage(instance: i18n): void {
  instance.on('languageChanged', (language: string) => {
    document.documentElement.lang = instance.resolvedLanguage ?? language;
  });
}
