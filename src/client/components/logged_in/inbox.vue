<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { useTranslation } from 'i18next-vue';
import EmptyLayout from '@/client/components/common/empty_state.vue';
import { useNotificationStore } from '@/client/stores/notificationStore';
import { useNotificationDisplay } from '@/client/composables/useNotificationDisplay';
import type { NotificationResponse } from '@/client/service/notification';
import HelpButton from '@/client/components/common/help-button.vue';

const { t } = useTranslation('inbox');
const { resolveActorDisplayName } = useNotificationDisplay();
const store = useNotificationStore();

const notifications = computed(() => store.notifications);
const hasMore = computed(() => store.hasMore);
const isLoading = computed(() => store.isLoading);

const sentinelRef = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

/**
 * Returns the translated suffix describing the verb's effect on the object,
 * substituting the object's snapshot label where relevant. Falls back to a
 * generic suffix for verbs that have not yet been localized.
 *
 * `object.label` is treated as plain text everywhere — the inbox template
 * uses `{{ }}` interpolation, never `v-html`, so the server-side snapshot
 * sanitization is defense-in-depth, not the only escape layer.
 */
const getNotificationSuffix = (notification: NotificationResponse): string => {
  switch (notification.verb) {
    case 'Follow':
      return t('notifications.follow_suffix');
    case 'Announce':
      return t('notifications.repost_suffix', { eventId: notification.object.id });
    case 'Flag':
      return t('notifications.flag_suffix', { eventTitle: notification.object.label });
    case 'ReportEscalated':
      return t('notifications.report_escalated_sentence', { eventTitle: notification.object.label });
    case 'ReportResolved':
      return t('notifications.report_resolved_sentence', { eventTitle: notification.object.label });
    case 'EditorInvited':
      return t('notifications.editor_invited_suffix', { calendarName: notification.object.label });
    case 'EditorRevoked':
      return t('notifications.editor_revoked_suffix', { calendarName: notification.object.label });
    default:
      return '';
  }
};

/**
 * Returns `notification.actor.displayUrl` only when it is a safe `https://`
 * URL. Anything else (`javascript:`, `data:`, `http://`, missing scheme)
 * returns `null` so the template hides the anchor and falls back to the
 * plain-text actor name.
 *
 * Defense-in-depth — the server-side Flag anonymization already filters
 * `actor.displayUrl` for Flag rows, but Follow / Announce rows carry
 * remote-supplied URLs through unchanged. A federated peer cannot inject a
 * `javascript:` URL today (`actor_display_url` is populated from the
 * actor's AP profile URL), but a future code path that copies a less
 * trusted field would silently become an XSS sink without this guard.
 */
const safeActorUrl = (notification: NotificationResponse): string | null => {
  const url = notification.actor.displayUrl;
  if (!url) {
    return null;
  }
  return url.startsWith('https://') ? url : null;
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
 * notifications.
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
    <div class="inbox-heading-row">
      <h1 class="inbox-heading">
        {{ t('title') }}
      </h1>
      <HelpButton />
    </div>

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
            v-if="safeActorUrl(notification)"
            :href="safeActorUrl(notification) ?? undefined"
            rel="noopener noreferrer"
            target="_blank"
            class="actor-link"
          >{{ resolveActorDisplayName(notification.actor.displayName) }}<span class="sr-only">{{ t('notifications.opens_in_new_tab') }}</span></a>
          <span
            v-else-if="resolveActorDisplayName(notification.actor.displayName)"
            class="actor-name"
          >{{ resolveActorDisplayName(notification.actor.displayName) }}</span>
          {{ getNotificationSuffix(notification) }}
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
      <p v-if="isLoading">
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

  .inbox-heading-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--pav-space-6) var(--pav-space-4) var(--pav-space-4);
  }

  h1.inbox-heading {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--pav-color-stone-900);
    margin: 0;
    padding: 0;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-100);
    }
  }

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
    // Override the global [aria-live="polite"] off-screen rule — this region is intentionally visible
    position: static;
    left: auto;
    width: auto;
    height: auto;
    overflow: visible;
    padding: var(--pav-space-6);
    text-align: center;

    p {
      color: var(--pav-color-text-secondary);
      font-size: var(--pav-font-size-xs);
    }
  }
}
</style>
