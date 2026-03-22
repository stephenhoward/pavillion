import config from 'config';
import { DateTime } from 'luxon';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent, CalendarEventSchedule } from '@/common/model/events';
import { EventLocation } from '@/common/model/location';
import { ActivityPubObject } from '@/server/activitypub/model/base';
import { SeriesObject } from '@/server/activitypub/model/object/series';

class EventObject extends ActivityPubObject {
  type: string = 'Event';
  attributedTo: string;
  date: Date;
  location: LocationObject|string;
  parentEvent: string = '';
  childEvents: string[] = [];
  categories: string[] = [];
  series: string | null = null;
  content: Record<string, APEventContent>;
  schedules: CalendarEventSchedule[];

  private readonly _calendar: Calendar;
  private readonly _event: CalendarEvent;

  static eventUrl(calendar: Calendar, event: CalendarEvent|string ): string {
    let id = typeof event == 'string'
      ? event
      : event.id;

    return id.match('^https?:\/\/')
      ? id
      : 'https://'+config.get('domain')+'/calendars/'+calendar.urlName+'/events/'+id;
  }

  constructor( calendar: Calendar, event: CalendarEvent ) {
    super();
    this._calendar = calendar;
    this._event = event;
    this.id = EventObject.eventUrl(calendar,event);

    // Set attributedTo to the calendar's actor URL
    const domain = config.get('domain');
    this.attributedTo = 'https://'+domain+'/calendars/'+calendar.urlName;

    this.date = event.date;
    this.content = event.toObject().content;

    if( event.parentEvent ) {
      this.parentEvent = event.parentEvent.id;
    }

    // Serialize event categories as public API URIs
    if (event.categories && event.categories.length > 0) {
      this.categories = event.categories.map(cat =>
        `https://${domain}/api/public/v1/calendar/${calendar.urlName}/categories/${cat.id}`,
      );
    }

    // Serialize series as AP series Object ID (UUID-based URL)
    if (event.series) {
      this.series = SeriesObject.seriesUrl(calendar, event.series);
    }
  }

  /**
   * Serializes this event as a standard ActivityPub object with AS properties
   * and pavillion:* prefixed extensions for federation.
   *
   * @returns {Record<string, any>} ActivityPub-compatible object
   */
  toActivityPubObject(): Record<string, any> {
    const domain = config.get('domain');
    const event = this._event;
    const calendar = this._calendar;

    // Determine primary language: prefer 'en' if event has en content with a name,
    // otherwise use the first language with a non-empty name
    const primaryLanguage = event._content['en']?.name
      ? 'en'
      : Object.keys(event._content).find(l => event._content[l]?.name) || 'en';

    // Build name from primary language content, inlining fallback search
    const primaryContent = event._content[primaryLanguage];
    let name = primaryContent?.name || 'Untitled Event';
    if (name === 'Untitled Event') {
      for (const lang of Object.keys(event._content)) {
        const c = event._content[lang];
        if (c.name && c.name.trim().length > 0) {
          name = c.name;
          break;
        }
      }
    }

    // Build startTime from first schedule or fallback to date field
    const startTime = this._resolveStartTime(event);

    const result: Record<string, any> = {
      type: this.type,
      id: this.id,
      attributedTo: this.attributedTo,
      name,
      startTime,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [`https://${domain}/calendars/${calendar.urlName}/followers`],
    };

    // summary: only when primary-language description is non-empty
    const primaryDescription = primaryContent?.description || '';
    if (primaryDescription.trim().length > 0) {
      result.summary = primaryDescription;
    }

    // endTime: only when first schedule has endDate
    const firstSchedule = event.schedules[0];
    if (firstSchedule?.endDate) {
      result.endTime = firstSchedule.endDate.toISO();
    }

    // location: emitted as Place with optional PostalAddress; omitted if no location
    const locationObj = this._buildLocation(event.location);
    if (locationObj) {
      result.location = locationObj;
    }

    // nameMap/summaryMap: only when 2+ languages have content
    const contentLanguages = Object.keys(event._content).filter(
      lang => event._content[lang] && !event._content[lang].isEmpty(),
    );
    if (contentLanguages.length >= 2) {
      const nameMap: Record<string, string> = {};
      const summaryMap: Record<string, string> = {};
      let hasSummaryEntries = false;

      for (const lang of contentLanguages) {
        const c = event._content[lang];
        if (c.name) {
          nameMap[lang] = c.name;
        }
        if (c.description) {
          summaryMap[lang] = c.description;
          hasSummaryEntries = true;
        }
      }

      if (Object.keys(nameMap).length > 0) {
        result.nameMap = nameMap;
      }
      if (hasSummaryEntries) {
        result.summaryMap = summaryMap;
      }
    }

    // pavillion:* extensions
    result['pavillion:content'] = event.toObject().content;
    result['pavillion:categories'] = this.categories;
    result['pavillion:series'] = this.series;
    result['pavillion:schedules'] = event.schedules.map(s => s.toObject());

    return result;
  }

  /**
   * Normalizes a raw ActivityPub event object into the internal eventParams shape
   * expected by CalendarEvent.fromObject(). Handles three formats:
   *
   * 1. New Pavillion format: pavillion:content, pavillion:categories, etc. take precedence
   * 2. Old Pavillion format: bare content, categories, schedules, series pass through
   * 3. Standard AS format: name/summary/nameMap/summaryMap mapped to content, startTime/endTime
   *    synthesized into schedules and date
   *
   * Note: This intentionally returns Record<string, any> (eventParams shape) rather than
   * a domain model instance. The caller (inbox.ts) spreads these params and then passes
   * them to CalendarEvent.fromObject() via the calendar service layer. This diverges from
   * the typical fromObject() pattern because the AP wire format does not map 1:1 to the
   * domain model constructor.
   *
   * @param apObject - Raw ActivityPub object from the wire
   * @returns eventParams shape compatible with CalendarEvent.fromObject()
   */
  static fromActivityPubObject(apObject: Record<string, any>): Record<string, any> {
    // Spread entire input first; subsequent normalization overwrites handled keys
    const result: Record<string, any> = Object.assign({}, apObject);

    // --- Content resolution ---
    // Priority: pavillion:content > bare content (old format) > name/summary/nameMap/summaryMap
    if (apObject['pavillion:content']) {
      result.content = apObject['pavillion:content'];
    }
    else if (apObject.content && typeof apObject.content === 'object' && !Array.isArray(apObject.content)) {
      // Old Pavillion format: bare content object with language keys
      result.content = apObject.content;
    }
    else {
      // Standard AS format: build content from name/summary/nameMap/summaryMap
      const content: Record<string, { name: string; description: string }> = {};

      // nameMap and summaryMap provide per-language content
      const nameMap = apObject.nameMap || {};
      const summaryMap = apObject.summaryMap || {};
      const allLanguages = new Set([...Object.keys(nameMap), ...Object.keys(summaryMap)]);

      // If there's a bare name/summary but no maps, use 'en' as default language
      if (allLanguages.size === 0 && (apObject.name || apObject.summary)) {
        content.en = {
          name: apObject.name || '',
          description: apObject.summary || '',
        };
      }
      else {
        for (const lang of allLanguages) {
          content[lang] = {
            name: nameMap[lang] || '',
            description: summaryMap[lang] || '',
          };
        }

        // If bare name exists and isn't in nameMap, it represents the primary language
        // but since we already have all languages from maps, we skip adding it again
      }

      if (Object.keys(content).length > 0) {
        result.content = content;
      }
    }

    // --- Categories resolution ---
    // Priority: pavillion:categories > bare categories
    if (apObject['pavillion:categories'] !== undefined) {
      result.categories = apObject['pavillion:categories'];
    }
    else if (apObject.categories !== undefined) {
      result.categories = apObject.categories;
    }

    // --- Series resolution ---
    // Priority: pavillion:series > bare series
    if (apObject['pavillion:series'] !== undefined) {
      result.series = apObject['pavillion:series'];
    }
    else if (apObject.series !== undefined) {
      result.series = apObject.series;
    }

    // --- Schedules resolution ---
    // Priority: pavillion:schedules > bare schedules > synthesize from startTime/endTime
    if (apObject['pavillion:schedules'] !== undefined) {
      result.schedules = apObject['pavillion:schedules'];
    }
    else if (apObject.schedules !== undefined) {
      result.schedules = apObject.schedules;
    }
    else if (apObject.startTime) {
      // Synthesize a schedule from standard AS startTime/endTime
      const schedule: Record<string, any> = {
        start: apObject.startTime,
      };
      if (apObject.endTime) {
        schedule.end = apObject.endTime;
      }
      result.schedules = [schedule];
    }

    // --- Date extraction from startTime ---
    if (apObject.startTime && !result.date) {
      const parsed = DateTime.fromISO(apObject.startTime);
      if (parsed.isValid) {
        result.date = parsed.toFormat('yyyy-MM-dd');
      }
    }

    // --- Location normalization ---
    if (apObject.location !== undefined) {
      result.location = EventObject._normalizeLocation(apObject.location);
    }

    return result;
  }

  /**
   * Normalizes an AP location value into the EventLocation-compatible shape.
   * Handles Place objects with optional PostalAddress, and plain strings.
   */
  private static _normalizeLocation(location: any): Record<string, any> {
    if (typeof location === 'string') {
      return { name: location };
    }

    if (typeof location === 'object' && location !== null) {
      const normalized: Record<string, any> = {};

      if (location.name) {
        normalized.name = location.name;
      }

      // Extract PostalAddress fields if address is a sub-object
      const addr = location.address;
      if (addr && typeof addr === 'object') {
        if (addr.streetAddress) normalized.address = addr.streetAddress;
        if (addr.addressLocality) normalized.city = addr.addressLocality;
        if (addr.addressRegion) normalized.state = addr.addressRegion;
        if (addr.postalCode) normalized.postalCode = addr.postalCode;
        if (addr.addressCountry) normalized.country = addr.addressCountry;
      }
      else if (typeof addr === 'string') {
        normalized.address = addr;
      }

      return normalized;
    }

    return { name: String(location) };
  }

  /**
   * Resolves startTime from the first schedule's startDate, falling back to the event date field.
   */
  private _resolveStartTime(event: CalendarEvent): string {
    const firstSchedule = event.schedules[0];
    if (firstSchedule?.startDate) {
      return firstSchedule.startDate.toISO()!;
    }

    // Fallback: parse date string as YYYY-MM-DD and emit as midnight UTC
    if (event.date) {
      const parsed = DateTime.fromISO(String(event.date), { zone: 'utc' });
      if (parsed.isValid) {
        return parsed.toISO()!;
      }
    }

    return DateTime.utc().toISO()!;
  }

  /**
   * Builds an ActivityPub Place object from an EventLocation, or null if no location.
   */
  private _buildLocation(location: EventLocation | null): Record<string, any> | null {
    if (!location) {
      return null;
    }

    // Only emit if at least a name is present
    if (!location.name || location.name.trim().length === 0) {
      return null;
    }

    const place: Record<string, any> = {
      type: 'Place',
      name: location.name,
    };

    // Add PostalAddress sub-object if any address fields are present
    const hasAddress = location.address?.trim();
    const hasCity = location.city?.trim();
    const hasState = location.state?.trim();
    const hasPostalCode = location.postalCode?.trim();
    const hasCountry = location.country?.trim();

    if (hasAddress || hasCity || hasState || hasPostalCode || hasCountry) {
      const address: Record<string, any> = {
        type: 'PostalAddress',
      };

      if (hasAddress) address.streetAddress = location.address;
      if (hasCity) address.addressLocality = location.city;
      if (hasState) address.addressRegion = location.state;
      if (hasPostalCode) address.postalCode = location.postalCode;
      if (hasCountry) address.addressCountry = location.country;

      place.address = address;
    }

    return place;
  }
}

export { EventObject };
