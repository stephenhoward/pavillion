import { Model, TranslatedContentModel } from './model.js';

/**
 * Represents translatable content for an event series.
 * Series can have names and descriptions in multiple languages.
 */
export class EventSeriesContent extends Model implements TranslatedContentModel {
  /**
   * @param language - The language code for this content
   * @param name - Optional name/title of the series
   * @param description - Optional description of the series
   * @param imageAlt - Optional alt text for the series image
   */
  constructor(
    public language: string,
    public name: string = '',
    public description: string = '',
    public imageAlt: string = '',
  ) {
    super();
  }

  /**
   * Validates that the content has required information.
   */
  isValid(): boolean {
    return (
      this.language.length > 0 &&
      this.name.length > 0 &&
      this.name.length <= 255 &&
      this.description.length <= 5000
    );
  }

  /**
   * Checks if the content is empty (no name, description, or image alt text).
   */
  isEmpty(): boolean {
    return this.name.length === 0 && this.description.length === 0 && this.imageAlt.length === 0;
  }

  /**
   * Convert to plain object for serialization.
   */
  toObject(): Record<string, any> {
    return {
      language: this.language,
      name: this.name,
      description: this.description,
      imageAlt: this.imageAlt,
    };
  }

  /**
   * Create from plain object.
   */
  static fromObject(obj: Record<string, any>): EventSeriesContent {
    return new EventSeriesContent(
      obj.language,
      obj.name,
      obj.description,
      obj.imageAlt ?? '',
    );
  }
}
