import { Model, TranslatedContentModel } from './model.js';

/**
 * Represents translatable content for an event series.
 * Series can have names and descriptions in multiple languages.
 */
export class EventSeriesContent extends Model implements TranslatedContentModel {
  constructor(
    public language: string,
    public name: string = '',
    public description: string = '',
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
   * Checks if the content is empty (no name or description).
   */
  isEmpty(): boolean {
    return this.name.length === 0 && this.description.length === 0;
  }

  /**
   * Convert to plain object for serialization.
   */
  toObject(): Record<string, any> {
    return {
      language: this.language,
      name: this.name,
      description: this.description,
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
    );
  }
}
