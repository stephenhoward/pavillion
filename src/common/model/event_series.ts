import { TranslatedModel } from './model.js';
import { EventSeriesContent } from './event_series_content.js';
import { Media } from '@/common/model/media';
import { CALENDAR_URL_NAME_RE } from '@/common/validation/calendarUrlName';

/**
 * Represents an event series that groups related recurring or themed events.
 * Series can have names and descriptions in multiple languages.
 */
export class EventSeries extends TranslatedModel<EventSeriesContent> {
  /** Horizontal focal point for media cropping (0.0 = left, 1.0 = right). */
  mediaFocalPointX: number = 0.5;
  /** Vertical focal point for media cropping (0.0 = top, 1.0 = bottom). */
  mediaFocalPointY: number = 0.5;
  /** Zoom level for media display (1.0 = no zoom). */
  mediaZoom: number = 1.0;
  /** Hydrated media record for the series image, when loaded. */
  media: Media | null = null;

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
   * urlName must match the calendar url-name shape rule, CALENDAR_URL_NAME_RE.
   */
  isValid(): boolean {
    return (
      this.calendarId.length > 0 &&
      CALENDAR_URL_NAME_RE.test(this.urlName) &&
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
      mediaFocalPointX: this.mediaFocalPointX,
      mediaFocalPointY: this.mediaFocalPointY,
      mediaZoom: this.mediaZoom,
      media: this.media?.toObject() ?? null,
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

    series.mediaFocalPointX = obj.mediaFocalPointX ?? 0.5;
    series.mediaFocalPointY = obj.mediaFocalPointY ?? 0.5;
    series.mediaZoom = obj.mediaZoom ?? 1.0;
    series.media = obj.media ? Media.fromObject(obj.media) : null;

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
