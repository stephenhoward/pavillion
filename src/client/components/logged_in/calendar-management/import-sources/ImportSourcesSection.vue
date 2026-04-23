<template>
  <div class="import-sources-section">
    <header class="import-sources-section__header">
      <div class="import-sources-section__heading">
        <h2 class="import-sources-section__title">{{ t('section_title') }}</h2>
        <p class="import-sources-section__description">{{ t('section_description') }}</p>
      </div>
      <PillButton
        v-if="!state.showAddForm && state.sources.length > 0"
        variant="primary"
        @click="openAddForm"
      >
        <Plus :size="20" :stroke-width="2" aria-hidden="true" />
        {{ t('add_button') }}
      </PillButton>
    </header>

    <div v-if="state.error" class="alert alert--error" role="alert">
      {{ state.error }}
    </div>

    <LoadingMessage v-if="state.isLoading" :description="t('loading')" />

    <template v-else>
      <!-- Add form (inline, not modal, per bead spec — quick add) -->
      <div v-if="state.showAddForm" class="import-sources-section__add-form-container">
        <AddImportSourceForm
          ref="addFormRef"
          :is-submitting="state.isAdding"
          :error-message="state.addError"
          :autofocus="true"
          @submit="onAddSubmit"
          @cancel="closeAddForm"
        />
      </div>

      <!-- List of sources -->
      <ImportSourceList
        v-if="state.sources.length > 0"
        :sources="state.sources"
        :removing-id="state.removingId"
        :syncing-id="state.syncingId"
        @remove="confirmRemove"
        @sync="onSync"
        @verify="onVerify"
      />

      <!-- Empty state -->
      <EmptyLayout
        v-else-if="!state.showAddForm"
        :title="t('empty_title')"
        :description="t('empty_description')"
      >
        <PillButton variant="primary" @click="openAddForm">
          <Plus :size="20" :stroke-width="2" aria-hidden="true" />
          {{ t('add_button') }}
        </PillButton>
      </EmptyLayout>
    </template>

    <!-- DNS challenge modal -->
    <DnsChallengeModal
      v-if="state.challengeSource"
      :source="state.challengeSource"
      :instance-host="props.instanceHost"
      :challenge-token="state.challengeToken"
      @verified="onVerified"
      @close="closeChallengeModal"
    />

    <!-- Remove confirmation modal -->
    <ModalLayout
      v-if="state.sourceToRemove"
      :title="t('confirm_remove_title')"
      @close="cancelRemove"
    >
      <div class="confirmation-modal">
        <p>
          {{ t('confirm_remove_message', { url: state.sourceToRemove.url }) }}
        </p>
        <div class="confirmation-modal__actions">
          <button
            type="button"
            class="btn-ghost"
            :disabled="state.removingId === state.sourceToRemove.id"
            @click="cancelRemove"
          >
            {{ t('cancel_button') }}
          </button>
          <PillButton
            variant="danger"
            :disabled="state.removingId === state.sourceToRemove.id"
            @click="executeRemove"
          >
            {{ state.removingId === state.sourceToRemove.id ? t('removing') : t('remove') }}
          </PillButton>
        </div>
      </div>
    </ModalLayout>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue';
import { useTranslation } from 'i18next-vue';
import { Plus } from 'lucide-vue-next';

import type { ImportSource } from '@/common/model/import_source';
import ImportSourceService from '@/client/service/import_source';
import PillButton from '@/client/components/common/pill-button.vue';
import ModalLayout from '@/client/components/common/modal.vue';
import EmptyLayout from '@/client/components/common/empty_state.vue';
import LoadingMessage from '@/client/components/common/loading_message.vue';
import { useToast } from '@/client/composables/useToast';

import ImportSourceList from './ImportSourceList.vue';
import AddImportSourceForm from './AddImportSourceForm.vue';
import DnsChallengeModal from './DnsChallengeModal.vue';

const props = withDefaults(defineProps<{
  calendarId: string;
  /**
   * Instance host for the `pavillion-verify=v1:{host}:{token}` TXT record
   * value shown in the DNS challenge modal. Populated from config/site
   * metadata by the calendar management route; the default is the
   * browser-visible hostname so the modal still renders something
   * sensible in isolated test mounts.
   */
  instanceHost?: string;
}>(), {
  instanceHost: () =>
    typeof window !== 'undefined' ? window.location.host : '',
});

const emit = defineEmits<{
  (event: 'source-added', source: ImportSource): void;
  (event: 'sync-requested', source: ImportSource): void;
}>();

const { t } = useTranslation('calendars', { keyPrefix: 'import' });
const toast = useToast();

const service = new ImportSourceService();

const state = reactive({
  sources: [] as ImportSource[],
  isLoading: false,
  error: null as string | null,
  showAddForm: false,
  isAdding: false,
  addError: null as string | null,
  sourceToRemove: null as ImportSource | null,
  removingId: null as string | null,
  syncingId: null as string | null,
  challengeSource: null as ImportSource | null,
  challengeToken: '',
});

const addFormRef = ref<InstanceType<typeof AddImportSourceForm> | null>(null);

/**
 * Load the full list of import sources for this calendar.
 */
const loadSources = async () => {
  state.isLoading = true;
  state.error = null;
  try {
    state.sources = await service.listSources(props.calendarId);
  }
  catch (err) {
    console.error('Failed to load import sources', err);
    state.error = t('error_loading');
  }
  finally {
    state.isLoading = false;
  }
};

const openAddForm = () => {
  state.showAddForm = true;
  state.addError = null;
  addFormRef.value?.reset();
};

const closeAddForm = () => {
  if (state.isAdding) {
    return;
  }
  state.showAddForm = false;
  state.addError = null;
};

/**
 * Create a new import source. On success, prepend to the list, emit
 * `source-added`, and open the DNS-challenge modal so the owner can
 * publish the TXT record immediately (pv-1qcp.3.4).
 */
const onAddSubmit = async (url: string) => {
  state.isAdding = true;
  state.addError = null;
  try {
    const created = await service.createSource(props.calendarId, url);
    state.sources = [created, ...state.sources];
    state.showAddForm = false;
    emit('source-added', created);
    openChallengeModal(created);
  }
  catch (err) {
    console.error('Failed to create import source', err);
    state.addError = (err as Error)?.message || t('error_creating');
  }
  finally {
    state.isAdding = false;
  }
};

const confirmRemove = (source: ImportSource) => {
  state.sourceToRemove = source;
};

const cancelRemove = () => {
  if (state.removingId) {
    return;
  }
  state.sourceToRemove = null;
};

const executeRemove = async () => {
  const target = state.sourceToRemove;
  if (!target) {
    return;
  }
  state.removingId = target.id;
  try {
    await service.deleteSource(props.calendarId, target.id);
    state.sources = state.sources.filter(s => s.id !== target.id);
    state.sourceToRemove = null;
  }
  catch (err) {
    console.error('Failed to remove import source', err);
    state.error = t('error_removing');
  }
  finally {
    state.removingId = null;
  }
};

/**
 * Trigger a manual sync for a verified source. Surfaces results via
 * toast notifications and refreshes the row's timestamp/status on
 * success. Also emits `sync-requested` for parent observability (kept
 * for backwards compatibility with pv-1qcp.3.3's contract).
 */
const onSync = async (source: ImportSource) => {
  if (state.syncingId) {
    return;
  }
  emit('sync-requested', source);
  state.syncingId = source.id;
  try {
    const summary = await service.syncSource(props.calendarId, source.id);
    // Re-fetch the specific source to pick up updated lastFetchedAt /
    // lastStatus fields that the service mutates alongside the run.
    try {
      const refreshed = await service.getSource(props.calendarId, source.id);
      state.sources = state.sources.map(s =>
        (s.id === source.id ? refreshed : s),
      );
    }
    catch (refreshErr) {
      // Row refresh is best-effort; the sync itself already succeeded.
      console.warn('Sync refresh failed', refreshErr);
    }

    const hasChanges = summary.eventsCreated > 0 || summary.eventsUpdated > 0;
    if (hasChanges) {
      toast.success(
        t('sync_success', {
          created: summary.eventsCreated,
          updated: summary.eventsUpdated,
        }),
      );
    }
    else {
      toast.success(t('sync_success_no_changes'));
    }
  }
  catch (err) {
    console.error('Failed to sync import source', err);
    toast.error(errorMessageForSync(err));
  }
  finally {
    state.syncingId = null;
  }
};

/**
 * Map a sync error to a sanitized i18n-backed message. Falls back to a
 * generic message so the user never sees raw error objects or backend
 * resolver detail.
 */
const errorMessageForSync = (err: unknown): string => {
  const name = (err as { name?: string })?.name;
  switch (name) {
    case 'ImportSourceFetchError': return t('errors.fetch_error');
    case 'ImportSourceSsrfBlockedError': return t('errors.ssrf_blocked');
    case 'ImportSourceParseError': return t('errors.parse_error');
    case 'ImportSourceVerifyRateLimitError': return t('errors.rate_limited');
    default: return t('errors.unknown_sync');
  }
};

/**
 * Open the DNS challenge modal for a source. The challenge token is
 * owner-only data surfaced by the verify-issue endpoint; we render the
 * modal immediately with an empty token and replace it in-place once the
 * server responds so the modal stays responsive while the request is in
 * flight.
 */
const openChallengeModal = async (source: ImportSource) => {
  state.challengeSource = source;
  state.challengeToken = '';
  try {
    const token = await service.issueChallenge(props.calendarId, source.id);
    // Guard against the modal being closed mid-flight.
    if (state.challengeSource?.id === source.id) {
      state.challengeToken = token;
    }
  }
  catch (err) {
    console.error('Failed to load DNS challenge token', err);
    // Leave token empty; the modal still renders the record name so the
    // user has something to copy, and the action buttons remain active.
  }
};

const closeChallengeModal = () => {
  state.challengeSource = null;
  state.challengeToken = '';
};

const onVerify = (source: ImportSource) => {
  openChallengeModal(source);
};

/**
 * Update the row when verification succeeds so the verification badge
 * and action-button visibility immediately reflect the new state.
 */
const onVerified = (updated: ImportSource) => {
  state.sources = state.sources.map(s =>
    (s.id === updated.id ? updated : s),
  );
  closeChallengeModal();
};

onMounted(loadSources);

defineExpose({ state, loadSources });
</script>

<style scoped lang="scss">
@use '../../../../assets/style/components/calendar-admin' as *;

.import-sources-section {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4);
  padding: var(--pav-space-4) 0;

  @media (min-width: 640px) {
    padding: var(--pav-space-6) 0;
  }

  &__header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--pav-space-4);
    flex-wrap: wrap;
  }

  &__heading {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-1);
    min-width: 0;
  }

  &__title {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--pav-color-stone-900);
    margin: 0;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-100);
    }
  }

  &__description {
    margin: 0;
    color: var(--pav-color-stone-600);
    font-size: 0.875rem;
    max-width: 36rem;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }

  &__add-form-container {
    background: var(--pav-surface-primary);
    border: 1px solid var(--pav-border-primary);
    border-radius: 0.75rem;
    padding: var(--pav-space-4);

    @media (min-width: 640px) {
      padding: var(--pav-space-6);
    }

    @media (prefers-color-scheme: dark) {
      background: var(--pav-color-stone-900);
      border-color: var(--pav-color-stone-800);
    }
  }
}

.confirmation-modal {
  @include admin-dialog-layout;

  p {
    margin: 0 0 var(--pav-space-6) 0;
    color: var(--pav-text-primary);
    line-height: 1.5;
  }

  &__actions {
    display: flex;
    gap: var(--pav-space-3);
    justify-content: flex-end;
    margin-top: var(--pav-space-4);
    padding-top: var(--pav-space-4);
    border-top: 1px solid var(--pav-border-primary);
  }
}
</style>
