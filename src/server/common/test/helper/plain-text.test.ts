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
});
