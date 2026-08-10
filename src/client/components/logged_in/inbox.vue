<script setup lang="ts">
import { computed, ref, nextTick, onMounted, onUnmounted } from 'vue';
import { useTranslation } from 'i18next-vue';
import type { RouteLocationRaw } from 'vue-router';
import EmptyLayout from '@/client/components/common/empty_state.vue';
import { useNotificationStore } from '@/client/stores/notificationStore';
import { useNotificationDisplay } from '@/client/composables/useNotificationDisplay';
import { routeFor } from '@/client/service/notification-target';
import type { NotificationResponse } from '@/common/model/notification';
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
 * Text of the visually-hidden status region. Marking a row read is otherwise
 * a silent change for a screen reader: the sentence does not change, and the
 * only visible difference is the row's accent border.
 */
const statusMessage = ref('');

/**
 * Each row's dismiss button, keyed by notification id.
 *
 * The mark-as-read button unmounts the moment its row is marked read, so the
 * element holding focus disappears and focus falls back to `<body>`. The
 * dismiss button is the same row's next focus stop and is present on every
 * row, seen or not, which makes it the one stable place to land.
 */
const dismissButtons = new Map<string, HTMLButtonElement>();

const setDismissRef = (id: string, el: unknown): void => {
  if (el instanceof HTMLButtonElement) {
    dismissButtons.set(id, el);
  }
  else {
    dismissButtons.delete(id);
  }
};

/**
 * Returns the translated sentence describing the verb's effect on the object.
 *
 * Sentences for verbs whose object is linkable still carry the `{1}` slot the
 * `<i18next>` component splices the object link into; the label is never
 * concatenated onto a suffix, because in French the slot sits mid-sentence
 * ("Un signalement concernant {1} a été transmis"). Verbs with no linkable
 * object (`Follow`, `EditorRevoked`) keep their plain suffix wording.
 *
 * `object.label` is treated as plain text everywhere — the inbox template
 * uses `{{ }}` interpolation, never `v-html`, so the server-side snapshot
 * sanitization is defense-in-depth, not the only escape layer.
 */
const notificationSentence = (notification: NotificationResponse): string => {
  switch (notification.verb) {
    case 'Follow':
      return t('notifications.follow_suffix');
    case 'Announce':
      return t('notifications.repost_sentence');
    case 'Flag':
      return t('notifications.flag_sentence');
    case 'ReportEscalated':
      return t('notifications.report_escalated_sentence');
    case 'ReportResolved':
      return t('notifications.report_resolved_sentence');
    case 'EditorInvited':
      return t('notifications.editor_invited_sentence');
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
 * Matches the `{1}` object slot in a sentence, using the same tolerance for
 * inner whitespace as the `<i18next>` component's own slot pattern.
 *
 * Coupling: this is a hand-written mirror of `i18next-vue`'s internal slot
 * regex. If that library changes its slot syntax, this pattern stops matching
 * and `content` silently degrades to a raw `"...{1}..."` string in both
 * buttons' accessible names — nothing here throws. `inbox.test.ts` asserts the
 * rendered label text, so the drift surfaces there rather than in production.
 */
const OBJECT_SLOT_PATTERN = /\{\s*1\s*\}/;

/**
 * Everything one row renders, derived once per notification.
 *
 * The row shows its content in three places — the visible sentence and the
 * accessible names of the two trailing buttons — and all three must say the
 * same thing. Deriving them together means there is one resolution of the
 * actor name (Flag rows carry an `i18n:` anonymisation token, not a real
 * name) and one resolution of the sentence, rather than a render path and a
 * separate label-formatting path that can drift apart.
 */
interface NotificationRow {
  notification: NotificationResponse;
  /** Actor name after i18n-token resolution; empty for system-authored rows. */
  actorName: string;
  /** Safe external profile URL, or null when the actor renders as plain text. */
  actorUrl: string | null;
  /** Sentence for the verb, still carrying the `{1}` slot for the object link. */
  sentence: string;
  /** Where the object link points, or null when the row is not navigable. */
  route: RouteLocationRaw | null;
  /** Plain-text rendering of the row, used verbatim as both buttons' label. */
  content: string;
}

const rows = computed<NotificationRow[]>(() => notifications.value.map((notification) => {
  const actorName = resolveActorDisplayName(notification.actor.displayName);
  const sentence = notificationSentence(notification);
  const rendered = sentence.replace(OBJECT_SLOT_PATTERN, notification.object.label);

  return {
    notification,
    actorName,
    actorUrl: safeActorUrl(notification),
    sentence,
    route: routeFor(notification.object.target),
    content: actorName ? `${actorName} ${rendered}` : rendered,
  };
}));

/**
 * Load more notifications when scroll sentinel becomes visible.
 */
const loadMore = () => {
  if (!isLoading.value && hasMore.value) {
    store.loadMore();
  }
};

/**
 * Accessible name for a row's mark-as-read control.
 *
 * The unread state used to render as a free-floating `sr-only` span, which a
 * screen reader announces as a standalone phrase and a Tab-only user never
 * reaches at all. Composing it into this button's name instead ties the state
 * to the control that acts on it. The button renders on unread rows only, so
 * a read row still conveys no unread state anywhere.
 */
const markSeenLabel = (row: NotificationRow): string => {
  const state = t('notifications.unread_badge');
  const action = t('notifications.mark_seen_aria_label', { content: row.content });
  return `${state}. ${action}`;
};

/**
 * Mark a row as seen. Reached only from the row's mark-as-read button, which
 * renders on unread rows alone; the guard here and the store's own
 * already-seen short-circuit collapse a double activation into one PATCH.
 *
 * Activating the button destroys it, so the two follow-ups exist to keep the
 * change perceivable: focus moves to the same row's dismiss button rather
 * than falling back to `<body>`, and the status region announces the change
 * that is otherwise silent.
 */
const handleSeen = async (notification: NotificationResponse): Promise<void> => {
  if (notification.seen) {
    return;
  }

  try {
    await store.markSeen(notification.id);
  }
  catch {
    // The store logs and leaves the row unread, so the mark-as-read button is
    // still mounted and still holds focus. Nothing to move, nothing to say.
    return;
  }

  // Wait for the button to actually unmount before moving focus off it.
  await nextTick();
  dismissButtons.get(notification.id)?.focus();

  // Clear before setting: marking a second row read writes the same string,
  // and an unchanged live region is not a mutation, so nothing is announced.
  statusMessage.value = '';
  await nextTick();
  statusMessage.value = t('notifications.mark_seen_status');
};

/**
 * Dismiss a row. The store optimistically splices the row out of the
 * local list; the active inbox refreshes immediately. The PATCH runs in
 * the background.
 */
const handleDismiss = (notification: NotificationResponse) => {
  void store.markDismissed(notification.id);
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
      <!--
        The row itself is not interactive: it carries no role, tabindex or
        aria-label, so its links and buttons are the only focus stops and
        none of them nests inside another. Focus order follows DOM order —
        actor, object, mark-as-read, dismiss.

        Note the single literal space between the actor element and
        `<i18next>`: Vue drops a whitespace-only text node that contains a
        newline between two elements, so putting them on separate lines would
        run the actor name into the sentence. `inbox.test.ts` asserts the
        exact rendered text of `p.notification-text` to keep it that way.
      -->
      <li
        v-for="row in rows"
        :key="row.notification.id"
        class="notification-item"
        :class="{ 'notification-item--unread': !row.notification.seen }"
        data-testid="notification-item"
      >
        <p class="notification-text">
          <a
            v-if="row.actorUrl"
            :href="row.actorUrl"
            rel="noopener noreferrer"
            target="_blank"
            class="actor-link"
          >{{ row.actorName }}<span class="sr-only">{{ t('notifications.opens_in_new_tab') }}</span></a>
          <span
            v-else-if="row.actorName"
            class="actor-name"
          >{{ row.actorName }}</span> <i18next :translation="row.sentence">
            <template #1>
              <router-link
                v-if="row.route"
                :to="row.route"
                class="object-link"
              >{{ row.notification.object.label }}</router-link>
              <span
                v-else
                class="object-label"
              >{{ row.notification.object.label }}</span>
            </template>
          </i18next>
        </p>
        <button
          v-if="!row.notification.seen"
          type="button"
          class="mark-seen"
          data-testid="notification-mark-seen"
          :aria-label="markSeenLabel(row)"
          @click="handleSeen(row.notification)"
        >
          <span aria-hidden="true">&check;</span>
        </button>
        <button
          :ref="(el) => setDismissRef(row.notification.id, el)"
          type="button"
          class="dismiss-button"
          data-testid="notification-dismiss"
          :aria-label="t('notifications.dismiss_aria_label', { content: row.content })"
          @click="handleDismiss(row.notification)"
        >
          <span aria-hidden="true">&times;</span>
        </button>
      </li>

      <!-- Scroll sentinel for infinite scroll -->
      <li
        ref="sentinelRef"
        class="scroll-sentinel"
        aria-hidden="true"
        data-testid="scroll-sentinel"
      />
    </ul>

    <!--
      Dedicated, always-empty-until-needed status region. Marking a row read
      changes nothing a screen reader would otherwise voice, and the control
      that was activated no longer exists to report its own new state.
    -->
    <div
      class="sr-only"
      role="status"
      aria-live="polite"
      data-testid="inbox-status"
    >{{ statusMessage }}</div>

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

    // The row is a plain container — no cursor or hover affordance, because
    // nothing about the row itself is clickable. The trailing controls sit in
    // normal flex flow in DOM order, which keeps focus order and RTL layout
    // correct without any positioning.
    li.notification-item {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--pav-space-3);
      padding: var(--pav-space-4);
      margin-bottom: var(--pav-space-3);
      background: var(--pav-color-surface-secondary);
      border: 1px solid var(--pav-color-border-primary);
      border-radius: var(--pav-border-radius-md);
      transition: background 0.2s ease;

      &.notification-item--unread {
        background: var(--pav-color-surface-accent, var(--pav-color-surface-secondary));
        border-inline-start: 3px solid var(--pav-color-interactive-primary);
        font-weight: var(--pav-font-weight-medium);
      }

      p.notification-text {
        flex: 1;
        margin: 0;
        font-size: var(--pav-font-size-sm);
        color: var(--pav-color-text-primary);
        line-height: 1.5;
      }

      // The object link shares the actor link's treatment: both point away
      // from the row, and distinguishing them would signal a difference the
      // row does not have.
      a.actor-link,
      a.object-link {
        color: var(--pav-color-interactive-primary);
        text-decoration: underline;

        &:hover {
          color: var(--pav-color-interactive-primary-hover);
        }
      }

      // Mark-as-read and dismiss are a visually paired set, so they are
      // authored as one rule rather than two blocks that can drift apart in
      // size or hit target.
      button.mark-seen,
      button.dismiss-button {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        min-inline-size: var(--pav-space-8);
        min-block-size: var(--pav-space-8);
        background: transparent;
        border: none;
        padding: var(--pav-space-1) var(--pav-space-2);
        font-size: var(--pav-font-size-lg);
        line-height: 1;
        color: var(--pav-color-text-secondary);
        cursor: pointer;
        border-radius: var(--pav-border-radius-sm);

        &:hover,
        &:focus-visible {
          background: var(--pav-color-surface-primary);
          color: var(--pav-color-text-primary);
        }
      }

      // One focus ring for all four stops in a row, matching the shared
      // theme-aware ring in `@mixin btn-base`.
      a.actor-link,
      a.object-link,
      button.mark-seen,
      button.dismiss-button {
        &:focus-visible {
          outline: var(--pav-border-width-2) solid var(--pav-border-color-focus);
          outline-offset: var(--pav-space-0_5);
          box-shadow: var(--pav-shadow-focus);
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
