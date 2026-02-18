<script setup>
import { computed, ref, nextTick, onMounted, onUnmounted } from 'vue';
import { useTranslation } from 'i18next-vue';
import { DateTime } from 'luxon';
import { useFeedStore } from '@/client/stores/feedStore';
import { useToast } from '@/client/composables/useToast';
import EmptyLayout from '@/client/components/common/empty_state.vue';
import RepostCategoriesModal from '@/client/components/logged_in/repost-categories-modal.vue';

const { t } = useTranslation('feed', { keyPrefix: 'events' });
const feedStore = useFeedStore();
const toast = useToast();

const events = computed(() => feedStore.events);
const hasMore = computed(() => feedStore.eventsHasMore);
const isLoading = computed(() => feedStore.isLoadingEvents);
const pendingRepost = computed(() => feedStore.pendingRepost);
const sentinelRef = ref(null);
const repostTriggerElement = ref(null);
let observer = null;

/**
 * Format event date and time for display
 */
const formatEventDate = (event) => {
  if (!event.date) {
    return '';
  }

  try {
    const dt = DateTime.fromISO(event.date);
    return dt.toLocaleString(DateTime.DATETIME_MED);
  }
  catch (error) {
    console.error('Error formatting date:', error);
    return event.date;
  }
};

/**
 * Get the event title in the appropriate language
 */
const getEventTitle = (event) => {
  if (!event || typeof event.content !== 'function') {
    return '';
  }
  const content = event.content('en'); // TODO: Use user's preferred language
  return content?.name || t('untitled_event');
};

/**
 * Get the event description in the appropriate language
 */
const getEventDescription = (event) => {
  const content = event.content('en'); // TODO: Use user's preferred language
  return content?.description || '';
};

/**
 * Get calendar identifier for display
 */
const getCalendarIdentifier = (event) => {
  // For federated events, this would come from the event metadata
  // For now, just show the calendar ID
  return event.calendarId || t('unknown_calendar');
};

/**
 * Derive the pre-selected category objects for the modal from pendingRepost state.
 * Matches preSelectedIds against allLocalCategories to get proper { id, name } pairs.
 */
const pendingRepostPreSelected = computed(() => {
  if (!pendingRepost.value) {
    return [];
  }
  const { preSelectedIds, allLocalCategories } = pendingRepost.value;
  return allLocalCategories.filter((cat) => preSelectedIds.includes(cat.id));
});

/**
 * Derive the event title for the pending repost modal.
 */
const pendingRepostEventTitle = computed(() => {
  if (!pendingRepost.value) {
    return '';
  }
  const event = events.value.find((e) => e.id === pendingRepost.value.eventId);
  return event ? getEventTitle(event) : '';
});

/**
 * Handle repost button click — delegates to the store which may set pendingRepost
 */
const handleRepost = async (eventId, event) => {
  repostTriggerElement.value = (event?.currentTarget) ?? null;
  try {
    await feedStore.repostEvent(eventId);
  }
  catch (error) {
    console.error('Error reposting event:', error);
    toast.error(t('repost_error'));
  }
};

/**
 * Handle unrepost action (clicking on reposted label)
 */
const handleUnrepost = async (eventId) => {
  try {
    await feedStore.unrepostEvent(eventId);
  }
  catch (error) {
    console.error('Error unreposting event:', error);
    toast.error(t('unrepost_error'));
  }
};

/**
 * Handle modal confirm: repost with the selected category IDs
 */
const handleRepostConfirm = async (categoryIds) => {
  try {
    await feedStore.confirmPendingRepost(categoryIds);
    nextTick(() => { repostTriggerElement.value?.focus(); });
  }
  catch (error) {
    console.error('Error confirming repost:', error);
    toast.error(t('repost_error'));
  }
};

/**
 * Handle modal cancel: dismiss without reposting
 */
const handleRepostCancel = () => {
  feedStore.cancelPendingRepost();
  nextTick(() => { repostTriggerElement.value?.focus(); });
};

/**
 * Handle "Follow a Calendar" button click
 */
const emit = defineEmits(['followCalendar']);
const handleFollowCalendar = () => {
  emit('followCalendar');
};

/**
 * Load more events when scroll sentinel becomes visible
 */
const loadMore = () => {
  if (!isLoading.value && hasMore.value) {
    feedStore.loadFeed(true);
  }
};

/**
 * Setup Intersection Observer for infinite scroll
 */
onMounted(() => {
  if (!sentinelRef.value) {
    return;
  }

  observer = new IntersectionObserver(
    (entries) => {
      const sentinel = entries[0];
      if (sentinel.isIntersecting) {
        loadMore();
      }
    },
    {
      root: null,
      rootMargin: '100px',
      threshold: 0.1,
    },
  );

  observer.observe(sentinelRef.value);
});

/**
 * Cleanup Intersection Observer
 */
onUnmounted(() => {
  if (observer && sentinelRef.value) {
    observer.unobserve(sentinelRef.value);
    observer.disconnect();
  }
});
</script>

<template>
  <div class="events-container">
    <div v-if="events.length" class="events-list">
      <div
        v-for="event in events"
        :key="event.id"
        class="event-item"
        data-testid="event-item"
      >
        <div class="event-content">
          <h3 class="event-title">{{ getEventTitle(event) }}</h3>
          <p class="event-date">{{ formatEventDate(event) }}</p>
          <p v-if="getEventDescription(event)" class="event-description">
            {{ getEventDescription(event) }}
          </p>
          <p class="event-source">
            {{ getCalendarIdentifier(event) }}
          </p>
        </div>

        <div class="event-actions">
          <!-- Not reposted - show Repost button -->
          <button
            v-if="event.repostStatus === 'none'"
            type="button"
            class="repost-button"
            data-testid="repost-button"
            @click="handleRepost(event.id, $event)"
          >
            {{ t('repost_button') }}
          </button>

          <!-- Manually reposted - show clickable label to unrepost -->
          <button
            v-else-if="event.repostStatus === 'manual'"
            type="button"
            class="reposted-label"
            data-testid="reposted-label"
            :aria-label="t('unrepost_aria_label')"
            @click="handleUnrepost(event.id)"
          >
            {{ t('reposted_button') }}
          </button>

          <!-- Auto-posted - show non-clickable label -->
          <span
            v-else-if="event.repostStatus === 'auto'"
            class="auto-posted-label"
            data-testid="auto-posted-label"
          >
            {{ t('auto_posted_label') }}
          </span>
        </div>
      </div>

      <!-- Scroll sentinel for infinite scroll -->
      <div
        ref="sentinelRef"
        class="scroll-sentinel"
      />

      <!-- Loading indicator -->
      <div
        v-if="isLoading"
        class="loading-indicator"
        aria-live="polite"
        aria-atomic="true"
      >
        <p>{{ t('loading_more') }}</p>
      </div>
    </div>

    <!-- Empty state -->
    <EmptyLayout v-else :title="t('no_events')">
      <button
        type="button"
        class="primary"
        @click="handleFollowCalendar"
      >
        {{ t("follow_button") }}
      </button>
    </EmptyLayout>

    <!-- Repost categories modal — shown when pendingRepost is set -->
    <RepostCategoriesModal
      v-if="pendingRepost"
      :event-title="pendingRepostEventTitle"
      :pre-selected-categories="pendingRepostPreSelected"
      :all-local-categories="pendingRepost.allLocalCategories"
      @confirm="handleRepostConfirm"
      @cancel="handleRepostCancel"
    />
  </div>
</template>

<style scoped lang="scss">
div.events-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;

  div.events-list {
    flex: 1;
    padding: var(--pav-space-4);

    div.event-item {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: var(--pav-space-4);
      padding: var(--pav-space-4);
      margin-bottom: var(--pav-space-3);
      background: var(--pav-color-surface-secondary);
      border: 1px solid var(--pav-color-border-primary);
      border-radius: var(--pav-border-radius-md);
      transition: box-shadow 0.2s ease;

      &:hover {
        box-shadow: var(--pav-shadow-sm);
      }

      div.event-content {
        flex: 1;
        min-width: 0; // Enable text truncation

        h3.event-title {
          margin: 0 0 var(--pav-space-1) 0;
          font-size: 18px;
          font-weight: var(--pav-font-weight-medium);
          color: var(--pav-color-text-primary);
        }

        p.event-date {
          margin: 0 0 var(--pav-space-2) 0;
          font-size: 14px;
          color: var(--pav-color-text-secondary);
        }

        p.event-description {
          margin: 0 0 var(--pav-space-2) 0;
          font-size: 14px;
          line-height: 1.5;
          color: var(--pav-color-text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        p.event-source {
          margin: 0;
          font-size: 12px;
          color: var(--pav-color-text-secondary);
          font-style: italic;
        }
      }

      div.event-actions {
        flex-shrink: 0;
        display: flex;
        align-items: center;

        button.repost-button {
          padding: var(--pav-space-2) var(--pav-space-4);
          background: #f97316;
          color: white;
          border: none;
          border-radius: var(--pav-border-radius-sm);
          font-size: 14px;
          font-weight: var(--pav-font-weight-medium);
          cursor: pointer;
          transition: background 0.2s ease;

          &:hover {
            background: #ea580c;
          }

          &:active {
            background: #c2410c;
          }
        }

        button.reposted-label {
          padding: var(--pav-space-2) var(--pav-space-4);
          background: #22c55e;
          color: white;
          border: none;
          border-radius: var(--pav-border-radius-sm);
          font-size: 14px;
          font-weight: var(--pav-font-weight-medium);
          cursor: pointer;
          transition: background 0.2s ease;

          &:hover {
            background: #16a34a;
          }

          &:active {
            background: #15803d;
          }
        }

        span.auto-posted-label {
          padding: var(--pav-space-2) var(--pav-space-4);
          background: #6b7280;
          color: white;
          border-radius: var(--pav-border-radius-sm);
          font-size: 14px;
          font-weight: var(--pav-font-weight-medium);
        }
      }

      @media (max-width: 768px) {
        flex-direction: column;
        gap: var(--pav-space-3);

        div.event-actions {
          width: 100%;

          button,
          span {
            width: 100%;
            text-align: center;
          }
        }
      }
    }

    div.scroll-sentinel {
      height: 1px;
      width: 100%;
    }

    div.loading-indicator {
      padding: var(--pav-space-6);
      text-align: center;

      p {
        color: var(--pav-color-text-secondary);
        font-size: 14px;
      }
    }
  }

  // Empty state styling (inherits from EmptyLayout component)
  button.primary {
    background: #f97316;
    color: white;
    border: none;
    padding: var(--pav-space-3) var(--pav-space-6);
    border-radius: var(--pav-border-radius-md);
    font-size: 16px;
    font-weight: var(--pav-font-weight-medium);
    cursor: pointer;
    transition: background 0.2s ease;

    &:hover {
      background: #ea580c;
    }

    &:active {
      background: #c2410c;
    }
  }
}
</style>
