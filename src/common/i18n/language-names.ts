import iso6391 from 'iso-639-1-dir';

/**
 * Names a content language in the reader's UI locale, for prose that embeds a
 * language name (e.g. "Image description (anglais)" in a French UI).
 *
 * Language pickers deliberately show each language's native name instead, so
 * a reader who does not read the current UI language can still find theirs;
 * this helper is not for those.
 *
 * Falls back to the English name from `iso-639-1-dir`, then to the code
 * itself, when `Intl.DisplayNames` has no name or rejects the locale or code.
 *
 * @param code - ISO 639-1 code of the language being named
 * @param uiLocale - The active UI locale the name is rendered in
 * @returns The language's display name
 */
export function languageDisplayName(code: string, uiLocale: string): string {
  try {
    const name = new Intl.DisplayNames([uiLocale], { type: 'language', fallback: 'none' }).of(code);
    if (name) {
      return name;
    }
  }
  catch {
    // Invalid locale or code: use the fallbacks below.
  }
  return iso6391.getName(code) || code;
}
