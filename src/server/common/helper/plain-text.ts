import striptags from 'striptags';
import he from 'he';

/**
 * Bidi control characters. These can be used to spoof displayed text direction
 * (Trojan Source class).
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
const BIDI_CONTROL_RE = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/**
 * Zero-width characters. They render as nothing, so they let otherwise
 * identical strings differ, and let text hide content from a reader while
 * still carrying it.
 *
 * Covered: U+200B ZWSP, U+200C ZWNJ, U+200D ZWJ, U+2060 word joiner,
 * U+FEFF BOM / zero-width no-break space.
 */
const ZERO_WIDTH_RE = /[\u200B-\u200D\u2060\uFEFF]/g;

/**
 * C0 controls (U+0000-U+001F) except tab and newline, plus DEL (U+007F) and
 * the C1 controls (U+0080-U+009F). Carriage return is removed here; any
 * newline beside it survives to be collapsed below.
 */
// Matching control codepoints is this table's entire purpose, so the rule is
// disabled for this one line rather than weakened for the whole repository.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

/** A run of the tab/newline characters kept by {@link CONTROL_RE}. */
const LINE_BREAK_RUN_RE = /[\t\n]+/g;

/**
 * Reduces arbitrary, possibly hostile text to plain text: no markup, no
 * invisible characters, no control characters.
 *
 * The result is NOT HTML-escaped. Stripping tags is not escaping: `"`, `'`,
 * and any bare `<` or `>` that did not form a well-formed tag survive
 * unchanged, so a value such as `" onmouseover="alert(1)` passes through this
 * helper intact. Every caller must escape at its own sink — an HTML attribute
 * (`alt="..."`, `<meta content="...">`), a text node, or a URL. Vue's `:alt`
 * binding and Handlebars' `{{ }}` do that escaping; raw string concatenation
 * into markup does not, and `v-html` or `{{{ }}}` must never receive this
 * output.
 *
 * Steps:
 * 1. Return '' for null/undefined or non-string input (trust-boundary guard)
 * 2. Decode HTML entities (e.g. `&lt;script&gt;` -> `<script>`)
 * 3. Strip HTML tags using a well-tested library
 * 4. Remove bidi controls, zero-width characters, and C0/C1 controls other
 *    than tab and newline
 * 5. Collapse runs of tabs and newlines to a single space
 *
 * Ordinary spaces are left as they are: this normalizes away what cannot be
 * seen, not the author's spacing. Callers decide about trimming and length.
 *
 * **Call this exactly once on any given value — it is deliberately not
 * idempotent, and a second pass is a security regression, not a no-op.**
 * Step 2 decodes once and step 3 strips once, so a double-encoded payload
 * gives up one layer per pass: `&amp;lt;b&amp;gt;bold&amp;lt;/b&amp;gt;`
 * becomes `&lt;b&gt;bold&lt;/b&gt;` after one call and `bold` after two.
 * Running it twice is therefore a double-decode, which is the entity-smuggling
 * vector single-decode exists to close, and it also makes the stored value
 * depend on how many times the write path happened to normalize. Every write
 * path today calls it exactly once, via `validateImageAlt`/`sanitizeImageAlt`
 * or `sanitize`; a caller that already holds normalized text must not
 * re-normalize it "to be safe".
 *
 * This is defense-in-depth, never the only defense: escaping at the sink is
 * still the caller's obligation.
 *
 * @param {unknown} text - Raw user-supplied or federated text
 * @returns {string} Plain-text form of the input
 */
export function toPlainText(text: unknown): string {
  // Step 1: Nullish/type guard — this helper sits at a trust boundary and may
  // receive nullable or untyped values; `he.decode` throws on non-strings.
  if (text == null || typeof text !== 'string') return '';

  // Step 2: Decode HTML entities so that encoded tags become real tags
  // before we strip them (e.g. &lt;script&gt; -> <script>)
  const decoded = he.decode(text);

  // Step 3: Strip any remaining HTML tags
  const stripped = striptags(decoded);

  // Steps 4 and 5
  return stripped
    .replace(BIDI_CONTROL_RE, '')
    .replace(ZERO_WIDTH_RE, '')
    .replace(CONTROL_RE, '')
    .replace(LINE_BREAK_RUN_RE, ' ');
}
