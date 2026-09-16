import { describe, it, expect } from 'vitest';

import { toPlainText } from '@/server/common/helper/plain-text';

describe('toPlainText', () => {
  // ---------------------------------------------------------------------------
  // Nullish and non-string inputs
  // ---------------------------------------------------------------------------

  it('should return empty string for null input', () => {
    expect(toPlainText(null)).toBe('');
  });

  it('should return empty string for undefined input', () => {
    expect(toPlainText(undefined)).toBe('');
  });

  it('should return empty string for a non-string input', () => {
    expect(toPlainText({ alt: 'text' })).toBe('');
    expect(toPlainText(42)).toBe('');
  });

  it('should handle an empty string', () => {
    expect(toPlainText('')).toBe('');
  });

  // ---------------------------------------------------------------------------
  // HTML stripping and entity decoding
  // ---------------------------------------------------------------------------

  it('should strip HTML tags', () => {
    expect(toPlainText('<b>x</b>')).toBe('x');
  });

  it('should decode HTML entities before stripping tags', () => {
    expect(toPlainText('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('alert(1)');
  });

  it('should preserve benign decoded entities', () => {
    expect(toPlainText('Alice &amp; Bob')).toBe('Alice & Bob');
  });

  // ---------------------------------------------------------------------------
  // Unicode control classes
  // ---------------------------------------------------------------------------

  it('should remove bidi control characters', () => {
    expect(toPlainText('Alice\u202EBob')).toBe('AliceBob');
    expect(toPlainText('Alice\u061C\u200E\u200F\u2066\u2069Bob')).toBe('AliceBob');
  });

  it('should remove zero-width characters', () => {
    expect(toPlainText('Alice\u200BBob')).toBe('AliceBob');
    expect(toPlainText('Alice\u200C\u200D\u2060\uFEFFBob')).toBe('AliceBob');
  });

  it('should remove C0 control characters other than tab and newline', () => {
    expect(toPlainText('Alice\u0007Bob')).toBe('AliceBob');
    expect(toPlainText('Alice\u0000\u001FBob')).toBe('AliceBob');
  });

  it('should remove DEL and C1 control characters', () => {
    expect(toPlainText('Alice\u007FBob')).toBe('AliceBob');
    expect(toPlainText('Alice\u0085\u009FBob')).toBe('AliceBob');
  });

  // ---------------------------------------------------------------------------
  // Whitespace collapsing
  // ---------------------------------------------------------------------------

  it('should collapse a newline to a single space', () => {
    expect(toPlainText('Alice\nBob')).toBe('Alice Bob');
  });

  it('should collapse a run of newlines and tabs to a single space', () => {
    expect(toPlainText('Alice\n\n\t\nBob')).toBe('Alice Bob');
  });

  it('should collapse a CRLF to a single space', () => {
    // CR is a C0 control and is removed, leaving the newline behind to collapse.
    expect(toPlainText('Alice\r\nBob')).toBe('Alice Bob');
  });

  // ---------------------------------------------------------------------------
  // Ordinary text is left alone
  // ---------------------------------------------------------------------------

  it('should keep ordinary Unicode text unchanged', () => {
    expect(toPlainText('Café Ünicode — 日本語 🎉'))
      .toBe('Café Ünicode — 日本語 🎉');
  });

  it('should keep ordinary interior spaces unchanged', () => {
    expect(toPlainText('  a  b  ')).toBe('  a  b  ');
  });

  // ---------------------------------------------------------------------------
  // The output is plain text, NOT HTML-escaped
  // ---------------------------------------------------------------------------
  //
  // These pin the caller contract: stripping tags is not escaping. Callers
  // rendering into an attribute or any other HTML context must escape at the
  // sink. A change that makes these fail is a change to the contract, not a
  // broken test.

  it('should leave double quotes unescaped', () => {
    expect(toPlainText('A "quoted" dog')).toBe('A "quoted" dog');
  });

  it('should leave single quotes unescaped', () => {
    expect(toPlainText("A dog's beach")).toBe("A dog's beach");
  });

  it('should leave a bare less-than or greater-than unescaped', () => {
    expect(toPlainText('a < b and c > d')).toBe('a < b and c > d');
  });

  it('should leave an attribute-breaking payload intact', () => {
    // Not exploitable at today's sinks (Vue :alt, Handlebars {{ }}), but this
    // is what reaches them — the helper does no escaping of its own.
    expect(toPlainText('" onmouseover="alert(1)')).toBe('" onmouseover="alert(1)');
  });

  // ---------------------------------------------------------------------------
  // Call-exactly-once contract.
  //
  // This helper is deliberately NOT idempotent, and these tests exist so that
  // property is a recorded decision rather than a surprise. It decodes once and
  // strips once, so each pass peels one layer off a double-encoded payload.
  // Running it twice is a double-decode — the entity-smuggling vector that
  // single-decode exists to close — and it also makes the stored value depend
  // on how many times a write path happened to normalize.
  //
  // If someone "fixes" this to be idempotent, that is a security change and
  // needs to be reasoned about, not a cleanup. These tests should fail loudly.
  // ---------------------------------------------------------------------------
  describe('is deliberately not idempotent', () => {
    it('peels exactly one layer off a double-encoded payload per call', () => {
      const doubleEncoded = '&amp;lt;b&amp;gt;bold&amp;lt;/b&amp;gt;';

      const once = toPlainText(doubleEncoded);
      expect(once).toBe('&lt;b&gt;bold&lt;/b&gt;');

      // The second call decodes what the first left encoded and then strips the
      // tag it just revealed. This is why callers must normalize exactly once.
      expect(toPlainText(once)).toBe('bold');
      expect(toPlainText(once)).not.toBe(once);
    });

    it('turns a double-encoded script tag into a live-looking one on a second pass', () => {
      const once = toPlainText('&amp;lt;script&amp;gt;x&amp;lt;/script&amp;gt;');
      expect(once).toBe('&lt;script&gt;x&lt;/script&gt;');
      expect(toPlainText(once)).toBe('x');
    });

    it('is stable for input that was never encoded', () => {
      // The hazard is specific to encoded input; ordinary text is unaffected,
      // which is why a stray second call is easy to miss in review.
      for (const value of ['plain text', 'a dog on a beach', '&lt;b&gt;once&lt;/b&gt;']) {
        expect(toPlainText(toPlainText(value))).toBe(toPlainText(value));
      }
    });
  });
});
