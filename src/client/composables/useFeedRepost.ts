import FeedService, {
  type FeedEvent,
  type FollowRelationship,
  type CategoryEntry,
  type CategoryMappingEntry,
} from '@/client/service/feed';
import { useFeedStore } from '@/client/stores/feedStore';

/**
 * State representing a pending repost that requires the user to select categories.
 */
export interface PendingRepost {
  eventId: string;
  preSelectedIds: string[];
  sourceCategories: CategoryEntry[];
  allLocalCategories: CategoryEntry[];
  calendarActorUuid: string;
}

/**
 * Return type for the useFeedRepost composable
 */
export interface UseFeedRepostReturn {
  repostEvent: (eventId: string) => Promise<PendingRepost | null>;
  unrepostEvent: (eventId: string) => Promise<void>;
  confirmRepost: (
    eventId: string,
    categoryIds: string[],
    calendarActorUuid: string,
    sourceCategoriesToAdopt?: CategoryEntry[],
  ) => Promise<void>;
}

/**
 * Attempt to find which follow relationship corresponds to a given feed event.
 * Uses a domain-based heuristic for remote events, or falls back to single-follow detection.
 *
 * @param follows - List of follow relationships
 * @param event - The feed event to match
 * @returns The matching follow relationship, or null if not determinable
 */
export function findFollowForEvent(follows: FollowRelationship[], event: FeedEvent): FollowRelationship | null {
  if (follows.length === 0) {
    return null;
  }

  // For remote events: try to match by domain extracted from eventSourceUrl
  if (!event.calendarId && event.eventSourceUrl) {
    try {
      const eventDomain = new URL(event.eventSourceUrl).hostname;
      const match = follows.find((f) => {
        const parts = f.calendarActorId.split('@');
        return parts.length === 2 && parts[1] === eventDomain;
      });
      if (match) {
        return match;
      }
    }
    catch {
      // URL parse failed; fall through to single-follow fallback
    }
  }

  // Fallback: if there is exactly one follow, assume it is the source
  if (follows.length === 1) {
    return follows[0];
  }

  return null;
}

/**
 * Composable for managing event repost and unrepost operations.
 * Handles optimistic updates and the smart repost flow (category checking).
 * Does NOT own pendingRepost state — that is UI state for the consuming component.
 *
 * @returns Repost management methods
 */
export function useFeedRepost(): UseFeedRepostReturn {
  const feedService = new FeedService();
  const feedStore = useFeedStore();

  /**
   * Execute the actual repost API call with optional category IDs.
   * Applies an optimistic update before the call and rolls back on error.
   *
   * @param eventId - The ID of the event to repost
   * @param categoryIds - Local category IDs to assign to the reposted event
   */
  const doRepost = async (eventId: string, categoryIds: string[]) => {
    if (!feedStore.selectedCalendarId) {
      return;
    }

    const eventIndex = feedStore.events.findIndex((e) => e.id === eventId);
    if (eventIndex === -1) {
      return;
    }

    const eventSourceUrl = feedStore.events[eventIndex].eventSourceUrl;

    // Optimistic update
    const previousStatus = feedStore.events[eventIndex].repostStatus;
    feedStore.events[eventIndex].repostStatus = 'manual';

    try {
      await feedService.shareEvent(feedStore.selectedCalendarId, eventSourceUrl, categoryIds);
    }
    catch (error) {
      // Rollback on error
      feedStore.events[eventIndex].repostStatus = previousStatus;
      console.error('Error reposting event:', error);
      throw error;
    }
  };

  /**
   * Repost an event from the feed to the current calendar.
   *
   * Checks source categories and existing mappings before reposting:
   * - If source follow cannot be identified: reposts silently
   * - If source has no categories: reposts silently
   * - If all source categories are mapped: applies mappings silently
   * - If any source category is unmapped: returns PendingRepost so the
   *   component can open the category selection modal
   *
   * @param eventId - The ID of the event to repost
   * @returns PendingRepost if user input is needed, null if reposted silently
   */
  const repostEvent = async (eventId: string): Promise<PendingRepost | null> => {
    if (!feedStore.selectedCalendarId) {
      return null;
    }

    const event = feedStore.events.find((e) => e.id === eventId);
    if (!event) {
      return null;
    }

    // Find the follow relationship for this event
    const follow = findFollowForEvent(feedStore.follows, event);

    // If we cannot determine the source follow, repost silently
    if (!follow) {
      await doRepost(eventId, []);
      return null;
    }

    // Fetch source categories for this followed calendar
    let sourceCategories: CategoryEntry[] = [];
    try {
      sourceCategories = await feedService.getSourceCategories(feedStore.selectedCalendarId, follow.calendarActorUuid);
    }
    catch {
      // If we can't fetch source categories, repost silently
      await doRepost(eventId, []);
      return null;
    }

    // If the source calendar has no categories, repost silently
    if (sourceCategories.length === 0) {
      await doRepost(eventId, []);
      return null;
    }

    // Narrow to only the source categories assigned to this specific event.
    const eventCategoryIds = event.categoryIds;
    let relevantSourceCategories: CategoryEntry[];
    if (eventCategoryIds === undefined) {
      relevantSourceCategories = sourceCategories;
    }
    else if (eventCategoryIds.length === 0) {
      relevantSourceCategories = [];
    }
    else {
      relevantSourceCategories = sourceCategories.filter((src) => eventCategoryIds.includes(src.id));
    }

    if (relevantSourceCategories.length === 0) {
      await doRepost(eventId, []);
      return null;
    }

    // Fetch existing category mappings
    let mappings: CategoryMappingEntry[] = [];
    try {
      mappings = await feedService.getCategoryMappings(feedStore.selectedCalendarId, follow.calendarActorUuid);
    }
    catch {
      // If we can't fetch mappings, fall through to show modal with empty pre-selection
    }

    // Build the list of pre-selected local category IDs from existing mappings
    const preSelectedIds = relevantSourceCategories
      .map((src) => mappings.find((m) => m.sourceCategoryId === src.id)?.localCategoryId)
      .filter((id): id is string => id !== undefined);

    const allMapped = preSelectedIds.length === relevantSourceCategories.length;

    if (allMapped) {
      // All source categories are mapped: apply silently
      await doRepost(eventId, preSelectedIds);
      return null;
    }

    // Some categories are unmapped: fetch local categories and return pending repost
    let allLocalCategories: CategoryEntry[] = [];
    try {
      allLocalCategories = await feedService.getCalendarCategories(feedStore.selectedCalendarId);
    }
    catch {
      // If we can't load local categories, repost silently with partial mappings
      await doRepost(eventId, preSelectedIds);
      return null;
    }

    return {
      eventId,
      preSelectedIds,
      sourceCategories: relevantSourceCategories,
      allLocalCategories,
      calendarActorUuid: follow.calendarActorUuid,
    };
  };

  /**
   * Confirm a pending repost with the user-selected category IDs.
   *
   * When sourceCategoriesToAdopt is provided (no-local-categories mode), this method:
   * 1. Creates each adopted source category as a new local category
   * 2. Saves the source-to-local mappings
   * 3. Reposts with the new local category IDs
   *
   * @param eventId - The event to repost
   * @param categoryIds - The local category IDs selected by the user (has-categories mode)
   * @param calendarActorUuid - The actor UUID for saving category mappings
   * @param sourceCategoriesToAdopt - Source categories to create locally (no-categories mode)
   */
  const confirmRepost = async (
    eventId: string,
    categoryIds: string[],
    calendarActorUuid: string,
    sourceCategoriesToAdopt?: CategoryEntry[],
  ) => {
    if (!sourceCategoriesToAdopt || sourceCategoriesToAdopt.length === 0) {
      return doRepost(eventId, categoryIds);
    }

    if (!feedStore.selectedCalendarId) {
      return;
    }

    // Create each adopted source category as a new local category and collect mappings
    const newMappings: CategoryMappingEntry[] = [];
    const newLocalCategoryIds: string[] = [];

    for (const sourceCat of sourceCategoriesToAdopt) {
      const newLocalCat = await feedService.createLocalCategory(feedStore.selectedCalendarId, sourceCat.name);
      newLocalCategoryIds.push(newLocalCat.id);
      newMappings.push({
        sourceCategoryId: sourceCat.id,
        sourceCategoryName: sourceCat.name,
        localCategoryId: newLocalCat.id,
      });
    }

    // Fetch existing mappings and merge with new ones
    let existingMappings: CategoryMappingEntry[] = [];
    try {
      existingMappings = await feedService.getCategoryMappings(feedStore.selectedCalendarId, calendarActorUuid);
    }
    catch {
      // If we can't fetch existing mappings, proceed with just the new ones
    }

    // Merge: new mappings override any existing mapping for the same source category
    const existingFiltered = existingMappings.filter(
      (m) => !newMappings.some((n) => n.sourceCategoryId === m.sourceCategoryId),
    );
    await feedService.setCategoryMappings(
      feedStore.selectedCalendarId,
      calendarActorUuid,
      [...existingFiltered, ...newMappings],
    );

    return doRepost(eventId, newLocalCategoryIds);
  };

  /**
   * Un-repost an event (remove repost from current calendar) with optimistic update.
   *
   * @param eventId - The ID of the event to un-repost
   */
  const unrepostEvent = async (eventId: string) => {
    if (!feedStore.selectedCalendarId) {
      return;
    }

    const eventIndex = feedStore.events.findIndex((e) => e.id === eventId);
    if (eventIndex === -1) {
      return;
    }

    // Optimistic update
    const previousStatus = feedStore.events[eventIndex].repostStatus;
    feedStore.events[eventIndex].repostStatus = 'none';

    try {
      await feedService.unshareEvent(feedStore.selectedCalendarId, eventId);
    }
    catch (error) {
      // Rollback on error
      feedStore.events[eventIndex].repostStatus = previousStatus;
      console.error('Error unreposting event:', error);
      throw error;
    }
  };

  return { repostEvent, unrepostEvent, confirmRepost };
}
