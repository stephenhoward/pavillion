<template>
  <div class="import-sources-section">
    <div v-if="state.error" class="alert alert--error" role="alert">
      {{ state.error }}
    </div>

    <LoadingMessage v-if="state.isLoading" :description="t('loading')" />

    <template v-else-if="state.sources.length > 0">
      <AdminSectionHeader
        :title="t('section_title')"
        :description="t('section_description')"
      >
        <template #actions>
          <PillButton variant="primary" @click="openAddForm">
            <Plus :size="20" :stroke-width="2" aria-hidden="true" />
            {{ t('add_button') }}
          </PillButton>
        </template>
      </AdminSectionHeader>

      <!-- List of sources -->
      <ImportSourceList
        :sources="state.sources"
        :removing-id="state.removingId"
        :syncing-id="state.syncingId"
        @remove="confirmRemove"
        @sync="onSync"
        @verify="onVerify"
      />
    </template>

    <!-- Empty state — only the centered notice and add button, no section header -->
    <EmptyLayout
      v-else
      :title="t('empty_title')"
      :description="t('empty_description')"
      :guide="{ slug: 'guides/calendar-owners/ics-import', key: 'ics_import' }"
      :guide-label="t('guide_link')"
    >
      <button type="button" class="btn btn--cta btn--lg" @click="openAddForm">
        <Plus :size="20" :stroke-width="2" aria-hidden="true" />
        {{ t('add_button') }}
      </button>
    </EmptyLayout>

    <!-- Add import source modal -->
    <ModalLayout
      v-if="state.showAddForm"
      :title="t('add_fieldset_legend')"
      size="lg"
      @close="closeAddForm"
    >
      <AddImportSourceForm
        :is-submitting="state.isAdding"
        :error-message="state.addError"
        :autofocus="true"
        @submit="onAddSubmit"
        @cancel="closeAddForm"
      />
    </ModalLayout>

    <!-- Verify ownership wizard -->
    <VerifyOwnershipWizard
      v-if="state.challengeSource"
      :source="state.challengeSource"
      :instance-host="props.instanceHost"
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
          {{ t('confirm_remove_message', { url: state.sourceToRemove.url ?? state.sourceToRemove.originalFilename ?? '' }) }}
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
import { reactive, onMounted, nextTick } from 'vue';
import { useTranslation } from 'i18next-vue';
import { Plus } from 'lucide-vue-next';

import type { ImportSource } from '@/common/model/import_source';
import ImportSourceService, { type ImportRunSummary } from '@/client/service/import_source';
import { importSourceErrorKey } from '@/client/service/import_source_errors';
import PillButton from '@/client/components/common/pill-button.vue';
import ModalLayout from '@/client/components/common/modal.vue';
import EmptyLayout from '@/client/components/common/empty_state.vue';
import LoadingMessage from '@/client/components/common/loading_message.vue';
import AdminSectionHeader from '@/client/components/common/admin-section-header.vue';
import { useToast } from '@/client/composables/useToast';

import ImportSourceList from './ImportSourceList.vue';
import AddImportSourceForm, { type SubmitPayload } from './AddImportSourceForm.vue';
import VerifyOwnershipWizard from './VerifyOwnershipWizard.vue';

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
});

/**
 * Element that triggered the verify-ownership wizard (typically the Verify
 * button in the row, or the Add button via the create-flow). Captured at
 * open time so focus can be restored when the wizard closes, per WCAG 2.4.3
 * Focus Order. The wizard owns its modal chrome but not the trigger
 * relationship — that lives with the section that opens it.
 */
let challengeTrigger: HTMLElement | null = null;

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
};

const closeAddForm = () => {
  if (state.isAdding) {
    return;
  }
  state.showAddForm = false;
  state.addError = null;
};

/**
 * Dispatch the form's discriminated submit to the matching create path.
 * URL sources go through the verify-ownership flow; file sources are imported
 * synchronously with an inline run summary and no wizard. The payload shape
 * (`SubmitPayload`) is imported from AddImportSourceForm so the emit contract
 * stays tied to its source of truth. The `type` field selects between the
 * live-URL create path (which requires ownership verification) and the
 * one-shot file-upload path (which imports immediately and needs no
 * verification).
 */
const onAddSubmit = async (payload: SubmitPayload) => {
  if (payload.type === 'file') {
    await createFileSource(payload.file);
    return;
  }
  await createUrlSource(payload.url);
};

/**
 * Create a new URL-backed import source. On success, prepend to the list,
 * emit `source-added`, and open the DNS-challenge modal so the owner can
 * publish the TXT record immediately (pv-1qcp.3.4).
 */
const createUrlSource = async (url: string) => {
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

/**
 * Build the human-readable summary for a completed file import from the run
 * counters returned by `createSourceFromFile`.
 *
 * NOTE: The API's `run` payload (see `toImportRunSummary`) currently exposes
 * only `eventsCreated` / `eventsUpdated` (plus the per-source
 * `eventsSkippedLocallyEdited` / `eventsDisappeared`). The calendar-wide dedup
 * counters the file path computes — `eventsSkippedSyncManaged` and
 * `eventsPreservedLocalEdits` — are dropped by the wire DTO, so they cannot be
 * surfaced here yet. Wiring them through is a backend follow-up.
 */
const buildImportSummary = (run: ImportRunSummary): string =>
  t('import_success', {
    created: run.eventsCreated,
    updated: run.eventsUpdated,
  });

/**
 * Create a file-backed import source from an uploaded .ics file. The upload
 * imports events synchronously, so there is no ownership wizard — on success
 * we prepend the source and surface a run summary toast.
 */
const createFileSource = async (file: File) => {
  state.isAdding = true;
  state.addError = null;
  try {
    const { source, run } = await service.createSourceFromFile(props.calendarId, file);
    state.sources = [source, ...state.sources];
    state.showAddForm = false;
    emit('source-added', source);
    toast.success(buildImportSummary(run));
  }
  catch (err) {
    console.error('Failed to import calendar file', err);
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
    toast.error(t(importSourceErrorKey(err, 'sync')));
  }
  finally {
    state.syncingId = null;
  }
};

/**
 * Open the verify-ownership wizard for a source. The wizard owns its own
 * challenge-token issuance lifecycle, so the section only needs to record
 * which source is being verified and which element triggered the open so
 * focus can be returned on close.
 *
 * @param source - The source to verify
 * @param trigger - The element that triggered the open (typically the
 *   Verify button row); captured for focus return per WCAG 2.4.3.
 */
const openChallengeModal = (source: ImportSource, trigger: HTMLElement | null = null): void => {
  challengeTrigger = trigger ?? (
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  );
  state.challengeSource = source;
};

/**
 * Close the verify-ownership wizard and return focus to the element that
 * opened it. Focus is restored on the next tick so the wizard's teardown
 * has fully released the focus trap before we reassign focus.
 */
const closeChallengeModal = (): void => {
  state.challengeSource = null;
  const trigger = challengeTrigger;
  challengeTrigger = null;
  if (trigger) {
    nextTick(() => {
      if (trigger.isConnected) {
        trigger.focus();
      }
    });
  }
};

const onVerify = (source: ImportSource): void => {
  // The Verify button is the activeElement at this point because clicks set
  // it as the focused element synchronously. openChallengeModal() captures
  // it via the document.activeElement fallback so we can return focus on
  // close per WCAG 2.4.3.
  openChallengeModal(source);
};

/**
 * Update the row when verification succeeds so the verification badge
 * and action-button visibility immediately reflect the new state. Closing
 * the wizard returns focus to the element that opened it.
 */
const onVerified = (updated: ImportSource): void => {
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
