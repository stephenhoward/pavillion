import { v4 as uuidv4 } from 'uuid';
import config from 'config';
import axios from 'axios';

import { Account } from "@/common/model/account";
import { Calendar } from "@/common/model/calendar";
import { CalendarMemberEntity } from "@/server/calendar/entity/calendar_member";
import type { CalendarActor } from "@/server/activitypub/entity/calendar_actor";
import { CalendarEvent, CalendarEventContent, CalendarEventSchedule, UrlPrompt, URL_PROMPT_VALUES } from "@/common/model/events";
import { EventCategory } from "@/common/model/event_category";
import { EventLocation, validateLocationHierarchy } from "@/common/model/location";
import { EventContentEntity, EventEntity, EventScheduleEntity } from "@/server/calendar/entity/event";
import CalendarService from "@/server/calendar/service/calendar";
import { LocationEntity, LocationContentEntity } from "@/server/calendar/entity/location";
// TODO: MediaEntity is still needed here for Sequelize eager-load association includes
// (e.g., include: [MediaEntity] in queries). Removing this cross-domain import requires
// either restructuring entity associations or moving eager-loading to the media domain.
import { MediaEntity } from "@/server/media/entity/media";
import LocationService from "@/server/calendar/service/locations";
import { EventEmitter } from 'events';
import type MediaInterface from '@/server/media/interface';
import type ActivityPubInterface from '@/server/activitypub/interface';
import { EventNotFoundError, InsufficientCalendarPermissionsError, CalendarNotFoundError, BulkEventsNotFoundError, MixedCalendarEventsError, CategoriesNotFoundError, LocationValidationError, InvalidExternalUrlError } from '@/common/exceptions/calendar';
import { ValidationError } from '@/common/exceptions/base';
import CategoryService from './categories';
import { EventCategoryEntity } from '@/server/calendar/entity/event_category';
import { EventSeriesEntity, EventSeriesContentEntity } from '@/server/calendar/entity/event_series';
import { EventCategoryContentEntity } from '@/server/calendar/entity/event_category_content';
import { EventCategoryAssignmentEntity } from '@/server/calendar/entity/event_category_assignment';
import { EventInstanceEntity } from '@/server/calendar/entity/event_instance';
import { EventRepostEntity } from '@/server/calendar/entity/event_repost';
import { validateUrlNotPrivate } from '@/server/common/helper/ip-validation';
import { FEDERATION_HTTP_TIMEOUT_MS } from '@/server/common/constants';
import db from '@/server/common/entity/db';
import { logError } from '@/server/common/helper/error-logger';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('calendar');
import { Op, literal, where, fn, col, type Transaction } from 'sequelize';

/**
 * Normalizes an optional external URL attached to an event.
 *
 * - null/undefined → null
 * - empty/whitespace → null
 * - > 2048 chars → InvalidExternalUrlError
 * - missing scheme → prepend https:// before parse
 * - non-http(s) scheme (javascript:, data:, ftp:, …) → InvalidExternalUrlError
 * - unparseable → InvalidExternalUrlError
 * - otherwise → `URL.toString()` (canonicalized form)
 */
function normalizeExternalUrl(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (trimmed.length > 2048) {
    throw new InvalidExternalUrlError('url too long');
  }
  const candidate = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  }
  catch {
    throw new InvalidExternalUrlError('invalid url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidExternalUrlError('only http and https allowed');
  }
  return parsed.toString();
}

/**
 * Validates a urlPrompt value against the {@link URL_PROMPT_VALUES} whitelist.
 * Returns null when the input is null/undefined; throws {@link ValidationError}
 * when the input is a non-string or an unknown enum value.
 */
function validateUrlPrompt(value: unknown): UrlPrompt | null {
  if (value == null) return null;
  if (typeof value !== 'string' || !URL_PROMPT_VALUES.includes(value as UrlPrompt)) {
    throw new ValidationError('invalid url prompt', { urlPrompt: ['invalid'] });
  }
  return value as UrlPrompt;
}

/**
 * Enforces the cross-field invariant that externalUrl and urlPrompt must be
 * set or cleared together. When exactly one is null, throws a
 * {@link ValidationError} whose `fields` map highlights both inputs so the
 * editor can flag them simultaneously.
 */
function validateExternalUrlPair(externalUrl: string | null, urlPrompt: UrlPrompt | null): void {
  const urlNull = externalUrl === null;
  const promptNull = urlPrompt === null;
  if (urlNull !== promptNull) {
    throw new ValidationError(
      'externalUrl and urlPrompt must be set or cleared together',
      {
        externalUrl: ['required when urlPrompt is set'],
        urlPrompt: ['required when externalUrl is set'],
      },
    );
  }
}

/**
 * Scrubs an external URL for safe inclusion in structured logs.
 *
 * External URLs may contain sensitive material in their query string or
 * fragment (OAuth tokens, session IDs, personal identifiers). This helper
 * preserves only the origin and pathname so log lines retain enough
 * context for debugging without leaking secrets.
 *
 * - null/undefined → null
 * - unparseable URL → null (do not log a malformed value verbatim)
 * - otherwise → `${origin}${pathname}` with query and fragment stripped
 *
 * @param externalUrl - The candidate external URL value (already normalized
 *                      via {@link normalizeExternalUrl} in production code,
 *                      but this helper tolerates any string defensively).
 * @returns A safe-for-logging form of the URL, or null when the input is
 *          missing or unparseable.
 */
export function scrubExternalUrlForLog(externalUrl: string | null | undefined): string | null {
  if (externalUrl == null) return null;
  try {
    const u = new URL(externalUrl);
    return `${u.origin}${u.pathname}`;
  }
  catch {
    return null;
  }
}

/**
 * Service class for managing events
 *
 * @remarks
 * Use this class to manage the lifecycle of events in the system
 */
class EventService {
  private locationService: LocationService;
  private calendarService: CalendarService;
  private categoryService: CategoryService;
  private eventBus: EventEmitter;
  private mediaInterface?: MediaInterface;
  private activityPubInterface?: ActivityPubInterface;

  constructor(eventBus: EventEmitter) {
    this.locationService = new LocationService();
    this.calendarService = new CalendarService();
    this.categoryService = new CategoryService();
    this.eventBus = eventBus;
  }

  setMediaInterface(mediaInterface: MediaInterface): void {
    this.mediaInterface = mediaInterface;
  }

  setActivityPubInterface(apInterface: ActivityPubInterface): void {
    this.activityPubInterface = apInterface;
  }

  /**
   * Validates if a string is a valid UUID v4
   * @private
   */
  private isValidUUID(uuid: string): boolean {
    const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return typeof uuid === 'string' && UUID_V4_REGEX.test(uuid);
  }


  /**
   * Retrieves events for the provided calendar.
   * Returns events that are either:
   * - Owned by the calendar (calendar_id matches)
   * - Reposted by the calendar (via EventRepostEntity)
   * - Shared by the calendar (via SharedEventEntity - auto-repost or manual share)
   *
   * @param calendar - the calendar to retrieve events for
   * @param options - optional search and filter parameters
   * @returns a promise that resolves to the list of events
   */
  async listEvents(calendar: Calendar, options?: {
    search?: string;
    categories?: string[];
  }): Promise<CalendarEvent[]> {

    // Get event IDs that are reposted or shared by this calendar.
    //
    // repostStatus resolution:
    //   - SharedEventEntity (via AP interface) is the authoritative source and
    //     carries auto_posted to distinguish 'auto' vs 'manual' shares.
    //   - EventRepostEntity is a legacy direct-repost link with no auto/manual
    //     distinction; when an event appears only there it is treated as 'manual'.
    //   - Events not in either collection (owned by the calendar) report 'none'.
    const reposts = await EventRepostEntity.findAll({
      where: { calendar_id: calendar.id },
      attributes: ['event_id'],
    });
    // Get shared event id -> status map via AP interface (derived from auto_posted).
    // Filter to valid UUIDs for safety since old records may have AP URLs.
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const sharedStatusMap = await this.activityPubInterface!.getSharedEventStatusMap(calendar.id);

    // Build a unified repostStatus map for O(1) lookup during mapping below.
    // SharedEventEntity takes precedence (auto|manual); EventRepostEntity-only
    // entries default to 'manual'.
    const repostStatusByEventId = new Map<string, 'auto' | 'manual'>();
    for (const [eventId, status] of sharedStatusMap.entries()) {
      if (UUID_REGEX.test(eventId)) {
        repostStatusByEventId.set(eventId, status);
      }
    }
    for (const r of reposts) {
      if (!repostStatusByEventId.has(r.event_id)) {
        repostStatusByEventId.set(r.event_id, 'manual');
      }
    }

    const repostedEventIds = Array.from(repostStatusByEventId.keys());

    // Query events owned by calendar OR reposted by calendar
    const queryOptions: any = {
      where: {
        [Op.or]: [
          { calendar_id: calendar.id },
          ...(repostedEventIds.length > 0 ? [{ id: { [Op.in]: repostedEventIds } }] : []),
        ],
      },
      include: [
        LocationEntity,
        EventScheduleEntity,
        MediaEntity,
        {
          model: EventCategoryAssignmentEntity,
          as: 'categoryAssignments',
          include: [{
            model: EventCategoryEntity,
            as: 'category',
            include: [EventCategoryContentEntity],
          }],
        },
      ],
    };

    // Handle search parameter
    if (options?.search && options.search.trim()) {
      // Use LOWER() for case-insensitive search that works on both PostgreSQL and SQLite
      const searchTerm = options.search.trim().toLowerCase();
      queryOptions.include.push({
        model: EventContentEntity,
        as: 'content',  // Use the association alias
        where: {
          [Op.or]: [
            where(fn('LOWER', col('content.name')), {
              [Op.like]: `%${searchTerm}%`,
            }),
            where(fn('LOWER', col('content.description')), {
              [Op.like]: `%${searchTerm}%`,
            }),
          ],
        },
        required: true, // INNER JOIN to only include events with matching content
      });
    }
    else {
      // Always include content, but without search filter
      queryOptions.include.push(EventContentEntity);
    }

    // Handle category filter
    if (options?.categories && options.categories.length > 0) {
      // Find the category assignment include that we added above
      const categoryAssignmentInclude = queryOptions.include.find(
        (inc: any) => inc.model === EventCategoryAssignmentEntity || inc === EventCategoryAssignmentEntity,
      );

      if (categoryAssignmentInclude && typeof categoryAssignmentInclude === 'object') {
        // Add the filter to the existing category assignment include
        categoryAssignmentInclude.where = {
          category_id: {
            [Op.in]: options.categories,
          },
        };
        categoryAssignmentInclude.required = true; // INNER JOIN to only include events with matching categories
      }
    }


    const events = await EventEntity.findAll(queryOptions);

    const mappedEvents = events.map( (event) => {
      let e = event.toModel();
      if ( event.content ) {
        for ( let c of event.content ) {
          e.addContent( c.toModel() );
        }
      }
      if ( event.location ) {
        e.location = event.location.toModel();
      }
      if ( event.schedules ) {
        for ( let s of event.schedules ) {
          e.addSchedule( s.toModel() );
        }
      }

      // Map categories from eagerly loaded data
      // Access via getDataValue since we don't have a declared property
      const categoryAssignments = event.getDataValue('categoryAssignments') as EventCategoryAssignmentEntity[] | undefined;
      if (categoryAssignments) {
        e.categories = categoryAssignments.map(assignment => assignment.category.toModel());
      }

      e.repostStatus = repostStatusByEventId.get(e.id) ?? 'none';

      return e;
    });

    return mappedEvents;
  }

  generateEventId(): string {
    return uuidv4();
  }

  generateEventUrl(eventId: string): string {
    const domain = config.get('domain');
    return 'https://' + domain + '/events/' + eventId;
  }

  /**
   * Creates an event on a remote calendar by sending an ActivityPub Create activity
   *
   * @param account - The local account creating the event
   * @param remoteCalendarActor - The CalendarActor representing the remote calendar
   * @param eventParams - The parameters for the new event
   * @returns A promise that resolves to the created event (from remote response)
   */
  private async createRemoteEvent(
    account: Account,
    remoteCalendarActor: CalendarActor,
    eventParams: Record<string, any>,
  ): Promise<CalendarEvent> {
    // Get the local user's actor URI for signing the activity
    const actorUri = await this.activityPubInterface!.getUserActorUri(account.id);
    if (!actorUri) {
      throw new InsufficientCalendarPermissionsError('User does not have an ActivityPub identity configured');
    }

    const localDomain = config.get<string>('domain');
    const eventId = this.generateEventId();

    // Build the ActivityPub Create activity
    const createActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Create',
      id: `https://${localDomain}/activities/${uuidv4()}`,
      actor: actorUri,
      to: [remoteCalendarActor.actorUri],
      object: {
        type: 'Event',
        id: `https://${localDomain}/events/${eventId}`,
        name: eventParams.content?.en?.name || eventParams.name || 'Untitled Event',
        summary: eventParams.content?.en?.description || eventParams.description || '',
        startTime: this.buildIsoDateTime(eventParams.start_date, eventParams.start_time),
        endTime: this.buildIsoDateTime(eventParams.end_date, eventParams.end_time),
        attributedTo: actorUri,
        calendarId: remoteCalendarActor.id,
        eventParams: eventParams,
      },
    };

    // Send to the remote calendar's inbox
    const inboxUrl = remoteCalendarActor.inboxUrl;
    if (!inboxUrl) {
      throw new CalendarNotFoundError('Remote calendar inbox URL not configured');
    }

    logger.info({ inboxUrl }, 'Sending Create activity to remote calendar');

    // SECURITY: Validate that the inbox URL does not point to a private IP address
    // to prevent SSRF attacks where a malicious remote calendar advertises an internal
    // network address as its inbox.
    try {
      await validateUrlNotPrivate(inboxUrl);
    }
    catch (error) {
      const errorMsg = `Security: Blocked delivery to private inbox URL: ${error instanceof Error ? error.message : String(error)}`;
      logError(error, `[Calendar] Security: Blocked delivery to private inbox URL for create activity`);
      throw new Error(errorMsg);
    }

    try {
      const response = await axios.post(inboxUrl, createActivity, {
        timeout: FEDERATION_HTTP_TIMEOUT_MS,
        maxRedirects: 0,
        headers: {
          'Content-Type': 'application/activity+json',
        },
      });

      logger.info({ status: response.status }, 'Remote calendar accepted Create activity');

      // The remote calendar should return the created event as JSON
      if (response.data && typeof response.data === 'object' && response.data.id) {
        // Use the event data returned by the remote calendar
        const event = CalendarEvent.fromObject(response.data);
        return event;
      }

      // Fallback: construct a local representation of the event if no response data
      const event = new CalendarEvent(
        eventId,
        remoteCalendarActor.id,
        this.generateEventUrl(eventId),
        false,
      );

      // Add content from params
      if (eventParams.content) {
        for (const [language, content] of Object.entries(eventParams.content)) {
          const contentObj = content as any;
          event.addContent(new CalendarEventContent(language, contentObj.name || '', contentObj.description || ''));
        }
      }

      return event;
    }
    catch (error: any) {
      logError(error, '[Calendar] Failed to create event on remote calendar');
      if (error.response?.status === 403) {
        throw new InsufficientCalendarPermissionsError('You are not authorized to create events on this calendar');
      }
      throw new Error(`Failed to create event on remote calendar: ${error.message}`);
    }
  }

  /**
   * Helper to build ISO date-time string from date and time parts
   */
  private buildIsoDateTime(date: string, time?: string): string {
    if (!date) return '';
    if (time) {
      return `${date}T${time}:00`;
    }
    return `${date}T00:00:00`;
  }

  /**
   * Updates an event on a remote calendar by sending an ActivityPub Update activity
   *
   * @param account - The local account updating the event
   * @param remoteCalendarActor - The CalendarActor representing the remote calendar
   * @param eventId - The ID of the event to update
   * @param eventParams - The updated event parameters
   * @returns A promise that resolves to the updated event
   */
  private async updateRemoteEventViaActivityPub(
    account: Account,
    remoteCalendarActor: CalendarActor,
    eventId: string,
    eventParams: Record<string, any>,
  ): Promise<CalendarEvent> {
    // Get the local user's actor URI for signing the activity
    const actorUri = await this.activityPubInterface!.getUserActorUri(account.id);
    if (!actorUri) {
      throw new InsufficientCalendarPermissionsError('User does not have an ActivityPub identity configured');
    }

    const localDomain = config.get<string>('domain');

    // Build the ActivityPub Update activity
    // Include the local event ID in eventParams so the remote can look it up
    const eventParamsWithId = { ...eventParams, id: eventId };

    const updateActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Update',
      id: `https://${localDomain}/activities/${uuidv4()}`,
      actor: actorUri,
      to: [remoteCalendarActor.actorUri],
      object: {
        type: 'Event',
        id: `https://${localDomain}/events/${eventId}`,
        name: eventParams.content?.en?.name || eventParams.name || 'Untitled Event',
        summary: eventParams.content?.en?.description || eventParams.description || '',
        startTime: this.buildIsoDateTime(eventParams.start_date, eventParams.start_time),
        endTime: this.buildIsoDateTime(eventParams.end_date, eventParams.end_time),
        attributedTo: actorUri,
        calendarId: remoteCalendarActor.id,
        eventParams: eventParamsWithId,
      },
    };

    // Send to the remote calendar's inbox
    const inboxUrl = remoteCalendarActor.inboxUrl;
    if (!inboxUrl) {
      throw new CalendarNotFoundError('Remote calendar inbox URL not configured');
    }

    logger.info({ inboxUrl }, 'Sending Update activity to remote calendar');

    // SECURITY: Validate that the inbox URL does not point to a private IP address
    // to prevent SSRF attacks where a malicious remote calendar advertises an internal
    // network address as its inbox.
    try {
      await validateUrlNotPrivate(inboxUrl);
    }
    catch (error) {
      const errorMsg = `Security: Blocked delivery to private inbox URL: ${error instanceof Error ? error.message : String(error)}`;
      logError(error, `[Calendar] Security: Blocked delivery to private inbox URL for update activity`);
      throw new Error(errorMsg);
    }

    try {
      const response = await axios.post(inboxUrl, updateActivity, {
        timeout: FEDERATION_HTTP_TIMEOUT_MS,
        maxRedirects: 0,
        headers: {
          'Content-Type': 'application/activity+json',
        },
      });

      logger.info({ status: response.status }, 'Remote calendar accepted Update activity');

      // Construct a local representation of the updated event
      const event = new CalendarEvent(
        eventId,
        remoteCalendarActor.id,
        this.generateEventUrl(eventId),
        false,
      );

      // Add content from params
      if (eventParams.content) {
        for (const [language, content] of Object.entries(eventParams.content)) {
          const contentObj = content as any;
          event.addContent(new CalendarEventContent(language, contentObj.name || '', contentObj.description || ''));
        }
      }

      return event;
    }
    catch (error: any) {
      logError(error, '[Calendar] Failed to update event on remote calendar');
      if (error.response?.status === 403) {
        throw new InsufficientCalendarPermissionsError('You are not authorized to update events on this calendar');
      }
      throw new Error(`Failed to update event on remote calendar: ${error.message}`);
    }
  }

  /**
   * Deletes an event on a remote calendar by sending an ActivityPub Delete activity
   *
   * @param account - The local account deleting the event
   * @param remoteCalendarActor - The CalendarActor representing the remote calendar
   * @param eventId - The ID of the event to delete
   * @returns A promise that resolves when the delete is complete
   */
  private async deleteRemoteEventViaActivityPub(
    account: Account,
    remoteCalendarActor: CalendarActor,
    eventId: string,
  ): Promise<void> {
    // Get the local user's actor URI for signing the activity
    const actorUri = await this.activityPubInterface!.getUserActorUri(account.id);
    if (!actorUri) {
      throw new InsufficientCalendarPermissionsError('User does not have an ActivityPub identity configured');
    }

    const localDomain = config.get<string>('domain');

    // Build the ActivityPub Delete activity
    // Include the local event ID so the remote can look it up
    const deleteActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Delete',
      id: `https://${localDomain}/activities/${uuidv4()}`,
      actor: actorUri,
      to: [remoteCalendarActor.actorUri],
      object: {
        type: 'Tombstone',
        id: `https://${localDomain}/events/${eventId}`,
        formerType: 'Event',
        calendarId: remoteCalendarActor.id,
        eventId: eventId,
      },
    };

    // Send to the remote calendar's inbox
    const inboxUrl = remoteCalendarActor.inboxUrl;
    if (!inboxUrl) {
      throw new CalendarNotFoundError('Remote calendar inbox URL not configured');
    }

    logger.info({ inboxUrl }, 'Sending Delete activity to remote calendar');

    // SECURITY: Validate that the inbox URL does not point to a private IP address
    // to prevent SSRF attacks where a malicious remote calendar advertises an internal
    // network address as its inbox.
    try {
      await validateUrlNotPrivate(inboxUrl);
    }
    catch (error) {
      const errorMsg = `Security: Blocked delivery to private inbox URL: ${error instanceof Error ? error.message : String(error)}`;
      logError(error, `[Calendar] Security: Blocked delivery to private inbox URL for delete activity`);
      throw new Error(errorMsg);
    }

    try {
      const response = await axios.post(inboxUrl, deleteActivity, {
        timeout: FEDERATION_HTTP_TIMEOUT_MS,
        maxRedirects: 0,
        headers: {
          'Content-Type': 'application/activity+json',
        },
      });

      logger.info({ status: response.status }, 'Remote calendar accepted Delete activity');
    }
    catch (error: any) {
      logError(error, '[Calendar] Failed to delete event on remote calendar');
      if (error.response?.status === 403) {
        throw new InsufficientCalendarPermissionsError('You are not authorized to delete events on this calendar');
      }
      throw new Error(`Failed to delete event on remote calendar: ${error.message}`);
    }
  }

  /**
     * Creates a new event for the provided account
     * @param account - account the event belongs to
     * @param eventParams - the parameters for the new event
     * @returns a promise that resolves to the created Event
     */
  async createEvent(account: Account, eventParams:Record<string,any>): Promise<CalendarEvent> {

    const calendar = await this.calendarService.getCalendar(eventParams.calendarId);
    const calendars = await this.calendarService.editableCalendarsForUser(account);

    // Check if this is a local calendar
    if (calendar) {
      if (!calendars.some(c => c.id == calendar.id)) {
        throw new InsufficientCalendarPermissionsError('Insufficient permissions to modify events in this calendar');
      }
      // Continue with local event creation below
    }
    else {
      // Calendar not found locally - check if it's a remote calendar we have access to.
      // Look up the CalendarActorEntity by the provided calendar UUID, then find membership.
      const calendarActor = await this.activityPubInterface!.findCalendarActorByCalendarId(eventParams.calendarId);
      if (calendarActor) {
        const remoteMembership = await CalendarMemberEntity.findOne({
          where: {
            account_id: account.id,
            calendar_actor_id: calendarActor.id,
            calendar_id: null, // Ensure this is remote calendar membership
          },
          include: [{ association: 'calendarActor' }],
        });

        if (remoteMembership && remoteMembership.calendarActor) {
          // This is a remote calendar - delegate to remote event creation
          const remoteCalendarActor = remoteMembership.calendarActor.toModel();
          return this.createRemoteEvent(account, remoteCalendarActor, eventParams);
        }
      }

      throw new CalendarNotFoundError('Calendar for event does not exist');
    }

    eventParams.id = this.generateEventId();
    eventParams.calendarId = calendar.id;

    // Validate + normalize externalUrl / urlPrompt pair before constructing
    // the model so the canonicalized values are what gets persisted.
    const normalizedExternalUrl = normalizeExternalUrl(eventParams.externalUrl);
    const validatedUrlPrompt = validateUrlPrompt(eventParams.urlPrompt);
    validateExternalUrlPair(normalizedExternalUrl, validatedUrlPrompt);
    eventParams.externalUrl = normalizedExternalUrl;
    eventParams.urlPrompt = validatedUrlPrompt;

    const event = CalendarEvent.fromObject(eventParams);
    if ( calendar.urlName.length > 0 ) {
      event.eventSourceUrl = '/' + calendar.urlName + '/' + event.id;
    }
    else {
      event.eventSourceUrl = '';
    }

    const eventEntity = EventEntity.fromModel(event);

    // Handle locationId (reference to existing location)
    if (eventParams.locationId) {
      // Validate that location exists and belongs to this calendar
      const location = await this.locationService.getLocationById(calendar, eventParams.locationId);
      if (!location) {
        throw new Error('Location not found or does not belong to this calendar');
      }

      eventEntity.location_id = eventParams.locationId;
      event.locationId = eventParams.locationId;
      event.location = location;
    }
    // Fallback to embedded location object (for backward compatibility)
    else if( eventParams.location ) {
      // Validate location hierarchy before processing
      const location = EventLocation.fromObject(eventParams.location);
      const validationErrors = validateLocationHierarchy(location);
      if (validationErrors.length > 0) {
        throw new LocationValidationError(validationErrors);
      }

      let locationEntity = await this.locationService.findOrCreateLocation(calendar, eventParams.location);
      eventEntity.location_id = locationEntity.id;
      event.location = locationEntity;
    }

    // Handle media attachment
    if (eventParams.mediaId) {
      // Verify the media belongs to the same calendar via MediaInterface
      const media = await this.mediaInterface?.getMediaById(eventParams.mediaId);

      if (!media || media.calendarId !== calendar.id) {
        throw new Error('Media not found or does not belong to this calendar');
      }
      eventEntity.media_id = media.id;
      event.media = media;
    }

    await eventEntity.save();

    // Notify media domain that media has been attached to an event
    if (eventEntity.media_id) {
      this.eventBus.emit('mediaAttachedToEvent', {
        mediaId: eventEntity.media_id,
        eventId: event.id,
      });
    }

    if ( eventParams.content ) {
      for( let [language,content] of Object.entries(eventParams.content) ) {
        event.addContent(await this.createEventContent(event.id, language, content as Record<string,any>));
      }
    }

    if ( eventParams.schedules ) {
      event.schedules = []; // "fromObject" auto-creates schedules, but we need to create them in the db
      for( let schedule of eventParams.schedules ) {
        event.addSchedule(await this.createEventSchedule(event.id, schedule as Record<string,any>));
      }
    }

    this.eventBus.emit('eventCreated', { calendar, event });
    return event;
  }

  async createEventSchedule(eventId: string, scheduleParams: Record<string,any>): Promise<CalendarEventSchedule> {
    const schedule = CalendarEventSchedule.fromObject(scheduleParams);

    // For non-recurring events, sync endDate to eventEndTime so the database
    // consistently reflects when the event ends for both instance generation
    // and direct schedule queries.
    if (!schedule.frequency && schedule.eventEndTime) {
      schedule.endDate = schedule.eventEndTime;
    }

    schedule.id = uuidv4();
    const scheduleEntity = EventScheduleEntity.fromModel(schedule);
    scheduleEntity.event_id = eventId;
    await scheduleEntity.save();

    return schedule;
  }

  async createEventContent(eventId: string, language: string, contentParams: Record<string,any>): Promise<CalendarEventContent> {
    contentParams.language = language;
    const content = CalendarEventContent.fromObject(contentParams);

    const contentEntity = EventContentEntity.fromModel(content);
    contentEntity.id = uuidv4();
    contentEntity.event_id = eventId;
    await contentEntity.save();

    return content;
  }

  /**
     * updates the event with the provided id
     * @param eventId - the id of the event to update
     * @param eventParams - the parameters and values to update for the event
     * @returns a promise that resolves to the Event
     */
  async updateEvent(account: Account, eventId: string, eventParams:Record<string,any>): Promise<CalendarEvent> {
    // Validate eventId parameter
    if (!eventId || (typeof eventId === 'string' && eventId.trim() === '')) {
      throw new ValidationError('Event ID is required');
    }

    if (!this.isValidUUID(eventId)) {
      throw new ValidationError('Invalid UUID format in event ID');
    }

    const eventEntity = await EventEntity.findByPk(eventId);

    // If event not found locally, check if this is a remote event the user can update
    if (!eventEntity) {
      // Check if the user has remote calendar membership for the specified calendarId
      if (eventParams.calendarId) {
        const calendarActor = await this.activityPubInterface!.findCalendarActorByCalendarId(eventParams.calendarId);
        if (calendarActor) {
          const remoteMembership = await CalendarMemberEntity.findOne({
            where: {
              account_id: account.id,
              calendar_actor_id: calendarActor.id,
              calendar_id: null, // Ensure this is remote calendar membership
            },
            include: [{ association: 'calendarActor' }],
          });

          if (remoteMembership && remoteMembership.calendarActor) {
            // This is a remote calendar event - delegate to remote update
            const remoteCalendarActor = remoteMembership.calendarActor.toModel();
            return this.updateRemoteEventViaActivityPub(account, remoteCalendarActor, eventId, eventParams);
          }
        }
      }
      throw new EventNotFoundError('Event not found');
    }

    // Remote events stored locally (calendar_id is null) cannot be updated through this method
    if (!eventEntity.calendar_id) {
      throw new InsufficientCalendarPermissionsError('Cannot update remote events through this method');
    }

    const calendar = await this.calendarService.getCalendar(eventEntity.calendar_id);
    if ( ! calendar ) {
      throw new CalendarNotFoundError('Calendar for event does not exist');
    }

    const calendars = await this.calendarService.editableCalendarsForUser(account);
    if ( ! calendars.some(c => c.id == calendar.id) ) {
      throw new InsufficientCalendarPermissionsError('Insufficient permissions to modify events in this calendar');
    }

    let event = eventEntity.toModel();

    // Validate + normalize externalUrl / urlPrompt pair. Only consider a field
    // "being changed" when its key is explicitly present in the payload — an
    // absent key means "leave the stored value alone".
    const urlKeyPresent = Object.prototype.hasOwnProperty.call(eventParams, 'externalUrl');
    const promptKeyPresent = Object.prototype.hasOwnProperty.call(eventParams, 'urlPrompt');
    if (urlKeyPresent || promptKeyPresent) {
      const rawUrl = urlKeyPresent ? eventParams.externalUrl : event.externalUrl;
      const rawPrompt = promptKeyPresent ? eventParams.urlPrompt : event.urlPrompt;
      const normalizedExternalUrl = normalizeExternalUrl(rawUrl);
      const validatedUrlPrompt = validateUrlPrompt(rawPrompt);
      validateExternalUrlPair(normalizedExternalUrl, validatedUrlPrompt);
      event.externalUrl = normalizedExternalUrl;
      event.urlPrompt = validatedUrlPrompt;
      eventEntity.external_url = normalizedExternalUrl;
      eventEntity.url_prompt = validatedUrlPrompt;
    }

    if ( eventParams.content ) {
      for( let [language,content] of Object.entries(eventParams.content) ) {
        let contentEntity = await EventContentEntity.findOne({
          where: { event_id: eventId, language: language },
        });

        if ( contentEntity ) {

          if ( ! content ) {
            await contentEntity.destroy();
            continue;
          }

          let c = content as Record<string,any>;
          delete c.language;

          if ( Object.keys(c).length === 0 ) {
            await contentEntity.destroy();
            continue;
          }

          // Support both 'name' and 'title' field names for API compatibility
          const name = c.name || c.title;
          await contentEntity.update({
            name: name,
            description: c.description,
            accessibility_info: c.accessibilityInfo ?? '',
          });
          event.addContent(contentEntity.toModel());
        }
        else {
          if ( !content ) {
            continue;
          }

          let c = content as Record<string,any>;
          delete c.language;

          if ( Object.keys(c).length > 0 ) {
            event.addContent(await this.createEventContent(eventId, language, c));
          }
        }
      }
    }

    // Handle locationId (reference to existing location) if present
    if (eventParams.hasOwnProperty('locationId')) {
      if (eventParams.locationId === null) {
        // Clear the location
        eventEntity.location_id = null;
        event.locationId = null;
        event.location = null;
      }
      else {
        // Validate that location exists and belongs to this calendar
        const location = await this.locationService.getLocationById(calendar, eventParams.locationId);
        if (!location) {
          throw new Error('Location not found or does not belong to this calendar');
        }

        eventEntity.location_id = eventParams.locationId;
        event.locationId = eventParams.locationId;
        event.location = location;
      }
    }
    // Fallback to embedded location object (for backward compatibility)
    else if ( eventEntity.location_id && ! eventParams.location ) {
      eventEntity.location_id = null;
      event.location = null;
    }
    else if( eventParams.location ) {
      // Validate location hierarchy before processing
      const location = EventLocation.fromObject(eventParams.location);
      const validationErrors = validateLocationHierarchy(location);
      if (validationErrors.length > 0) {
        throw new LocationValidationError(validationErrors);
      }

      let locationEntity = await this.locationService.findOrCreateLocation(calendar, eventParams.location);
      eventEntity.location_id = locationEntity.id;
      event.location = locationEntity;
    }

    if ( eventParams.schedules ) {
      let existingSchedules = await EventScheduleEntity.findAll({ where: { event_id: eventId } });
      let existingScheduleIds = existingSchedules.map( s => s.id );

      for( let schedule of eventParams.schedules ) {

        if ( schedule.id ) {
          let scheduleEntity = existingSchedules.find( s => s.id === schedule.id );

          if ( ! scheduleEntity ) {
            throw Error ('Schedule not found for event');
          }

          existingScheduleIds = existingScheduleIds.filter( id => id !== schedule.id );

          // Parse incoming data through the model to get proper DateTime objects
          // and correct property name mapping (start → startDate, end → endDate)
          const parsed = CalendarEventSchedule.fromObject(schedule);

          // For non-recurring events, sync endDate to eventEndTime (same as createEventSchedule)
          if (!parsed.frequency && parsed.eventEndTime) {
            parsed.endDate = parsed.eventEndTime;
          }

          const byDayValue = parsed.byDay !== undefined && parsed.byDay.length > 0
            ? parsed.byDay.join(',')
            : scheduleEntity.by_day;

          // Use parsed model values for fields present in the request.
          // For clearable fields (end_date, count, frequency), check the raw
          // request keys to distinguish "explicitly cleared" from "not sent".
          // Raw key names: start/end/eventEndTime/frequency/interval/count/isException
          const toStorage = EventScheduleEntity.toStorageDate;
          await scheduleEntity.update({
            timezone: parsed.startDate?.zoneName ?? scheduleEntity.timezone,
            start_date: toStorage(parsed.startDate) ?? scheduleEntity.start_date,
            end_date: 'end' in schedule ? (toStorage(parsed.endDate) ?? null) : scheduleEntity.end_date,
            event_end_time: 'eventEndTime' in schedule ? (toStorage(parsed.eventEndTime) ?? null) : scheduleEntity.event_end_time,
            frequency: 'frequency' in schedule ? ((parsed.frequency as string) ?? null) : scheduleEntity.frequency,
            interval: 'interval' in schedule ? (parsed.interval ?? 0) : scheduleEntity.interval,
            count: 'count' in schedule ? (parsed.count ?? 0) : scheduleEntity.count,
            by_day: byDayValue,
            is_exclusion: 'isException' in schedule ? (parsed.isExclusion ?? false) : scheduleEntity.is_exclusion,
          });
          event.addSchedule(scheduleEntity.toModel());
        }
        else {
          event.addSchedule(await this.createEventSchedule(eventId, schedule));
        }
      }

      if ( existingScheduleIds.length > 0 ) {
        await EventScheduleEntity.destroy({ where: { id: existingScheduleIds } });
      }
    }

    // Handle media updates
    let newMediaAttached = false;
    if (eventParams.hasOwnProperty('mediaId')) {
      if (eventParams.mediaId) {
        // Verify the media belongs to the same calendar via MediaInterface
        const media = await this.mediaInterface?.getMediaById(eventParams.mediaId);

        if (!media || media.calendarId !== calendar.id) {
          throw new Error('Media not found or does not belong to this calendar');
        }
        newMediaAttached = eventEntity.media_id !== media.id;
        eventEntity.media_id = media.id;
        event.media = media;
      }
      else {
        // Remove media if mediaId is null/empty
        eventEntity.media_id = '';
        event.media = null;
      }
    }

    if (eventParams.mediaFocalPointX !== undefined) {
      eventEntity.media_focal_point_x = eventParams.mediaFocalPointX;
    }
    if (eventParams.mediaFocalPointY !== undefined) {
      eventEntity.media_focal_point_y = eventParams.mediaFocalPointY;
    }
    if (eventParams.mediaZoom !== undefined) {
      eventEntity.media_zoom = eventParams.mediaZoom;
    }

    await eventEntity.save();

    // Notify media domain that media has been attached to an event
    if (newMediaAttached && eventEntity.media_id) {
      this.eventBus.emit('mediaAttachedToEvent', {
        mediaId: eventEntity.media_id,
        eventId: event.id,
      });
    }

    this.eventBus.emit('eventUpdated', { calendar, event });
    return event;
  }

  /**
   * Add a new event from a remote calendar.
   * Remote events have calendar_id = null since they don't belong to a local calendar.
   * The AP origin information is tracked separately in EventObjectEntity.
   *
   * @param calendar - the local calendar context (used for location storage)
   * @param eventParams - the parameters for the new event
   * @returns a promise that resolves to the created Event
   */
  async addRemoteEvent(calendar: Calendar, eventParams:Record<string,any>): Promise<CalendarEvent> {
    if ( ! eventParams.id ) {
      throw new Error('Event id is required');
    }
    // Validate event id format
    // Accept: UUID only, or full URL formats
    if ( eventParams.id.match(/^([0-9a-f-]+|https:\/\/[^\/]+(\/calendars\/[^\/]+)?\/events\/[0-9a-f-]+)$/) === null ) {
      throw new Error('Invalid event id');
    }

    // If calendarId is explicitly provided (e.g., from a cross-instance editor),
    // preserve it. Otherwise, set to null for traditional remote federated events.
    if (!eventParams.calendarId) {
      eventParams.calendarId = null;
    }

    const event = CalendarEvent.fromObject(eventParams);
    const eventEntity = EventEntity.fromModel(event);

    if( eventParams.location ) {
      let location = await this.locationService.findOrCreateLocation(calendar, eventParams.location);
      eventEntity.location_id = location.id;
      event.location = location;
    }

    await eventEntity.save();

    if ( eventParams.content ) {
      for( let [language,content] of Object.entries(eventParams.content) ) {
        event.addContent(await this.createEventContent(event.id, language, content as Record<string,any>));
      }
    }

    if ( eventParams.schedules ) {
      for( let schedule of eventParams.schedules ) {
        event.addSchedule(await this.createEventSchedule(event.id, schedule as Record<string,any>));
      }
    }

    return event;
  }

  /**
   * Update a remote event with new data from a federated Update activity.
   * This is called when receiving an Update activity via ActivityPub.
   *
   * @param calendar - the local calendar receiving this update (for location context)
   * @param eventParams - the updated event parameters
   * @returns a promise that resolves to the updated Event
   */
  async updateRemoteEvent(calendar: Calendar, eventParams: Record<string,any>): Promise<CalendarEvent> {

    const eventEntity = await EventEntity.findByPk(eventParams.id);

    if (!eventEntity) {
      throw new EventNotFoundError(`Remote event ${eventParams.id} not found for update`);
    }

    // Use the local calendar that is receiving this update (same pattern as addRemoteEvent)

    let event = eventEntity.toModel();

    // Update content translations
    if (eventParams.content) {
      for (let [language, content] of Object.entries(eventParams.content)) {
        let contentEntity = await EventContentEntity.findOne({
          where: { event_id: eventParams.id, language: language },
        });

        if (contentEntity) {
          if (!content) {
            await contentEntity.destroy();
            continue;
          }

          let c = content as Record<string,any>;
          delete c.language;

          if (Object.keys(c).length === 0) {
            await contentEntity.destroy();
            continue;
          }

          await contentEntity.update({
            name: c.name,
            description: c.description,
            accessibility_info: c.accessibilityInfo ?? '',
          });
          event.addContent(contentEntity.toModel());
        }
        else {
          if (!content) {
            continue;
          }

          let c = content as Record<string,any>;
          delete c.language;

          if (Object.keys(c).length > 0) {
            event.addContent(await this.createEventContent(eventParams.id, language, c));
          }
        }
      }
    }

    // Update location
    if (eventEntity.location_id && !eventParams.location) {
      eventEntity.location_id = null;
      event.location = null;
    }
    else if (eventParams.location) {
      let locationEntity = await this.locationService.findOrCreateLocation(calendar, eventParams.location);
      eventEntity.location_id = locationEntity.id;
      event.location = locationEntity;
    }

    // Update schedules
    if (eventParams.schedules) {
      let existingSchedules = await EventScheduleEntity.findAll({ where: { event_id: eventParams.id } });
      let existingScheduleIds = existingSchedules.map(s => s.id);

      for (let schedule of eventParams.schedules) {
        if (schedule.id) {
          let scheduleEntity = existingSchedules.find(s => s.id === schedule.id);

          if (!scheduleEntity) {
            throw Error('Schedule not found for event');
          }

          existingScheduleIds = existingScheduleIds.filter(id => id !== schedule.id);

          const byDayValue = schedule.byDay !== undefined
            ? (Array.isArray(schedule.byDay) ? schedule.byDay.join(',') : (schedule.byDay || ''))
            : scheduleEntity.by_day;

          await scheduleEntity.update({
            start_date: schedule.startDate ?? scheduleEntity.start_date,
            end_date: schedule.endDate ?? scheduleEntity.end_date,
            event_end_time: schedule.eventEndTime ?? scheduleEntity.event_end_time,
            frequency: schedule.frequency ?? scheduleEntity.frequency,
            interval: schedule.interval ?? scheduleEntity.interval,
            count: schedule.count ?? scheduleEntity.count,
            by_day: byDayValue,
            is_exclusion: schedule.isExclusion ?? scheduleEntity.is_exclusion,
          });
          event.addSchedule(scheduleEntity.toModel());
        }
        else {
          event.addSchedule(await this.createEventSchedule(eventParams.id, schedule));
        }
      }

      if (existingScheduleIds.length > 0) {
        await EventScheduleEntity.destroy({ where: { id: existingScheduleIds } });
      }
    }

    await eventEntity.save();

    return event;
  }

  /**
   * Delete a remote event.
   * This is called when receiving a Delete activity via ActivityPub.
   *
   * @param eventId - the ID of the event to delete
   * @returns a promise that resolves when the event is deleted
   */
  async deleteRemoteEvent(eventId: string): Promise<void> {
    const eventEntity = await EventEntity.findByPk(eventId, {
      include: [EventContentEntity, LocationEntity, EventScheduleEntity, MediaEntity],
    });

    if (!eventEntity) {
      throw new EventNotFoundError(`Remote event ${eventId} not found for deletion`);
    }

    const transaction = await db.transaction();
    try {
      // Delete related records in correct order to satisfy foreign key constraints
      await EventInstanceEntity.destroy({
        where: { event_id: eventId },
        transaction,
      });

      await EventCategoryAssignmentEntity.destroy({
        where: { event_id: eventId },
        transaction,
      });

      await EventScheduleEntity.destroy({
        where: { event_id: eventId },
        transaction,
      });

      await EventContentEntity.destroy({
        where: { event_id: eventId },
        transaction,
      });

      await eventEntity.destroy({ transaction });

      await transaction.commit();
    }
    catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async getEventById(eventId: string): Promise<CalendarEvent> {
    // Validate eventId parameter
    if (!eventId || (typeof eventId === 'string' && eventId.trim() === '')) {
      throw new ValidationError('eventId is required');
    }


    const event = await EventEntity.findOne({
      where: { id: eventId },
      include: [
        EventContentEntity,
        { model: LocationEntity, include: [LocationContentEntity] },
        EventScheduleEntity,
        MediaEntity,
        { model: EventSeriesEntity, include: [EventSeriesContentEntity] },
      ],
    });

    if ( ! event ) {
      throw new EventNotFoundError(eventId);
    }

    let e = event.toModel();
    if ( event.content ) {
      for ( let c of event.content ) {
        e.addContent( c.toModel() );
      }
    }
    if ( event.location ) {
      e.location = event.location.toModel();
    }
    if ( event.schedules ) {
      for ( let s of event.schedules ) {
        e.addSchedule( s.toModel() );
      }
    }
    if ( event.media ) {
      e.media = event.media.toModel();
    }

    e.categories = await this.categoryService.getEventCategories(event.id);

    return e;
  }

  /**
   * Resolves the effective calendar ID for a set of events, accounting for reposts.
   *
   * For owned events the calendar_id on the EventEntity is the correct calendar to use.
   * For reposted events the calendar_id is the original owner's calendar; this method
   * detects that case and returns the reposter's calendar (which the account controls)
   * instead.
   *
   * @param account - The account requesting the operation
   * @param calendarId - The calendar ID taken directly from the EventEntity rows
   * @param eventIds - The event IDs being operated on
   * @param transaction - Active Sequelize transaction
   * @param preferredCalendarId - Optional caller-supplied context (e.g. the calendar
   *   whose event list the user is viewing). When the account owns both the event's
   *   source calendar and a repost target, this disambiguates which calendar the
   *   operation is intended to modify. Used when the preferred calendar either matches
   *   the source calendar or has an EventRepostEntity row for every event in the set.
   * @returns effectiveCalendarId (string), wasRepost flag, and pre-fetched userCalendars
   * @throws InsufficientCalendarPermissionsError when no owned calendar can be resolved
   */
  private async resolveEffectiveCalendarId(
    account: Account,
    calendarId: string,
    eventIds: string[],
    transaction: Transaction,
    preferredCalendarId?: string,
  ): Promise<{ effectiveCalendarId: string; wasRepost: boolean; userCalendars: Calendar[] }> {
    const userCalendars = await this.calendarService.editableCalendarsForUser(account);
    let effectiveCalendarId = calendarId;
    let wasRepost = false;

    // Fast path: caller doesn't need disambiguation and already owns the source
    // calendar. No repost lookup required.
    if (!preferredCalendarId && userCalendars.some(cal => cal.id === effectiveCalendarId)) {
      return { effectiveCalendarId, wasRepost, userCalendars };
    }

    // Reposts are tracked in two tables: the legacy EventRepostEntity and the
    // authoritative SharedEventEntity (populated by the auto-repost pipeline).
    // Both must be consulted, otherwise repost targets created via auto-repost
    // are invisible to this resolver.
    const legacyReposts = await EventRepostEntity.findAll({
      where: { event_id: eventIds },
      transaction,
    });
    const sharedCalendarIdsByEvent = new Map<string, Set<string>>();
    if (this.activityPubInterface) {
      for (const eventId of eventIds) {
        const calendarIds = await this.activityPubInterface.getCalendarIdsForSharedEvent(eventId);
        sharedCalendarIdsByEvent.set(eventId, new Set(calendarIds));
      }
    }

    const isRepostTarget = (candidateCalendarId: string): boolean => {
      return eventIds.every((eventId) => {
        if (legacyReposts.some(r => r.event_id === eventId && r.calendar_id === candidateCalendarId)) {
          return true;
        }
        return sharedCalendarIdsByEvent.get(eventId)?.has(candidateCalendarId) ?? false;
      });
    };

    // When the caller provides the calendar context they're operating in, honor it
    // if the account owns it and it has a valid relationship with the events. This
    // disambiguates the case where the account owns both source and repost-target
    // calendars (otherwise the source calendar wins and repost-target categories
    // fail validation).
    if (preferredCalendarId && userCalendars.some(cal => cal.id === preferredCalendarId)) {
      if (preferredCalendarId === calendarId) {
        return { effectiveCalendarId: preferredCalendarId, wasRepost: false, userCalendars };
      }
      if (isRepostTarget(preferredCalendarId)) {
        return { effectiveCalendarId: preferredCalendarId, wasRepost: true, userCalendars };
      }
    }

    if (!userCalendars.some(cal => cal.id === effectiveCalendarId)) {
      // Gather all candidate repost targets across both legacy and shared tables.
      const candidateCalendarIds = new Set<string>();
      for (const r of legacyReposts) {
        candidateCalendarIds.add(r.calendar_id);
      }
      for (const set of sharedCalendarIdsByEvent.values()) {
        for (const id of set) {
          candidateCalendarIds.add(id);
        }
      }
      const ownedRepostTargets = [...candidateCalendarIds].filter(
        (id) => userCalendars.some(cal => cal.id === id) && isRepostTarget(id),
      );
      if (ownedRepostTargets.length === 1) {
        effectiveCalendarId = ownedRepostTargets[0];
        wasRepost = true;
      }
      // If still not resolved, the permission check in the caller will throw
    }

    return { effectiveCalendarId, wasRepost, userCalendars };
  }

  /**
   * Assign categories to multiple events at once
   * @param account - the account performing the operation
   * @param eventIds - array of event IDs to assign categories to
   * @param categoryIds - array of category IDs to assign
   * @returns promise that resolves to updated events with their categories
   */
  async bulkAssignCategories(
    account: Account,
    eventIds: string[],
    categoryIds: string[],
  ): Promise<CalendarEvent[]> {
    // Validate required array fields
    if (!Array.isArray(eventIds) || eventIds.length === 0) {
      throw new ValidationError('eventIds must be a non-empty array');
    }

    if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
      throw new ValidationError('categoryIds must be a non-empty array');
    }

    // Validate that all IDs are strings
    if (!eventIds.every(id => typeof id === 'string')) {
      throw new ValidationError('all eventIds must be strings');
    }

    if (!categoryIds.every(id => typeof id === 'string')) {
      throw new ValidationError('all categoryIds must be strings');
    }

    // Validate that all IDs are valid UUIDs
    const invalidEventIds = eventIds.filter(id => !this.isValidUUID(id));
    if (invalidEventIds.length > 0) {
      throw new ValidationError('invalid UUID format in eventIds', { invalidIds: invalidEventIds });
    }

    const invalidCategoryIds = categoryIds.filter(id => !this.isValidUUID(id));
    if (invalidCategoryIds.length > 0) {
      throw new ValidationError('invalid UUID format in categoryIds', { invalidIds: invalidCategoryIds });
    }


    let wasRepost = false;

    const transaction = await db.transaction();

    try {
      // 1. Validate that all events exist
      const events = await EventEntity.findAll({
        where: { id: eventIds },
        transaction,
      });

      if (events.length !== eventIds.length) {
        throw new BulkEventsNotFoundError('Some events were not found or you do not have permission to modify them');
      }

      // 2. Verify all events belong to same local calendar (remote events not supported)
      const calendarIds = [...new Set(events.map(event => event.calendar_id))];

      // Check for remote events (calendar_id is null)
      if (calendarIds.includes(null)) {
        throw new MixedCalendarEventsError('Cannot bulk assign categories to remote events');
      }

      if (calendarIds.length > 1) {
        throw new MixedCalendarEventsError('All events must belong to the same calendar');
      }

      // 3. Resolve the effective calendar for permission and category validation.
      // For reposted events the event's calendar_id is the original owner's calendar;
      // we need the reposter's calendar (which the user controls) instead.
      const {
        effectiveCalendarId,
        wasRepost: resolvedAsRepost,
        userCalendars,
      } = await this.resolveEffectiveCalendarId(account, calendarIds[0] as string, eventIds, transaction);
      let calendarId = effectiveCalendarId;
      wasRepost = resolvedAsRepost;

      const calendar = await this.calendarService.getCalendar(calendarId);

      if (!calendar) {
        throw new CalendarNotFoundError('Calendar not found for events');
      }

      // 4. Validate categories exist and belong to the effective calendar
      const categories = await EventCategoryEntity.findAll({
        where: {
          id: categoryIds,
          calendar_id: calendarId,
        },
        transaction,
      });

      if (categories.length !== categoryIds.length) {
        throw new CategoriesNotFoundError('Some categories were not found in the calendar');
      }

      // 5. Check user has permission to modify events
      // All events are in the same effective calendar, so check permission once
      const hasPermission = userCalendars.some(cal => cal.id === calendarId);
      if (!hasPermission) {
        throw new InsufficientCalendarPermissionsError('Insufficient permissions to modify events in this calendar');
      }

      // 5. Get existing assignments to avoid duplicates
      const existingAssignments = await EventCategoryAssignmentEntity.findAll({
        where: {
          event_id: eventIds,
          category_id: categoryIds,
        },
        transaction,
      });

      // 6. Create assignments, avoiding duplicates
      const assignmentsToCreate = [];

      for (const eventId of eventIds) {
        for (const categoryId of categoryIds) {
          // Check if this assignment already exists
          const existingAssignment = existingAssignments.find(
            assignment => assignment.event_id === eventId && assignment.category_id === categoryId,
          );

          if (!existingAssignment) {
            assignmentsToCreate.push({
              id: uuidv4(),
              event_id: eventId,
              category_id: categoryId,
            });
          }
        }
      }

      // 7. Bulk create all new assignments
      if (assignmentsToCreate.length > 0) {
        await EventCategoryAssignmentEntity.bulkCreate(assignmentsToCreate, { transaction });
      }

      await transaction.commit();
    }
    catch (error) {
      await transaction.rollback();
      throw error;
    }

    // 8. Return updated events with their categories (after successful commit)
    const updatedEvents = [];
    for (const eventId of eventIds) {
      const updatedEvent = await this.getEventById(eventId);
      // wasRepost is derived from resolveEffectiveCalendarId(); preserve the
      // legacy boolean by mapping true → 'manual' (no auto/manual context here).
      updatedEvent.repostStatus = wasRepost ? 'manual' : 'none';
      updatedEvents.push(updatedEvent);
    }

    return updatedEvents;
  }

  /**
   * Replace all category assignments on a single event with a new set.
   * Empty categoryIds clears all assignments.
   *
   * @param account - The account performing the operation
   * @param eventId - The event ID to replace categories on
   * @param categoryIds - Array of category IDs to assign (empty clears all)
   * @returns Promise resolving to the updated CalendarEvent
   */
  async replaceEventCategories(
    account: Account,
    eventId: string,
    categoryIds: string[],
    calendarId?: string,
  ): Promise<CalendarEvent> {
    // Validate eventId is a valid UUID
    if (!this.isValidUUID(eventId)) {
      throw new ValidationError('eventId must be a valid UUID');
    }

    // Validate each categoryId is a valid UUID
    if (categoryIds.length > 0) {
      const invalidCategoryIds = categoryIds.filter(id => !this.isValidUUID(id));
      if (invalidCategoryIds.length > 0) {
        throw new ValidationError('invalid UUID format in categoryIds');
      }
    }

    // Deduplicate categoryIds to prevent false count mismatches
    const uniqueCategoryIds = [...new Set(categoryIds)];

    let wasRepost = false;

    const transaction = await db.transaction();

    try {
      // 1. Find the event
      const event = await EventEntity.findOne({
        where: { id: eventId },
        transaction,
      });

      if (!event) {
        throw new EventNotFoundError('Event not found');
      }

      // 2. Resolve effective calendar (handles repost lookup)
      const {
        effectiveCalendarId,
        wasRepost: resolvedAsRepost,
        userCalendars,
      } = await this.resolveEffectiveCalendarId(account, event.calendar_id, [eventId], transaction, calendarId);
      wasRepost = resolvedAsRepost;

      // 3. Check user has permission
      const hasPermission = userCalendars.some(cal => cal.id === effectiveCalendarId);
      if (!hasPermission) {
        throw new InsufficientCalendarPermissionsError('Insufficient permissions to modify events in this calendar');
      }

      // 4. Validate categories belong to effective calendar (only if non-empty)
      if (uniqueCategoryIds.length > 0) {
        const categories = await EventCategoryEntity.findAll({
          where: {
            id: uniqueCategoryIds,
            calendar_id: effectiveCalendarId,
          },
          transaction,
        });

        if (categories.length !== uniqueCategoryIds.length) {
          throw new CategoriesNotFoundError('Some categories were not found in the calendar');
        }
      }

      // 5. Destroy all existing assignments for this event
      await EventCategoryAssignmentEntity.destroy({
        where: { event_id: eventId },
        transaction,
      });

      // 6. Bulk create new assignments (skip if empty)
      if (uniqueCategoryIds.length > 0) {
        const assignmentsToCreate = uniqueCategoryIds.map(categoryId => ({
          id: uuidv4(),
          event_id: eventId,
          category_id: categoryId,
        }));

        await EventCategoryAssignmentEntity.bulkCreate(assignmentsToCreate, { transaction });
      }

      await transaction.commit();
    }
    catch (error) {
      await transaction.rollback();
      throw error;
    }

    // Return updated event (after successful commit)
    const updatedEvent = await this.getEventById(eventId);
    // wasRepost is derived from resolveEffectiveCalendarId(); map true → 'manual'
    // (no auto/manual context available here).
    updatedEvent.repostStatus = wasRepost ? 'manual' : 'none';

    return updatedEvent;
  }

  /**
   * Delete an event
   * @param account - The account attempting to delete the event
   * @param eventId - The ID of the event to delete
   * @param calendarId - Optional calendar ID, required for remote calendar events
   * @throws EventNotFoundError if the event doesn't exist
   * @throws InsufficientCalendarPermissionsError if the user can't modify the calendar
   */
  async deleteEvent(account: Account, eventId: string, calendarId?: string): Promise<void> {
    // Validate eventId parameter
    if (!eventId || (typeof eventId === 'string' && eventId.trim() === '')) {
      throw new ValidationError('Event ID is required');
    }

    if (!this.isValidUUID(eventId)) {
      throw new ValidationError('Invalid UUID format in event ID');
    }

    const eventEntity = await EventEntity.findByPk(eventId, {
      include: [EventContentEntity, LocationEntity, EventScheduleEntity, MediaEntity],
    });

    // If event not found locally, check if this is a remote event the user can delete
    if (!eventEntity) {
      // Check if the user has remote calendar membership for the specified calendarId
      if (calendarId) {
        const calendarActor = await this.activityPubInterface!.findCalendarActorByCalendarId(calendarId);
        if (calendarActor) {
          const remoteMembership = await CalendarMemberEntity.findOne({
            where: {
              account_id: account.id,
              calendar_actor_id: calendarActor.id,
              calendar_id: null, // Ensure this is remote calendar membership
            },
            include: [{ association: 'calendarActor' }],
          });

          if (remoteMembership && remoteMembership.calendarActor) {
            // This is a remote calendar event - delegate to remote delete
            const remoteCalendarActor = remoteMembership.calendarActor.toModel();
            await this.deleteRemoteEventViaActivityPub(account, remoteCalendarActor, eventId);
            return;
          }
        }
      }
      throw new EventNotFoundError(`Event with ID ${eventId} not found`);
    }

    // Remote events stored locally (calendar_id is null) cannot be deleted through this method
    if (!eventEntity.calendar_id) {
      throw new InsufficientCalendarPermissionsError('Cannot delete remote events through this method - use deleteRemoteEvent');
    }

    const calendar = await this.calendarService.getCalendar(eventEntity.calendar_id);
    if (!calendar) {
      throw new CalendarNotFoundError(`Calendar not found for event ${eventId}`);
    }

    const canModify = await this.calendarService.userCanModifyCalendar(account, calendar);
    if (!canModify) {
      throw new InsufficientCalendarPermissionsError(`User does not have permission to delete events in calendar ${calendar.urlName}`);
    }

    // Capture the CalendarEvent model before the deletion transaction destroys the entity
    const event = eventEntity.toModel();

    const transaction = await db.transaction();
    try {
      // Delete related records in correct order to satisfy foreign key constraints
      // 1. Delete event instances first
      await EventInstanceEntity.destroy({
        where: { event_id: eventId },
        transaction,
      });

      // 2. Delete category assignments
      await EventCategoryAssignmentEntity.destroy({
        where: { event_id: eventId },
        transaction,
      });

      // 3. Delete event schedules
      await EventScheduleEntity.destroy({
        where: { event_id: eventId },
        transaction,
      });

      // 4. Delete event content translations
      await EventContentEntity.destroy({
        where: { event_id: eventId },
        transaction,
      });

      // 5. Finally, delete the main event entity
      await eventEntity.destroy({ transaction });

      await transaction.commit();
    }
    catch (error) {
      await transaction.rollback();
      throw error;
    }

    // Emit event for ActivityPub federation (after successful commit)
    this.eventBus.emit('eventDeleted', {
      calendar,
      event,
    });
  }
  /**
   * Retrieves events from calendars that the given calendar is following.
   * This is the calendar domain's implementation of the feed query, exposing
   * the EventEntity records as CalendarEvent domain models.
   *
   * Used by ActivityPubService to populate the federation feed without
   * crossing the domain boundary by importing EventEntity directly.
   *
   * @param calendar - The calendar whose followed sources should be queried
   * @param page - Zero-based page number for pagination (default: 0)
   * @param pageSize - Number of events per page (default: 20)
   * @returns Array of CalendarEvent domain models from followed sources
   */
  async getEventsFromFollowedSources(calendar: Calendar, page?: number, pageSize?: number): Promise<CalendarEvent[]> {
    const defaultPageSize = pageSize || 20;

    // Escape the calendar ID to prevent SQL injection in literal subqueries.
    const escapedCalendarId = EventEntity.sequelize!.escape(calendar.id);

    // Query events from calendars this calendar is following.
    // This includes BOTH:
    // - Remote events (calendar_id = null) tracked via EventObjectEntity.attributed_to
    // - Local events (calendar_id = UUID) from followed local calendars
    const events = await EventEntity.findAll({
      where: {
        [Op.or]: [
          // Remote events originally authored by followed remote calendars
          {
            calendar_id: null,
            id: {
              [Op.in]: EventEntity.sequelize!.literal(
                `(SELECT eo.event_id FROM ap_event_object eo
                  JOIN calendar_actor ca ON eo.attributed_to = ca.actor_uri AND ca.actor_type = 'remote'
                  JOIN ap_following f ON f.calendar_actor_id = ca.id
                  WHERE f.calendar_id = ${escapedCalendarId})`,
              ),
            },
          },
          // Events announced/shared by followed remote calendars.
          // Includes BOTH remote-origin events (calendar_id = null) and
          // local-origin events (calendar_id = UUID) — the latter surfaces
          // when a followed remote peer shares one of our own events back
          // to us (e.g., cross-instance auto-repost self-origin loop). No
          // calendar_id outer filter: the ea.type='share' + remote actor +
          // ap_following joins are sufficient semantic filters.
          {
            id: {
              [Op.in]: EventEntity.sequelize!.literal(
                `(SELECT eo.event_id FROM ap_event_object eo
                  JOIN ap_event_activity ea ON eo.ap_id = ea.event_id AND ea.type = 'share'
                  JOIN calendar_actor ca ON ea.calendar_actor_id = ca.id AND ca.actor_type = 'remote'
                  JOIN ap_following f ON f.calendar_actor_id = ca.id
                  WHERE f.calendar_id = ${escapedCalendarId})`,
              ),
            },
          },
          // Local events from followed local calendars
          {
            calendar_id: {
              [Op.in]: EventEntity.sequelize!.literal(
                `(SELECT ca.calendar_id FROM ap_following f
                  JOIN calendar_actor ca ON f.calendar_actor_id = ca.id
                  WHERE f.calendar_id = ${escapedCalendarId}
                    AND ca.actor_type = 'local'
                    AND ca.calendar_id IS NOT NULL)`,
              ),
            },
          },
          // Events reposted by followed local calendars (pv-ru1j)
          // Note: No calendar_id outer filter — includes both local-origin and
          // remote-origin reposted events. EventRepostEntity stores event_id
          // directly, so filtering by calendar_id would incorrectly exclude
          // valid reposts where the original event belongs to a different calendar.
          {
            id: {
              [Op.in]: EventEntity.sequelize!.literal(
                `(SELECT er.event_id FROM event_repost er
                  JOIN calendar_actor ca ON er.calendar_id = ca.calendar_id AND ca.actor_type = 'local'
                  JOIN ap_following f ON f.calendar_actor_id = ca.id
                  WHERE f.calendar_id = ${escapedCalendarId})`,
              ),
            },
          },
          // Events auto-reposted (shared via AP) by followed local calendars.
          // Auto-repost creates SharedEventEntity records, not EventRepostEntity,
          // so this condition is needed to surface multi-hop reposted events.
          {
            id: {
              [Op.in]: EventEntity.sequelize!.literal(
                `(SELECT se.event_id FROM ap_shared_event se
                  JOIN calendar_actor ca ON se.calendar_id = ca.calendar_id AND ca.actor_type = 'local'
                  JOIN ap_following f ON f.calendar_actor_id = ca.id
                  WHERE f.calendar_id = ${escapedCalendarId})`,
              ),
            },
          },
        ],
      },
      include: [
        {
          association: 'content',
          required: false,
        },
        {
          association: 'schedules',
          required: false,
        },
        {
          association: 'categoryAssignments',
          required: false,
        },
        {
          association: 'location',
          required: false,
        },
      ],
      limit: defaultPageSize,
      offset: page ? page * defaultPageSize : 0,
      order: [['createdAt', 'DESC']],
    });

    return events.map(entity => {
      const event = entity.toModel();
      // Populate schedules not handled by EventEntity.toModel()
      if (entity.schedules && entity.schedules.length > 0) {
        event.schedules = entity.schedules.map((s: any) => s.toModel());
      }
      // Populate category IDs from category assignments
      const categoryAssignments = entity.getDataValue('categoryAssignments') as any[] | undefined;
      if (categoryAssignments && categoryAssignments.length > 0) {
        event.categories = categoryAssignments.map((ca: any) => {
          const cat = new EventCategory(ca.category_id, '');
          return cat;
        });
      }
      return event;
    });
  }

}

export default EventService;
