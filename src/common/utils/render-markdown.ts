import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

/**
 * Closed allowlist of HTML tags permitted in rendered policy markdown.
 * Anything not in this list is stripped by DOMPurify (Layer 2).
 */
const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'u', 's',
  'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
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
  // Layer 1: parse markdown into HTML.
  // `html: false` is passed as a security signal documenting intent (no
  // raw-HTML passthrough at parse time). marked >=15 ignores the flag and
  // always passes raw HTML through, so DOMPurify in Layer 2 is the
  // authoritative defense; we keep the option for forward-compatibility and
  // contract-clarity.
  const html = marked.parse(source, {
    async: false,
    gfm: true,
    breaks: false,
    html: false,
  } as Parameters<typeof marked.parse>[1]) as string;

  // Layer 2: DOMPurify with closed allowlist + URI scheme allowlist.
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS,
    FORBID_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP,
  });
}
