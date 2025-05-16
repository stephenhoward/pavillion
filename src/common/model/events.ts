import { DateTime } from 'luxon';

import { Model, TranslatedModel, TranslatedContentModel } from '@/common/model/model';
import { EventLocation } from '@/common/model/location';

/**
 * Represents a calendar event with multilingual content support.
 * Extends TranslatedModel to manage event content in different languages.
 */
class CalendarEvent extends TranslatedModel<CalendarEventContent> {
  date: string = '';
  location: EventLocation | null = null;
  parentEvent: CalendarEvent | null = null;
  eventSourceUrl: string = '';
  _content: Record<string, CalendarEventContent> = {};
  schedules: CalendarEventSchedule[] = [];

  /**
   * Constructor for CalendarEvent.
   *
   * @param {string} [id] - Unique identifier for the event
   * @param {string} [date] - Date of the event
   * @param {string} [eventSourceUrl] - URL source of the event
   * @param {EventLocation} [location] - Location where the event takes place
   */
  constructor(id?: string, date?: string, eventSourceUrl?: string, location?: EventLocation) {
    super(id);
    this.date = date ?? '';
    this.eventSourceUrl = eventSourceUrl ?? '';
    this.location = location ?? null;
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
    let event = new CalendarEvent(obj.id, obj.date, obj.eventSourceUrl);

    event.location = obj.location ? EventLocation.fromObject(obj.location) : null;

    if ( obj.content ) {
      for( let [language,strings] of Object.entries(obj.content) ) {
        strings.language = language;
        const content = CalendarEventContent.fromObject(strings as Record<string,any>);
        event.addContent(content);
      }
    }

    return event;
  }

  /**
   * Converts the event to a plain JavaScript object.
   *
   * @returns {Record<string, any>} Plain object representation of the event
   */
  toObject(): Record<string, any> {
    return {
      id: this.id,
      date: this.date,
      location: this.location?.toObject(),
      eventSourceUrl: this.eventSourceUrl,
      content: Object.fromEntries(
        Object.entries(this._content)
          .map(([language, strings]: [string, CalendarEventContent]) => [language, strings.toObject()]),
      ),
      schedules: this.schedules.map(schedule => schedule.toObject()),
    };
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

  /**
   * Constructor for CalendarEventContent.
   *
   * @param {string} language - The language code for this content
   * @param {string} [name] - Optional name/title of the event
   * @param {string} [description] - Optional description of the event
   */
  constructor( language: string, name?: string, description?: string) {
    super();
    this.name = name ?? '';
    this.description = description ?? '';
    this.language = language;
  }

  /**
   * Creates a CalendarEventContent instance from a plain object.
   *
   * @param {Record<string, any>} obj - Plain object containing content data
   * @returns {CalendarEventContent} A new CalendarEventContent instance
   */
  static fromObject(obj: Record<string, any>): CalendarEventContent {
    return new CalendarEventContent(obj.language, obj.name, obj.description);
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
};

/**
 * Frequency options for recurring events.
 */
enum EventFrequency {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
};

/**
 * Represents a schedule for a calendar event, including recurrence rules.
 */
class CalendarEventSchedule extends Model {
  id: string = '';
  startDate: DateTime | null = null;
  endDate: DateTime | null = null;
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
      start: this.startDate?.toISO(),
      end: this.endDate?.toISO(),
      frequency: this.frequency as string,
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
