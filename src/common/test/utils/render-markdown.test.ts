// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { renderPolicyMarkdown, isPolicySourceSafe } from '@/common/utils/render-markdown';

/**
 * XSS regression suite for the policy-markdown sanitization pipeline.
 *
 * Each row is a known-dangerous payload that must not survive
 * `renderPolicyMarkdown`. The assertions below check that the output
 * contains none of the dangerous tags, attributes, or URI schemes that
 * would re-introduce script execution. This locks the closed-allowlist
 * contract: future changes to ALLOWED_TAGS/ALLOWED_ATTR/ALLOWED_URI_REGEXP
 * must keep these vectors blocked.
 */
const xssVectors: Array<{ name: string; input: string }> = [
  {
    name: 'raw <script> tag',
    input: '<script>alert(1)</script>',
  },
  {
    name: '<img> with onerror handler',
    input: '<img src=x onerror=alert(1)>',
  },
  {
    name: 'markdown link with javascript: scheme',
    input: '[click](javascript:alert(1))',
  },
  {
    name: 'markdown image with data: URL',
    input: '![img](data:image/svg+xml,<svg onload=alert(1)>)',
  },
  {
    name: '<svg> with <animate onbegin>',
    input: '<svg><animate onbegin=alert(1)/></svg>',
  },
  {
    name: '<iframe> tag',
    input: '<iframe src="https://evil.example"></iframe>',
  },
  {
    name: '<object> tag',
    input: '<object data="https://evil.example"></object>',
  },
  {
    name: '<base> tag',
    input: '<base href="https://evil.example/">',
  },
  {
    name: 'raw <style> block',
    input: '<style>body{background:url(javascript:alert(1))}</style>',
  },
  // --- pv-dzy3 corpus expansion: bypass classes the original 9 vectors miss ---
  {
    // MathML mutation-XSS: <math>/<mglyph> are absent from ALLOWED_TAGS. In
    // foreign-content parsing contexts mglyph can be a mutation gadget; this
    // fixture locks the closed allowlist so math/mglyph can never re-enter it.
    name: 'MathML mglyph mXSS wrapper',
    input: '<math><mglyph><img src=x onerror=alert(1)></mglyph></math>',
  },
  {
    // SVG <animate> driving an href to a javascript: value — the URI is in a
    // values= attribute, not directly in href=, so URI-scheme allowlisting on
    // href alone would miss it. svg/animate are forbidden tags; the whole
    // subtree must drop.
    name: 'SVG animate xlink:href values=javascript:',
    input: '<svg><a><animate xlink:href="#x" attributeName="href" values="javascript:alert(1)"/></a></svg>',
  },
  {
    // formaction on a button overrides the form action with a javascript: URI.
    // form is a forbidden tag and formaction is not in ALLOWED_ATTR.
    name: 'form button formaction=javascript:',
    input: '<form><button formaction="javascript:alert(1)">click</button></form>',
  },
  {
    // noscript mutation XSS: the title attribute closes </noscript> early in
    // parsers that switch tokenizer state on noscript, re-materializing the
    // <img onerror> as live markup. noscript is not in ALLOWED_TAGS.
    name: 'noscript mutation XSS via title',
    input: '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></p>',
  },
  {
    // Raw <a href="javascript:..."> reaching DOMPurify directly — the
    // raw-HTML form, distinct from the marked-minted markdown-link form at
    // index 2. Exercises ALLOWED_URI_REGEXP on a literal anchor token.
    name: 'raw anchor javascript: scheme',
    input: '<a href="javascript:alert(1)">click</a>',
  },
  {
    // data:text/html in markdown-link form — a navigable HTML document URI.
    name: 'markdown link data:text/html',
    input: '[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  },
  {
    // data:text/html in raw-anchor form — the same scheme reaching DOMPurify
    // through a literal <a href> rather than through marked.
    name: 'raw anchor data:text/html href',
    input: '<a href="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;">click</a>',
  },
  // --- cure53-derived allowlist-bypass vectors (tag/attribute smuggling) ---
  {
    // <template> holds inert DOM that some sanitizers fail to traverse;
    // template is not in ALLOWED_TAGS and must be stripped with its contents.
    name: 'cure53 template content smuggling',
    input: '<template><img src=x onerror=alert(1)></template>',
  },
  {
    // CSS @import pulling a javascript: stylesheet — style is a forbidden tag.
    name: 'cure53 style @import javascript:',
    input: '<style>@import "javascript:alert(1)";</style>',
  },
  {
    // <details ontoggle> — event handler on a non-allowlisted interactive tag.
    name: 'cure53 details ontoggle handler',
    input: '<details open ontoggle=alert(1)>x</details>',
  },
  {
    // <marquee onstart> — legacy element with an event handler; marquee is not
    // in ALLOWED_TAGS.
    name: 'cure53 marquee onstart handler',
    input: '<marquee onstart=alert(1)>x</marquee>',
  },
];

/**
 * Forbidden tag names. The opening-tag check is case-insensitive and
 * matches a `<tag` token boundary so that allowed content (e.g. an
 * inline `<a>` link) is never mistaken for a forbidden tag.
 */
const FORBIDDEN_TAGS = [
  'script', 'iframe', 'object', 'base', 'style', 'svg', 'animate', 'embed', 'form',
  // pv-dzy3 additions — closed-allowlist drift guards
  'math', 'mglyph', 'template', 'noscript', 'marquee', 'details', 'button',
];

/**
 * Forbidden attributes — inline event handlers and identity/styling vectors.
 */
const FORBIDDEN_ATTRS = [
  'onerror', 'onload', 'onbegin', 'onclick', 'onmouseover', 'onfocus',
  // pv-dzy3 additions — formaction (action-override) and ontoggle/onstart handlers
  'formaction', 'ontoggle', 'onstart', 'xlink:href',
];

/**
 * Forbidden URI schemes that must never appear in attribute-position
 * (i.e. wired into `href=`/`src=`). Plain-text occurrences of these
 * tokens left in document content are not exploitable — only attribute
 * placement permits script execution. The regex matches each scheme
 * preceded by `=` or `="`/`='` to anchor the attribute context.
 */
const FORBIDDEN_PROTOCOLS = ['javascript:', 'data:', 'vbscript:'];
const ATTR_PROTOCOL_REGEXES = FORBIDDEN_PROTOCOLS.map(
  (proto) => new RegExp(`=\\s*["']?\\s*${proto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
);

describe('renderPolicyMarkdown', () => {
  describe('XSS sanitization', () => {
    for (const { name, input } of xssVectors) {
      it(`strips dangerous content from: ${name}`, () => {
        const output = renderPolicyMarkdown(input);

        // No forbidden tag opening sequences (e.g. "<script", "<iframe").
        for (const tag of FORBIDDEN_TAGS) {
          expect(output.toLowerCase()).not.toMatch(new RegExp(`<${tag}\\b`, 'i'));
        }

        // No LIVE inline event-handler attribute. Anchored to a live tag run
        // (`<...on*=`) the way the AP expectInert helper does, so a payload that
        // renders as escaped, inert TEXT (e.g. a code-fenced `&lt;img onerror=`)
        // does not false-fail merely because the substring survives as content.
        expect(output).not.toMatch(/<[^>]*\son\w+\s*=/i);

        // Belt-and-suspenders substring check for the specific handler/attribute
        // tokens. Safe for current fixtures (none render the token as inert
        // text); kept alongside the live-tag-run regex above for defense in depth.
        for (const attr of FORBIDDEN_ATTRS) {
          expect(output.toLowerCase()).not.toContain(attr);
        }

        // No dangerous URI schemes wired into attribute values.
        for (const re of ATTR_PROTOCOL_REGEXES) {
          expect(output).not.toMatch(re);
        }
      });
    }
  });

  describe('safe content survives sanitization', () => {
    it('preserves bold markdown', () => {
      const output = renderPolicyMarkdown('**bold**');
      expect(output).toContain('<strong>bold</strong>');
    });

    it('preserves https links', () => {
      const output = renderPolicyMarkdown('[link](https://example.com)');
      expect(output).toContain('href="https://example.com"');
      expect(output).toContain('link');
    });

    it('preserves h2/h3 headings and paragraphs', () => {
      // h1 is intentionally excluded from ALLOWED_TAGS — the page already
      // carries a site-level h1, and a second h1 in admin-authored policy
      // content would break heading hierarchy.
      const output = renderPolicyMarkdown('## Section\n\nA paragraph.\n\n### Subsection');
      expect(output).toContain('<h2>');
      expect(output).toContain('Section');
      expect(output).toContain('<h3>');
      expect(output).toContain('Subsection');
      expect(output).toContain('<p>');
      expect(output).toContain('A paragraph.');
    });

    it('strips h1 from admin-authored content (page already has site h1)', () => {
      const output = renderPolicyMarkdown('# Should be stripped');
      expect(output).not.toContain('<h1');
      // Content text is preserved (DOMPurify keeps inner text when stripping the wrapper tag)
      expect(output).toContain('Should be stripped');
    });
  });
});

/**
 * Direct unit tests for the `isPolicySourceSafe` predicate. The predicate
 * runs Layer 1 (marked) and Layer 2 (DOMPurify) and reports whether
 * DOMPurify would strip or rewrite anything from the parsed output. The
 * persistence layer uses this to refuse dangerous input rather than
 * silently downgrading it.
 *
 * Tests cover: representative safe markdown round-trips cleanly; each XSS
 * vector class is rejected; and h1 — intentionally absent from
 * ALLOWED_TAGS as an allowlist constraint, not an XSS vector — is
 * rejected so the persistence layer cannot accept content the renderer
 * would silently strip.
 */
describe('isPolicySourceSafe', () => {
  describe('returns true for safe markdown', () => {
    it('accepts h2 headings', () => {
      expect(isPolicySourceSafe('## Section')).toBe(true);
    });

    it('accepts h3 headings', () => {
      expect(isPolicySourceSafe('### Subsection')).toBe(true);
    });

    it('accepts paragraphs', () => {
      expect(isPolicySourceSafe('A simple paragraph of text.')).toBe(true);
    });

    it('accepts unordered lists', () => {
      expect(isPolicySourceSafe('- one\n- two\n- three')).toBe(true);
    });

    it('accepts ordered lists', () => {
      expect(isPolicySourceSafe('1. one\n2. two\n3. three')).toBe(true);
    });

    it('accepts http/https links', () => {
      expect(isPolicySourceSafe('[link](https://example.com)')).toBe(true);
    });

    it('accepts mailto: links', () => {
      expect(isPolicySourceSafe('[mail](mailto:a@b.c)')).toBe(true);
    });

    it('accepts emphasis (em and strong)', () => {
      expect(isPolicySourceSafe('*emph* and **bold**')).toBe(true);
    });

    it('accepts inline code and code blocks', () => {
      expect(isPolicySourceSafe('Some `inline` code.\n\n    block code')).toBe(true);
    });

    it('accepts blockquotes', () => {
      expect(isPolicySourceSafe('> quoted text')).toBe(true);
    });

    // Entity-normalization cases: marked emits &#39; for ASCII apostrophes and
    // &quot; for ASCII double-quotes; DOMPurify normalizes both back to literal
    // characters. Without the normalizeEntitiesForComparison step the strings
    // differ and common English contractions / quoted text are falsely rejected.
    it('accepts ASCII apostrophe in contractions (don\'t)', () => {
      expect(isPolicySourceSafe("don't worry")).toBe(true);
    });

    it('accepts ASCII apostrophe in multiple contractions (can\'t, won\'t, we\'re)', () => {
      expect(isPolicySourceSafe("can't stop, won't stop, we're here")).toBe(true);
    });

    it('accepts ASCII double-quote in text', () => {
      expect(isPolicySourceSafe('She said "hello".')).toBe(true);
    });

    it('accepts mixed apostrophe and double-quote in a heading and paragraph', () => {
      expect(isPolicySourceSafe('## Heading with don\'t and won\'t and "quoted" text')).toBe(true);
    });
  });

  describe('returns false for XSS vectors', () => {
    it('rejects raw <a> with javascript: href', () => {
      expect(isPolicySourceSafe('<a href="javascript:alert(1)">click</a>')).toBe(false);
    });

    // Note: the individual data:-URI and other per-vector cases are covered by
    // the for-loop below, which asserts isPolicySourceSafe(input) === false for
    // every entry in the shared xssVectors corpus (including the data:image/svg
    // markdown-image vector at index 3). No standalone duplicates needed.

    // Every vector in the shared corpus must also be REJECTED by the save-time
    // predicate, not merely stripped at render time. isPolicySourceSafe is a
    // plain boolean (string-equality on the normalized parsed-vs-purified
    // output, render-markdown.ts:155-159) — it never throws, so each dangerous
    // vector asserts `toBe(false)`. This locks the save-time refusal contract
    // alongside the render-time strip contract above.
    for (const { name, input } of xssVectors) {
      it(`rejects: ${name}`, () => {
        expect(isPolicySourceSafe(input)).toBe(false);
      });
    }
  });

  describe('normalization-boundary safe content (numeric/named entities)', () => {
    // normalizeEntitiesForComparison (render-markdown.ts:118-126) decodes only
    // the apostrophe/quote entity family on BOTH sides of the equality check,
    // because marked emits &#39;/&quot; for ASCII ' and " while DOMPurify
    // normalizes them back to literal characters. These fixtures assert the
    // boundary holds: content carrying those numeric entities is accepted
    // (no false-positive strip). &#x3C; (a literal '<') is intentionally NOT
    // in this set — it decodes to a structural char and is correctly rejected.
    it('accepts &#39; numeric apostrophe entity', () => {
      expect(isPolicySourceSafe('it&#39;s here')).toBe(true);
    });

    it('accepts &#x27; hex apostrophe entity', () => {
      expect(isPolicySourceSafe('don&#x27;t stop')).toBe(true);
    });

    it('accepts &#34; numeric double-quote entity', () => {
      expect(isPolicySourceSafe('a &#34;quoted&#34; phrase')).toBe(true);
    });
  });

  describe('returns false for allowlist boundary cases', () => {
    it('rejects h1 headings (intentional allowlist constraint — use h2)', () => {
      // h1 is intentionally absent from ALLOWED_TAGS because the page
      // already carries a site-level h1; admin-authored h1 would break
      // heading hierarchy. This is not an XSS vector, but the predicate
      // must still reject so the persistence layer never stores content
      // the renderer would silently strip.
      expect(isPolicySourceSafe('# Welcome')).toBe(false);
    });
  });
});
