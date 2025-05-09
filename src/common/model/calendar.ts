import { Model, TranslatedContentModel, TranslatedModel } from '@/common/model/model';

/**
 * Represents a calendar with multilingual content support.
 * Extends TranslatedModel to manage calendar content in different languages.
 */
class Calendar extends TranslatedModel<CalendarContent> {
  urlName: string = '';
  languages: string[] = ['en'];
  description: string = '';
  _content: Record<string, CalendarContent> = {};

  /**
   * Creates new content for a specified language.
   *
   * @param {string} language - The language code to create content for
   * @returns {CalendarContent} New content instance for the specified language
   * @protected
   */
  protected createContent(language: string): CalendarContent {
    return new CalendarContent(language);
  }

  /**
   * Constructor for Calendar.
   *
   * @param {string} [id] - Unique identifier for the calendar
   * @param {string} [urlName] - URL-friendly name for the calendar
   */
  constructor (id?: string, urlName?: string) {
    super(id);
    this.urlName = urlName ?? '';
  };

  /**
   * Converts the calendar to a plain JavaScript object.
   *
   * @returns {Record<string,any>} Plain object representation of the calendar
   */
  toObject(): Record<string,any> {
    return {
      id: this.id,
      urlName: this.urlName,
      description: this.description,
      languages: this.languages,
    };
  };

  /**
   * Creates a Calendar instance from a plain object.
   *
   * @param {Record<string,any>} obj - Plain object containing calendar data
   * @returns {Calendar} A new Calendar instance
   */
  static fromObject(obj: Record<string,any>): Calendar {
    let calendar = new Calendar(obj.id, obj.urlName);
    calendar.languages = obj.languages;
    calendar.description = obj.description;
    return calendar;
  }

  /**
   * Creates a deep copy of this calendar.
   *
   * @returns {Calendar} A new Calendar instance with the same properties
   */
  clone(): Calendar { return Calendar.fromObject(this.toObject()); }
};

/**
 * Content for a calendar in a specific language.
 * Implements TranslatedContentModel to support the translated model framework.
 */
class CalendarContent extends Model implements TranslatedContentModel {
  language: string = 'en';
  name: string = '';
  description: string = '';

  /**
   * Creates new content for a calendar in a specific language.
   *
   * @param {string} language - The language code for this content
   * @param {string} [name] - Optional name/title of the calendar
   * @param {string} [description] - Optional description of the calendar
   */
  constructor( language: string, name?: string, description?: string) {
    super();
    this.name = name ?? '';
    this.description = description ?? '';
    this.language = language;
  }

  /**
   * Creates a CalendarContent instance from a plain object.
   *
   * @param {Record<string, any>} obj - Plain object containing content data
   * @returns {CalendarContent} A new CalendarContent instance
   */
  static fromObject(obj: Record<string, any>): CalendarContent {
    return new CalendarContent(obj.language, obj.name, obj.description);
  }

  /**
   * Converts the content to a plain JavaScript object.
   *
   * @returns {Record<string, any>} Plain object representation of the content
   */
  toObject(): Record<string, any> {
    return {
      language: this.language,
      name: this.name,
      description: this.description,
    };
  }

  /**
   * Determines if the content has any meaningful data.
   *
   * @returns {boolean} True if both name and description are empty
   */
  isEmpty(): boolean {
    return this.name === '' && this.description === '';
  }
}

export { Calendar, CalendarContent };
