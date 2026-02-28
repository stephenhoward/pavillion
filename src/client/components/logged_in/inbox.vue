<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { useTranslation } from 'i18next-vue';
import EmptyLayout from '@/client/components/common/empty_state.vue';
import { useNotificationStore } from '@/client/stores/notificationStore';
import type { Notification } from '@/common/model/notification';

const { t } = useTranslation('inbox');
const store = useNotificationStore();

const notifications = computed(() => store.notifications);
const hasMore = computed(() => store.hasMore);
const isLoading = computed(() => store.isLoading);

const sentinelRef = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

/**
 * Returns the translated description text for a notification, excluding actor name.
 */
const getNotificationSuffix = (notification: Notification): string => {
  if (notification.type === 'follow') {
    return t('notifications.follow_suffix');
  }
  if (notification.type === 'repost') {
    return t('notifications.repost_suffix', { eventId: notification.eventId ?? '' });
  }
  return '';
};

/**
 * Load more notifications when scroll sentinel becomes visible.
 */
const loadMore = () => {
  if (!isLoading.value && hasMore.value) {
    store.loadMore();
  }
};

/**
 * Setup Intersection Observer for infinite scroll, then load initial
 * notifications and clear the unread badge.
 */
onMounted(async () => {
  if (sentinelRef.value) {
    observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
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
  }

  await store.fetchNotifications();
  await store.markAllSeen();
});

/**
 * Cleanup Intersection Observer on unmount.
 */
onUnmounted(() => {
  if (observer && sentinelRef.value) {
    observer.unobserve(sentinelRef.value);
    observer.disconnect();
  }
});
</script>

<template>
  <div class="inbox-container">
    <h1 class="sr-only">
      {{ t('title') }}
    </h1>

    <ul
      v-if="notifications.length"
      class="notifications-list"
    >
      <li
        v-for="notification in notifications"
        :key="notification.id"
        class="notification-item"
        data-testid="notification-item"
      >
        <p class="notification-text">
          <a
            v-if="notification.actorUrl"
            :href="notification.actorUrl"
            rel="noopener noreferrer"
            target="_blank"
            class="actor-link"
          >{{ notification.actorName }}<span class="sr-only">{{ t('notifications.opens_in_new_tab') }}</span></a>
          <span
            v-else
            class="actor-name"
          >{{ notification.actorName }}</span>
          {{ ' ' + getNotificationSuffix(notification) }}
        </p>
      </li>

      <!-- Scroll sentinel for infinite scroll -->
      <li
        ref="sentinelRef"
        class="scroll-sentinel"
        aria-hidden="true"
        data-testid="scroll-sentinel"
      />
    </ul>

    <!-- Loading indicator (persistent aria-live region) -->
    <div
      class="loading-indicator"
      aria-live="polite"
      aria-atomic="true"
    >
      <p v-show="isLoading">
        {{ t('notifications.loading_more') }}
      </p>
    </div>

    <!-- Empty state -->
    <EmptyLayout
      v-if="!notifications.length && !isLoading"
      :title="t('notifications.empty_state')"
    />
  </div>
</template>

<style scoped lang="scss">
div.inbox-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;

  ul.notifications-list {
    flex: 1;
    padding: var(--pav-space-4);
    list-style: none;
    margin: 0;

    li.notification-item {
      padding: var(--pav-space-4);
      margin-bottom: var(--pav-space-3);
      background: var(--pav-color-surface-secondary);
      border: 1px solid var(--pav-color-border-primary);
      border-radius: var(--pav-border-radius-md);
      transition: box-shadow 0.2s ease;

      &:hover {
        box-shadow: var(--pav-shadow-sm);
      }

      p.notification-text {
        margin: 0;
        font-size: var(--pav-font-size-sm);
        color: var(--pav-color-text-primary);
        line-height: 1.5;
      }

      a.actor-link {
        color: var(--pav-color-text-link);
        text-decoration: underline;

        &:hover {
          color: var(--pav-color-text-link-hover);
        }
      }
    }

    li.scroll-sentinel {
      height: 1px;
      width: 100%;
    }
  }

  div.loading-indicator {
    padding: var(--pav-space-6);
    text-align: center;

    p {
      color: var(--pav-color-text-secondary);
      font-size: var(--pav-font-size-xs);
    }
  }
}
</style>
