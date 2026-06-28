import { v4 as uuidv4 } from 'uuid';
import config from 'config';

import { Account } from "@/common/model/account";
import { Calendar } from "@/common/model/calendar";
import { CalendarMemberEntity } from "@/server/calendar/entity/calendar_member";
import type { CalendarActor } from "@/server/activitypub/entity/calendar_actor";
import { CalendarEvent, CalendarEventContent, CalendarEventSchedule, UrlPrompt, URL_PROMPT_VALUES } from "@/common/model/events";
import { EventCategory } from "@/common/model/event_category";
import { EventLocation, validateLocationHierarchy } from "@/common/model/location";
import { EventContentEntity, EventEntity, EventScheduleEntity } from "@/server/calendar/entity/event";
import { EventImportOriginEntity } from "@/server/calendar/entity/event_import_origin";
import CalendarService from "@/server/calendar/service/calendar";
import { LocationEntity, LocationContentEntity } from "@/server/calendar/entity/location";
import { LocationSpaceEntity, LocationSpaceContentEntity } from "@/server/calendar/entity/location_space";
// TODO: MediaEntity is still needed here for Sequelize eager-load association includes
// (e.g., include: [MediaEntity] in queries). Removing this cross-domain import requires
// either restructuring entity associations or moving eager-loading to the media domain.
import { MediaEntity } from "@/server/media/entity/media";
import LocationService, { spacesIncludeWithEventCount } from "@/server/calendar/service/locations";
import { EventEmitter } from 'events';
import type MediaInterface from '@/server/media/interface';
import type ActivityPubInterface from '@/server/activitypub/interface';
import { EventNotFoundError, InsufficientCalendarPermissionsError, CalendarNotFoundError, BulkEventsNotFoundError, MixedCalendarEventsError, CategoriesNotFoundError, LocationValidationError, InvalidExternalUrlError, SpaceLocationMismatchError } from '@/common/exceptions/calendar';
import { ValidationError } from '@/common/exceptions/base';
import CategoryService from './categories';
import { EventCategoryEntity } from '@/server/calendar/entity/event_category';
import { EventSeriesEntity, EventSeriesContentEntity } from '@/server/calendar/entity/event_series';
import { EventCategoryContentEntity } from '@/server/calendar/entity/event_category_content';
import { EventCategoryAssignmentEntity } from '@/server/calendar/entity/event_category_assignment';
import { EventInstanceEntity } from '@/server/calendar/entity/event_instance';
import { EventRepostEntity } from '@/server/calendar/entity/event_repost';
import db from '@/server/common/entity/db';
import { Op, where, fn, col, type Transaction } from 'sequelize';

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
 * Validates the media-transform parameters (focal point and zoom) before they
 * are persisted. `mediaFocalPointX` and `mediaFocalPointY` must be finite
 * numbers in [0,1]; `mediaZoom` must be a finite number >= 1. Values that are
 * undefined or null are skipped (no transform supplied / cleared). Out-of-range
 * or non-numeric inputs are rejected with a {@link ValidationError} whose
 * `fields` map flags the offending input.
 *
 * Shared by createEvent and updateEvent so both persistence paths enforce the
 * same bounds.
 */
export function validateMediaTransform(eventParams: Record<string, any>): void {
  const checkFocal = (key: 'mediaFocalPointX' | 'mediaFocalPointY') => {
    const value = eventParams[key];
    if (value === undefined || value === null) return;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new ValidationError(`${key} must be a number between 0 and 1`, {
        [key]: ['must be a number between 0 and 1'],
      });
    }
  };
  checkFocal('mediaFocalPointX');
  checkFocal('mediaFocalPointY');

  const zoom = eventParams.mediaZoom;
  if (zoom !== undefined && zoom !== null) {
    if (typeof zoom !== 'number' || !Number.isFinite(zoom) || zoom < 1) {
      throw new ValidationError('mediaZoom must be a number greater than or equal to 1', {
        mediaZoom: ['must be a number greater than or equal to 1'],
      });
    }
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
 * Originator context for EventService mutations.
 *
 * Distinguishes user-driven mutations (HTTP handlers, UI actions) from
 * import-driven mutations (ICS sync orchestrator). The service layer — not
 * entity hooks — owns the rule because hooks cannot distinguish caller
 * intent. See architecture-playbook (no entity hooks for caller-intent
 * rules).
 *
 * - `'user'` (default): user-initiated mutation. On updateEvent, the
 *   service looks up the `EventImportOriginEntity` sibling row (if any)
 *   and flips `locally_edited=true` so future sync runs know not to
 *   overwrite this event's content. On createEvent, no-op.
 * - `'import'`: ICS sync orchestrator. On createEvent and updateEvent,
 *   no-op at the EventService layer — origin bookkeeping lives on the
 *   sibling table and is owned by sync.ts's stampImportOrigin, which
 *   runs in the same transaction. The context argument is retained for
 *   symmetry, audit traceability, and future originator-aware behavior.
 *
 * Event-bus emissions fire on BOTH paths (critical — imported events must
 * still federate via AP through the existing emission machinery).
 */
export type EventOriginatorContext = {
  source: 'user' | 'import';
};

const DEFAULT_ORIGINATOR_CONTEXT: EventOriginatorContext = { source: 'user' };

/**
 * Loose UUID regex used to filter out legacy AP-URL identifiers from
 * `ap_shared_event` rows before passing the resulting ids into `Op.in`
 * queries against `EventEntity.id` (UUID column). Permissive enough to
 * accept any UUID variant; strict enough to reject AP URLs and other
 * non-UUID strings that would otherwise blow up Sequelize's UUID coercion.
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
   * Cross-entity invariant: when an event references both a Place (locationId)
   * and a Space (spaceId), the Space must belong to that Place.
   *
   * Defensive backstop for direct API callers and inbound ActivityPub —
   * the picker UI never produces a mismatched pair, but lower-trust callers
   * could. Throws {@link SpaceLocationMismatchError} on mismatch (or when the
   * Space row is missing entirely, with `actualPlaceId='unknown'`).
   *
   * No-op when either id is null/undefined — those cases are handled by the
   * caller's own location/space resolution.
   *
   * @private
   */
  private async validateSpaceMatchesPlace(locationId: string, spaceId: string): Promise<void> {
    const space = await LocationSpaceEntity.findByPk(spaceId);
    if (!space) {
      throw new SpaceLocationMismatchError(spaceId, locationId, 'unknown');
    }
    if (space.place_id !== locationId) {
      throw new SpaceLocationMismatchError(spaceId, locationId, space.place_id);
    }
  }

  /**
   * Resolve the Place (EventLocation) and optional Space for an inbound
   * federated event payload.
   *
   * Branching contract for `eventParams.location`:
   *   - When `location.originUri` is present, route through
   *     LocationsService.findOrCreatePlaceByOriginUri so two events sharing
   *     the same `pavillion:place.id` produce only one LocationEntity row
   *     for this calendar.
   *   - When `location.originUri` is absent, fall through to the existing
   *     flat-create path (findOrCreateLocation) unchanged. This preserves
   *     backward compatibility with non-aware peers (Mobilizon, Mastodon,
   *     Gancio) whose Place objects carry no Pavillion identity hint.
   *
   * The same branching is applied to `eventParams.space`. Space resolution
   * is anchored on the resolved Place (not on the calendar) because Spaces
   * are scoped per-place; the per-calendar isolation is established by the
   * caller having already resolved the Place against this calendar.
   *
   * Post-resolution, when both Place and Space are resolved, this helper
   * runs the same `validateSpaceMatchesPlace` invariant that direct API
   * callers do. The inbound path is lower-trust than an authenticated API
   * caller, so the defense matters more here, not less. A mismatch throws
   * SpaceLocationMismatchError and prevents persistence.
   *
   * Both findOrCreate*ByOriginUri helpers do their own existence-check
   * before write, so re-running this on the update path is idempotent.
   *
   * @param calendar - The local calendar receiving the event
   * @param eventParams - Parsed inbound event params (mutated: location and
   *                      space fields are removed once resolved so callers
   *                      don't double-process them)
   * @returns Object with optional resolved location and space
   * @private
   */
  private async resolveRemoteLocationAndSpace(
    calendar: Calendar,
    eventParams: Record<string, any>,
  ): Promise<{ location: EventLocation | null; space: LocationSpaceEntity | null }> {
    let resolvedLocation: EventLocation | null = null;
    let resolvedSpace: LocationSpaceEntity | null = null;

    if (eventParams.location) {
      const originUri: string | undefined = typeof eventParams.location.originUri === 'string'
        ? eventParams.location.originUri
        : undefined;

      if (originUri) {
        // Route through dedup helper. Two inbound events sharing the same
        // pavillion:place.id resolve to the same LocationEntity row.
        const placeData = EventLocation.fromObject(eventParams.location);
        resolvedLocation = await this.locationService.findOrCreatePlaceByOriginUri(
          calendar,
          originUri,
          placeData,
        );
      }
      else {
        // Flat-create path unchanged for non-aware peers.
        resolvedLocation = await this.locationService.findOrCreateLocation(
          calendar,
          eventParams.location,
        );
      }
    }

    if (eventParams.space && resolvedLocation) {
      const spaceOriginUri: string | undefined = typeof eventParams.space.originUri === 'string'
        ? eventParams.space.originUri
        : undefined;

      if (spaceOriginUri) {
        // Build the language-keyed content map the helper expects.
        const contentByLang: Record<string, { name: string; accessibilityInfo: string }> = {};
        const spaceContent = eventParams.space.content;
        if (spaceContent && typeof spaceContent === 'object' && !Array.isArray(spaceContent)) {
          for (const lang of Object.keys(spaceContent)) {
            const entry = spaceContent[lang];
            if (entry && typeof entry === 'object') {
              contentByLang[lang] = {
                name: typeof entry.name === 'string' ? entry.name : '',
                accessibilityInfo: typeof entry.accessibilityInfo === 'string' ? entry.accessibilityInfo : '',
              };
            }
          }
        }

        const spaceModel = await this.locationService.findOrCreateSpaceByOriginUri(
          calendar,
          resolvedLocation,
          spaceOriginUri,
          contentByLang,
        );
        // Re-load as entity so callers can read place_id / origin_uri directly
        // and so EventEntity persistence reads space.id consistently with the
        // local-create paths.
        resolvedSpace = await LocationSpaceEntity.findByPk(spaceModel.id);
      }
    }

    // Cross-entity invariant: when both Place and Space are resolved, the
    // Space must belong to that Place. Defensive backstop for the inbox
    // path. For the dedup-by-origin_uri path the parent
    // anchoring is structural (we passed the resolved Place into the Space
    // helper), so this only fires on the unlikely race where a sender
    // mismatches its own pavillion:place.id and pavillion:space.id parent
    // path — but we run it unconditionally so the invariant is enforced
    // identically to the direct API path.
    if (resolvedLocation && resolvedSpace) {
      await this.validateSpaceMatchesPlace(resolvedLocation.id, resolvedSpace.id);
    }

    return { location: resolvedLocation, space: resolvedSpace };
  }


  /**
   * Returns the deduped set of event ids visible on the given calendar.
   *
   * The set is the union of three sources:
   *   - own events (`event.calendar_id = calendar.id`)
   *   - events linked via `event_repost` (legacy direct-repost link)
   *   - events linked via `ap_shared_event` (auto-repost / manual share)
   *
   * Non-UUID identifiers from `ap_shared_event` (legacy AP URL rows) are
   * filtered out so callers can safely use the result with `Op.in` against
   * `EventEntity.id`.
   *
   * Public so intra-domain consumers (e.g. `EventInstanceService`) can drive
   * listing under the single-producer model without re-deriving the union.
   *
   * @param calendar - the calendar whose visible event ids to enumerate
   * @returns deduped string[] of event ids visible on the calendar
   */
  async listEventIdsForCalendar(calendar: Calendar): Promise<string[]> {
    // Filter to valid UUIDs for safety since old ap_shared_event rows may
    // carry AP URLs rather than EventEntity ids — see module-level UUID_REGEX.
    const [ownedEvents, reposts, sharedStatusMap] = await Promise.all([
      EventEntity.findAll({
        where: { calendar_id: calendar.id },
        attributes: ['id'],
      }),
      EventRepostEntity.findAll({
        where: { calendar_id: calendar.id },
        attributes: ['event_id'],
      }),
      this.activityPubInterface!.getSharedEventStatusMap(calendar.id),
    ]);

    const ids = new Set<string>();
    for (const e of ownedEvents) {
      ids.add(e.id);
    }
    for (const r of reposts) {
      ids.add(r.event_id);
    }
    for (const sharedId of sharedStatusMap.keys()) {
      if (UUID_REGEX.test(sharedId)) {
        ids.add(sharedId);
      }
    }

    return Array.from(ids);
  }

  /**
   * Resolve the repostStatus lookup for a calendar's reposted/shared events.
   *
   * Consults both repost sources for the calendar and builds a unified map
   * keyed by event id, with this precedence:
   *   - SharedEventEntity (via the AP interface) is authoritative and carries
   *     the auto/manual distinction (derived from auto_posted). Non-UUID keys
   *     (legacy AP-URL rows) are filtered out — see module-level UUID_REGEX.
   *   - EventRepostEntity is a legacy direct-repost link with no auto/manual
   *     distinction; entries present only there default to 'manual'.
   * Events absent from the returned map are owned by the calendar; call sites
   * report them as 'none' via `map.get(id) ?? 'none'`.
   *
   * A single pair of queries is issued per call regardless of event count.
   *
   * @param calendarId - the acting calendar whose repost status to resolve
   * @returns map of event id -> 'auto' | 'manual' for reposted/shared events
   */
  private async resolveRepostStatusForCalendar(
    calendarId: string,
  ): Promise<Map<string, 'auto' | 'manual'>> {
    const [reposts, sharedStatusMap] = await Promise.all([
      EventRepostEntity.findAll({
        where: { calendar_id: calendarId },
        attributes: ['event_id'],
      }),
      this.activityPubInterface!.getSharedEventStatusMap(calendarId),
    ]);

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

    return repostStatusByEventId;
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

    // Get the repostStatus lookup for events reposted or shared by this
    // calendar (SharedEventEntity auto/manual, EventRepostEntity-only as
    // 'manual', owned events as 'none'). See resolveRepostStatusForCalendar.
    const repostStatusByEventId = await this.resolveRepostStatusForCalendar(calendar.id);

    // Query events owned by calendar OR reposted/shared by calendar.
    // Source set is the union of own events, event_repost links, and
    // ap_shared_event links — see listEventIdsForCalendar() for the canonical
    // derivation. listEvents retains its own repostStatus map (above) because
    // the helper returns ids only; the status map drives the repostStatus
    // field on each returned model.
    const visibleEventIds = await this.listEventIdsForCalendar(calendar);

    const queryOptions: any = {
      where: {
        id: { [Op.in]: visibleEventIds },
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
   * Creates an event on a remote calendar by delegating to the AP domain's
   * typed publisher. The publisher owns activity construction, signing-actor
   * resolution, and remote response handling.
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
    const eventId = this.generateEventId();
    return this.activityPubInterface!.publishEventCreate(
      account,
      { eventId, eventParams },
      remoteCalendarActor,
    );
  }

  /**
   * Updates an event on a remote calendar by delegating to the AP domain's
   * typed publisher (fire-and-forget). Constructs a local CalendarEvent
   * representation from the inputs for the caller — the publisher returns
   * void.
   *
   * @param account - The local account updating the event
   * @param remoteCalendarActor - The CalendarActor representing the remote calendar
   * @param eventId - The ID of the event to update
   * @param eventParams - The updated event parameters
   * @returns A promise that resolves to a local representation of the updated event
   */
  private async updateRemoteEventViaActivityPub(
    account: Account,
    remoteCalendarActor: CalendarActor,
    eventId: string,
    eventParams: Record<string, any>,
  ): Promise<CalendarEvent> {
    await this.activityPubInterface!.publishEventUpdate(
      account,
      { eventId, eventParams },
      remoteCalendarActor,
    );

    // Construct a local representation of the updated event for the caller.
    const event = new CalendarEvent(
      eventId,
      remoteCalendarActor.id,
      this.generateEventUrl(eventId),
      false,
    );

    if (eventParams.content) {
      for (const [language, content] of Object.entries(eventParams.content)) {
        const contentObj = content as any;
        event.addContent(new CalendarEventContent(language, contentObj.name || '', contentObj.description || ''));
      }
    }

    return event;
  }

  /**
   * Deletes an event on a remote calendar by delegating to the AP domain's
   * typed publisher (fire-and-forget).
   *
   * @param account - The local account deleting the event
   * @param remoteCalendarActor - The CalendarActor representing the remote calendar
   * @param eventId - The ID of the event to delete
   * @returns A promise that resolves when the delete is enqueued
   */
  private async deleteRemoteEventViaActivityPub(
    account: Account,
    remoteCalendarActor: CalendarActor,
    eventId: string,
  ): Promise<void> {
    await this.activityPubInterface!.publishEventDelete(account, eventId, remoteCalendarActor);
  }

  /**
     * Creates a new event for the provided account.
     *
     * The `_context` originator-context parameter is retained on the
     * signature for symmetry with updateEvent and because callers (notably
     * the ICS-import sync orchestrator) pass `{ source: 'import' }`
     * positionally. createEvent currently has no originator-branching
     * behavior — origin-provenance bookkeeping lives on the sibling
     * EventImportOriginEntity written by the orchestrator in the same
     * transaction. Preserving the argument keeps the API stable for any
     * future originator-aware create behavior.
     *
     * @param account - account the event belongs to
     * @param eventParams - the parameters for the new event
     * @returns a promise that resolves to the created Event
     */
  async createEvent(
    account: Account,
    eventParams: Record<string, any>,
    _context: EventOriginatorContext = DEFAULT_ORIGINATOR_CONTEXT,
    tx?: Transaction,
  ): Promise<CalendarEvent> {

    // Bounds-check media transform values before any persistence.
    validateMediaTransform(eventParams);

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

    // Cross-entity invariant: when spaceId is supplied, the Space must belong
    // to the event's Place. Resolve the effective parent locationId from
    // (1) the payload's explicit locationId, (2) the embedded location object's
    // id (after findOrCreateLocation has run above and set eventEntity.location_id),
    // or (3) reject — a Space cannot be validated without a parent Place.
    // Validation MUST run before space_id is written, otherwise an attacker
    // could submit a foreign spaceId without a locationId and bypass the check
    // (cross-calendar IDOR). No-op when spaceId is null/undefined.
    //
    // After the client wire fix, toObject() emits both spaceId and
    // space:{id}, so the spaceId branch fires on the create path. The
    // space:{id} fallback is defense-in-depth for federation inbound (where
    // the canonical wire shape is space:{id} only, no top-level spaceId).
    if (eventParams.spaceId) {
      const effectiveLocationId = eventParams.locationId ?? eventEntity.location_id ?? null;
      if (!effectiveLocationId) {
        throw new SpaceLocationMismatchError(
          eventParams.spaceId,
          'unknown',
          'unknown',
          `Space ${eventParams.spaceId} cannot be attached to an event without a parent Place`,
        );
      }
      await this.validateSpaceMatchesPlace(effectiveLocationId, eventParams.spaceId);
      // Only write space_id after the invariant has been validated.
      eventEntity.space_id = eventParams.spaceId;
    }
    else if (eventParams.space?.id) {
      // Federation inbound / legacy shape: space:{id} object but no top-level spaceId.
      // Defense-in-depth IDOR guard — validate before writing.
      const effectiveLocationId = eventParams.locationId ?? eventEntity.location_id ?? null;
      if (!effectiveLocationId) {
        throw new SpaceLocationMismatchError(
          eventParams.space.id,
          'unknown',
          'unknown',
          `Space ${eventParams.space.id} cannot be attached to an event without a parent Place`,
        );
      }
      await this.validateSpaceMatchesPlace(effectiveLocationId, eventParams.space.id);
      eventEntity.space_id = eventParams.space.id;
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

    await eventEntity.save({ transaction: tx });

    // Notify media domain that media has been attached to an event.
    // When the caller supplies a transaction, defer the emit until after
    // commit. The setImmediate hop is required to escape Sequelize's CLS
    // context — without it the listener's async body inherits a CLS scope
    // that still binds the just-committed transaction, and Sequelize's
    // implicit transaction lookup picks it up, causing
    // "commit has been called on this transaction" errors.
    if (eventEntity.media_id) {
      const mediaId = eventEntity.media_id;
      const emitMediaAttached = () => this.eventBus.emit('mediaAttachedToEvent', {
        mediaId,
        eventId: event.id,
      });
      if (tx) {
        tx.afterCommit(() => setImmediate(emitMediaAttached));
      }
      else {
        emitMediaAttached();
      }
    }

    if ( eventParams.content ) {
      for( let [language,content] of Object.entries(eventParams.content) ) {
        event.addContent(await this.createEventContent(event.id, language, content as Record<string,any>, tx));
      }
    }

    if ( eventParams.schedules ) {
      event.schedules = []; // "fromObject" auto-creates schedules, but we need to create them in the db
      for( let schedule of eventParams.schedules ) {
        event.addSchedule(await this.createEventSchedule(event.id, schedule as Record<string,any>, tx));
      }
    }

    const emitEventCreated = () => this.eventBus.emit('eventCreated', { calendar, event });
    if (tx) {
      tx.afterCommit(() => setImmediate(emitEventCreated));
    }
    else {
      emitEventCreated();
    }
    return event;
  }

  async createEventSchedule(eventId: string, scheduleParams: Record<string,any>, tx?: Transaction): Promise<CalendarEventSchedule> {
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
    await scheduleEntity.save({ transaction: tx });

    return schedule;
  }

  async createEventContent(eventId: string, language: string, contentParams: Record<string,any>, tx?: Transaction): Promise<CalendarEventContent> {
    contentParams.language = language;
    const content = CalendarEventContent.fromObject(contentParams);

    const contentEntity = EventContentEntity.fromModel(content);
    contentEntity.id = uuidv4();
    contentEntity.event_id = eventId;
    await contentEntity.save({ transaction: tx });

    return content;
  }

  /**
   * Updates the event with the provided id.
   *
   * Schedule semantics — two disjoint classes of EventScheduleEntity rows
   * coexist per event:
   *
   *   1. Positive schedules (is_exclusion=false): the RRULE-bearing rows
   *      that define when the event recurs. These are owned by the event
   *      editor and may be freely replaced from the request payload.
   *
   *   2. Exclusion schedules (is_exclusion=true): cancellation markers for
   *      individual occurrences (created via the cancel-instance flow on
   *      EventInstanceService). These are NOT owned by the generic edit
   *      surface and must survive unrelated event edits. Clients must not
   *      submit them through updateEvent; any payload that tries to do so
   *      is rejected with a 400 ValidationError.
   *
   * Preservation of existing exclusion rows is delegated to
   * {@link reconcileSchedules}, which loads all existing rows scoped
   * strictly by event_id, separates them into the two classes, applies
   * the payload's positive schedules, and leaves exclusions untouched.
   *
   * @param eventId - the id of the event to update
   * @param eventParams - the parameters and values to update for the event
   * @returns a promise that resolves to the Event
   */
  async updateEvent(
    account: Account,
    eventId: string,
    eventParams: Record<string, any>,
    context: EventOriginatorContext = DEFAULT_ORIGINATOR_CONTEXT,
    tx?: Transaction,
  ): Promise<CalendarEvent> {
    // Validate eventId parameter
    if (!eventId || (typeof eventId === 'string' && eventId.trim() === '')) {
      throw new ValidationError('Event ID is required');
    }

    if (!this.isValidUUID(eventId)) {
      throw new ValidationError('Invalid UUID format in event ID');
    }

    // Bounds-check media transform values before any persistence.
    validateMediaTransform(eventParams);

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
          transaction: tx,
        });

        if ( contentEntity ) {

          if ( ! content ) {
            await contentEntity.destroy({ transaction: tx });
            continue;
          }

          let c = content as Record<string,any>;
          delete c.language;

          if ( Object.keys(c).length === 0 ) {
            await contentEntity.destroy({ transaction: tx });
            continue;
          }

          // Support both 'name' and 'title' field names for API compatibility
          const name = c.name || c.title;
          await contentEntity.update({
            name: name,
            description: c.description,
            accessibility_info: c.accessibilityInfo ?? '',
          }, { transaction: tx });
          event.addContent(contentEntity.toModel());
        }
        else {
          if ( !content ) {
            continue;
          }

          let c = content as Record<string,any>;
          delete c.language;

          if ( Object.keys(c).length > 0 ) {
            event.addContent(await this.createEventContent(eventId, language, c, tx));
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

    // Cross-entity invariant: when spaceId is supplied, the Space must belong
    // to the event's Place. Resolve the effective parent locationId from
    // (1) the payload's explicit locationId, (2) the persisted location_id
    // on the event entity (which the location-handling block above just
    // refreshed if locationId or location was supplied), or (3) reject — a
    // Space cannot be validated without a parent Place. Validation MUST run
    // before space_id is written, otherwise an attacker could submit a foreign
    // spaceId without a locationId and bypass the check (cross-calendar IDOR).
    //
    // Persist space_id semantics:
    //   1. spaceId explicitly provided → validate, then write it
    //   2. space:{id} object provided (no top-level spaceId) → validate, then
    //      write it (federation/legacy client shape)
    //   3. spaceId explicitly null → clear space_id
    //   4. spaceId omitted but locationId is being changed → clear space_id
    //      (whole-venue fallback: the prior Space belonged to the prior Place
    //      and is no longer valid against the new Place)
    //   5. spaceId omitted and locationId unchanged → leave space_id alone
    // Resolve the incoming space identifier to a canonical spaceId string.
    // The client sends either a top-level `spaceId` (current wire contract)
    // or a nested `space:{id}` object (federation / legacy shape).
    // Whichever is present, validate before writing (IDOR guard) and eagerly
    // load the space model so the returned `event.space` is populated without
    // a second DB round-trip.
    const incomingSpaceId: string | null = eventParams.spaceId ?? eventParams.space?.id ?? null;
    if (incomingSpaceId) {
      const effectiveLocationId = eventParams.hasOwnProperty('locationId')
        ? eventParams.locationId
        : eventEntity.location_id;
      if (!effectiveLocationId) {
        throw new SpaceLocationMismatchError(
          incomingSpaceId,
          'unknown',
          'unknown',
          `Space ${incomingSpaceId} cannot be attached to an event without a parent Place`,
        );
      }
      await this.validateSpaceMatchesPlace(effectiveLocationId, incomingSpaceId);
      // Only write space_id after the invariant has been validated.
      eventEntity.space_id = incomingSpaceId;
      // Populate the returned model so callers see event.space without a
      // second getEventById round-trip. The space entity was validated above
      // so it exists; re-load with content so toModel() has full content.
      const spaceEntity = await LocationSpaceEntity.findByPk(incomingSpaceId, {
        include: [LocationSpaceContentEntity],
      });
      if (spaceEntity) {
        event.space = spaceEntity.toModel();
      }
    }
    else if (eventParams.hasOwnProperty('spaceId')) {
      // Explicit null clears space_id.
      eventEntity.space_id = null;
      event.space = null;
    }
    else if (eventParams.hasOwnProperty('locationId')) {
      eventEntity.space_id = null;
      event.space = null;
    }

    if ( eventParams.schedules ) {
      await this.reconcileSchedules(eventId, eventParams.schedules, event, tx);
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

    // Originator-aware locally_edited flip: a user-driven update to an
    // imported event flips locally_edited=true on the sibling
    // EventImportOriginEntity row so subsequent sync runs know this event's
    // content has diverged from the upstream feed and should not be
    // overwritten. Import-driven updates leave locally_edited unchanged —
    // the sync orchestrator explicitly passes context.source='import' for
    // this case. Non-imported events have no origin row; the SELECT
    // returns null and the flip is a no-op.
    //
    // Note: entity hooks are deliberately NOT used for this rule — hooks
    // cannot distinguish caller intent. Service layer owns it. See
    // architecture-playbook.
    //
    // Cost: one extra SELECT + UPDATE per user-initiated edit of an imported
    // event. Accepted per epic DESIGN for structural purity — origin
    // provenance lives on the sibling table, not on EventEntity.
    if (context.source === 'user') {
      const origin = await EventImportOriginEntity.findOne({
        where: { event_id: eventEntity.id },
        transaction: tx,
      });
      if (origin) {
        origin.locally_edited = true;
        await origin.save({ transaction: tx });
      }
    }

    await eventEntity.save({ transaction: tx });

    // Notify media domain that media has been attached to an event.
    // When the caller supplies a transaction, defer the emit until after
    // commit. The setImmediate hop is required to escape Sequelize's CLS
    // context — without it the listener's async body inherits a CLS scope
    // that still binds the just-committed transaction, and Sequelize's
    // implicit transaction lookup picks it up, causing
    // "commit has been called on this transaction" errors.
    if (newMediaAttached && eventEntity.media_id) {
      const mediaId = eventEntity.media_id;
      const emitMediaAttached = () => this.eventBus.emit('mediaAttachedToEvent', {
        mediaId,
        eventId: event.id,
      });
      if (tx) {
        tx.afterCommit(() => setImmediate(emitMediaAttached));
      }
      else {
        emitMediaAttached();
      }
    }

    const emitEventUpdated = () => this.eventBus.emit('eventUpdated', { calendar, event });
    if (tx) {
      tx.afterCommit(() => setImmediate(emitEventUpdated));
    }
    else {
      emitEventUpdated();
    }
    return event;
  }

  /**
   * Reconciles the positive (RRULE-bearing) schedules of an event with the
   * caller's incoming payload, while preserving any exclusion rows
   * (is_exclusion=true) that already exist on the event.
   *
   * Two disjoint classes of EventScheduleEntity rows coexist per event:
   *
   *   - Positive schedules (is_exclusion=false) — the RRULE-bearing rows that
   *     define when the event recurs. Owned by the generic event-edit surface
   *     and fully replaced from the payload on each update.
   *
   *   - Exclusion schedules (is_exclusion=true) — per-occurrence cancellation
   *     markers (EXDATE-style or RECURRENCE-ID overrides) produced by the
   *     cancel-instance flow. These are NOT part of the generic edit surface;
   *     editing unrelated event fields must never delete them.
   *
   * The caller must reject payloads containing is_exclusion=true entries
   * before invoking this method. Scoping of every query/destroy is strictly
   * by event_id to prevent cross-event leakage.
   *
   * @param eventId - the id of the event whose schedules are being reconciled
   * @param incomingPositiveSchedules - the array of positive-schedule
   *        payloads from the client (empty array clears all positives)
   * @param event - the CalendarEvent domain model being mutated; positive
   *        and preserved-exclusion schedules are added back to this model
   */
  async reconcileSchedules(
    eventId: string,
    incomingPositiveSchedules: any[],
    event: CalendarEvent,
    tx?: Transaction,
  ): Promise<void> {
    // Reject payloads that try to create or modify exclusion rows directly.
    // Exclusions are only created via the cancel-instance flow; allowing them
    // through updateEvent would let unrelated edits fabricate cancellations.
    for (const s of incomingPositiveSchedules) {
      if (s && s.isException === true) {
        throw new ValidationError(
          'Exclusion schedules cannot be created or modified through updateEvent',
        );
      }
    }

    // Load every schedule row for this event, scoped strictly by event_id
    // (never by calendar or owner) to guarantee we only touch rows belonging
    // to this event and can't leak into other events' cancellations.
    const existingSchedules = await EventScheduleEntity.findAll({
      where: { event_id: eventId },
      transaction: tx,
    });

    // Separate existing rows by class so exclusions are kept completely
    // outside the replace-from-payload codepath below.
    const existingExclusions = existingSchedules.filter(s => s.is_exclusion === true);
    const existingPositives = existingSchedules.filter(s => s.is_exclusion !== true);
    let unseenPositiveIds = existingPositives.map(s => s.id);

    for (const schedule of incomingPositiveSchedules) {
      if (schedule.id) {
        const scheduleEntity = existingPositives.find(s => s.id === schedule.id);

        if (!scheduleEntity) {
          // Either the id doesn't exist or it refers to an exclusion row,
          // which the generic edit surface is not allowed to touch.
          throw Error('Schedule not found for event');
        }

        unseenPositiveIds = unseenPositiveIds.filter(id => id !== schedule.id);

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
        // Raw key names: start/end/eventEndTime/frequency/interval/count.
        // is_exclusion is intentionally NOT written from the payload: this
        // helper is positive-only, and payload rejection above guarantees
        // we never see isException=true here.
        const toStorage = EventScheduleEntity.toStorageDate;
        // Capture the pre-edit occurrence instant and frequency so a single
        // (non-recurring) event's exclusion row can follow a date edit below.
        // The instant is taken from the entity's model projection (not the raw
        // start_date column) because positive schedules and exclusion rows do
        // NOT share a storage convention: positive rows store wall-clock digits
        // reinterpreted in their `timezone` column (keepLocalTime), while the
        // cancel path writes exclusion rows as true UTC instants with
        // timezone='UTC'. Comparing raw `start_date` columns therefore only
        // matched on a UTC server; comparing the resolved UTC instant matches
        // on any server.
        const oldStartInstantMs = scheduleEntity.toModel().startDate?.toUTC().toMillis() ?? null;
        const oldStartDate = scheduleEntity.start_date;
        const oldFrequency = scheduleEntity.frequency;
        const newStartDate = toStorage(parsed.startDate) ?? scheduleEntity.start_date;
        const newFrequency = 'frequency' in schedule ? ((parsed.frequency as string) ?? null) : scheduleEntity.frequency;
        await scheduleEntity.update({
          timezone: parsed.startDate?.zoneName ?? scheduleEntity.timezone,
          start_date: newStartDate,
          end_date: 'end' in schedule ? (toStorage(parsed.endDate) ?? null) : scheduleEntity.end_date,
          event_end_time: 'eventEndTime' in schedule ? (toStorage(parsed.eventEndTime) ?? null) : scheduleEntity.event_end_time,
          frequency: newFrequency,
          interval: 'interval' in schedule ? (parsed.interval ?? 0) : scheduleEntity.interval,
          count: 'count' in schedule ? (parsed.count ?? 0) : scheduleEntity.count,
          by_day: byDayValue,
        }, { transaction: tx });
        event.addSchedule(scheduleEntity.toModel());

        // Cancellation-follows-event (single events): when an owner edits the
        // date/time of a single, non-recurring event that carries a
        // cancellation, the exclusion row — keyed by start_date — must move
        // with the event so it stays cancelled. Re-key any matching exclusion
        // from the old start_date to the new one. Multi-schedule and recurring
        // events are deliberately excluded: their exclusions are keyed to
        // individual occurrence dates, not the lone schedule's start_date.
        const isSingleNonRecurringEdit =
          existingPositives.length === 1 &&
          incomingPositiveSchedules.length === 1 &&
          !oldFrequency && !newFrequency;
        if (
          isSingleNonRecurringEdit &&
          oldStartInstantMs !== null &&
          parsed.startDate &&
          oldStartDate && newStartDate &&
          newStartDate.getTime() !== oldStartDate.getTime()
        ) {
          for (const exclusion of existingExclusions) {
            // Match and re-key by resolved UTC instant (via the model
            // projection) so the comparison is independent of each row's
            // storage convention. The new value is written back in the
            // exclusion's OWN timezone convention via toStorageDate so it
            // round-trips through toModel() to the new occurrence instant.
            const exclusionInstantMs = exclusion.toModel().startDate?.toUTC().toMillis() ?? null;
            if (exclusionInstantMs !== null && exclusionInstantMs === oldStartInstantMs) {
              const rekeyedStart = toStorage(parsed.startDate.setZone(exclusion.timezone || 'UTC'));
              await exclusion.update({ start_date: rekeyedStart }, { transaction: tx });
            }
          }
        }
      }
      else {
        event.addSchedule(await this.createEventSchedule(eventId, schedule, tx));
      }
    }

    // Destroy only positive rows that were absent from the payload. The
    // destroy clause is double-scoped (id list AND event_id AND
    // is_exclusion=false) as defense-in-depth so a bug elsewhere can never
    // turn this into a cross-event or cross-class delete.
    if (unseenPositiveIds.length > 0) {
      await EventScheduleEntity.destroy({
        where: {
          id: unseenPositiveIds,
          event_id: eventId,
          is_exclusion: false,
        },
        transaction: tx,
      });
    }

    // Re-attach the preserved exclusion rows to the returned model so
    // downstream consumers (and the emitted eventUpdated payload) see the
    // full, accurate schedule list.
    for (const exclusion of existingExclusions) {
      event.addSchedule(exclusion.toModel());
    }
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

    // Branch on origin_uri to dedup AP-originated Places/Spaces.
    // When the inbound Place carries a pavillion:place.id (origin_uri), two
    // events sharing that id resolve to the same LocationEntity row. Falls
    // back to the existing flat-create path for non-aware peers.
    const resolved = await this.resolveRemoteLocationAndSpace(calendar, eventParams);
    if (resolved.location) {
      eventEntity.location_id = resolved.location.id;
      event.location = resolved.location;
    }
    if (resolved.space) {
      eventEntity.space_id = resolved.space.id;
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

    // Emit eventCreated with calendar:null so the calendar-domain
    // buildEventInstances handler materializes the canonical event_instance
    // rows for this remote-origin event. The null calendar is intentional:
    // the AP eventCreated handler early-returns on it, preventing an
    // outbound Announce loop back to federation.
    this.eventBus.emit('eventCreated', { calendar: null, event });

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

    // Update location and space.
    // When the inbound payload omits the location entirely, clear both the
    // location and space references on the event. When location is present,
    // resolve through the dedup helper: origin_uri-bearing
    // Places route to findOrCreatePlaceByOriginUri, the rest fall back to
    // the existing flat-create path. Same branching applies to space.
    if (eventEntity.location_id && !eventParams.location) {
      eventEntity.location_id = null;
      event.location = null;
      eventEntity.space_id = null;
    }
    else if (eventParams.location) {
      const resolved = await this.resolveRemoteLocationAndSpace(calendar, eventParams);
      if (resolved.location) {
        eventEntity.location_id = resolved.location.id;
        event.location = resolved.location;
      }
      // Update space: explicit resolution wins; if the inbound payload
      // dropped the space (no eventParams.space), clear space_id.
      if (resolved.space) {
        eventEntity.space_id = resolved.space.id;
      }
      else {
        eventEntity.space_id = null;
      }
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

  /**
   * Look up an event by id, eagerly loading content/location/schedules/media/series.
   *
   * @param eventId - The event id to fetch
   * @param displayCalendarId - Optional display calendar id. When provided,
   *   categories are filtered to assignments on that calendar so reposted
   *   events display the reposting calendar's category mappings rather than
   *   the originating calendar's. The public detail handler resolves this
   *   from the `?calendar=urlName` query param.
   */
  async getEventById(eventId: string, displayCalendarId?: string): Promise<CalendarEvent> {
    // Validate eventId parameter
    if (!eventId || (typeof eventId === 'string' && eventId.trim() === '')) {
      throw new ValidationError('eventId is required');
    }


    const event = await EventEntity.findOne({
      where: { id: eventId },
      include: [
        EventContentEntity,
        // Eager-load the Place and its full Spaces tree (with eventCount) so
        // the event editor's location picker can render the layered list of
        // available Spaces inline — otherwise `place.spaces` is empty and the
        // picker collapses to a Place-only view (helper used here to keep
        // the editor's wire shape aligned with the public GETs).
        { model: LocationEntity, include: [LocationContentEntity, spacesIncludeWithEventCount()] },
        // Eager-load the event's currently-pinned Space and its translatable
        // content so the layered Place — Space header and per-Space
        // accessibility section render correctly.
        { model: LocationSpaceEntity, include: [LocationSpaceContentEntity] },
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
    if ( event.space ) {
      e.space = event.space.toModel();
    }
    if ( event.schedules ) {
      for ( let s of event.schedules ) {
        e.addSchedule( s.toModel() );
      }
    }
    if ( event.media ) {
      e.media = event.media.toModel();
    }

    e.categories = await this.categoryService.getEventCategories(event.id, displayCalendarId);

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


    const transaction = await db.transaction();

    // The acting calendar id (the reposter for repost events; the source
    // calendar otherwise) is captured here so the post-commit repostStatus
    // lookup can target the same calendar that owned the assignment write.
    let actingCalendarId: string;

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
        userCalendars,
      } = await this.resolveEffectiveCalendarId(account, calendarIds[0] as string, eventIds, transaction);
      let calendarId = effectiveCalendarId;
      actingCalendarId = effectiveCalendarId;

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

    // 8. Build authoritative repostStatus map for the acting calendar.
    // See resolveRepostStatusForCalendar for the SharedEventEntity-first,
    // EventRepostEntity-fallback precedence.
    const repostStatusByEventId = await this.resolveRepostStatusForCalendar(actingCalendarId);

    // 9. Return updated events with their categories (after successful commit).
    // repostStatus is populated authoritatively from the SharedEventEntity +
    // EventRepostEntity union above; events not in either collection (owned by
    // the acting calendar) default to 'none'.
    const updatedEvents = [];
    for (const eventId of eventIds) {
      const updatedEvent = await this.getEventById(eventId);
      updatedEvent.repostStatus = repostStatusByEventId.get(eventId) ?? 'none';
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

    const transaction = await db.transaction();

    // The acting calendar id (the reposter for repost events; the source
    // calendar otherwise) is captured here so the post-commit repostStatus
    // lookup can target the same calendar that owned the assignment write.
    let actingCalendarId: string;

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
        userCalendars,
      } = await this.resolveEffectiveCalendarId(account, event.calendar_id, [eventId], transaction, calendarId);
      actingCalendarId = effectiveCalendarId;

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

      // 5. Destroy this event's assignments owned by the acting calendar only.
      //
      // A reposted event is shared across multiple calendars, each of which may
      // have attached its own categories. Destroying every assignment for the
      // event (the prior behavior) silently wiped other sharing calendars' rows.
      // EventCategoryAssignmentEntity carries no calendar_id and deliberately has
      // no association to join through (see event_category_assignment.ts), so we
      // scope the destroy through category ownership: each EventCategoryEntity is
      // owned by exactly one calendar (calendar_id, never reparented), so the set
      // of categories owned by effectiveCalendarId fully determines which
      // assignments belong to the acting calendar.
      const ownedCategories = await EventCategoryEntity.findAll({
        where: { calendar_id: effectiveCalendarId },
        attributes: ['id'],
        transaction,
      });
      const ownedCategoryIds = ownedCategories.map(c => c.id);

      // Explicit empty-set guard. Do NOT rely on IN([]) no-op behavior: its
      // codegen diverges by driver (PostgreSQL -> WHERE 1=0; SQLite has
      // historically dropped the clause entirely, yielding an UNSCOPED destroy
      // that reintroduces the cross-calendar wipe). When the acting calendar
      // owns no categories there is nothing of its own to remove.
      if (ownedCategoryIds.length > 0) {
        await EventCategoryAssignmentEntity.destroy({
          where: { event_id: eventId, category_id: { [Op.in]: ownedCategoryIds } },
          transaction,
        });
      }

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

    // 7. Build authoritative repostStatus map for the acting calendar and
    // resolve this event's status from it. See resolveRepostStatusForCalendar
    // for the SharedEventEntity-first, EventRepostEntity-fallback precedence;
    // an event absent from the map is owned by the calendar and reports 'none'.
    const repostStatusByEventId = await this.resolveRepostStatusForCalendar(actingCalendarId);

    // Return updated event (after successful commit) with authoritative
    // repostStatus populated.
    const updatedEvent = await this.getEventById(eventId);
    updatedEvent.repostStatus = repostStatusByEventId.get(eventId) ?? 'none';

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
          // Events reposted by followed local calendars
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
