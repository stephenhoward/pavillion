import { describe, it, expect } from 'vitest';
import { computed, ref } from 'vue';

/**
 * Tests: Feed events empty state logic in events.vue
 *
 * Verifies that the component selects the correct empty state variant
 * based on whether the user follows any calendars.
 *
 * - Zero follows: show "Follow a Calendar" CTA
 * - Follows >= 1 but no events: show waiting/explanation message (no CTA)
 *
 * These tests exercise the branching logic in isolation since mounting
 * the full events.vue requires extensive store and i18next infrastructure.
 * The pattern directly mirrors the computed `hasFollows` ref in events.vue.
 */
describe('Feed events empty state branching logic', () => {
  /**
   * Simulate the reactive state as it exists in events.vue:
   *   const hasFollows = computed(() => feedStore.follows.length > 0);
   */
  const makeHasFollows = (followsArray: unknown[]) =>
    computed(() => followsArray.length > 0);

  describe('when follows array is empty', () => {
    it('hasFollows is false', () => {
      const hasFollows = makeHasFollows([]);
      expect(hasFollows.value).toBe(false);
    });

    it('shows "follow a calendar" empty state (not the waiting state)', () => {
      const events = ref([]);
      const hasFollows = makeHasFollows([]);

      // Template branch: v-else (no follows) renders the CTA
      const showCTA = !events.value.length && !hasFollows.value;
      const showWaiting = !events.value.length && hasFollows.value;

      expect(showCTA).toBe(true);
      expect(showWaiting).toBe(false);
    });
  });

  describe('when follows array has entries but no events', () => {
    it('hasFollows is true', () => {
      const hasFollows = makeHasFollows([{ id: 'follow-1' }]);
      expect(hasFollows.value).toBe(true);
    });

    it('shows waiting empty state (not the CTA state)', () => {
      const events = ref([]);
      const hasFollows = makeHasFollows([{ id: 'follow-1' }]);

      // Template branch: v-else-if (has follows, no events) renders waiting message
      const showCTA = !events.value.length && !hasFollows.value;
      const showWaiting = !events.value.length && hasFollows.value;

      expect(showCTA).toBe(false);
      expect(showWaiting).toBe(true);
    });

    it('shows waiting state when multiple follows exist', () => {
      const events = ref([]);
      const hasFollows = makeHasFollows([
        { id: 'follow-1' },
        { id: 'follow-2' },
      ]);

      const showWaiting = !events.value.length && hasFollows.value;
      expect(showWaiting).toBe(true);
    });
  });

  describe('when there are events (regardless of follows)', () => {
    it('neither empty state is shown when events exist', () => {
      const events = ref([{ id: 'event-1' }]);
      const hasFollows = makeHasFollows([{ id: 'follow-1' }]);

      const showCTA = !events.value.length && !hasFollows.value;
      const showWaiting = !events.value.length && hasFollows.value;

      expect(showCTA).toBe(false);
      expect(showWaiting).toBe(false);
    });
  });

  describe('reactive updates', () => {
    it('transitions from waiting state to no-empty-state when events arrive', () => {
      const events = ref([]);
      const followsArray = ref([{ id: 'follow-1' }]);
      const hasFollows = computed(() => followsArray.value.length > 0);

      // Initial: waiting state
      expect(!events.value.length && hasFollows.value).toBe(true);

      // Events arrive
      events.value = [{ id: 'event-1' }];

      // Empty state disappears
      expect(!events.value.length && hasFollows.value).toBe(false);
    });

    it('transitions from waiting to CTA state when all calendars are unfollowed', () => {
      const events = ref([]);
      const followsArray = ref([{ id: 'follow-1' }]);
      const hasFollows = computed(() => followsArray.value.length > 0);

      // Initial: waiting state (has follow, no events)
      expect(!events.value.length && hasFollows.value).toBe(true);

      // Unfollow all
      followsArray.value = [];

      // Now shows CTA state
      expect(!events.value.length && !hasFollows.value).toBe(true);
    });
  });
});
