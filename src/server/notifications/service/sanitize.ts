import striptags from 'striptags';
import he from 'he';

/**
 * Bidi control characters to strip from snapshot text before storage.
 * These can be used to spoof displayed text direction (Trojan Source class).
 *
 * Covered:
 * - U+061C ALM (Arabic Letter Mark)
 * - U+200E LRM (Left-to-Right Mark)
 * - U+200F RLM (Right-to-Left Mark)
 * - U+202A LRE (Left-to-Right Embedding)
 * - U+202B RLE (Right-to-Left Embedding)
 * - U+202C PDF (Pop Directional Formatting)
 * - U+202D LRO (Left-to-Right Override)
 * - U+202E RLO (Right-to-Left Override)
 * - U+2066 LRI (Left-to-Right Isolate)
 * - U+2067 RLI (Right-to-Left Isolate)
 * - U+2068 FSI (First Strong Isolate)
 * - U+2069 PDI (Pop Directional Isolate)
 */
const BIDI_CONTROL_RE = /[؜‎‏‪-‮⁦-⁩]/g;

/**
 * Sanitizes a snapshot text field (e.g. `actor_display_name`, `object_label`)
 * before it is persisted in a notification row.
 *
 * Steps:
 * 1. Return '' for null/undefined input (trust-boundary guard)
 * 2. Decode HTML entities (e.g. `&lt;script&gt;` → `<script>`)
 * 3. Strip HTML tags using a well-tested library
 * 4. Remove Unicode bidirectional control characters
 * 5. Truncate to `maxLen` characters, trimming any trailing unpaired
 *    high surrogate so we never emit invalid UTF-16
 *
 * This is defense-in-depth: clients must still render the result as plain text
 * (never `v-html` or any HTML-rendering context).
 *
 * @param {string} text - Raw user-supplied or federated text
 * @param {number} maxLen - Maximum character length of the returned string
 * @returns {string} Sanitized text, safe for storage
 */
export function sanitize(text: string, maxLen: number): string {
  // Step 1: Nullish guard — helper sits at a trust boundary and may receive
  // nullable values (e.g. `object_label`); `he.decode` throws on null/undefined.
  if (text == null) return '';

  // Step 2: Decode HTML entities so that encoded tags become real tags
  // before we strip them (e.g. &lt;script&gt; → <script>)
  const decoded = he.decode(text);

  // Step 3: Strip any remaining HTML tags
  const stripped = striptags(decoded);

  // Step 4: Remove bidi control characters
  const noBidi = stripped.replace(BIDI_CONTROL_RE, '');

  // Step 5: Truncate, then trim a trailing unpaired high surrogate so the
  // result is never an invalid UTF-16 sequence.
  let result = noBidi.slice(0, maxLen);
  const lastCode = result.charCodeAt(result.length - 1);
  if (lastCode >= 0xD800 && lastCode <= 0xDBFF) {
    result = result.slice(0, -1);
  }
  return result;
}
