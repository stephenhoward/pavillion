import { TranslatedModel } from './model.js';
import { EventCategoryContentModel } from './event_category_content.js';

/**
 * Represents an event category (tag) that can be assigned to events within a calendar.
 * Categories help organize and filter events by type, theme, or purpose.
 * Category names are translatable through EventCategoryContent.
 */
export class EventCategoryModel extends TranslatedModel<EventCategoryContentModel> {
  constructor(
    id: string,
    public calendarId: string,
  ) {
    super(id);
  }

  /**
   * Creates new content for a specified language.
   *
   * @param {string} language - The language code to create content for
   * @returns {EventCategoryContentModel} New content instance for the specified language
   * @protected
   */
  protected createContent(language: string): EventCategoryContentModel {
    return new EventCategoryContentModel(language);
  }

  /**
   * Validates that the category has required information.
   */
  isValid(): boolean {
    return (
      this.calendarId.length > 0 &&
      this.getLanguages().length > 0 &&
      this.getLanguages().every(lang => this.hasContent(lang))
    );
  }

  /**
   * Convert to plain object for serialization.
   */
  toObject(): Record<string, any> {
    return {
      id: this.id,
      calendarId: this.calendarId,
      content: Object.fromEntries(
        Object.entries(this._content)
          .map(([language, content]: [string, EventCategoryContentModel]) => [language, content.toObject()]),
      ),
    };
  }

  /**
   * Create from plain object.
   */
  static fromObject(obj: Record<string, any>): EventCategoryModel {
    const category = new EventCategoryModel(
      obj.id,
      obj.calendarId,
    );

    if (obj.content) {
      for (const [language, contentObj] of Object.entries(obj.content)) {
        if (typeof contentObj === 'object' && contentObj !== null) {
          const contentData = contentObj as Record<string, any>;
          contentData.language = language; // Ensure language is set
          const content = EventCategoryContentModel.fromObject(contentData);
          category.addContent(content);
        }
      }
    }

    return category;
  }
}
