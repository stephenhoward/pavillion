import { ValidationError } from '@/common/exceptions/base';
import { toPlainText } from '@/server/common/helper/plain-text';

/**
 * Maximum length of a stored image alt text, in characters, measured after
 * normalization and trimming. Screen readers read alt text in one breath, so
 * this is a generous ceiling rather than a target length.
 */
export const IMAGE_ALT_MAX_LENGTH = 500;

/**
 * Validates and normalizes an image alt text on its way into storage. This is
 * the sole write-side entry point for `imageAlt`, shared by the event, series,
 * and calendar content write paths, so rendering and federation can trust the
 * stored value.
 *
 * Order is normalize -> trim -> cap, so the length the caller is told about is
 * the length of the value that would have been stored. An over-long value is
 * rejected and never truncated: silently shortening a description would change
 * its meaning without telling its author.
 *
 * @param {unknown} raw - Raw alt text from a request body
 * @returns {string} Normalized alt text ('' meaning "no alt in this language")
 * @throws {ValidationError} When the input is a non-string, or is longer than
 *   {@link IMAGE_ALT_MAX_LENGTH} once normalized
 */
export function validateImageAlt(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw !== 'string') {
    throw new ValidationError('imageAlt must be a string', {
      imageAlt: ['must be a string'],
    });
  }

  const normalized = toPlainText(raw).trim();
  if (normalized.length > IMAGE_ALT_MAX_LENGTH) {
    throw new ValidationError(`imageAlt must be ${IMAGE_ALT_MAX_LENGTH} characters or fewer`, {
      imageAlt: [`must be ${IMAGE_ALT_MAX_LENGTH} characters or fewer`],
    });
  }
  return normalized;
}
