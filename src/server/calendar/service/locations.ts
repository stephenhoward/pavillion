import { v4 as uuidv4 } from 'uuid';
import { literal, Transaction } from 'sequelize';
import { Calendar } from '@/common/model/calendar';
import { EventLocation, EventLocationSpace } from '@/common/model/location';
import {
  InvalidClientIdError,
  LocationNotFoundError,
  LocationValidationError,
  SpaceHijackError,
} from '@/common/exceptions/calendar';
import { LocationEntity, LocationContentEntity } from '@/server/calendar/entity/location';
import { LocationSpaceEntity, LocationSpaceContentEntity } from '@/server/calendar/entity/location_space';
import { EventEntity } from '@/server/calendar/entity/event';
import expressHelper from '@/server/common/helper/express';
import db from '@/server/common/entity/db';

/**
 * Build the include block that eager-loads Spaces (with their content rows)
 * and stamps a computed `eventCount` on each Space row via a correlated
 * subquery against the `event` table.
 *
 * Centralised so the read-path (`getLocationsForCalendar`,
 * `getLocationById`) and the post-write reload path (introduced in pv-0pht.3)
 * speak the same eager-load shape — keeps the wire contract stable across
 * GETs and write responses, and prevents drift between the COUNT correlation
 * and the entity alias used to root the subquery.
 *
 * The literal subquery references the per-row Space alias `LocationSpaceEntity`
 * (the default Sequelize alias when an unaliased nested include is used), so
 * the COUNT correlates against the joined Space row at hydration time. If a
 * future caller aliases the nested include, this literal must be updated to
 * track the new alias.
 */
export function spacesIncludeWithEventCount() {
  return {
    model: LocationSpaceEntity,
    required: false,
    separate: true,
    include: [LocationSpaceContentEntity],
    attributes: {
      include: [
        [
          // CAST AS INTEGER is dialect-neutral (PostgreSQL + SQLite).
          // Note: with `separate: true` the Space rows are loaded by their
          // own SELECT, so this correlated subquery references the Space's
          // own table column `id`.
          literal(
            '(SELECT CAST(COUNT(*) AS INTEGER) FROM event ev WHERE ev.space_id = "LocationSpaceEntity"."id")',
          ),
          'eventCount',
        ],
      ],
    },
  } as any;
}

export default class LocationService {
  /**
   * Get all locations for a calendar with their content and Spaces.
   *
   * Eager-loads each Place's Space rows inline and stamps a computed
   * `eventCount` on each Space (COUNT(events) for events whose `space_id`
   * matches the Space). Constant query count regardless of place count or
   * space count: one SELECT for the Places + their content, plus one
   * `separate: true` SELECT for the Spaces with the correlated COUNT subquery
   * embedded — never N+1 (pv-0pht).
   *
   * @param calendar - The calendar to get locations for
   * @returns Array of EventLocation models populated with content and
   *          `spaces[]` (each Space carries `eventCount`)
   */
  async getLocationsForCalendar(calendar: Calendar): Promise<EventLocation[]> {
    const entities = await LocationEntity.findAll({
      where: {
        calendar_id: calendar.id,
      },
      include: [LocationContentEntity, spacesIncludeWithEventCount()],
      order: [['name', 'ASC']],
    });

    return entities.map(entity => entity.toModel());
  }

  /**
   * Get a specific location by ID with content and Spaces.
   * Returns null if location doesn't exist or doesn't belong to the calendar.
   *
   * Eager-loads Spaces inline with per-Space `eventCount` so the editor can
   * decide which delete dialog to show (plain confirm vs reassign) without
   * any follow-up round trip (pv-0pht).
   *
   * @param calendar - The calendar that should own the location
   * @param locationId - The location ID to fetch
   * @returns EventLocation model populated with content and `spaces[]`, or null
   */
  async getLocationById(calendar: Calendar, locationId: string): Promise<EventLocation | null> {
    const entity = await LocationEntity.findByPk(locationId, {
      include: [LocationContentEntity, spacesIncludeWithEventCount()],
    });

    if (!entity || entity.calendar_id !== calendar.id) {
      return null;
    }

    return entity.toModel();
  }

  /**
   * Find an existing location by ID or matching attributes.
   *
   * If location has an ID, searches by primary key and verifies calendar ownership.
   * Otherwise, searches for exact match on all location attributes (name, address, city, state, postal code, country).
   *
   * @param calendar - The calendar that should own the location
   * @param location - The location to search for (by ID or attributes)
   * @returns Matching EventLocation model or null if not found
   */
  async findLocation(calendar: Calendar, location: EventLocation): Promise<EventLocation|null> {

    if ( location.id ) {
      let entity = await LocationEntity.findByPk(location.id);
      if ( entity && entity.calendar_id === calendar.id ) {
        return entity.toModel();
      }
    }
    else {
      let entity = await LocationEntity.findOne({
        where: {
          calendar_id: calendar.id,
          name: location.name,
          address: location.address,
          city: location.city,
          state: location.state,
          postal_code: location.postalCode,
          country: location.country,
        },
      });
      if ( entity ) {
        return entity.toModel();
      }
    }
    return null;
  }

  /**
   * Create a new location with optional accessibility content and optional
   * nested Spaces (pv-0pht atomic Place + Spaces save).
   *
   * Wraps Place insert + per-language content rows + per-Space rows + per-Space
   * content rows in a single Sequelize transaction. The Space rows ride along
   * on `location.spaces` — no new positional argument. Each new Space is
   * assigned a server-generated UUID; if the caller supplied a `clientId`
   * correlation token, it is validated as a UUID v4 (rejected with
   * `InvalidClientIdError` if malformed) and echoed back on the returned
   * model so the client can map staged-anchor → real-id.
   *
   * @param calendar - The calendar that will own the location
   * @param location - The location model to create (with optional content
   *                   and optional `spaces[]` for atomic save)
   * @returns Created EventLocation model with `spaces[]` and `clientId` echoes
   * @throws LocationValidationError if location name is empty
   * @throws InvalidClientIdError if any incoming Space `clientId` is not a
   *         valid UUID v4
   */
  async createLocation(calendar: Calendar, location: EventLocation): Promise<EventLocation> {
    // Validate required fields
    if (!location.name || location.name.trim().length === 0) {
      throw new LocationValidationError(['Location name is required']);
    }

    // Pre-validate incoming Space clientIds before opening the transaction so
    // a malformed token never reaches the writes. UUID-format check follows
    // the security advisor's gate for the round-trip echo (pv-0pht).
    const incomingSpaces = location.spaces ?? [];
    for (const space of incomingSpaces) {
      if (space.clientId !== undefined && !expressHelper.isValidUUID(space.clientId)) {
        throw new InvalidClientIdError(space.clientId);
      }
    }

    // Map server-assigned Space id → client-supplied clientId. Populated as
    // each Space is inserted; consumed after the reload to echo each
    // clientId back on the response model.
    const clientIdByServerId = new Map<string, string>();

    const placeId = await db.transaction(async (tx) => {
      // Create location entity
      const entity = LocationEntity.fromModel(location);
      entity.id = uuidv4();
      entity.calendar_id = calendar.id;
      await entity.save({ transaction: tx });

      // Create content entities if location has content
      const languages = location.getLanguages();
      if (languages.length > 0) {
        for (const language of languages) {
          const content = location.content(language);
          if (!content.isEmpty()) {
            const contentEntity = LocationContentEntity.fromModel(entity.id, content);
            await contentEntity.save({ transaction: tx });
          }
        }
      }

      // Create nested Spaces and their multilingual content rows. Each gets
      // a server-generated UUID; the supplied `clientId` is purely a
      // correlation token and is never used as a row primary key.
      for (const space of incomingSpaces) {
        const spaceId = uuidv4();
        if (space.clientId !== undefined) {
          clientIdByServerId.set(spaceId, space.clientId);
        }
        await this._insertSpace(tx, entity.id, spaceId, space);
      }

      return entity.id;
    });

    // Reload with the canonical eager-load shape so the response carries
    // `spaces[]` with per-Space `eventCount` (matches GET responses 1:1).
    const result = await this._reloadPlaceForResponse(placeId);

    // Echo clientIds back on the response model so the client can map
    // staged-anchor → real-id.
    for (const space of result.spaces) {
      const clientId = clientIdByServerId.get(space.id);
      if (clientId !== undefined) {
        space.clientId = clientId;
      }
    }

    return result;
  }

  /**
   * Reload a Place by id with the canonical eager-load shape used by GET
   * responses (Place content + Spaces with content + per-Space eventCount).
   *
   * Centralised so the post-write reload in createLocation/updateLocation
   * speaks the same shape as the read path. Throws if the row is missing
   * mid-transaction-commit (which would indicate a transaction-isolation
   * problem rather than a normal "not found" — callers that need a nullable
   * lookup use getLocationById instead).
   *
   * @param placeId - The id of the Place to reload
   * @returns EventLocation with content and spaces[] populated
   */
  private async _reloadPlaceForResponse(placeId: string): Promise<EventLocation> {
    const reloaded = await LocationEntity.findByPk(placeId, {
      include: [LocationContentEntity, spacesIncludeWithEventCount()],
    });
    if (!reloaded) {
      // Defensive: the row was just written under our transaction; if it
      // disappears at this point something is fundamentally broken (the
      // commit was rolled back, the table was truncated by another process,
      // etc). Surfacing the failure here is more helpful than handing the
      // caller back a phantom result.
      throw new LocationNotFoundError(`Place ${placeId} disappeared after write`);
    }
    return reloaded.toModel();
  }

  /**
   * Insert a single LocationSpaceEntity row plus its per-language content
   * rows under the supplied transaction. Used by both createLocation (all
   * incoming Spaces are new) and updateLocation (the create-branch entries
   * in the snapshot diff).
   *
   * @param tx - The active Sequelize transaction
   * @param placeId - The parent Place id this Space belongs to
   * @param spaceId - The server-generated Space id (UUID)
   * @param space - The model carrying the per-language content payload
   */
  private async _insertSpace(
    tx: Transaction,
    placeId: string,
    spaceId: string,
    space: EventLocationSpace,
  ): Promise<void> {
    await LocationSpaceEntity.create(
      {
        id: spaceId,
        place_id: placeId,
      },
      { transaction: tx },
    );

    for (const language of space.getLanguages()) {
      const content = space.content(language);
      if (!content.isEmpty()) {
        await LocationSpaceContentEntity.create(
          {
            space_id: spaceId,
            language: content.language,
            name: content.name,
            accessibility_info: content.accessibilityInfo,
          },
          { transaction: tx },
        );
      }
    }
  }

  /**
   * Replace the per-language content rows on an existing Space inside the
   * supplied transaction. Used by the snapshot-diff update-branch in
   * updateLocation: incoming Space `id` matches a row scoped by
   * `place_id = :locationId` → destroy old content rows, then write new ones
   * for any non-empty incoming language.
   *
   * @param tx - The active Sequelize transaction
   * @param spaceId - The Space id whose content should be replaced
   * @param space - The incoming model whose content payload should land
   */
  private async _replaceSpaceContent(
    tx: Transaction,
    spaceId: string,
    space: EventLocationSpace,
  ): Promise<void> {
    await LocationSpaceContentEntity.destroy({
      where: { space_id: spaceId },
      transaction: tx,
    });

    for (const language of space.getLanguages()) {
      const content = space.content(language);
      if (!content.isEmpty()) {
        await LocationSpaceContentEntity.create(
          {
            space_id: spaceId,
            language: content.language,
            name: content.name,
            accessibility_info: content.accessibilityInfo,
          },
          { transaction: tx },
        );
      }
    }
  }

  /**
   * Update an existing location's fields and content, plus apply the
   * snapshot-diff for nested Spaces atomically (pv-0pht).
   *
   * The whole write — Place fields + Place content rows + Space create /
   * update / destroy — runs under a single Sequelize transaction so any
   * failure rolls the entire change back.
   *
   * Snapshot-diff semantics for `location.spaces`:
   * - Existing Space `id` matches a row scoped by `place_id = :locationId`
   *   → replace its multilingual content rows in place.
   * - Incoming Space `id` does NOT match a row scoped by `place_id` →
   *   reject with `SpaceHijackError` (the security boundary; rejects sibling-
   *   Place `id`s even when the calendar matches).
   * - Incoming Space with `clientId` and no `id` → insert a new Space with a
   *   server-generated UUID; the `clientId` is echoed back on the response.
   * - Existing Space `id` not present in the incoming snapshot → destroy.
   *   The `events.space_id` FK with `ON DELETE SET NULL` (pv-0pht.2) handles
   *   the event-side null automatically — no per-event sweep here.
   *
   * The auth gate (locationId belongs to calendar) is the calendar boundary.
   * The Space-hijack check uses `place_id = :locationId` as its own boundary
   * — explicitly NOT `calendar_id`, since two Places on the same calendar
   * must not be able to swap Space rows via the snapshot.
   *
   * @param calendar - The calendar that should own the location
   * @param locationId - The ID of the location to update
   * @param location - The location model with updated data and `spaces[]` snapshot
   * @returns Updated EventLocation model with `spaces[]` (and `clientId`
   *          echoes for new entries), or null if not found or not owned by
   *          calendar
   * @throws LocationValidationError if location name is empty
   * @throws InvalidClientIdError if any incoming Space `clientId` is not a
   *         valid UUID v4
   * @throws SpaceHijackError if any incoming Space `id` does not belong to
   *         this Place
   */
  async updateLocation(calendar: Calendar, locationId: string, location: EventLocation): Promise<EventLocation | null> {
    const entity = await LocationEntity.findByPk(locationId);

    if (!entity || entity.calendar_id !== calendar.id) {
      return null;
    }

    // Validate required fields
    if (!location.name || location.name.trim().length === 0) {
      throw new LocationValidationError(['Location name is required']);
    }

    // Pre-validate incoming Space clientIds before opening the transaction.
    // Malformed tokens never reach the writes (security advisor gate, pv-0pht).
    const incomingSpaces = location.spaces ?? [];
    for (const space of incomingSpaces) {
      if (space.clientId !== undefined && !expressHelper.isValidUUID(space.clientId)) {
        throw new InvalidClientIdError(space.clientId);
      }
    }

    // Map server-assigned Space id (or pre-existing id) → client-supplied
    // clientId. Populated as inserts happen below; consumed after the reload
    // to echo each clientId back on the response model.
    const clientIdByServerId = new Map<string, string>();

    await db.transaction(async (tx) => {
      // Update Place fields
      await entity.update(
        {
          name: location.name,
          address: location.address,
          city: location.city,
          state: location.state,
          postal_code: location.postalCode,
          country: location.country,
        },
        { transaction: tx },
      );

      // Replace Place content: delete existing, then create new
      await LocationContentEntity.destroy({
        where: { location_id: locationId },
        transaction: tx,
      });

      const languages = location.getLanguages();
      if (languages.length > 0) {
        for (const language of languages) {
          const content = location.content(language);
          if (!content.isEmpty()) {
            const contentEntity = LocationContentEntity.fromModel(locationId, content);
            await contentEntity.save({ transaction: tx });
          }
        }
      }

      // Snapshot-diff Spaces.
      //
      // Load the existing set scoped by place_id (NOT calendar.id) — that is
      // the security boundary for sibling-Place hijack rejection. Any incoming
      // Space `id` not present in this set is rejected outright.
      const existing = await LocationSpaceEntity.findAll({
        where: { place_id: locationId },
        transaction: tx,
      });
      const existingById = new Map<string, LocationSpaceEntity>();
      for (const row of existing) {
        existingById.set(row.id, row);
      }

      const seenExistingIds = new Set<string>();

      for (const space of incomingSpaces) {
        if (space.id) {
          const match = existingById.get(space.id);
          if (!match) {
            // Sibling-Place hijack rejection. Any Space id not scoped to this
            // place_id — even one owned by the same calendar on a sibling
            // Place — is treated as untrusted input and rejected.
            throw new SpaceHijackError(space.id, locationId);
          }
          seenExistingIds.add(space.id);
          await this._replaceSpaceContent(tx, space.id, space);
        }
        else {
          const newSpaceId = uuidv4();
          if (space.clientId !== undefined) {
            clientIdByServerId.set(newSpaceId, space.clientId);
          }
          await this._insertSpace(tx, locationId, newSpaceId, space);
        }
      }

      // Destroy any existing rows that were not echoed back in the snapshot.
      // FK SET NULL on events.space_id (pv-0pht.2) handles the event-side
      // null automatically — no per-event sweep needed here.
      const toDestroy: string[] = [];
      for (const row of existing) {
        if (!seenExistingIds.has(row.id)) {
          toDestroy.push(row.id);
        }
      }
      if (toDestroy.length > 0) {
        await LocationSpaceContentEntity.destroy({
          where: { space_id: toDestroy },
          transaction: tx,
        });
        await LocationSpaceEntity.destroy({
          where: { id: toDestroy },
          transaction: tx,
        });
      }
    });

    // Reload with the canonical eager-load shape used by GET responses so
    // the wire contract matches 1:1 (pv-0pht.4).
    const result = await this._reloadPlaceForResponse(locationId);

    // Echo clientIds back on the response model so the client can map
    // staged-anchor → real-id.
    for (const space of result.spaces) {
      const clientId = clientIdByServerId.get(space.id);
      if (clientId !== undefined) {
        space.clientId = clientId;
      }
    }

    return result;
  }

  /**
   * Delete a Place (LocationEntity) and cascade-delete its Spaces.
   *
   * Cascade behaviour, all inside a single transaction so a failure rolls
   * the whole chain back:
   *
   *   1. Nullify BOTH `location_id` AND `space_id` on every Event row that
   *      references this Place. The where-clause is scoped by `location_id`
   *      (not `space_id`) so events sitting on a child Space — which are by
   *      definition also attached to this Place — also get their `space_id`
   *      cleared in the same statement.
   *   2. Find every Space under this Place; if any exist, destroy their
   *      content rows and then the Space rows themselves. The `IN`-list
   *      destroy on `LocationSpaceContentEntity` is paired with a single
   *      `LocationSpaceEntity.destroy({ where: { place_id } })` so both
   *      table sweeps are O(1) statements regardless of Space count.
   *   3. Destroy the Place's own content rows.
   *   4. Destroy the Place row.
   *
   * @param calendar - The calendar that should own the Place
   * @param locationId - The ID of the Place to delete
   * @returns True if the Place was deleted, false if not found or not owned by calendar
   */
  async deleteLocation(calendar: Calendar, locationId: string): Promise<boolean> {
    const entity = await LocationEntity.findByPk(locationId);

    if (!entity || entity.calendar_id !== calendar.id) {
      return false;
    }

    await db.transaction(async (tx) => {
      // Nullify both FKs on associated events. Scoping by location_id (not
      // space_id) catches every event under this Place, including those
      // attached to one of its Spaces — those rows are about to lose their
      // Space anyway, so clearing both columns in one statement keeps the
      // event row valid (no orphaned space_id pointing at a destroyed Space).
      await EventEntity.update(
        { location_id: null, space_id: null },
        { where: { location_id: locationId }, transaction: tx },
      );

      // Cascade-delete Spaces and their content
      const spaces = await LocationSpaceEntity.findAll({
        where: { place_id: locationId },
        transaction: tx,
      });
      if (spaces.length > 0) {
        const spaceIds = spaces.map(s => s.id);
        await LocationSpaceContentEntity.destroy({
          where: { space_id: spaceIds },
          transaction: tx,
        });
        await LocationSpaceEntity.destroy({
          where: { place_id: locationId },
          transaction: tx,
        });
      }

      // Delete Place content entities
      await LocationContentEntity.destroy({
        where: { location_id: locationId },
        transaction: tx,
      });

      // Delete the Place entity
      await entity.destroy({ transaction: tx });
    });

    return true;
  }

  /**
   * Reassign every Event row currently attached to `(placeId, fromSpaceId)`
   * onto `toSpaceId`, scoped to the caller's calendar via the parent Place.
   *
   * Single SQL UPDATE inside a transaction:
   *   UPDATE events SET space_id = :toSpaceId
   *   WHERE place_id = :placeId AND space_id = :fromSpaceId
   *
   * Security boundary: the WHERE-clause `place_id = :locationId` is the
   * structural fence that prevents cross-Place mutations. The handler MUST
   * NOT add an explicit `fromSpaceId in this Place's Space set` check —
   * doing so would gratuitously break retry-as-no-op idempotency for
   * `(fromSpaceId no longer in Place)` calls without adding any additional
   * safety, since the WHERE clause already nails every row to this Place.
   *
   * Idempotency: if `fromSpaceId` is not on this Place (e.g. it was already
   * destroyed by a snapshot diff that removed the Space), the UPDATE simply
   * matches zero rows and the method returns `{ count: 0 }`. Re-running a
   * reassign that has nothing left to do is therefore safe and well-defined.
   *
   * @param calendar - The calendar that should own the parent Place
   * @param placeId - The Place id; events outside this Place are never touched
   * @param fromSpaceId - The current Space id to migrate events away from
   * @param toSpaceId - The destination Space id; must already be on this Place
   * @returns `{ count }` — the number of event rows updated, or null if the
   *   Place is not owned by the calendar, or undefined if `toSpaceId` does
   *   not reference a Space currently on this Place
   * @throws (none) — handler-layer validation translates the structural
   *   results into HTTP responses
   */
  async reassignEvents(
    calendar: Calendar,
    placeId: string,
    fromSpaceId: string,
    toSpaceId: string,
  ): Promise<{ count: number; placeFound: boolean; toSpaceValid: boolean }> {
    const place = await LocationEntity.findByPk(placeId);
    if (!place || place.calendar_id !== calendar.id) {
      return { count: 0, placeFound: false, toSpaceValid: false };
    }

    // Validate `toSpaceId` references a Space currently on this Place. The
    // structural fence is `place_id = :placeId` so a Space owned by a
    // sibling Place — even on the same calendar — is rejected.
    const toSpace = await LocationSpaceEntity.findOne({
      where: { id: toSpaceId, place_id: placeId },
    });
    if (!toSpace) {
      return { count: 0, placeFound: true, toSpaceValid: false };
    }

    // Single SQL UPDATE inside a transaction. The WHERE-clause
    // `place_id = :placeId` is the safety boundary; do NOT add an explicit
    // `fromSpaceId Place-scoping` check (intentional: keeps retry-as-no-op
    // semantics for already-removed `fromSpaceId` values).
    const count = await db.transaction(async (tx) => {
      const [affected] = await EventEntity.update(
        { space_id: toSpaceId },
        {
          where: { location_id: placeId, space_id: fromSpaceId },
          transaction: tx,
        },
      );
      return affected;
    });

    return { count, placeFound: true, toSpaceValid: true };
  }

  /**
   * Get all Spaces belonging to a Place.
   *
   * Verifies that the Place exists and belongs to the caller's calendar before
   * looking up its Spaces. Returns an empty array when the Place is missing or
   * owned by a different calendar (matching the "silent empty" semantics used
   * elsewhere in this service for unauthorized lookups).
   *
   * @param calendar - The calendar that should own the parent Place
   * @param placeId - The ID of the parent Place (LocationEntity)
   * @returns Array of EventLocationSpace models with multilingual content;
   *          empty if the Place does not exist or is not owned by the calendar
   */
  async getSpacesForPlace(calendar: Calendar, placeId: string): Promise<EventLocationSpace[]> {
    const place = await LocationEntity.findByPk(placeId);
    if (!place || place.calendar_id !== calendar.id) {
      return [];
    }

    const entities = await LocationSpaceEntity.findAll({
      where: { place_id: placeId },
      include: [LocationSpaceContentEntity],
    });

    return entities.map(entity => entity.toModel());
  }

  /**
   * Get a specific Space by ID, scoped to the caller's calendar via its
   * parent Place.
   *
   * Eager-loads `place` so the auth chain `space.place.calendar_id` is safe to
   * dereference. Returns null if the Space does not exist, has no loadable
   * place association, or the parent Place is not owned by the caller's
   * calendar (matching the "silent null" semantics used by getLocationById).
   *
   * @param calendar - The calendar that should own the Space (via its Place)
   * @param spaceId - The ID of the Space to fetch
   * @returns EventLocationSpace populated with content, or null
   */
  async getSpaceById(calendar: Calendar, spaceId: string): Promise<EventLocationSpace | null> {
    const space = await LocationSpaceEntity.findByPk(spaceId, {
      include: [
        { model: LocationEntity, as: 'place' },
        LocationSpaceContentEntity,
      ],
    });
    if (!space || !space.place || space.place.calendar_id !== calendar.id) {
      return null;
    }

    return space.toModel();
  }

  /**
   * Create a new Space within a Place owned by the caller's calendar.
   *
   * Verifies that the parent Place exists and belongs to the caller's calendar,
   * then creates the Space row plus one content row per supplied language.
   * Returns the populated EventLocationSpace (re-loaded with content rows
   * attached so callers receive the full multilingual model).
   *
   * @param calendar - The calendar that should own the parent Place
   * @param placeId - The ID of the parent Place
   * @param contentByLang - Map of language code to {name, accessibilityInfo}
   * @returns Newly created EventLocationSpace populated with content
   * @throws LocationNotFoundError if the Place does not exist or is not
   *         owned by the caller's calendar
   */
  async createSpace(
    calendar: Calendar,
    placeId: string,
    contentByLang: Record<string, { name: string; accessibilityInfo: string }>,
  ): Promise<EventLocationSpace> {
    const place = await LocationEntity.findByPk(placeId);
    if (!place || place.calendar_id !== calendar.id) {
      throw new LocationNotFoundError('Place not found or not owned by calendar');
    }

    const spaceId = uuidv4();
    await LocationSpaceEntity.create({
      id: spaceId,
      place_id: placeId,
    });

    for (const [language, content] of Object.entries(contentByLang)) {
      await LocationSpaceContentEntity.create({
        space_id: spaceId,
        language,
        name: content.name,
        accessibility_info: content.accessibilityInfo,
      });
    }

    const fetched = await LocationSpaceEntity.findByPk(spaceId, {
      include: [LocationSpaceContentEntity],
    });
    return fetched!.toModel();
  }

  /**
   * Update an existing Space's multilingual content.
   *
   * Verifies that the Space exists and that its parent Place belongs to the
   * caller's calendar (eager-loading `place` so the auth chain
   * `space.place.calendar_id` is safe to dereference). Replaces all existing
   * content rows with the supplied set (destroy-then-create), then reloads
   * the Space with content rows attached.
   *
   * @param calendar - The calendar that should own the Space (via its Place)
   * @param spaceId - The ID of the Space to update
   * @param contentByLang - Map of language code to {name, accessibilityInfo}
   * @returns Reloaded EventLocationSpace populated with new content, or null
   *          if the Space does not exist, has no loadable place association,
   *          or is not owned by the caller's calendar
   */
  async updateSpace(
    calendar: Calendar,
    spaceId: string,
    contentByLang: Record<string, { name: string; accessibilityInfo: string }>,
  ): Promise<EventLocationSpace | null> {
    const space = await LocationSpaceEntity.findByPk(spaceId, {
      include: [{ model: LocationEntity, as: 'place' }],
    });
    if (!space || !space.place || space.place.calendar_id !== calendar.id) {
      return null;
    }

    // Replace content: delete existing, then create new
    await LocationSpaceContentEntity.destroy({
      where: { space_id: spaceId },
    });

    for (const [language, content] of Object.entries(contentByLang)) {
      await LocationSpaceContentEntity.create({
        space_id: spaceId,
        language,
        name: content.name,
        accessibility_info: content.accessibilityInfo,
      });
    }

    const reloaded = await LocationSpaceEntity.findByPk(spaceId, {
      include: [LocationSpaceContentEntity],
    });
    return reloaded!.toModel();
  }

  /**
   * Delete a Space and nullify event.space_id on referencing events.
   *
   * Verifies that the Space exists and that its parent Place belongs to the
   * caller's calendar (eager-loading `place` so the auth chain
   * `space.place.calendar_id` is safe to dereference). On success, runs the
   * three side effects inside a single `db.transaction` so a failure mid-way
   * rolls the entire chain back:
   *
   *   1. Set `space_id = null` on every Event row that references this Space,
   *      leaving `location_id` untouched (the event remains attached to the
   *      parent Place as a "whole-venue" event).
   *   2. Destroy the Space's content rows.
   *   3. Destroy the Space row itself.
   *
   * The auth check (findByPk + place ownership) runs OUTSIDE the transaction
   * because it is a read-only gate; the transaction wraps only the writes.
   *
   * Cross-calendar isolation is enforced structurally by the FK invariant
   * (Space → Place → Calendar): a Space owned by a different calendar is
   * rejected by the auth chain before any side effects run.
   *
   * @param calendar - The calendar that should own the Space (via its Place)
   * @param spaceId - The ID of the Space to delete
   * @returns True if the Space was deleted; false if not found, not owned by
   *          the calendar, or missing a loadable place association
   */
  async deleteSpace(calendar: Calendar, spaceId: string): Promise<boolean> {
    const space = await LocationSpaceEntity.findByPk(spaceId, {
      include: [{ model: LocationEntity, as: 'place' }],
    });
    if (!space || !space.place || space.place.calendar_id !== calendar.id) {
      return false;
    }

    await db.transaction(async (tx) => {
      // Nullify event.space_id only; leave event.location_id intact so the
      // event becomes a whole-venue event on the parent Place.
      await EventEntity.update(
        { space_id: null },
        { where: { space_id: spaceId }, transaction: tx },
      );

      await LocationSpaceContentEntity.destroy({
        where: { space_id: spaceId },
        transaction: tx,
      });

      await space.destroy({ transaction: tx });
    });

    return true;
  }

  /**
   * Find an existing location or create a new one if not found.
   *
   * Attempts to find a matching location by ID or attributes. If no match is found,
   * creates a new location with the provided parameters. This is useful for deduplicating
   * locations when processing event data.
   *
   * @param calendar - The calendar that should own the location
   * @param locationParams - Raw location data object (will be converted to EventLocation)
   * @returns Existing or newly created EventLocation model
   * @throws LocationValidationError if location name is empty when creating
   */
  async findOrCreateLocation(calendar: Calendar, locationParams: Record<string,any>): Promise<EventLocation> {
    let location = await this.findLocation(calendar, EventLocation.fromObject(locationParams));
    if ( ! location ) {
      location = await this.createLocation(calendar, EventLocation.fromObject(locationParams));
    }
    return location;
  }

  /**
   * Find or create a Place keyed on its AP origin URI.
   *
   * Receiver-side dedup helper for the AP inbox path (pv-ix7v.9): when an
   * inbound activity references a Place by its source-instance identity hint
   * (origin_uri), this lookup either returns the previously-mirrored Place
   * for this calendar or creates a new one with the supplied data and the
   * origin_uri stamped on it.
   *
   * Lookup is scoped per-calendar — the same source Place mirrored onto two
   * different local calendars produces two independent rows, preserving the
   * per-calendar isolation invariant established by DEC-008 (no cross-calendar
   * leakage of identity hints or dedup state).
   *
   * @param calendar - The calendar that should own the Place
   * @param originUri - The AP source URI used to identify the Place
   * @param data - EventLocation model carrying the fields and content to use
   *               on the create branch (ignored if a match already exists)
   * @returns Existing or newly created EventLocation populated with content
   */
  async findOrCreatePlaceByOriginUri(
    calendar: Calendar,
    originUri: string,
    data: EventLocation,
  ): Promise<EventLocation> {
    const existing = await LocationEntity.findOne({
      where: {
        calendar_id: calendar.id,
        origin_uri: originUri,
      },
      include: [LocationContentEntity],
    });

    if (existing) {
      return existing.toModel();
    }

    // Create branch: build a Place row with origin_uri stamped on it, write
    // any content rows, then re-load through getLocationById so the returned
    // model has its content rows attached.
    const entity = LocationEntity.fromModel(data);
    entity.id = uuidv4();
    entity.calendar_id = calendar.id;
    entity.origin_uri = originUri;
    await entity.save();

    const languages = data.getLanguages();
    if (languages.length > 0) {
      for (const language of languages) {
        const content = data.content(language);
        if (!content.isEmpty()) {
          const contentEntity = LocationContentEntity.fromModel(entity.id, content);
          await contentEntity.save();
        }
      }
    }

    return this.getLocationById(calendar, entity.id) as Promise<EventLocation>;
  }

  /**
   * Find or create a Space keyed on its AP origin URI within a Place.
   *
   * Receiver-side dedup helper for the AP inbox path (pv-ix7v.9). The parent
   * Place is supplied by the caller (typically just resolved via
   * findOrCreatePlaceByOriginUri) so that Space scoping is anchored on a
   * concrete place_id. Lookup is keyed on (place_id, origin_uri); the parent
   * Place's calendar ownership is established by the caller and is not
   * re-checked here (the auth chain Place → Calendar already gates which
   * Spaces this helper can touch).
   *
   * @param _calendar - The calendar that owns the Place (kept in the signature
   *                    for symmetry with findOrCreatePlaceByOriginUri and to
   *                    document the expected ownership chain; not used directly
   *                    because Space scoping is anchored on the supplied Place)
   * @param place - The parent Place this Space belongs to (must have an id)
   * @param originUri - The AP source URI used to identify the Space
   * @param contentByLang - Map of language code to {name, accessibilityInfo};
   *                        used only on the create branch
   * @returns Existing or newly created EventLocationSpace populated with content
   */
  async findOrCreateSpaceByOriginUri(
    _calendar: Calendar,
    place: EventLocation,
    originUri: string,
    contentByLang: Record<string, { name: string; accessibilityInfo: string }>,
  ): Promise<EventLocationSpace> {
    const existing = await LocationSpaceEntity.findOne({
      where: {
        place_id: place.id,
        origin_uri: originUri,
      },
      include: [LocationSpaceContentEntity],
    });

    if (existing) {
      return existing.toModel();
    }

    const spaceId = uuidv4();
    await LocationSpaceEntity.create({
      id: spaceId,
      place_id: place.id,
      origin_uri: originUri,
    });

    for (const [language, content] of Object.entries(contentByLang)) {
      await LocationSpaceContentEntity.create({
        space_id: spaceId,
        language,
        name: content.name,
        accessibility_info: content.accessibilityInfo,
      });
    }

    const fetched = await LocationSpaceEntity.findByPk(spaceId, {
      include: [LocationSpaceContentEntity],
    });
    return fetched!.toModel();
  }
}
