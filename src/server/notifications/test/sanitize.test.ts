import { describe, it, expect } from 'vitest';

import { sanitize } from '@/server/notifications/service/sanitize';

describe('sanitize', () => {
  // ---------------------------------------------------------------------------
  // Plain / empty inputs
  // ---------------------------------------------------------------------------

  it('should return a plain string unchanged', () => {
    expect(sanitize('Alice Bob', 256)).toBe('Alice Bob');
  });

  it('should handle an empty string', () => {
    expect(sanitize('', 256)).toBe('');
  });

  it('should return empty string for null input', () => {
    expect(sanitize(null as unknown as string, 256)).toBe('');
  });

  it('should return empty string for undefined input', () => {
    expect(sanitize(undefined as unknown as string, 256)).toBe('');
  });

  // ---------------------------------------------------------------------------
  // HTML stripping
  // ---------------------------------------------------------------------------

  it('should strip HTML tags', () => {
    expect(sanitize('<b>Alice</b>', 256)).toBe('Alice');
  });

  it('should strip nested tags', () => {
    expect(sanitize('<div><span>Name</span></div>', 256)).toBe('Name');
  });

  // ---------------------------------------------------------------------------
  // Entity decoding (must happen before stripping)
  // ---------------------------------------------------------------------------

  it('should decode HTML entities before stripping tags', () => {
    // &lt;script&gt; decodes to <script>, which should then be stripped
    expect(sanitize('&lt;script&gt;alert(1)&lt;/script&gt;', 256)).toBe('alert(1)');
  });

  it('should decode benign HTML entities correctly', () => {
    expect(sanitize('Alice &amp; Bob', 256)).toBe('Alice & Bob');
  });

  // ---------------------------------------------------------------------------
  // Bidi control characters
  // ---------------------------------------------------------------------------

  it('should remove Unicode bidi control character U+200F', () => {
    expect(sanitize('Alice\u200FBob', 256)).toBe('AliceBob');
  });

  it('should remove Unicode bidi control character U+202E', () => {
    expect(sanitize('Alice\u202EBob', 256)).toBe('AliceBob');
  });

  it('should remove Unicode bidi control characters in range U+2066-U+2069', () => {
    expect(sanitize('Alice\u2066\u2067\u2068\u2069Bob', 256)).toBe('AliceBob');
  });

  it('should remove Unicode bidi control character U+061C (ALM)', () => {
    expect(sanitize('Alice\u061cBob', 256)).toBe('AliceBob');
  });

  it('should remove Unicode bidi control character U+200E (LRM)', () => {
    expect(sanitize('Alice\u200eBob', 256)).toBe('AliceBob');
  });

  it('should remove Unicode bidi control character U+202A (LRE)', () => {
    expect(sanitize('Alice\u202aBob', 256)).toBe('AliceBob');
  });

  it('should remove Unicode bidi control character U+202B (RLE)', () => {
    expect(sanitize('Alice\u202bBob', 256)).toBe('AliceBob');
  });

  it('should remove Unicode bidi control character U+202C (PDF)', () => {
    expect(sanitize('Alice\u202cBob', 256)).toBe('AliceBob');
  });

  it('should remove Unicode bidi control character U+202D (LRO)', () => {
    // LRO is the most weaponizable for visual spoofing of actor/event names.
    expect(sanitize('Alice\u202dBob', 256)).toBe('AliceBob');
  });

  // ---------------------------------------------------------------------------
  // Length truncation
  // ---------------------------------------------------------------------------

  it('should truncate to maxLen=256 characters', () => {
    const result = sanitize('a'.repeat(300), 256);
    expect(result.length).toBe(256);
  });

  it('should truncate to maxLen=512 characters', () => {
    const result = sanitize('a'.repeat(600), 512);
    expect(result.length).toBe(512);
  });

  it('should not pad short strings to maxLen', () => {
    expect(sanitize('Alice', 256).length).toBe(5);
  });

  it('should truncate after stripping tags', () => {
    // 300-char string wrapped in tags — stripped result is 300 chars, truncated to 256
    const longName = '<b>' + 'a'.repeat(300) + '</b>';
    const result = sanitize(longName, 256);
    expect(result.length).toBe(256);
  });

  // ---------------------------------------------------------------------------
  // Mixed inputs
  // ---------------------------------------------------------------------------

  it('should handle entity-encoded HTML containing bidi controls', () => {
    // &lt;b&gt;Alice\u200FBob&lt;/b&gt; → <b>Alice\u200FBob</b> → Alice\u200FBob → AliceBob
    const input = '&lt;b&gt;Alice\u200FBob&lt;/b&gt;';
    expect(sanitize(input, 256)).toBe('AliceBob');
  });

  it('should handle mixed HTML, entities, and bidi controls', () => {
    // <i>Alice</i>&amp;\u202EBob → AliceBob with & preserved and bidi stripped
    const input = '<i>Alice</i>&amp;\u202EBob';
    expect(sanitize(input, 256)).toBe('Alice&Bob');
  });

  it('should truncate a mixed input with HTML and bidi controls', () => {
    const input = '<b>' + 'a'.repeat(300) + '\u200F' + 'b'.repeat(300) + '</b>';
    const result = sanitize(input, 512);
    expect(result.length).toBe(512);
    // No HTML tags or bidi chars survive
    expect(result).not.toMatch(/<|>|\u200F/);
  });

  // ---------------------------------------------------------------------------
  // UTF-16 surrogate-pair safety
  // ---------------------------------------------------------------------------

  it('should not leave a trailing unpaired high surrogate after truncation', () => {
    // '\uD83D\uDE00' is U+1F600, a surrogate pair (2 UTF-16 code units). A repeat of 200
    // emojis is 400 code units; truncating to an odd boundary like 255 would
    // otherwise split the final pair.
    const result = sanitize('\uD83D\uDE00'.repeat(200), 255);
    const lastCode = result.charCodeAt(result.length - 1);
    expect(lastCode < 0xD800 || lastCode > 0xDBFF).toBe(true);
  });

  it('should not split a surrogate pair when truncating to maxLen=256', () => {
    const result = sanitize('\uD83D\uDE00'.repeat(200), 256);
    const lastCode = result.charCodeAt(result.length - 1);
    expect(lastCode < 0xD800 || lastCode > 0xDBFF).toBe(true);
  });
});
