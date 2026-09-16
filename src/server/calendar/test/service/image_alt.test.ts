import { describe, it, expect } from 'vitest';

import { ValidationError } from '@/common/exceptions/base';
import { IMAGE_ALT_MAX_LENGTH, validateImageAlt } from '@/server/calendar/service/image_alt';

describe('validateImageAlt', () => {
  // ---------------------------------------------------------------------------
  // Absent values
  // ---------------------------------------------------------------------------

  it('should return empty string for null', () => {
    expect(validateImageAlt(null)).toBe('');
  });

  it('should return empty string for undefined', () => {
    expect(validateImageAlt(undefined)).toBe('');
  });

  it('should return empty string for a whitespace-only value', () => {
    expect(validateImageAlt('   \n\t ')).toBe('');
  });

  it('should return empty string for a value that normalizes away entirely', () => {
    expect(validateImageAlt('<b></b>​‮')).toBe('');
  });

  // ---------------------------------------------------------------------------
  // Normalization
  // ---------------------------------------------------------------------------

  it('should trim surrounding whitespace', () => {
    expect(validateImageAlt('  A dog on a beach  ')).toBe('A dog on a beach');
  });

  it('should strip markup and control characters', () => {
    expect(validateImageAlt('<b>A dog</b>​on a beach')).toBe('A dogon a beach');
  });

  it('should collapse newlines introduced by a textarea to spaces', () => {
    expect(validateImageAlt('A dog\non a beach')).toBe('A dog on a beach');
  });

  it('should keep ordinary Unicode text', () => {
    expect(validateImageAlt('Un chien sur la plage')).toBe('Un chien sur la plage');
  });

  // ---------------------------------------------------------------------------
  // Length cap
  // ---------------------------------------------------------------------------

  it('should expose a 500 character cap', () => {
    expect(IMAGE_ALT_MAX_LENGTH).toBe(500);
  });

  it('should accept exactly the cap length after normalization', () => {
    const result = validateImageAlt('a'.repeat(IMAGE_ALT_MAX_LENGTH));
    expect(result.length).toBe(IMAGE_ALT_MAX_LENGTH);
  });

  it('should accept input that only fits the cap once normalized', () => {
    // Markup and padding are removed before the cap is measured, so the
    // rejected length and the stored value never disagree.
    const raw = '  <b>' + 'a'.repeat(IMAGE_ALT_MAX_LENGTH) + '</b>  ';
    expect(validateImageAlt(raw).length).toBe(IMAGE_ALT_MAX_LENGTH);
  });

  it('should reject one character over the cap', () => {
    expect(() => validateImageAlt('a'.repeat(IMAGE_ALT_MAX_LENGTH + 1))).toThrow(ValidationError);
  });

  it('should flag the imageAlt field when rejecting an over-long value', () => {
    try {
      validateImageAlt('a'.repeat(IMAGE_ALT_MAX_LENGTH + 1));
      expect.unreachable('validateImageAlt should have thrown');
    }
    catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).fields).toHaveProperty('imageAlt');
    }
  });

  it('should never truncate an over-long value', () => {
    expect(() => validateImageAlt('a'.repeat(5000))).toThrow(ValidationError);
  });

  // ---------------------------------------------------------------------------
  // Type guard
  // ---------------------------------------------------------------------------

  it('should reject a non-string value', () => {
    expect(() => validateImageAlt(42)).toThrow(ValidationError);
    expect(() => validateImageAlt({ en: 'alt' })).toThrow(ValidationError);
  });
});
