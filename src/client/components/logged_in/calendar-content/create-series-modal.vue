<template>
  <ModalLayout
    :title="t('add_series_title')"
    size="lg"
    @close="$emit('close')"
  >
    <div class="create-series">
      <div
        v-if="state.error"
        class="alert alert--error"
        role="alert"
        aria-live="polite"
      >
        {{ state.error }}
      </div>

      <SeriesDetailsForm
        ref="detailsForm"
        :series="series"
        :disabled="state.isSaving"
        @submit="saveSeries"
      />

      <div class="form-actions">
        <button
          type="button"
          class="btn btn--ghost"
          data-test="create-series-cancel"
          @click="$emit('close')"
          :disabled="state.isSaving"
        >
          {{ t('cancel_button') }}
        </button>
        <PillButton
          variant="primary"
          data-test="create-series-submit"
          @click="saveSeries"
          :disabled="state.isSaving || !canSave()"
        >
          {{ state.isSaving ? t('creating') : t('create_button') }}
        </PillButton>
      </div>
    </div>
  </ModalLayout>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import SeriesService from '@/client/service/series';
import { seriesSaveErrorKey } from '@/client/composables/seriesSaveErrorKey';
import ModalLayout from '@/client/components/common/modal.vue';
import PillButton from '@/client/components/common/pill-button.vue';
import SeriesDetailsForm from './series-details-form.vue';

/**
 * Compact create-only series dialog for use away from the series
 * management page (currently the event editor's series selector). Renders
 * the shared details form without the image section; images are managed
 * from calendar management after creation.
 */
const emit = defineEmits(['close', 'saved']);

const props = defineProps({
  series: {
    type: Object, // EventSeries — a fresh, unsaved instance
    required: true,
  },
});

const { t } = useTranslation('series', {
  keyPrefix: 'management',
});

const seriesService = new SeriesService();
const detailsForm = ref(null);

const state = reactive({
  isSaving: false,
  error: '',
});

function canSave() {
  return detailsForm.value?.canSave() ?? false;
}

async function saveSeries() {
  if (!canSave()) return;

  state.isSaving = true;
  state.error = '';

  try {
    const savedSeries = await seriesService.saveSeries(props.series);
    emit('saved', savedSeries);
    emit('close');
  }
  catch (error) {
    const key = seriesSaveErrorKey(error, true);
    if (key === 'error_create_series') {
      console.error('Error creating series:', error);
    }
    state.error = t(key);
  }
  finally {
    state.isSaving = false;
  }
}
</script>

<style lang="scss" scoped>
.create-series {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4);
}

.form-actions {
  display: flex;
  gap: var(--pav-space-3);
  justify-content: flex-end;
  margin-top: var(--pav-space-4);
  padding-top: var(--pav-space-4);
  border-top: 1px solid var(--pav-border-primary);
}

</style>
