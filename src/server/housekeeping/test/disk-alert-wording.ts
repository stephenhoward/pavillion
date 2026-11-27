/**
 * Shared wording checks for the disk alert copy.
 *
 * The disk alert emails (and the operator guide section they link to) list
 * what could be filling the disk without saying or implying which cause is
 * likely. These words are a tripwire for that rule, not its definition:
 * whether the remaining copy stays conditional is checked in review.
 *
 * Not a test file: disk-alert-copy.test.ts, the disk alert render test and the
 * guide-section check import it.
 */

export type DiskAlertLocale = 'en' | 'es' | 'fr';

/** Words and phrases that rank or imply the likelihood of a cause, per locale. */
export const LIKELIHOOD_WORDS: Record<DiskAlertLocale, readonly string[]> = {
  en: [
    'likely', 'usually', 'probably', 'most often', 'rarely', 'typically', 'commonly',
    'often', 'frequently', 'mostly', 'mainly', 'primarily', 'generally',
  ],
  es: [
    'probablemente', 'normalmente', 'suele', 'suelen', 'raramente', 'rara vez',
    'generalmente', 'a menudo', 'con frecuencia', 'habitualmente', 'principalmente',
  ],
  fr: [
    'probablement', 'généralement', 'souvent', 'rarement', 'habituellement',
    'le plus souvent', 'en général', 'fréquemment', 'principalement', 'surtout',
  ],
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: '\'',
  nbsp: ' ',
};

/**
 * Decodes the HTML entities Handlebars and email markup produce: the named
 * ones above and every numeric (decimal or hex) reference.
 */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, ref: string) => {
    if (ref[0] === '#') {
      const codePoint = ref[1] === 'x' || ref[1] === 'X'
        ? parseInt(ref.slice(2), 16)
        : parseInt(ref.slice(1), 10);
      return String.fromCodePoint(codePoint);
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? match;
  });
}

/**
 * Reduces an email subject or body (text or HTML) to comparable prose:
 * strips tags, decodes entities, normalizes to NFC, lowercases and collapses
 * whitespace.
 *
 * @param body - Subject, text body, HTML body or locale string
 * @returns The normalized prose
 */
export function normalize(body: string): string {
  return decodeEntities(body.replace(/<[^>]*>/g, ' '))
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits normalized prose into letter tokens (Unicode-aware). */
function tokens(text: string): string[] {
  return text.split(/[^\p{L}]+/u).filter(token => token.length > 0);
}

/**
 * Finds the first word or phrase from `words` that appears in `text` as whole
 * tokens. A phrase matches only on token boundaries and a word never matches
 * inside a longer one, so "soften" does not match "often".
 *
 * @param text - Subject, body or locale string (normalized here)
 * @param words - Words or multi-word phrases to look for
 * @returns The offending word or phrase, or null when none appears
 */
export function findLikelihoodWord(text: string, words: readonly string[]): string | null {
  const haystack = tokens(normalize(text));
  for (const word of words) {
    const needle = tokens(normalize(word));
    if (needle.length === 0) {
      continue;
    }
    for (let start = 0; start + needle.length <= haystack.length; start++) {
      if (needle.every((token, offset) => haystack[start + offset] === token)) {
        return word;
      }
    }
  }
  return null;
}
