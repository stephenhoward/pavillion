<template>
  <li class="import-source-row">
    <div class="import-source-row__main">
      <div class="import-source-row__header">
        <span class="import-source-row__url" :title="source.url">{{ source.url }}</span>
        <span
          role="status"
          :class="['import-source-row__badge', `import-source-row__badge--${source.verificationState}`]"
          :aria-label="t('verification_state_label') + ': ' + verificationStateLabel"
        >
          {{ verificationStateLabel }}
        </span>
      </div>

      <p class="import-source-row__last-sync">
        {{ lastSyncLabel }}
      </p>

      <!--
        AP-source double-federation warning.
        TODO(pv-1qcp): the `detected_ap_source` field is not yet available on
        the common ImportSource model; when the server-side detection + field
        are added (see bead pv-1qcp.1.2 addendum), set `apSourceDetected` to
        `source.detectedApSource` so this warning renders automatically.
      -->
      <p
        v-if="apSourceDetected"
        :id="warningId"
        class="import-source-row__warning"
        role="note"
      >
        {{ t('warnings.ap_source_double_federation') }}
      </p>
    </div>

    <div class="import-source-row__actions">
      <button
        v-if="needsVerification"
        type="button"
        class="btn-ghost import-source-row__verify-btn"
        :aria-label="t('verify_aria', { url: source.url })"
        @click="onVerify"
      >
        <ShieldCheck :size="16" :stroke-width="2" aria-hidden="true" />
        {{ t('dns_challenge.verify_button') }}
      </button>
      <button
        type="button"
        class="btn-ghost"
        :disabled="!canSync || isSyncing"
        :title="!canSync ? t('sync_disabled_reason') : undefined"
        :aria-describedby="apSourceDetected ? warningId : undefined"
        @click="onSync"
      >
        <RefreshCw :size="16" :stroke-width="2" aria-hidden="true" />
        {{ t('sync_now') }}
      </button>
      <button
        type="button"
        class="btn-ghost btn-ghost--danger"
        :disabled="isRemoving"
        :aria-label="t('remove_source_aria', { url: source.url })"
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
const warningId = `import-source-warning-${uid}`;

/**
 * Server-side detection of an ActivityPub-federated source (e.g. Mobilizon or
 * Gancio) is planned but the `detectedApSource` field is not yet on the
 * common `ImportSource` model. When that lands, switch this computed to
 * `source.detectedApSource` so the double-federation warning shows
 * automatically. See bead pv-1qcp.3.3 notes.
 */
const apSourceDetected = computed<boolean>(() => {
  const extended = props.source as unknown as { detectedApSource?: boolean };
  return extended.detectedApSource === true;
});

const verificationStateLabel = computed(() =>
  t(`verification_state.${props.source.verificationState}`),
);

const lastSyncLabel = computed(() => {
  if (!props.source.lastFetchedAt) {
    return t('last_sync_never');
  }
  return t('last_sync_at', {
    time: props.source.lastFetchedAt.toLocaleString(),
  });
});

const canSync = computed(() => props.source.verificationState === 'verified');

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
  }

  &__last-sync {
    margin: 0;
    color: var(--pav-color-stone-600);
    font-size: 0.875rem;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }

  &__warning {
    margin: 0;
    padding: var(--pav-space-2) var(--pav-space-3);
    background-color: rgba(234, 179, 8, 0.1);
    border-left: 3px solid var(--pav-color-yellow-500, #eab308);
    border-radius: 0.375rem;
    color: var(--pav-color-stone-800);
    font-size: 0.875rem;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-200);
    }
  }

  &__actions {
    display: flex;
    gap: var(--pav-space-2);
    align-items: center;
    flex-shrink: 0;
  }
}

// Scoped layout for the row's icon+label ghost buttons. The confirmation-modal
// btn-ghost styling comes from admin-dialog-layout via the ImportSourcesSection;
// here the buttons are standalone action icons and need their own layout rules.
.btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: var(--pav-space-1);
  padding: var(--pav-space-2) var(--pav-space-3);
  background: none;
  border: none;
  color: var(--pav-color-stone-600);
  font-weight: 500;
  font-size: 0.875rem;
  cursor: pointer;
  transition: color 0.2s;
  border-radius: 0.375rem;

  &:hover:not(:disabled) {
    color: var(--pav-color-stone-900);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-100);
    }
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &--danger {
    color: var(--pav-color-red-600);

    &:hover:not(:disabled) {
      color: var(--pav-color-red-700);

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-red-400);
      }
    }
  }
}
</style>
