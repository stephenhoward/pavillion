import iso6391 from 'iso-639-1-dir';

import { ValidationError } from '@/common/exceptions/base';

/**
 * The accepted set of content language codes: every bare ISO 639-1 code, which
 * is exactly what the content editor's language picker offers. This is not the
 * enabled UI-language set (`isValidLanguageCode`), which would reject flows
 * that ship today. A `Set`, so `'__proto__'` is ordinary data, not a lookup
 * on an object prototype.
 */
const ISO_639_1 = new Set<string>(iso6391.getAllCodes());

/**
 * Whether a value is a bare ISO 639-1 language code.
 *
 * @param {unknown} code - Candidate language key
 * @returns {boolean} True only for a string in the ISO 639-1 set
 */
export function isContentLanguageCode(code: unknown): boolean {
  return typeof code === 'string' && ISO_639_1.has(code);
}

/**
 * Validates a language key on an **author-facing** content write.
 *
 * Inbound federation goes through {@link foldContentLanguages} instead:
 * rejecting is only useful when there is someone to show the error to.
 *
 * @param {unknown} code - Language key from a request body
 * @returns {string} The same code, when valid
 * @throws {ValidationError} With a `language` field entry when not a bare ISO 639-1 code
 */
export function validateContentLanguage(code: unknown): string {
  if (!isContentLanguageCode(code)) {
    throw new ValidationError('content language must be an ISO 639-1 language code', {
      language: ['must be an ISO 639-1 language code'],
    });
  }
  return code as string;
}

/**
 * Validates every language key of a content map before any language has been
 * persisted. The per-language write loops hold no transaction, so a throw from
 * inside one would leave earlier languages saved under a 400; a pre-pass keeps
 * the rejection whole. Same reasoning as `validateContentImageAlts`.
 *
 * @param {unknown} content - The payload's `content` map, keyed by language.
 *   Absent and non-object values are skipped.
 * @returns {void}
 * @throws {ValidationError} For the first invalid language key
 */
export function validateContentLanguages(content: unknown): void {
  if (!content || typeof content !== 'object') {
    return;
  }
  for (const language of Object.keys(content as Record<string, unknown>)) {
    validateContentLanguage(language);
  }
}

/**
 * Normalizes the language keys of a content map that arrived from a peer. Never
 * throws: a peer is not a form we can return an error to, and rejecting would
 * make the whole event un-ingestable.
 *
 * Two passes make "exact beats folded" independent of key order. Pass one keeps
 * entries whose key is already a bare ISO 639-1 code. Pass two folds each
 * remaining key to its base subtag (`fr-CA` -> `fr`, `zh-Hant` -> `zh`), taking
 * the slot only when it is still free. When two folded keys compete for one
 * free slot, the first in iteration order wins. Anything else (`__proto__`,
 * `zz`, `und`) is dropped.
 *
 * Folding rather than storing verbatim, because `TranslatedModel.content()` is
 * an exact-match lookup: a stored `fr-CA` row would render for nobody.
 *
 * `null` values are preserved: on update, null means "delete this translation".
 *
 * @param {unknown} content - A federated payload's content map
 * @returns {Record<string, any>} A null-prototype map keyed by bare ISO 639-1 codes
 */
export function foldContentLanguages(content: unknown): Record<string, any> {
  const folded: Record<string, any> = Object.create(null);
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return folded;
  }

  const entries = Object.entries(content as Record<string, any>);

  for (const [key, value] of entries) {
    if (isContentLanguageCode(key)) {
      folded[key] = value;
    }
  }

  for (const [key, value] of entries) {
    if (isContentLanguageCode(key)) continue;
    const base = key.split('-')[0].toLowerCase();
    if (isContentLanguageCode(base) && !(base in folded)) {
      folded[base] = value;
    }
  }

  return folded;
}
