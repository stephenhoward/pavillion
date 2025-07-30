import { Model, TranslatedContentModel } from './model.js';

/**
 * Represents translatable content for an event category.
 * Categories can have names in multiple languages.
 */
export class EventCategoryContent extends Model implements TranslatedContentModel {
  constructor(
    public language: string,
    public name: string = '',
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
      this.name.length <= 100
    );
  }

  /**
   * Checks if the content is empty (no name).
   */
  isEmpty(): boolean {
    return this.name.length === 0;
  }

  /**
   * Convert to plain object for serialization.
   */
  toObject(): Record<string, any> {
    return {
      language: this.language,
      name: this.name,
    };
  }

  /**
   * Create from plain object.
   */
  static fromObject(obj: Record<string, any>): EventCategoryContent {
    return new EventCategoryContent(
      obj.language,
      obj.name,
    );
  }
}
