/**
 * Alt text on a translated model: the two operations every image panel needs.
 *
 * "Decorative" is not a stored flag — it is the absence of alt text — so both
 * the editor's mode switch and each parent's image-removal path have to express
 * it by writing the model. They live together here because they are two halves
 * of one definition: `anyLanguageHasAlt` decides which state the editor opens
 * in, and `clearImageAlt` is the only way to reach the other state.
 *
 * **"Described" is derived in three places and they must agree.** This editor
 * asks `anyLanguageHasAlt`, the public site asks `localizedField` (site
 * composable `useLocalizedContent`), and the AS2 `altMap` loop
 * (`src/server/activitypub/model/object/event.ts`) asks whether the value
 * survives a trim. Whitespace is therefore not alt text anywhere: the server
 * trims on write, so a value that only this module counted would seed the
 * editor to Describe and come back Decorative on the next mount, and a value
 * only the site counted would be announced to a screen reader as a description
 * the author never wrote.
 *
 * **Decorative is model-wide.** `localizedField` (the site composable that
 * renders alt text) falls back ACROSS languages — current locale, then English,
 * then the first language holding a non-empty value. Clearing `imageAlt` for one
 * language while another still holds text therefore does NOT make the image
 * decorative: the visitor on the cleared locale is served the other language's
 * alt, describing an image that may no longer exist. That is why
 * `clearImageAlt` clears EVERY language and `anyLanguageHasAlt` spans every
 * language. A per-language variant of either would regress the public render
 * with no failing test, because each half would still be individually correct.
 */

import { TranslatedContentModel, TranslatedModel } from '@/common/model/model';

/**
 * The slice of translated content the alt-text editor and these helpers need.
 * CalendarEventContent, EventSeriesContent, and CalendarContent all satisfy it.
 */
export interface ImageAltContent extends TranslatedContentModel {
  imageAlt: string;
}

/**
 * Reports whether any language on a model carries alt text, which is how the
 * editor's mode is seeded.
 *
 * A whitespace-only value does not count, matching `localizedField` and the
 * AS2 `altMap` loop — the other two derivations of "described" (see the module
 * docblock).
 *
 * @param model - The model to inspect
 * @returns True when at least one language has non-blank alt text
 */
export function anyLanguageHasAlt(model: TranslatedModel<ImageAltContent>): boolean {
  return model.getLanguages().some((lang) => model.content(lang).imageAlt.trim() !== '');
}

/**
 * Drops the alt text on a model in every language, leaving the image
 * decorative.
 *
 * Alt text describes one particular photograph, so it cannot outlive it: on a
 * removal it would be saved with nothing left to describe, and on a replacement
 * it would be saved as a description of the new photograph, which a screen
 * reader would then confidently report.
 *
 * @param model - The working model whose alt text is being retired
 */
export function clearImageAlt(model: TranslatedModel<ImageAltContent>): void {
  for (const language of model.getLanguages()) {
    model.content(language).imageAlt = '';
  }
}
