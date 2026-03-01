import { TranslatedModel } from './model.js';
import { EventSeriesContent } from './event_series_content.js';

/**
 * Represents an event series that groups related recurring or themed events.
 * Series can have names and descriptions in multiple languages.
 */
export class EventSeries extends TranslatedModel<EventSeriesContent> {
  _content: Record<string, EventSeriesContent> = {};

  constructor(
    id: string,
    public calendarId: string,
    public urlName: string = '',
    public mediaId: string | null = null,
  ) {
    super(id);
  }

  /**
   * Creates new content for a specified language.
   *
   * @param {string} language - The language code to create content for
   * @returns {EventSeriesContent} New content instance for the specified language
   * @protected
   */
  protected createContent(language: string): EventSeriesContent {
    return new EventSeriesContent(language);
  }

  /**
   * Validates that the series has required information.
   * urlName must match the same pattern as Calendar.urlName: /^[a-z0-9][a-z0-9_]{2,23}$/i
   */
  isValid(): boolean {
    return (
      this.calendarId.length > 0 &&
      /^[a-z0-9][a-z0-9_]{2,23}$/i.test(this.urlName) &&
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
      urlName: this.urlName,
      mediaId: this.mediaId,
      content: Object.fromEntries(
        Object.entries(this._content)
          .map(([language, content]: [string, EventSeriesContent]) => [language, content.toObject()]),
      ),
    };
  }

  /**
   * Create from plain object.
   */
  static fromObject(obj: Record<string, any>): EventSeries {
    const series = new EventSeries(
      obj.id,
      obj.calendarId,
      obj.urlName,
      obj.mediaId ?? null,
    );

    if (obj.content) {
      for (const [language, contentObj] of Object.entries(obj.content)) {
        if (typeof contentObj === 'object' && contentObj !== null) {
          const contentData = contentObj as Record<string, any>;
          contentData.language = language;
          const content = EventSeriesContent.fromObject(contentData);
          series.addContent(content);
        }
      }
    }

    return series;
  }
}
