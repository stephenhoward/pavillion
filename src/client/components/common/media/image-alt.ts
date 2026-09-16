/**
 * Alt text on a translated model: the two operations every image panel needs.
 *
 * "Decorative" is not a stored flag — it is the absence of alt text — so both
 * the editor's mode switch and each parent's image-removal path have to express
 * it by writing the model. They live together here because they are two halves
 * of one definition: `anyLanguageHasAlt` is what "described" means in storage,
 * and `clearImageAlt` is the only way to reach the other state.
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
 * Reports whether any language on a model carries alt text. This is what
 * "describe" means in storage, so it is also how the editor's mode is seeded.
 *
 * @param model - The model to inspect
 * @returns True when at least one language has non-empty alt text
 */
export function anyLanguageHasAlt(model: TranslatedModel<ImageAltContent>): boolean {
  return model.getLanguages().some((lang) => model.content(lang).imageAlt !== '');
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
