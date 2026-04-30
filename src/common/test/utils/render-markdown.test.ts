// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { renderPolicyMarkdown } from '@/common/utils/render-markdown';

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

    it('preserves headings and paragraphs', () => {
      const output = renderPolicyMarkdown('# Title\n\nA paragraph.');
      expect(output).toContain('<h1>');
      expect(output).toContain('Title');
      expect(output).toContain('<p>');
      expect(output).toContain('A paragraph.');
    });
  });
});
