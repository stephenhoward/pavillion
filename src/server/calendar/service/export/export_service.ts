import config from 'config';
import i18next from 'i18next';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { ValidationError } from '@/common/exceptions/base';
import { CalendarExportError, CalendarNotFoundError } from '@/common/exceptions/calendar';
import { CalendarEditorPermissionError } from '@/common/exceptions/editor';
import { CalendarContentEntity } from '@/server/calendar/entity/calendar';
import { EventContentEntity, EventEntity, EventScheduleEntity } from '@/server/calendar/entity/event';
import { EventCategoryAssignmentEntity } from '@/server/calendar/entity/event_category_assignment';
import { EventCategoryContentEntity } from '@/server/calendar/entity/event_category_content';
import { EventCategoryEntity } from '@/server/calendar/entity/event_category';
import { LocationEntity } from '@/server/calendar/entity/location';
import { LocationSpaceContentEntity, LocationSpaceEntity } from '@/server/calendar/entity/location_space';
import CalendarService from '@/server/calendar/service/calendar';
import {
  IcsExportEvent,
  IcsExportInput,
  IcsSerializationError,
  VTimezoneSpan,
  planVTimezones,
  serializeCalendarToIcs,
} from '@/server/calendar/service/export/ics_serializer';
import { buildVTimezone } from '@/server/calendar/service/export/vtimezone';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('calendar');

/**
 * The most time zones one export may declare. Each costs a synchronous scan
 * of up to a few hundred milliseconds; past this the export is refused.
 * Kept below `VTIMEZONE_CACHE_SIZE` so all of one export's zones fit in the
 * cache, and a repeat export of the same calendar scans nothing.
 */
export const MAX_EXPORT_ZONES = 64;

/** The server i18next namespace holding the export's translated strings. */
const EXPORT_NAMESPACE = 'calendar_export';

/** A calendar's own events as one iCalendar file. */
export interface CalendarIcsExport {
  ics: string;
  /** Own events that produced at least one VEVENT. */
  eventCount: number;
  /** `<urlName>-<lang>.ics` */
  filename: string;
}

/**
 * Exports a calendar's own events to iCalendar for its owner.
 *
 * The owner, and only the owner: editors and instance admins are refused.
 * The file is all-or-nothing; an event that cannot be written fails the
 * request, and the log, not the response, says which one.
 */
export default class CalendarExportService {
  constructor(private calendarService: CalendarService) {}

  /**
   * The calendar's own events as one iCalendar file in `lang`.
   *
   * @param account - The requesting account; must own the calendar
   * @param calendarId - The calendar UUID
   * @param lang - Requested language, unvalidated; must be in {@link listExportLanguages}
   * @throws {CalendarNotFoundError} When the calendar does not exist
   * @throws {CalendarEditorPermissionError} When the account does not own it
   * @throws {ValidationError} When `lang` is not one of the export languages
   * @throws {CalendarExportError} When any event cannot be serialized, or the
   *   file would need more than {@link MAX_EXPORT_ZONES} time zones
   */
  async exportCalendarIcs(account: Account, calendarId: string, lang: unknown): Promise<CalendarIcsExport> {
    const calendar = await this.ownedCalendar(account, calendarId);
    const entries = await this.loadOwnEvents(calendar);
    const languages = await this.exportLanguages(calendar, entries.map(entry => entry.event));
    if (typeof lang !== 'string' || !languages.includes(lang)) {
      throw new ValidationError('lang must be one of the calendar\'s export languages', {
        lang: ['must be one of the calendar\'s export languages'],
      });
    }

    if (!i18next.hasResourceBundle('en', EXPORT_NAMESPACE)) {
      await i18next.loadNamespaces(EXPORT_NAMESPACE);
    }

    const input: IcsExportInput = {
      calendar,
      events: entries,
      language: lang,
      fallbackLanguages: languages,
      domain: config.get<string>('domain'),
      now: new Date(),
      accessibilityHeading: accessibilityHeadingFor(lang),
    };

    // Every VTIMEZONE costs a synchronous scan. Count them before any runs,
    // refuse a file that needs too many, and build the rest one at a time
    // with a yield between. The serializer is handed the built lines, so it
    // scans nothing, whatever other exports did to the shared cache meanwhile.
    const plan = await serializerStep(calendar.id, () => planVTimezones(input));
    if (plan.length > MAX_EXPORT_ZONES) {
      // The count only: zone names are the owner's data.
      logger.warn({ calendarId: calendar.id, zoneCount: plan.length }, 'Calendar export refused: too many time zones');
      throw new CalendarExportError();
    }
    const vtimezones = await serializerStep(calendar.id, () => buildPlannedVTimezones(plan));
    const result = await serializerStep(calendar.id, () => serializeCalendarToIcs({ ...input, vtimezones }));

    for (const eventId of result.skippedEventIds) {
      logger.warn({ calendarId: calendar.id, eventId }, 'Calendar export left out an event with no dated schedule');
    }

    return {
      ics: result.ics,
      eventCount: result.eventCount,
      // Both parts are safe here: urlName by construction, lang by membership.
      filename: `${calendar.urlName}-${lang}.ics`,
    };
  }

  /**
   * The languages the calendar can be exported in, in a stable order.
   *
   * @param account - The requesting account; must own the calendar
   * @param calendarId - The calendar UUID
   * @throws {CalendarNotFoundError} When the calendar does not exist
   * @throws {CalendarEditorPermissionError} When the account does not own it
   */
  async listExportLanguages(account: Account, calendarId: string): Promise<string[]> {
    const calendar = await this.ownedCalendar(account, calendarId);
    const rows = await EventEntity.findAll({
      where: { calendar_id: calendar.id },
      include: [{ model: EventContentEntity, separate: true }],
    });
    return this.exportLanguages(calendar, rows.map(row => row.toModel()));
  }

  /** The calendar, when it exists (404) and the account owns it (403). */
  private async ownedCalendar(account: Account, calendarId: string): Promise<Calendar> {
    const calendar = await this.calendarService.getCalendar(calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }
    // Owner means a calendar_member row with role owner: no admin bypass, and
    // not userCanModifyCalendar, which admits editors and admins.
    if (!await this.calendarService.isCalendarOwner(account, calendar)) {
      throw new CalendarEditorPermissionError('Permission denied');
    }
    return calendar;
  }

  /**
   * The export language set, the one list both routes use:
   *
   * 1. the calendar's content languages, oldest row first, then by code;
   * 2. then every other language an own event has content in, by code;
   * 3. when both are empty, the calendar's `languages` column.
   *
   * The column is not the source: it is written once at creation and never
   * updated, so it does not say what the calendar is written in.
   */
  private async exportLanguages(calendar: Calendar, events: CalendarEvent[]): Promise<string[]> {
    const contentRows = await CalendarContentEntity.findAll({
      where: { calendar_id: calendar.id },
      attributes: ['language'],
      order: [['createdAt', 'ASC'], ['language', 'ASC']],
    });
    const languages: string[] = [];
    for (const row of contentRows) {
      if (row.language && !languages.includes(row.language)) {
        languages.push(row.language);
      }
    }

    const eventLanguages = new Set<string>();
    for (const event of events) {
      for (const language of event.getLanguages()) {
        if (!languages.includes(language) && event.hasContent(language)) {
          eventLanguages.add(language);
        }
      }
    }
    languages.push(...[...eventLanguages].sort());

    return languages.length > 0 ? languages : [...calendar.languages];
  }

  /**
   * The calendar's own events (never reposts), each with everything the
   * serializer reads and its last-modified time. Schedules, never
   * event_instance rows, which stop at the generation horizon.
   */
  private async loadOwnEvents(calendar: Calendar): Promise<IcsExportEvent[]> {
    const rows = await EventEntity.findAll({
      where: { calendar_id: calendar.id },
      include: [
        { model: EventContentEntity, separate: true },
        { model: EventScheduleEntity, separate: true },
        LocationEntity,
        { model: LocationSpaceEntity, include: [LocationSpaceContentEntity] },
        {
          model: EventCategoryAssignmentEntity,
          as: 'categoryAssignments',
          separate: true,
          include: [{
            model: EventCategoryEntity,
            as: 'category',
            include: [EventCategoryContentEntity],
          }],
        },
      ],
      order: [['id', 'ASC']],
    });

    return rows.map((row) => {
      // toModel attaches content, location and space; schedules and
      // categories are mapped here.
      const event = row.toModel();
      for (const schedule of row.schedules ?? []) {
        event.addSchedule(schedule.toModel());
      }

      // Another calendar that reposts this event can assign its own
      // categories to it; only this calendar's belong in its file.
      const assignments = (row.getDataValue('categoryAssignments') ?? []) as EventCategoryAssignmentEntity[];
      event.categories = assignments
        .map(assignment => assignment.category as EventCategoryEntity | null)
        .filter((category): category is EventCategoryEntity => category?.calendar_id === calendar.id)
        .map(category => category.toModel())
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

      return { event, lastModified: latestUpdate([row, ...(row.content ?? []), ...(row.schedules ?? [])]) };
    });
  }
}

/**
 * Runs one step of serialization, turning any failure into the fixed-message
 * export error: not only a per-event one, since a VTIMEZONE can fail outside
 * the serializer's per-event guard. No partial file goes out, and the log,
 * not the response, says which calendar and, when known, which event.
 */
async function serializerStep<T>(calendarId: string, step: () => T | Promise<T>): Promise<T> {
  try {
    return await step();
  }
  catch (error) {
    const eventId = error instanceof IcsSerializationError ? error.eventId : undefined;
    logger.error({ err: error, calendarId, eventId }, 'Calendar export failed');
    throw new CalendarExportError();
  }
}

/**
 * Builds each planned VTIMEZONE, yielding to the event loop before each one,
 * so no synchronous stretch is longer than one zone's scan.
 *
 * @returns The lines of each zone's component, keyed by zone name
 */
async function buildPlannedVTimezones(plan: VTimezoneSpan[]): Promise<Map<string, string[]>> {
  const built = new Map<string, string[]>();
  for (const { zoneName, fromYear, toYear } of plan) {
    await new Promise(resolve => setImmediate(resolve));
    built.set(zoneName, buildVTimezone(zoneName, fromYear, toYear));
  }
  return built;
}

/**
 * The latest `updatedAt` among an event's row, content rows and schedule
 * rows. The models do not carry the column, so it is read off the entities.
 */
function latestUpdate(rows: Array<{ get(key: string): unknown }>): Date {
  let latest = 0;
  for (const row of rows) {
    const value = row.get('updatedAt');
    if (value instanceof Date && value.getTime() > latest) {
      latest = value.getTime();
    }
  }
  return new Date(latest);
}

/**
 * The serializer's heading lookup. It is called with the language of the
 * content row it used, which can be any key stored on an event, so that key
 * is only ever read from the loaded bundles, never used to load one; a
 * language with no bundle gets the export language's heading. `ns` and `lng`
 * are always passed, because email rendering moves the default namespace.
 */
function accessibilityHeadingFor(exportLanguage: string): (language: string) => string {
  return (language: string) => {
    const lng = i18next.hasResourceBundle(language, EXPORT_NAMESPACE) ? language : exportLanguage;
    return i18next.t('accessibility_heading', { ns: EXPORT_NAMESPACE, lng });
  };
}
