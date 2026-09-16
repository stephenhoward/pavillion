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
 * the write-side entry point for `imageAlt` on **author-facing** paths — the
 * event, series, and calendar content write paths reached by the owner of the
 * content — so rendering and federation can trust the stored value.
 *
 * Input that did not come from an author goes through {@link sanitizeImageAlt}
 * instead: rejecting is only useful when there is someone to show the error to.
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

/**
 * Normalizes an image alt text that arrived from a peer rather than from an
 * author — the inbound federation path (`Create`/`Update(Event)` carrying
 * `pavillion:content`, and the third-party document an `Announce` resolves to).
 *
 * Same normalization as {@link validateImageAlt}, but it never throws. A peer
 * is not a form we can return a validation error to, so rejecting its alt text
 * would mean rejecting the whole inbound event: any peer, hostile or merely
 * sloppy, could then make an event un-ingestable by attaching 501 characters of
 * alt text to it. The field is dropped instead and the rest of the event lands.
 *
 * Dropping rather than truncating keeps the rule of {@link validateImageAlt} —
 * an over-long alt text is never silently shortened, because a half-sentence
 * read out by a screen reader misdescribes the image. Dropping produces the
 * decorative state, which is at least honest about saying nothing.
 *
 * @param {unknown} raw - Alt text from a federated payload
 * @returns {string} Normalized alt text, or '' when absent, not a string, or
 *   longer than {@link IMAGE_ALT_MAX_LENGTH} once normalized
 */
export function sanitizeImageAlt(raw: unknown): string {
  // toPlainText already returns '' for nullish and non-string input.
  const normalized = toPlainText(raw).trim();
  return normalized.length > IMAGE_ALT_MAX_LENGTH ? '' : normalized;
}
