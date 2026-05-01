<script setup lang="ts">
import { ref, computed, reactive } from 'vue';
import { useTranslation } from 'i18next-vue';
import Sheet from '@/client/components/common/Sheet.vue';
import PillButton from '@/client/components/common/pill-button.vue';
import LanguageTabSelector from '@/client/components/common/language-tab-selector.vue';

const { t } = useTranslation('event_editor', { keyPrefix: 'create_location' });

const props = defineProps<{
  languages: string[];
}>();

const emit = defineEmits<{
  (e: 'create-location', data: any): void;
  (e: 'back-to-search'): void;
  (e: 'add-language'): void;
  (e: 'close'): void;
}>();

const currentLanguage = ref(props.languages[0] || 'en');
const accessibilityLangTabs = ref<InstanceType<typeof LanguageTabSelector> | null>(null);

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
            v-model="formData.name"
            type="text"
            class="form-input"
            :placeholder="t('name_placeholder')"
            :aria-label="t('name_aria_label')"
            required
          />
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
          v-model="currentLanguage"
          :languages="languages"
          @add-language="handleAddLanguage"
        />

        <div
          :id="accessibilityLangTabs?.panelId(currentLanguage)"
          role="tabpanel"
          :aria-labelledby="accessibilityLangTabs?.tabId(currentLanguage)"
          class="form-field"
        >
          <textarea
            v-model="accessibilityInfo[currentLanguage]"
            class="form-textarea"
            :placeholder="t('accessibility_placeholder')"
            :aria-label="t('accessibility_aria_label', { language: currentLanguage })"
            rows="4"
          />
        </div>
      </section>

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
