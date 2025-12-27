<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { useTranslation } from 'i18next-vue';
import { DateTime } from 'luxon';
import { useFeedStore } from '@/client/stores/feedStore';
import EmptyLayout from '@/client/components/common/empty_state.vue';

const { t } = useTranslation('feed', { keyPrefix: 'events' });
const feedStore = useFeedStore();

const events = computed(() => feedStore.events);
const hasMore = computed(() => feedStore.eventsHasMore);
const isLoading = computed(() => feedStore.isLoadingEvents);
const sentinelRef = ref(null);
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
  return event.calendarId || 'Unknown';
};

/**
 * Handle repost button click
 */
const handleRepost = async (eventId) => {
  try {
    await feedStore.repostEvent(eventId);
  }
  catch (error) {
    console.error('Error reposting event:', error);
    // TODO: Show user-friendly error message
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
    // TODO: Show user-friendly error message
  }
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
            @click="handleRepost(event.id)"
          >
            Repost
          </button>

          <!-- Manually reposted - show clickable label to unrepost -->
          <button
            v-else-if="event.repostStatus === 'manual'"
            type="button"
            class="reposted-label"
            data-testid="reposted-label"
            @click="handleUnrepost(event.id)"
          >
            Reposted
          </button>

          <!-- Auto-posted - show non-clickable label -->
          <span
            v-else-if="event.repostStatus === 'auto'"
            class="auto-posted-label"
            data-testid="auto-posted-label"
          >
            Auto-posted
          </span>
        </div>
      </div>

      <!-- Scroll sentinel for infinite scroll -->
      <div
        ref="sentinelRef"
        class="scroll-sentinel"
      />

      <!-- Loading indicator -->
      <div v-if="isLoading" class="loading-indicator">
        <p>Loading more events...</p>
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
  </div>
</template>

<style scoped lang="scss">
@use '../../../assets/mixins' as *;

div.events-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;

  div.events-list {
    flex: 1;
    padding: $spacing-lg;

    div.event-item {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: $spacing-lg;
      padding: $spacing-lg;
      margin-bottom: $spacing-md;
      background: $light-mode-panel-background;
      border: 1px solid $light-mode-border;
      border-radius: $component-border-radius;
      transition: box-shadow 0.2s ease;

      &:hover {
        box-shadow: $box-shadow-light;
      }

      @media (prefers-color-scheme: dark) {
        background: $dark-mode-panel-background;
        border-color: $dark-mode-border;

        &:hover {
          box-shadow: $box-shadow-medium;
        }
      }

      div.event-content {
        flex: 1;
        min-width: 0; // Enable text truncation

        h3.event-title {
          margin: 0 0 $spacing-xs 0;
          font-size: 18px;
          font-weight: $font-medium;
          color: $light-mode-text;

          @media (prefers-color-scheme: dark) {
            color: $dark-mode-text;
          }
        }

        p.event-date {
          margin: 0 0 $spacing-sm 0;
          font-size: 14px;
          color: $light-mode-secondary-text;

          @media (prefers-color-scheme: dark) {
            color: $dark-mode-secondary-text;
          }
        }

        p.event-description {
          margin: 0 0 $spacing-sm 0;
          font-size: 14px;
          line-height: 1.5;
          color: $light-mode-text;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;

          @media (prefers-color-scheme: dark) {
            color: $dark-mode-text;
          }
        }

        p.event-source {
          margin: 0;
          font-size: 12px;
          color: $light-mode-secondary-text;
          font-style: italic;

          @media (prefers-color-scheme: dark) {
            color: $dark-mode-secondary-text;
          }
        }
      }

      div.event-actions {
        flex-shrink: 0;
        display: flex;
        align-items: center;

        button.repost-button {
          padding: $spacing-sm $spacing-lg;
          background: #f97316;
          color: white;
          border: none;
          border-radius: $component-border-radius-small;
          font-size: 14px;
          font-weight: $font-medium;
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
          padding: $spacing-sm $spacing-lg;
          background: #22c55e;
          color: white;
          border: none;
          border-radius: $component-border-radius-small;
          font-size: 14px;
          font-weight: $font-medium;
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
          padding: $spacing-sm $spacing-lg;
          background: #6b7280;
          color: white;
          border-radius: $component-border-radius-small;
          font-size: 14px;
          font-weight: $font-medium;
        }
      }

      @media (max-width: 768px) {
        flex-direction: column;
        gap: $spacing-md;

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
      padding: $spacing-2xl;
      text-align: center;

      p {
        color: $light-mode-secondary-text;
        font-size: 14px;

        @media (prefers-color-scheme: dark) {
          color: $dark-mode-secondary-text;
        }
      }
    }
  }

  // Empty state styling (inherits from EmptyLayout component)
  button.primary {
    background: #f97316;
    color: white;
    border: none;
    padding: $spacing-md $spacing-2xl;
    border-radius: $component-border-radius;
    font-size: 16px;
    font-weight: $font-medium;
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
