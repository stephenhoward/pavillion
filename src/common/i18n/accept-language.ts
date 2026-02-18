/**
 * Parses the Accept-Language HTTP header into an ordered list of language preferences.
 *
 * The Accept-Language header format is defined by RFC 7231:
 * Accept-Language: en-US,en;q=0.9,fr;q=0.8
 *
 * Language codes are normalized to their base language (e.g., en-US → en).
 * Entries without a quality value default to q=1.0.
 * Results are sorted by quality in descending order.
 */

export interface LanguagePreference {
  /** ISO 639-1 base language code (e.g., 'en', 'fr', 'es') */
  language: string;
  /** Quality factor between 0.0 and 1.0 (default: 1.0) */
  quality: number;
}

/**
 * Parses an Accept-Language HTTP header string into an ordered array of language preferences.
 *
 * @param header - The raw Accept-Language header value
 * @returns Array of language preferences sorted by quality (highest first)
 */
export function parseAcceptLanguage(header: string | null | undefined): LanguagePreference[] {
  if (!header || typeof header !== 'string' || header.trim() === '') {
    return [];
  }

  const preferences: LanguagePreference[] = [];

  const entries = header.split(',');

  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }

    const parts = trimmed.split(';');
    const rawLanguage = parts[0].trim();

    if (!rawLanguage) {
      continue;
    }

    // Normalize to base language code (e.g., en-US → en)
    const language = rawLanguage.split('-')[0].toLowerCase();

    // Must be a valid language code (2-3 letter alphabetic code)
    if (!/^[a-z]{2,3}$/.test(language)) {
      continue;
    }

    let quality = 1.0;

    if (parts.length > 1) {
      const qualityPart = parts[1].trim();
      const match = qualityPart.match(/^q\s*=\s*([0-9]*\.?[0-9]+)$/i);

      if (match) {
        const parsed = parseFloat(match[1]);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
          quality = parsed;
        }
      }
    }

    preferences.push({ language, quality });
  }

  // Sort by quality descending, preserving relative order for equal qualities
  preferences.sort((a, b) => b.quality - a.quality);

  return preferences;
}
