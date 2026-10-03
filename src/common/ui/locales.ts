/**
 * Translation bundles for the shared `ui` namespace.
 *
 * Shared components own the keys they read (see README.md, "i18n"). Each app
 * spreads these into its static i18next `resources` next to its own
 * namespaces; no app defines or overrides a `ui` key.
 *
 * To add a language, add its ui.json beside the others and list it here —
 * test/locales.test.ts fails until every language in AVAILABLE_LANGUAGES has
 * a bundle with the same keys as English.
 */
import en from './calendar-views/locales/en/ui.json';
import es from './calendar-views/locales/es/ui.json';
import fr from './calendar-views/locales/fr/ui.json';

export const uiResources = {
  en: { ui: en },
  es: { ui: es },
  fr: { ui: fr },
} as const;
