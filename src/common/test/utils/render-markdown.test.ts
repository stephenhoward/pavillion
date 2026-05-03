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
];

/**
 * Forbidden tag names. The opening-tag check is case-insensitive and
 * matches a `<tag` token boundary so that allowed content (e.g. an
 * inline `<a>` link) is never mistaken for a forbidden tag.
 */
const FORBIDDEN_TAGS = ['script', 'iframe', 'object', 'base', 'style', 'svg', 'animate', 'embed', 'form'];

/**
 * Forbidden attributes — inline event handlers and identity/styling vectors.
 */
const FORBIDDEN_ATTRS = ['onerror', 'onload', 'onbegin', 'onclick', 'onmouseover', 'onfocus'];

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

        // No inline event-handler attributes.
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
    it('rejects raw <script> tags', () => {
      expect(isPolicySourceSafe('<script>alert(1)</script>')).toBe(false);
    });

    it('rejects <iframe> tags', () => {
      expect(isPolicySourceSafe('<iframe src="https://evil.example"></iframe>')).toBe(false);
    });

    it('rejects <img> with onerror handler', () => {
      expect(isPolicySourceSafe('<img onerror=alert(1) src=x>')).toBe(false);
    });

    it('rejects markdown link with javascript: scheme', () => {
      expect(isPolicySourceSafe('[click](javascript:alert(1))')).toBe(false);
    });

    it('rejects raw <a> with javascript: href', () => {
      expect(isPolicySourceSafe('<a href="javascript:alert(1)">click</a>')).toBe(false);
    });

    it('rejects markdown image with data: URI', () => {
      expect(isPolicySourceSafe('![img](data:image/svg+xml,<svg onload=alert(1)>)')).toBe(false);
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
