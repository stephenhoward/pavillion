import { v4 as uuidv4 } from 'uuid';

import { CalendarCategoryMappingEntity } from '@/server/calendar/entity/category_mapping';
import type { CalendarCategoryMapping } from '@/server/calendar/entity/category_mapping';
import { EventCategoryEntity } from '@/server/calendar/entity/event_category';
import { EventCategoryAssignmentEntity } from '@/server/calendar/entity/event_category_assignment';
import { CalendarActorEntity, CalendarActor } from '@/server/activitypub/entity/calendar_actor';
import { FollowingCalendarEntity } from '@/server/activitypub/entity/activitypub';
import db from '@/server/common/entity/db';

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

    const transaction = await db.transaction();
    try {
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

      await transaction.commit();
    }
    catch (e) {
      await transaction.rollback();
      throw e;
    }
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
    const actor = await CalendarActorEntity.findByPk(actorId);
    if (!actor) {
      throw new Error('actor not found');
    }

    const follow = await FollowingCalendarEntity.findOne({
      where: { calendar_actor_id: actorId, calendar_id: calendarId },
    });
    if (!follow) {
      throw new Error('actor is not in the following list for this calendar');
    }

    return actor.toModel();
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
   * @param calendarId - The local following calendar ID
   * @param sourceActorId - The CalendarActor entity ID of the remote calendar
   * @param eventId - The local event ID to assign categories to
   * @param sourceCategories - Source category identifiers from the remote AP event
   */
  async assignAutoRepostCategories(
    calendarId: string,
    sourceActorId: string,
    eventId: string,
    sourceCategories: { id: string }[],
  ): Promise<void> {
    if (sourceCategories.length === 0) {
      return;
    }

    const localCategoryIds = await this.applyMappings(calendarId, sourceActorId, sourceCategories);
    if (localCategoryIds.length === 0) {
      return;
    }

    await EventCategoryAssignmentEntity.bulkCreate(
      localCategoryIds.map(catId => ({ id: uuidv4(), event_id: eventId, category_id: catId })),
      { ignoreDuplicates: true },
    );
  }
}

export default CategoryMappingService;
export type { MappingInput, CalendarCategoryMapping };
