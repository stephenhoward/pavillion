<template>
  <li class="import-source-row">
    <div class="import-source-row__main">
      <div class="import-source-row__header">
        <!--
          `sourceLabel` is the source's display name: the feed URL for `url`
          sources, or the uploaded filename for `file` sources. `original_filename`
          is attacker-controlled (a user-supplied upload name) — it is rendered
          via normal mustache interpolation, which Vue HTML-escapes. NEVER switch
          this to v-html.
        -->
        <span class="import-source-row__url" :title="sourceLabel">{{ sourceLabel }}</span>
        <!--
          File sources carry a static 'File' badge in place of a verification
          badge — a one-shot upload has no ongoing ownership to verify.
        -->
        <span
          v-if="isFileSource"
          class="import-source-row__badge import-source-row__badge--file"
        >
          {{ t('file_badge') }}
        </span>
        <!--
          Verification state is static on render (not a live-updating status
          message), so role='status' would over-promise to assistive tech.
          A plain span with aria-label conveys the same information without
          triggering live-region announcements. Matches project
          accessibility.md guidance on ARIA use only when semantic HTML is
          insufficient.
        -->
        <span
          v-else
          :class="['import-source-row__badge', `import-source-row__badge--${source.verificationState}`]"
          :aria-label="t('verification_badge_aria', { state: verificationStateLabel })"
        >
          {{ verificationStateLabel }}
        </span>
      </div>

      <p class="import-source-row__last-sync">
        {{ lastSyncLabel }}
      </p>
    </div>

    <div class="import-source-row__actions">
      <button
        v-if="!isFileSource && needsVerification"
        type="button"
        class="btn-ghost import-source-row__verify-btn"
        :aria-label="t('verify_aria', { url: sourceLabel })"
        @click="onVerify"
      >
        <ShieldCheck :size="16" :stroke-width="2" aria-hidden="true" />
        {{ t('dns_challenge.verify_button') }}
      </button>
      <!--
        Sync Now is only meaningful for live URL feeds. File sources are a
        one-shot import with no feed to re-poll, so the button (and its
        disabled-reason description) are omitted entirely.

        sr-only description explains *why* the Sync Now button is disabled.
        The `title` attribute alone is not exposed by many screen readers; an
        aria-describedby reference on the button is the recommended pattern
        (WCAG SC 4.1.2 Name, Role, Value).
      -->
      <span
        v-if="!isFileSource && !canSync"
        :id="syncDisabledDescId"
        class="sr-only"
      >
        {{ t('sync_disabled_description') }}
      </span>
      <button
        v-if="!isFileSource"
        type="button"
        class="btn-ghost"
        :disabled="!canSync || isSyncing"
        :aria-disabled="!canSync || isSyncing"
        :aria-label="t('sync_aria', { url: sourceLabel })"
        :aria-describedby="syncAriaDescribedBy"
        @click="onSync"
      >
        <RefreshCw :size="16" :stroke-width="2" aria-hidden="true" />
        {{ t('sync_now') }}
      </button>
      <button
        type="button"
        class="btn-ghost btn-ghost--danger"
        :disabled="isRemoving"
        :aria-label="t('remove_source_aria', { url: sourceLabel })"
        @click="onRemove"
      >
        <Trash2 :size="16" :stroke-width="2" aria-hidden="true" />
        {{ isRemoving ? t('removing') : t('remove') }}
      </button>
    </div>
  </li>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import { RefreshCw, ShieldCheck, Trash2 } from 'lucide-vue-next';

import type { ImportSource } from '@/common/model/import_source';

const props = defineProps<{
  source: ImportSource;
  isRemoving?: boolean;
  isSyncing?: boolean;
}>();

const emit = defineEmits<{
  (event: 'remove', source: ImportSource): void;
  (event: 'sync', source: ImportSource): void;
  (event: 'verify', source: ImportSource): void;
}>();

const { t } = useTranslation('calendars', { keyPrefix: 'import' });

const uid = Math.random().toString(36).slice(2, 10);
const syncDisabledDescId = `import-source-sync-disabled-${uid}`;

/**
 * A file-backed source (`source_type === 'file'`) is a one-shot .ics upload:
 * it has no live URL to poll and no ownership to verify, so its row renders a
 * filename + 'File' badge and hides the Sync/Verify actions.
 */
const isFileSource = computed(() => props.source.sourceType === 'file');

/**
 * Display name for the source: the feed URL for `url` sources, or the uploaded
 * filename for `file` sources. Used for the visible label plus the row's
 * action aria-labels. Rendered via mustache interpolation only (never v-html)
 * because `originalFilename` is attacker-controlled.
 */
const sourceLabel = computed(() =>
  (isFileSource.value ? props.source.originalFilename : props.source.url) ?? '',
);

const verificationStateLabel = computed(() =>
  t(`verification_state.${props.source.verificationState}`),
);

const lastSyncLabel = computed(() => {
  if (!props.source.lastFetchedAt) {
    return t('last_sync_never');
  }
  const time = props.source.lastFetchedAt.toLocaleString();
  // A file source is a one-shot upload, not a polled feed — label its
  // timestamp "Imported" rather than "Last synced" to match the File badge
  // and the hidden Sync/Verify actions.
  return isFileSource.value
    ? t('imported_at', { time })
    : t('last_sync_at', { time });
});

const canSync = computed(() => props.source.verificationState === 'verified');

const syncAriaDescribedBy = computed<string | undefined>(() =>
  canSync.value ? undefined : syncDisabledDescId,
);

/**
 * Show the Verify button whenever the source is not currently verified.
 * The DNS challenge UX (pv-1qcp.3.4) renders the one-click entry point
 * into the modal that walks the owner through publishing the TXT record.
 */
const needsVerification = computed(() =>
  props.source.verificationState !== 'verified',
);

const onRemove = () => {
  if (!props.isRemoving) {
    emit('remove', props.source);
  }
};

const onSync = () => {
  if (canSync.value && !props.isSyncing) {
    emit('sync', props.source);
  }
};

const onVerify = () => {
  emit('verify', props.source);
};
</script>

<style scoped lang="scss">
@use '../../../../assets/style/components/calendar-admin' as *;
@use '../../../../assets/style/mixins/visibility' as *;

// Visually hide descriptive text while keeping it accessible to screen
// readers. Used for the Sync Now disabled-reason description so the
// reason is announced via aria-describedby even though only the label
// "Sync now" is visible on screen (WCAG SC 4.1.2).
.sr-only {
  @include sr-only;
}

.import-source-row {
  display: flex;
  align-items: flex-start;
  gap: var(--pav-space-4);
  padding: var(--pav-space-4);
  background: var(--pav-surface-primary);
  border: 1px solid var(--pav-border-primary);
  border-radius: 0.75rem;

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-900);
    border-color: var(--pav-color-stone-800);
  }

  &__main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-2);
  }

  &__header {
    display: flex;
    align-items: center;
    gap: var(--pav-space-3);
    flex-wrap: wrap;
  }

  &__url {
    font-weight: 500;
    color: var(--pav-color-stone-900);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-100);
    }
  }

  &__badge {
    display: inline-flex;
    align-items: center;
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;

    &--unverified,
    &--pending {
      background-color: rgba(234, 179, 8, 0.1);
      color: var(--pav-color-yellow-700, #a16207);

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-yellow-400, #facc15);
      }
    }

    &--verified {
      background-color: rgba(34, 197, 94, 0.1);
      color: var(--pav-color-green-700);

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-green-400);
      }
    }

    &--expired {
      background-color: rgba(239, 68, 68, 0.1);
      color: var(--pav-color-red-700);

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-red-400);
      }
    }

    // File sources are one-shot uploads with no verification lifecycle, so
    // their badge uses a neutral (non-status) tone.
    &--file {
      background-color: rgba(120, 113, 108, 0.1);
      color: var(--pav-color-stone-700);

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-stone-300);
      }
    }
  }

  &__last-sync {
    margin: 0;
    color: var(--pav-color-stone-600);
    font-size: 0.875rem;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }

  &__actions {
    display: flex;
    gap: var(--pav-space-2);
    align-items: center;
    flex-shrink: 0;
  }
}

.btn-ghost {
  @include admin-ghost-button;
}
</style>
