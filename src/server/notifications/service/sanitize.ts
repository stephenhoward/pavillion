import { toPlainText } from '@/server/common/helper/plain-text';

/**
 * Sanitizes a snapshot text field (e.g. `actor_display_name`, `object_label`)
 * before it is persisted in a notification row.
 *
 * Steps:
 * 1. Reduce the input to plain text with {@link toPlainText}: nullish and
 *    non-string values become '', HTML entities are decoded, tags are
 *    stripped, and bidi controls, zero-width characters and C0/C1 controls
 *    other than tab/newline are removed (tab and newline collapse to spaces)
 * 2. Truncate to `maxLen` characters, trimming any trailing unpaired
 *    high surrogate so we never emit invalid UTF-16
 *
 * This is defense-in-depth. The result is NOT HTML-escaped: stripping tags is
 * not escaping, so `"`, `'` and bare `<`/`>` survive (see {@link toPlainText}).
 * Escaping is the caller's obligation at the sink — never `v-html` or any other
 * HTML-rendering context.
 *
 * @param {string} text - Raw user-supplied or federated text
 * @param {number} maxLen - Maximum character length of the returned string
 * @returns {string} Sanitized plain text, safe to store; escape it at the sink
 */
export function sanitize(text: string, maxLen: number): string {
  // Step 1: Normalize to plain text (includes the nullish guard)
  const normalized = toPlainText(text);

  // Step 2: Truncate, then trim a trailing unpaired high surrogate so the
  // result is never an invalid UTF-16 sequence.
  let result = normalized.slice(0, maxLen);
  const lastCode = result.charCodeAt(result.length - 1);
  if (lastCode >= 0xD800 && lastCode <= 0xDBFF) {
    result = result.slice(0, -1);
  }
  return result;
}
