import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

/**
 * Closed allowlist of HTML tags permitted in rendered policy markdown.
 * Anything not in this list is stripped by DOMPurify (Layer 2).
 */
const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'u', 's',
  'ul', 'ol', 'li',
  // h1 omitted: the page already renders a site-level <h1> in root.vue, and
  // a second h1 in admin-authored policy content would break heading hierarchy.
  // h4-h6 omitted: a single policy document does not need 4+ levels of nesting.
  'h2', 'h3',
  'a', 'blockquote', 'code', 'pre', 'hr',
];

/**
 * Closed allowlist of attributes permitted on allowed tags.
 * `style`, `class`, `id`, etc. are explicitly forbidden via FORBID_ATTR.
 */
const ALLOWED_ATTR = ['href', 'target', 'rel'];

/**
 * Tags explicitly forbidden even if they would otherwise be allowed.
 * Defense-in-depth against allowlist drift.
 */
const FORBID_TAGS = ['script', 'iframe', 'embed', 'object', 'form', 'input', 'style', 'base', 'svg'];

/**
 * Attributes explicitly forbidden on any tag.
 * Blocks inline-style and other styling/identity vectors.
 */
const FORBID_ATTR = ['style', 'class', 'id', 'srcset'];

/**
 * URI scheme allowlist for `href` attributes.
 * Permits `http(s):` and `mailto:` only; blocks `javascript:`, `data:`, etc.
 */
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

/**
 * Shared DOMPurify configuration used by both `renderPolicyMarkdown`
 * (sanitizes parsed markdown for view-time rendering) and
 * `isPolicySourceSafe` (validates that markdown source survives the
 * sanitization pipeline unchanged at save time).
 */
const POLICY_PURIFY_CONFIG = {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  FORBID_TAGS,
  FORBID_ATTR,
  ALLOW_DATA_ATTR: false,
  ALLOWED_URI_REGEXP,
} as const;

/**
 * Module-private helper that runs Layer 1 of the policy pipeline: parse
 * markdown source to HTML using a single, identical `marked` configuration.
 * Both `renderPolicyMarkdown` (which then sanitizes through DOMPurify) and
 * `isPolicySourceSafe` (which compares the parsed output against the
 * sanitized output to detect strip events) share this helper so the
 * marked options can never drift between the two call sites.
 *
 * `html: false` is passed as a security signal documenting intent (no
 * raw-HTML passthrough at parse time). marked >=15 ignores the flag and
 * always passes raw HTML through, so DOMPurify in Layer 2 is the
 * authoritative defense; we keep the option for forward-compatibility and
 * contract-clarity.
 */
function parsePolicyMarkdown(source: string): string {
  return marked.parse(source, {
    async: false,
    gfm: true,
    breaks: false,
    html: false,
  } as Parameters<typeof marked.parse>[1]) as string;
}

/**
 * Render markdown source through a two-layer sanitization pipeline producing
 * safe HTML suitable for storage and `v-html` rendering.
 *
 * Layer 1 — `marked` parses markdown source into HTML.
 *
 * Layer 2 — DOMPurify sanitizes the parsed HTML against a closed allowlist of
 * tags, attributes, and URI schemes. This is the authoritative defense:
 * anything dangerous emitted by Layer 1 (raw `<script>`, javascript: URLs,
 * inline event handlers, etc.) is stripped here.
 *
 * The same module runs in Node (via `isomorphic-dompurify`'s jsdom backend)
 * and in browsers without environment branching.
 *
 * @param source - Untrusted markdown (or HTML) input
 * @returns Sanitized HTML safe for storage and rendering via `v-html`
 */
export function renderPolicyMarkdown(source: string): string {
  const html = parsePolicyMarkdown(source);
  return DOMPurify.sanitize(html, POLICY_PURIFY_CONFIG);
}

/**
 * Predicate used by the persistence layer to decide whether a markdown
 * source string can be stored as-is. Runs the same two-layer pipeline as
 * `renderPolicyMarkdown`, then compares the raw marked output against the
 * DOMPurify-sanitized output. If DOMPurify would strip or rewrite
 * anything (a forbidden tag, attribute, or URI scheme), the strings differ
 * and the source is rejected.
 *
 * Intent: store markdown source at rest, not pre-rendered HTML. The render
 * happens at view time. The save-time check refuses dangerous input rather
 * than silently downgrading it to safe HTML, so the editor and the public
 * page render identical content.
 *
 * @param source - Markdown source to validate
 * @returns true if the source survives the sanitization pipeline unchanged
 */
export function isPolicySourceSafe(source: string): boolean {
  const html = parsePolicyMarkdown(source);
  const purified = DOMPurify.sanitize(html, POLICY_PURIFY_CONFIG);
  return html === purified;
}
