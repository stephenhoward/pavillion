import { DateTime } from 'luxon';

import { Model, TranslatedModel, TranslatedContentModel } from '@/common/model/model';
import { EventLocation } from '@/common/model/location';
import { Media } from '@/common/model/media';
import { EventCategory } from '@/common/model/event_category';
import { EventSeries } from '@/common/model/event_series';

/**
 * Frequency options for recurring events.
 */
enum EventFrequency {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
};

export type startAndEndDates = {
  start: DateTime;
  end: DateTime | null;
};

/**
 * Prompt used to label the event's external URL (e.g., "Tickets", "RSVP", "More Info").
 */
export type UrlPrompt = 'tickets' | 'rsvp' | 'more_info' | 'register';

/**
 * Runtime-valid set of {@link UrlPrompt} values for enum checks on untrusted input.
 */
export const URL_PROMPT_VALUES: readonly UrlPrompt[] = ['tickets', 'rsvp', 'more_info', 'register'] as const;

/**
 * Represents a calendar event with multilingual content support.
 * Extends TranslatedModel to manage event content in different languages.
 *
 * Events are associated with a local calendar via calendarId (UUID).
 * For remote-origin events (copied from federation), calendarId is null
 * and the AP origin is tracked separately in the ActivityPub domain.
 */
class CalendarEvent extends TranslatedModel<CalendarEventContent> {
  date: string = '';
  /**
   * UUID of the local CalendarEntity that owns this event.
   * Null for remote-origin events (events copied from federation).
   */
  calendarId: string | null = null;
  /**
   * ID of the location where this event takes place.
   * References a LocationEntity by ID.
   */
  locationId: string | null = null;
  /**
   * Full location object (deprecated, use locationId instead).
   * Kept for backward compatibility during transition period.
   */
  location: EventLocation | null = null;
  media: Media | null = null;
  mediaId: string | null = null; // Temporary field for API communication
  /** Horizontal focal point for media cropping (0.0 = left, 1.0 = right). */
  mediaFocalPointX: number = 0.5;
  /** Vertical focal point for media cropping (0.0 = top, 1.0 = bottom). */
  mediaFocalPointY: number = 0.5;
  /** Zoom level for media display (1.0 = no zoom). */
  mediaZoom: number = 1.0;
  parentEvent: CalendarEvent | null = null;
  eventSourceUrl: string = '';
  _content: Record<string, CalendarEventContent> = {};
  schedules: CalendarEventSchedule[] = [];
  categories: EventCategory[] = [];
  series: EventSeries | null = null;
  /**
   * Repost status of this event relative to the querying calendar:
   * - 'none': owned directly by the calendar (not a repost)
   * - 'manual': reposted to the calendar via an explicit user action
   * - 'auto':  reposted to the calendar automatically by auto-repost policy
   *
   * Populated by: EventService.listEvents() — resolved from SharedEventEntity.auto_posted
   * for events shared to the querying calendar, or 'manual' for legacy EventRepostEntity
   * entries, or 'none' for owned events.
   *
   * NOT populated by: EventService.getEventById(), EventService.updateEvent(), or
   * EventService.bulkAssignCategories() (which calls getEventById() internally). Events
   * returned by those methods will always have repostStatus='none' regardless of actual
   * repost state.
   *
   * Default: 'none'. Must be explicitly set after retrieval if needed.
   */
  repostStatus: 'none' | 'manual' | 'auto' = 'none';
  /**
   * Optional external URL attached to an event (e.g., ticket page, RSVP link).
   * Non-translatable — the same URL applies across all languages.
   */
  externalUrl: string | null = null;
  /**
   * Prompt/label for the external URL. Used by the UI to choose CTA copy.
   * Non-translatable; the UI localizes via the enum value.
   */
  urlPrompt: UrlPrompt | null = null;

  /**
   * Derived flag: true when this event was obtained via a repost (auto or manual)
   * rather than direct ownership. Backed by {@link repostStatus}.
   */
  get isRepost(): boolean {
    return this.repostStatus !== 'none';
  }
  /**
   * Source calendar information for reposted events.
   * Contains the originating calendar's urlName, host, and URL.
   * Null for locally-owned events or when source is unknown.
   */
  sourceCalendar: { urlName: string; host: string; url: string } | null = null;

  /**
   * Constructor for CalendarEvent.
   *
   * @param {string} [id] - Unique identifier for the event
   * @param {string} [calendarId] - UUID of the owning calendar (null for remote-origin events)
   * @param {string} [eventSourceUrl] - URL source of the event
   */
  constructor(id?: string, calendarId?: string | null, eventSourceUrl?: string) {
    super(id);
    this.calendarId = calendarId ?? null;
    this.eventSourceUrl = eventSourceUrl ?? '';
  }

  /**
   * Returns true if this event originated from a remote federated calendar.
   * Remote events have no local calendar owner (calendarId is null).
   */
  isRemote(): boolean {
    return this.calendarId === null;
  }

  /**
   * Returns true if this event is owned by a local calendar on this instance.
   */
  isLocal(): boolean {
    return this.calendarId !== null;
  }

  /**
   * Creates new content for a specified language.
   *
   * @param {string} language - The language code to create content for
   * @returns {CalendarEventContent} New content instance for the specified language
   * @protected
   */
  protected createContent(language: string): CalendarEventContent {
    return new CalendarEventContent(language);
  }

  /**
   * Adds a schedule to the event.
   *
   * @param {CalendarEventSchedule} [schedule] - The schedule to add, or creates a new one if not provided
   */
  addSchedule(schedule?: CalendarEventSchedule) {
    if ( schedule ) {
      this.schedules.push(schedule);
    }
    else {
      this.schedules.push(new CalendarEventSchedule());
    }
  }

  /**
   * Removes a schedule from the event.
   *
   * @param {number} index - The index of the schedule to remove
   * @throws {Error} If the index is out of bounds
   */
  dropSchedule(index: number) {
    if ( index < 0 || index >= this.schedules.length ) {
      throw new Error('Invalid schedule index');
    }
    this.schedules.splice(index, 1);
  }

  /**
   * Creates a CalendarEvent instance from a plain object.
   *
   * @param {Record<string, any>} obj - Plain object containing event data
   * @returns {CalendarEvent} A new CalendarEvent instance
   */
  static fromObject(obj: Record<string, any>): CalendarEvent {
    let event = new CalendarEvent(obj.id, obj.calendarId ?? null, obj.eventSourceUrl);

    event.date = obj.date || '';
    event.locationId = obj.locationId ?? null;
    event.location = obj.location ? EventLocation.fromObject(obj.location) : null;
    event.media = obj.media ? Media.fromObject(obj.media) : null;
    event.mediaId = obj.mediaId || null;
    event.mediaFocalPointX = obj.mediaFocalPointX ?? 0.5;
    event.mediaFocalPointY = obj.mediaFocalPointY ?? 0.5;
    event.mediaZoom = obj.mediaZoom ?? 1.0;
    // Prefer repostStatus when present; fall back to legacy isRepost boolean for
    // backward compatibility with older serialized payloads.
    if (obj.repostStatus === 'manual' || obj.repostStatus === 'auto' || obj.repostStatus === 'none') {
      event.repostStatus = obj.repostStatus;
    }
    else if (obj.isRepost === true) {
      event.repostStatus = 'manual';
    }
    else {
      event.repostStatus = 'none';
    }
    event.sourceCalendar = obj.sourceCalendar ?? null;
    event.externalUrl = obj.externalUrl ?? null;
    event.urlPrompt = URL_PROMPT_VALUES.includes(obj.urlPrompt) ? obj.urlPrompt : null;

    if ( obj.content ) {
      for( let [language,strings] of Object.entries(obj.content) ) {
        if (typeof strings === 'object' && strings !== null) {
          const contentObj = strings as Record<string, any>;
          contentObj.language = language;
          const content = CalendarEventContent.fromObject(contentObj);
          event.addContent(content);
        }
      }
    }
    if ( obj.schedules ) {
      event.schedules = obj.schedules.map((s: Object) => CalendarEventSchedule.fromObject(s));
    }

    if( obj.location ) {
      event.location = EventLocation.fromObject(obj.location);
    }

    if( obj.categories ) {
      event.categories = obj.categories.map((c:Object) => EventCategory.fromObject(c));
    }

    if( obj.series ) {
      event.series = EventSeries.fromObject(obj.series);
    }

    return event;
  }

  /**
   * Converts the event to a plain JavaScript object.
   *
   * @returns {Record<string, any>} Plain object representation of the event
   */
  toObject(): Record<string, any> {
    const obj: Record<string, any> = {
      id: this.id,
      date: this.date,
      calendarId: this.calendarId,
      repostStatus: this.repostStatus,
      // Kept for backward compatibility with frontend code still reading isRepost.
      isRepost: this.isRepost,
      sourceCalendar: this.sourceCalendar,
      locationId: this.locationId,
      location: this.location?.toObject(),
      media: this.media?.toObject(),
      mediaFocalPointX: this.mediaFocalPointX,
      mediaFocalPointY: this.mediaFocalPointY,
      mediaZoom: this.mediaZoom,
      eventSourceUrl: this.eventSourceUrl,
      externalUrl: this.externalUrl,
      urlPrompt: this.urlPrompt,
      content: Object.fromEntries(
        Object.entries(this._content)
          .map(([language, strings]: [string, CalendarEventContent]) => [language, strings.toObject()]),
      ),
      schedules: this.schedules.map(schedule => schedule.toObject()),
      categories: this.categories.map(category => category.toObject() ),
      series: this.series?.toObject() ?? null,
    };

    // Include mediaId if present (used for API communication)
    if (this.mediaId) {
      obj.mediaId = this.mediaId;
    }

    return obj;
  }

  /**
   * Creates a deep copy of this event.
   *
   * @returns {CalendarEvent} A new CalendarEvent instance with the same properties
   */
  clone(): CalendarEvent { return CalendarEvent.fromObject(this.toObject()); }
};

/**
 * Supported language codes for event content.
 */
enum language {
  EN = "en",
  ES = "es",
  FR = "fr",
  DE = "de",
  IT = "it",
};

/**
 * Types of activities that can be performed on an event.
 */
enum event_activity {
  SHARE = "share",
}

/**
 * Content for a calendar event in a specific language.
 * Implements TranslatedContentModel to support the translated model framework.
 */
class CalendarEventContent extends Model implements TranslatedContentModel {
  language: string;
  name: string = '';
  description: string = '';
  accessibilityInfo: string = '';

  /**
   * Constructor for CalendarEventContent.
   *
   * @param {string} language - The language code for this content
   * @param {string} [name] - Optional name/title of the event
   * @param {string} [description] - Optional description of the event
   * @param {string} [accessibilityInfo] - Optional accessibility information
   */
  constructor( language: string, name?: string, description?: string, accessibilityInfo?: string) {
    super();
    this.name = name ?? '';
    this.description = description ?? '';
    this.accessibilityInfo = accessibilityInfo ?? '';
    this.language = language;
  }

  /**
   * Creates a CalendarEventContent instance from a plain object.
   *
   * @param {Record<string, any>} obj - Plain object containing content data
   * @returns {CalendarEventContent} A new CalendarEventContent instance
   */
  static fromObject(obj: Record<string, any>): CalendarEventContent {
    // Support both 'name' and 'title' field names for API compatibility
    const name = obj.name || obj.title || '';
    return new CalendarEventContent(obj.language, name, obj.description, obj.accessibilityInfo);
  }

  /**
   * Converts the content to a plain JavaScript object.
   *
   * @returns {Record<string, any>} Plain object representation of the content
   */
  toObject(): Record<string, any> {
    return {
      language: this.language,
      title: this.name,
      name: this.name,
      description: this.description,
      accessibilityInfo: this.accessibilityInfo,
    };
  }

  /**
   * Determines if the content has any meaningful data.
   *
   * @returns {boolean} True if name, description, and accessibilityInfo are all empty
   */
  isEmpty(): boolean {
    return this.name === '' && this.description === '' && this.accessibilityInfo === '';
  }
};

/**
 * Represents a schedule for a calendar event, including recurrence rules.
 */
class CalendarEventSchedule extends Model {
  id: string = '';
  startDate: DateTime | null = null;
  endDate: DateTime | null = null;
  eventEndTime: DateTime | null = null;
  count: number = 0;
  frequency: EventFrequency | null = null;
  interval: number = 0;
  byDay: string[] = [];
  isExclusion: boolean = false;

  /**
   * Constructor for CalendarEventSchedule.
   *
   * @param {string} [id] - Unique identifier for the schedule
   * @param {DateTime} [startDate] - Start date and time of the schedule
   * @param {DateTime} [endDate] - End date and time of the schedule
   */
  constructor(id?: string, startDate?: DateTime, endDate?: DateTime) {
    super();
    this.id = id ?? '';
    this.startDate = startDate ?? null;
    this.endDate = endDate ?? null;
  }

  /**
   * Parses a string into an EventFrequency enum value.
   *
   * @param {string} freq - The frequency string to parse
   * @returns {EventFrequency|null} The corresponding enum value or null if invalid
   */
  static parseFrequency(freq: string): EventFrequency | null {
    const enumValues = Object.values(EventFrequency) as string[];
    const isValidRole = enumValues.includes(freq);
    return isValidRole ? freq as EventFrequency : null;
  }

  /**
   * Creates a CalendarEventSchedule instance from a plain object.
   *
   * @param {Record<string, any>} obj - Plain object containing schedule data
   * @returns {CalendarEventSchedule} A new CalendarEventSchedule instance
   */
  static fromObject(obj: Record<string, any>): CalendarEventSchedule {
    let start = obj.start
      ? DateTime.fromISO(obj.start)
      : undefined;

    let end = obj.end
      ? DateTime.fromISO(obj.end)
      : undefined;


    let schedule = new CalendarEventSchedule(obj.id, start, end);

    if ( obj.frequency ) {
      schedule.frequency = CalendarEventSchedule.parseFrequency(obj.frequency);
    }
    schedule.interval = obj.interval;
    schedule.count = obj.count;
    schedule.byDay = obj.byDay;
    schedule.isExclusion = obj.isException;

    if ( obj.eventEndTime ) {
      const parsed = DateTime.fromISO(obj.eventEndTime);
      if (parsed.isValid) {
        schedule.eventEndTime = parsed;
      }
    }

    return schedule;
  }

  /**
   * Converts the schedule to a plain JavaScript object.
   *
   * @returns {Record<string, any>} Plain object representation of the schedule
   */
  toObject(): Record<string, any> {
    return {
      id: this.id,
      start: this.startDate?.toISO() ?? null,
      end: this.endDate?.toISO() ?? null,
      eventEndTime: this.eventEndTime?.toISO() ?? null,
      frequency: (this.frequency as string) ?? null,
      interval: this.interval,
      count: this.count,
      byDay: this.byDay,
      isException: this.isExclusion,
    };
  }
}

export {
  CalendarEvent, CalendarEventContent, CalendarEventSchedule, language, event_activity, EventFrequency,
};

