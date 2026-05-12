<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { useTranslation } from 'i18next-vue';
import i18nextInstance from 'i18next';
import EmptyLayout from '@/client/components/common/empty_state.vue';
import { useNotificationStore } from '@/client/stores/notificationStore';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { useEventStore } from '@/client/stores/eventStore';
import CalendarService from '@/client/service/calendar';
import type { Notification } from '@/common/model/notification';

const { t } = useTranslation('inbox');
const store = useNotificationStore();
const calendarStore = useCalendarStore();
const eventStore = useEventStore();
const calendarService = new CalendarService(calendarStore);

const notifications = computed(() => store.notifications);
const hasMore = computed(() => store.hasMore);
const isLoading = computed(() => store.isLoading);

const sentinelRef = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

/**
 * Resolves the human-readable calendar name for a notification.
 * Returns null when the calendar is not loaded in the store (e.g. deleted
 * or store not yet hydrated). Callers must handle that case with a
 * generic fallback phrasing.
 */
const resolveCalendarName = (notification: Notification): string | null => {
  if (!notification.calendarId) {
    return null;
  }
  const calendar = calendarStore.getCalendarById(notification.calendarId);
  if (!calendar) {
    return null;
  }
  const lang = i18nextInstance.resolvedLanguage ?? 'en';
  const name = calendar.content(lang).name || calendar.content('en').name || calendar.urlName;
  return name || null;
};

/**
 * Returns the translated phrase for a follow notification with the actor
 * name left as the `{1}` slot marker for the `<i18next>` component to
 * substitute the actor link or plain span. When the calendar cannot be
 * resolved (deleted or store not loaded), falls back to a generic phrase
 * that omits the calendar name.
 */
const getFollowPhrase = (notification: Notification): string => {
  const calendarName = resolveCalendarName(notification);
  if (calendarName) {
    return t('notifications.follow_description', { calendarName });
  }
  return t('notifications.follow_description_no_calendar');
};

/**
 * Resolves the human-readable event title for a repost notification.
 * Looks up the event in the eventStore by calendarId+eventId. Returns
 * null when the event is not in the store (e.g. event deleted, or the
 * calendar tab has not been visited so events were never loaded). The
 * caller renders a generic fallback phrase in that case.
 */
const resolveEventTitle = (notification: Notification): string | null => {
  if (!notification.calendarId || !notification.eventId) {
    return null;
  }
  const event = eventStore
    .eventsForCalendar(notification.calendarId)
    .find((e) => e.id === notification.eventId);
  if (!event) {
    return null;
  }
  const lang = i18nextInstance.resolvedLanguage ?? 'en';
  const title = event.content(lang).name || event.content('en').name;
  return title || null;
};

/**
 * Returns the translated phrase for a repost notification with the actor
 * name left as the `{1}` slot marker and (when the event title is
 * resolvable) the event title left as the `{2}` slot marker for the
 * `<i18next>` component to substitute the actor link and a RouterLink to
 * the event. When the event cannot be resolved (deleted or store not
 * loaded), falls back to a generic phrase that omits the event title.
 */
const getRepostPhrase = (notification: Notification): string => {
  const eventTitle = resolveEventTitle(notification);
  if (eventTitle) {
    return t('notifications.repost_description', { eventTitle });
  }
  return t('notifications.repost_description_no_event');
};

/**
 * Returns the translated phrase for a local-flow unshare notification. The
 * actor is a local editor who unposted a reposted event (DEC-008 sticky
 * dismissal flow); actorUrl is null on these notifications so the phrase
 * renders the actor name as plain text with Mustache interpolation rather
 * than the slot-based pattern used for follow/repost rows. When the calendar
 * cannot be resolved (deleted or store not loaded), falls back to a generic
 * phrase that omits the calendar name.
 */
const getUnsharePhrase = (notification: Notification): string => {
  const calendarName = resolveCalendarName(notification);
  const actorName = notification.actorName;
  if (calendarName) {
    return t('notifications.unshare_description', { actorName, calendarName });
  }
  return t('notifications.unshare_description_no_calendar', { actorName });
};

/**
 * Returns the translated phrase for an inbound-flow unshare notification.
 * The actor is a remote calendar that unposted our event from their calendar
 * (parallel to repost). The phrase leaves the actor as `{1}` and (when the
 * event title is resolvable) the event title as `{2}` for the `<i18next>`
 * component to substitute the actor link + RouterLink to the event. When the
 * event cannot be resolved (deleted or store not loaded), falls back to a
 * generic phrase that omits the event title.
 */
const getUnshareRemotePhrase = (notification: Notification): string => {
  const eventTitle = resolveEventTitle(notification);
  if (eventTitle) {
    return t('notifications.unshare_description_remote', { eventTitle });
  }
  return t('notifications.unshare_description_remote_no_event');
};

/**
 * Returns the translated phrase for a moderation-report notification.
 * Reporter identity is never surfaced (DEC-004, moderation-privacy) —
 * the phrase is generic across all reporter types. When the calendar
 * cannot be resolved (deleted or store not loaded), falls back to a
 * generic phrase that omits the calendar name.
 *
 * Supported types: report_received, report_verified, report_escalated.
 */
const getReportPhrase = (notification: Notification): string => {
  const calendarName = resolveCalendarName(notification);
  const key = `notifications.${notification.type}`;
  const fallbackKey = `${key}_no_calendar`;
  if (calendarName) {
    return t(key, { calendarName });
  }
  return t(fallbackKey);
};

/**
 * True for any notification type that surfaces a moderation report.
 * Used to route report rows to a generic, reporter-free template path.
 */
const isReportNotification = (notification: Notification): boolean => {
  return notification.type === 'report_received'
    || notification.type === 'report_verified'
    || notification.type === 'report_escalated';
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
 * notifications and clear the unread badge. Also ensure the calendar
 * store is hydrated so notification rows can resolve their calendar
 * name from notification.calendarId.
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

  // Hydrate calendar store so getCalendarById can resolve calendar names.
  // Failure here degrades to the no-calendar fallback phrasing; do not
  // block notification rendering on it.
  try {
    await calendarService.loadCalendars();
  }
  catch {
    // Intentionally ignored — getFollowPhrase falls back gracefully.
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
    <h1 class="inbox-heading">
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
        <p
          v-if="notification.type === 'follow'"
          class="notification-text"
        >
          <i18next :translation="getFollowPhrase(notification)">
            <template #1>
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
            </template>
          </i18next>
        </p>
        <p
          v-else-if="isReportNotification(notification)"
          class="notification-text"
        >
          {{ getReportPhrase(notification) }}
        </p>
        <p
          v-else-if="notification.type === 'unshare' && notification.actorUrl"
          class="notification-text"
        >
          <i18next :translation="getUnshareRemotePhrase(notification)">
            <template #1>
              <a
                :href="notification.actorUrl"
                rel="noopener noreferrer"
                target="_blank"
                class="actor-link"
              >{{ notification.actorName }}<span class="sr-only">{{ t('notifications.opens_in_new_tab') }}</span></a>
            </template>
            <template #2>
              <router-link
                v-if="notification.eventId && resolveEventTitle(notification)"
                :to="{ name: 'event_edit', params: { eventId: notification.eventId } }"
                class="event-link"
              >{{ resolveEventTitle(notification) }}</router-link>
            </template>
          </i18next>
        </p>
        <p
          v-else-if="notification.type === 'unshare'"
          class="notification-text"
        >
          {{ getUnsharePhrase(notification) }}
        </p>
        <p
          v-else
          class="notification-text"
        >
          <i18next :translation="getRepostPhrase(notification)">
            <template #1>
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
            </template>
            <template #2>
              <router-link
                v-if="notification.eventId && resolveEventTitle(notification)"
                :to="{ name: 'event_edit', params: { eventId: notification.eventId } }"
                class="event-link"
              >{{ resolveEventTitle(notification) }}</router-link>
            </template>
          </i18next>
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

  h1.inbox-heading {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--pav-color-stone-900);
    margin: 0;
    padding: var(--pav-space-6) var(--pav-space-4) var(--pav-space-4);

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

      a.actor-link,
      a.event-link {
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
