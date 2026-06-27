<script setup lang="ts">
import { ref, computed, reactive, nextTick, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import Sheet from '@/client/components/common/sheet.vue';
import PillButton from '@/client/components/common/pill-button.vue';
import LanguageTabSelector from '@/client/components/common/language-tab-selector.vue';
import SpacesEditor from '@/client/components/logged_in/calendar/SpacesEditor.vue';
import { useLanguageManagement } from '@/client/composables/useLanguageManagement';
import { EventLocationSpace } from '@/common/model/location';

const { t } = useTranslation('event_editor', { keyPrefix: 'create_location' });

const props = withDefaults(defineProps<{
  languages: string[];
  fieldErrors?: Record<string, string>;
  submissionError?: string;
}>(), {
  fieldErrors: () => ({}),
  submissionError: '',
});

const emit = defineEmits<{
  (e: 'create-location', data: any): void;
  (e: 'back-to-search'): void;
  (e: 'add-language'): void;
  (e: 'close'): void;
}>();

// Read-only consumer: parent owns the languages list via props.languages.
// initialLanguages is a one-shot factory invoked once at construction; if
// props.languages changes after mount, the composable will not reflect it.
// Deferred reactive prop-watch to v2 unless smoke (pv-3f2x.3) finds a real
// workflow that exercises it.
const lang = useLanguageManagement({
  initialLanguages: () => props.languages,
});
const accessibilityLangTabs = ref<InstanceType<typeof LanguageTabSelector> | null>(null);
const submissionErrorEl = ref<HTMLElement | null>(null);

watch(() => props.submissionError, async (newVal) => {
  if (newVal) {
    await nextTick();
    submissionErrorEl.value?.focus();
  }
});

// Form state
const formData = reactive({
  name: '',
  address: '',
  city: '',
  state: '',
  postalCode: '',
});

// Accessibility info keyed by language
const accessibilityInfo = reactive<Record<string, string>>({});

// Staged rooms/spaces. Empty by default; the SpacesEditor v-model writes here.
// On submit, the array is mapped to plain objects and stamped onto the
// emitted payload — the atomic Place + Spaces wire contract preserves nested
// spaces[] through EventLocation.fromObject() in useLocationManagement.
const spaces = ref<EventLocationSpace[]>([]);

// Validation
const isValid = computed(() => {
  return formData.name.trim().length > 0;
});

const handleAddLanguage = () => {
  emit('add-language');
};

const handleBackToSearch = () => {
  emit('back-to-search');
};

// SpacesEditor is removal-policy-agnostic: it emits `remove-space` and never
// mutates the array itself. For this brand-new-place flow no persisted Spaces
// exist, so a simple filter (matched on `id || clientId`) is sufficient.
const handleRemoveSpace = (space: EventLocationSpace) => {
  spaces.value = spaces.value.filter(s =>
    (s.id || s.clientId) !== (space.id || space.clientId),
  );
};

const handleSubmit = () => {
  if (!isValid.value) return;

  // Build location data object
  const locationData: any = {
    name: formData.name.trim(),
  };

  // Add optional fields only if they have values
  if (formData.address.trim()) {
    locationData.address = formData.address.trim();
  }
  if (formData.city.trim()) {
    locationData.city = formData.city.trim();
  }
  if (formData.state.trim()) {
    locationData.state = formData.state.trim();
  }
  if (formData.postalCode.trim()) {
    locationData.postalCode = formData.postalCode.trim();
  }

  // Add accessibility content for languages that have info
  const contentWithInfo = Object.entries(accessibilityInfo).filter(
    ([_, info]) => info.trim().length > 0,
  );

  if (contentWithInfo.length > 0) {
    locationData.content = {};
    for (const [lang, info] of contentWithInfo) {
      locationData.content[lang] = {
        accessibilityInfo: info.trim(),
      };
    }
  }

  // Stamp staged rooms onto the payload. Always include `spaces` (even when
  // empty) per the model's stable wire contract — see EventLocation.toObject()
  // which always emits `spaces`. The atomic Place + Spaces wire contract
  // preserves nested spaces[] through EventLocation.fromObject() in
  // useLocationManagement.createLocation().
  locationData.spaces = spaces.value.map(s => s.toObject());

  emit('create-location', locationData);
};
</script>

<template>
  <Sheet
    :title="t('title')"
    @close="emit('close')"
  >
    <div class="create-location-body">
      <section class="form-section">
        <h3 class="section-title">{{ t('basic_info_section') }}</h3>

        <div class="form-field">
          <input
            id="create-location-name"
            v-model="formData.name"
            type="text"
            class="form-input"
            :class="{ 'form-input--error': props.fieldErrors?.name }"
            :placeholder="t('name_placeholder')"
            :aria-label="t('name_aria_label')"
            :aria-invalid="props.fieldErrors?.name ? 'true' : undefined"
            :aria-describedby="props.fieldErrors?.name ? 'create-location-name-error' : undefined"
            required
          />
          <div
            v-if="props.fieldErrors?.name"
            id="create-location-name-error"
            class="form__error"
            role="alert"
            aria-live="polite"
          >
            {{ props.fieldErrors.name }}
          </div>
        </div>

        <div class="form-field">
          <input
            v-model="formData.address"
            type="text"
            class="form-input"
            :placeholder="t('address_placeholder')"
            :aria-label="t('address_placeholder')"
          />
        </div>

        <div class="form-row">
          <input
            v-model="formData.city"
            type="text"
            class="form-input"
            :placeholder="t('city_placeholder')"
            :aria-label="t('city_placeholder')"
          />
          <input
            v-model="formData.state"
            type="text"
            class="form-input form-input--state"
            :placeholder="t('state_placeholder')"
            :aria-label="t('state_placeholder')"
          />
          <input
            v-model="formData.postalCode"
            type="text"
            class="form-input form-input--zip"
            :placeholder="t('postal_code_placeholder')"
            :aria-label="t('postal_code_placeholder')"
          />
        </div>
      </section>

      <section class="form-section">
        <h3 class="section-title">{{ t('accessibility_section') }}</h3>

        <LanguageTabSelector
          ref="accessibilityLangTabs"
          v-model="lang.currentLanguage.value"
          :languages="lang.languages.value"
          @add-language="handleAddLanguage"
        />

        <div
          :id="accessibilityLangTabs?.panelId(lang.currentLanguage.value)"
          role="tabpanel"
          :aria-labelledby="accessibilityLangTabs?.tabId(lang.currentLanguage.value)"
          class="form-field"
        >
          <textarea
            v-model="accessibilityInfo[lang.currentLanguage.value]"
            class="form-textarea"
            :placeholder="t('accessibility_placeholder')"
            :aria-label="t('accessibility_aria_label', { language: lang.currentLanguage.value })"
            rows="4"
          />
        </div>
      </section>

      <section class="form-section">
        <h3 class="section-title">{{ t('spaces_section') }}</h3>
        <SpacesEditor
          v-model:spaces="spaces"
          @remove-space="handleRemoveSpace"
        />
      </section>

      <div
        v-if="props.submissionError"
        ref="submissionErrorEl"
        class="alert alert--error"
        role="alert"
        aria-live="polite"
        tabindex="-1"
      >
        {{ props.submissionError }}
      </div>

      <footer class="modal-actions">
        <PillButton
          variant="ghost"
          size="sm"
          @click="handleBackToSearch"
        >
          {{ t('back_button') }}
        </PillButton>
        <PillButton
          variant="primary"
          size="sm"
          :disabled="!isValid"
          @click="handleSubmit"
        >
          {{ t('submit_button') }}
        </PillButton>
      </footer>
    </div>
  </Sheet>
</template>

<style scoped lang="scss">
@use '../../assets/style/components/event-management' as *;

.create-location-body {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-lg);
  min-height: 0;
}

.form-section {
  .section-title {
    font-size: var(--pav-font-size-sm);
    font-weight: var(--pav-font-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--pav-text-secondary);
    margin: 0 0 var(--pav-space-md) 0;
  }
}

.form-field {
  margin-bottom: var(--pav-space-md);
}

.form-input {
  @include form-input-rounded;
  width: 100%;

  &--error {
    border-color: var(--pav-color-error);
  }

  &--state {
    width: 6rem;
  }

  &--zip {
    width: 8rem;
  }
}

.form-row {
  display: flex;
  gap: var(--pav-space-sm);
  margin-bottom: var(--pav-space-md);

  .form-input {
    flex: 1;
    min-width: 0;

    &--state,
    &--zip {
      flex: 0 0 auto;
    }
  }
}

.form-textarea {
  @include form-input-rounded;
  width: 100%;
  resize: vertical;
  min-height: 6rem;
  font-family: inherit;
}

.modal-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: var(--pav-space-md);
  border-top: var(--pav-border-width-1) solid var(--pav-border-primary);
}
</style>
