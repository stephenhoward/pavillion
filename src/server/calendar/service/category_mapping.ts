import { v4 as uuidv4 } from 'uuid';

import { CalendarCategoryMappingEntity } from '@/server/calendar/entity/category_mapping';
import type { CalendarCategoryMapping } from '@/server/calendar/entity/category_mapping';
import { EventCategoryEntity } from '@/server/calendar/entity/event_category';
import { EventCategoryAssignmentEntity } from '@/server/calendar/entity/event_category_assignment';
import { EventEntity } from '@/server/calendar/entity/event';
import type { CalendarActor } from '@/server/activitypub/entity/calendar_actor';
import db from '@/server/common/entity/db';
import type ActivityPubInterface from '@/server/activitypub/interface';

const MAX_MAPPINGS = 100;

interface MappingInput {
  sourceCategoryId: string;
  sourceCategoryName: string;
  localCategoryId: string;
}

/**
 * Service for managing category mappings between remote (federated) calendars
 * and local event categories. Allows calendar owners to normalise incoming
 * category tags from followed remote calendars into their own local taxonomy.
 */
class CategoryMappingService {
  private activityPubInterface?: ActivityPubInterface;

  setActivityPubInterface(apInterface: ActivityPubInterface): void {
    this.activityPubInterface = apInterface;
  }

  /**
   * Get all category mappings for a given calendar and source actor.
   *
   * @param calendarId - The local following calendar ID
   * @param sourceActorId - The ActivityPub actor ID of the remote calendar
   * @returns Array of mapping entities
   */
  async getMappings(calendarId: string, sourceActorId: string): Promise<CalendarCategoryMappingEntity[]> {
    return CalendarCategoryMappingEntity.findAll({
      where: {
        following_calendar_id: calendarId,
        source_calendar_actor_id: sourceActorId,
      },
    });
  }

  /**
   * Replace all category mappings for a given calendar and source actor.
   * Performs an atomic delete-then-insert within a transaction.
   *
   * @param calendarId - The local following calendar ID
   * @param sourceActorId - The ActivityPub actor ID of the remote calendar
   * @param mappings - The new set of mappings (max 100 entries)
   * @throws Error if mappings array length exceeds 100
   */
  async setMappings(calendarId: string, sourceActorId: string, mappings: MappingInput[]): Promise<void> {
    if (mappings.length > MAX_MAPPINGS) {
      throw new Error(`Cannot set more than ${MAX_MAPPINGS} category mappings at once`);
    }

    await db.transaction(async (transaction) => {
      await CalendarCategoryMappingEntity.destroy({
        where: {
          following_calendar_id: calendarId,
          source_calendar_actor_id: sourceActorId,
        },
        transaction,
      });

      for (const m of mappings) {
        await CalendarCategoryMappingEntity.create({
          id: uuidv4(),
          following_calendar_id: calendarId,
          source_calendar_actor_id: sourceActorId,
          source_category_id: m.sourceCategoryId,
          source_category_name: m.sourceCategoryName,
          local_category_id: m.localCategoryId,
        }, { transaction });
      }
    });
  }

  /**
   * Apply category mappings to a list of source categories.
   * Returns only the local category IDs for source categories that have
   * a mapping defined — unmapped source categories are silently skipped.
   *
   * @param calendarId - The local following calendar ID
   * @param sourceActorId - The ActivityPub actor ID of the remote calendar
   * @param sourceCategories - Source category identifiers to map
   * @returns Array of local category IDs (only for mapped entries)
   */
  async applyMappings(
    calendarId: string,
    sourceActorId: string,
    sourceCategories: { id: string }[],
  ): Promise<string[]> {
    if (sourceCategories.length === 0) {
      return [];
    }

    const mappings = await this.getMappings(calendarId, sourceActorId);
    if (mappings.length === 0) {
      return [];
    }

    const mappingIndex = new Map<string, string>();
    for (const m of mappings) {
      mappingIndex.set(m.source_category_id, m.local_category_id);
    }

    const localIds: string[] = [];
    for (const sourceCategory of sourceCategories) {
      const localId = mappingIndex.get(sourceCategory.id);
      if (localId !== undefined) {
        localIds.push(localId);
      }
    }

    return localIds;
  }

  /**
   * Check whether every source category in the provided list has a mapping.
   *
   * @param calendarId - The local following calendar ID
   * @param sourceActorId - The ActivityPub actor ID of the remote calendar
   * @param sourceCategories - Source category identifiers to check
   * @returns true if every source category is mapped (vacuously true for empty list)
   */
  async hasCompleteMapping(
    calendarId: string,
    sourceActorId: string,
    sourceCategories: { id: string }[],
  ): Promise<boolean> {
    if (sourceCategories.length === 0) {
      return true;
    }

    const mappings = await this.getMappings(calendarId, sourceActorId);
    const mappedIds = new Set(mappings.map(m => m.source_category_id));

    return sourceCategories.every(sc => mappedIds.has(sc.id));
  }

  /**
   * Look up a CalendarActor by ID and verify it is in the follow list for the given calendar.
   * Returns the actor model if valid, throws Error if not found or not followed.
   *
   * @param calendarId - The local calendar ID
   * @param actorId - The CalendarActor ID to look up
   * @returns The CalendarActor model if valid
   * @throws Error if actor not found or not in following list
   */
  async getActorInFollowing(calendarId: string, actorId: string): Promise<CalendarActor> {
    return this.activityPubInterface!.getActorInFollowing(calendarId, actorId);
  }

  /**
   * Validate that all given localCategoryIds belong to calendarId and exist.
   * Throws Error if any are invalid.
   *
   * @param calendarId - The calendar ID that categories must belong to
   * @param localCategoryIds - Array of category IDs to validate
   * @throws Error if any category does not belong to the calendar or does not exist
   */
  async validateLocalCategories(calendarId: string, localCategoryIds: string[]): Promise<void> {
    const localCategories = await EventCategoryEntity.findAll({
      where: { id: localCategoryIds },
    });

    for (const cat of localCategories) {
      if (cat.calendar_id !== calendarId) {
        throw new Error('Category does not belong to this calendar');
      }
    }

    const foundIds = new Set(localCategories.map(c => c.id));
    for (const id of localCategoryIds) {
      if (!foundIds.has(id)) {
        throw new Error(`Local category not found: ${id}`);
      }
    }
  }

  /**
   * Apply category mappings and assign the resulting local categories to an event.
   * Used during auto-repost to tag incoming events with local categories based on mappings.
   * No-ops silently if there are no source categories or no mappings are defined.
   *
   * With no recorded source categories, an event on this instance is mapped
   * from the categories its own calendar gave it (see {@link ownCategoriesOf}).
   *
   * @param calendarId - The local following calendar ID
   * @param sourceActorId - The CalendarActor entity ID of the followed calendar
   * @param eventId - The local event ID to assign categories to
   * @param sourceCategories - Source category identifiers recorded from the inbound AP event
   */
  async assignAutoRepostCategories(
    calendarId: string,
    sourceActorId: string,
    eventId: string,
    sourceCategories: { id: string }[],
  ): Promise<void> {
    const categories = sourceCategories.length > 0 ? sourceCategories : await this.ownCategoriesOf(eventId);
    if (categories.length === 0) {
      return;
    }

    const localCategoryIds = await this.applyMappings(calendarId, sourceActorId, categories);
    if (localCategoryIds.length === 0) {
      return;
    }

    await EventCategoryAssignmentEntity.bulkCreate(
      localCategoryIds.map(catId => ({ id: uuidv4(), event_id: eventId, category_id: catId })),
      { ignoreDuplicates: true },
    );
  }

  /**
   * Applies the current mappings to the events this calendar has already
   * auto-reposted from the source, adding the mapped categories. Removes
   * none, so an edit that drops a mapping leaves earlier assignments in place.
   *
   * Saving mappings runs this because a follow's history can be reposted
   * before its mappings exist: the follow dialog saves them after the follow,
   * and a same-instance follow is caught up at once.
   *
   * @param calendarId - The local following calendar ID
   * @param sourceActorId - The CalendarActor entity ID of the followed calendar
   */
  async applyMappingsToAutoReposts(calendarId: string, sourceActorId: string): Promise<void> {
    const mappings = await this.getMappings(calendarId, sourceActorId);
    if (mappings.length === 0) {
      return;
    }
    const localIdFor = new Map(mappings.map(m => [m.source_category_id, m.local_category_id]));

    const reposts = await this.activityPubInterface!.listAutoRepostedOriginals(calendarId, sourceActorId);
    const assignments: { id: string; event_id: string; category_id: string }[] = [];
    for (const { eventId, sourceCategories } of reposts) {
      const categories = sourceCategories.length > 0 ? sourceCategories : await this.ownCategoriesOf(eventId);
      for (const category of categories) {
        const localId = localIdFor.get(category.id);
        if (localId !== undefined) {
          assignments.push({ id: uuidv4(), event_id: eventId, category_id: localId });
        }
      }
    }

    if (assignments.length > 0) {
      await EventCategoryAssignmentEntity.bulkCreate(assignments, { ignoreDuplicates: true });
    }
  }

  /**
   * The categories an event's own calendar gave it, as source categories.
   * Only an inbound Create records source categories, so an event on this
   * instance, reposted by a same-instance follower, has none recorded. The
   * event's assignments are filtered to its own calendar because a follower's
   * mapped categories are assigned to the same event row. Empty for an event
   * from another instance.
   *
   * @param eventId - The event's id
   */
  private async ownCategoriesOf(eventId: string): Promise<{ id: string }[]> {
    const event = await EventEntity.findByPk(eventId, { attributes: ['id', 'calendar_id'] });
    if (!event?.calendar_id) {
      return [];
    }
    const assignments = await EventCategoryAssignmentEntity.findAll({
      where: { event_id: eventId },
      include: [{
        model: EventCategoryEntity,
        as: 'category',
        where: { calendar_id: event.calendar_id },
        required: true,
        attributes: ['id'],
      }],
    });
    return assignments.map(assignment => ({ id: assignment.category_id }));
  }

  /**
   * Assigns explicitly selected local categories to a manually reposted event.
   * Skips the permission check because shareEvent() already verified the user
   * can modify the destination calendar before calling this.
   *
   * @param eventId - The local event ID to assign categories to
   * @param categoryIds - Local category IDs selected by the user in the repost modal
   */
  async assignManualRepostCategories(
    eventId: string,
    categoryIds: string[],
  ): Promise<void> {
    if (categoryIds.length === 0) {
      return;
    }

    await EventCategoryAssignmentEntity.bulkCreate(
      categoryIds.map(catId => ({ id: uuidv4(), event_id: eventId, category_id: catId })),
      { ignoreDuplicates: true },
    );
  }
}

export default CategoryMappingService;
export type { MappingInput, CalendarCategoryMapping };
