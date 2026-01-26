<script setup lang="ts">
import { ref, computed, reactive } from 'vue';
import PillButton from '@/client/components/common/PillButton.vue';
import LanguageTabSelector from '@/client/components/common/LanguageTabSelector.vue';

/**
 * CreateLocationForm Component
 *
 * Form dialog for creating a new location with basic information and
 * multilingual accessibility details.
 *
 * Features:
 * - Basic location fields: name (required), address, city, state, postal code
 * - Language tabs for adding accessibility information in multiple languages
 * - Form validation requiring at least a location name
 * - Back button to return to location search
 * - Uses form-input-rounded styling for consistent design
 *
 * @component
 *
 * Props:
 * @prop {string[]} languages - Array of language codes for multilingual content (e.g., ['en', 'es'])
 *
 * Emits:
 * @emits create-location - Fired when user submits the form with valid data
 *   @param {object} data - Location data including name, address, city, state, postalCode, and content object with accessibility info per language
 * @emits back-to-search - Fired when user clicks "Back to Search" button
 * @emits add-language - Fired when user requests to add a new language tab
 * @emits close - Fired when user closes the modal dialog
 */

const props = defineProps<{
  languages: string[];
}>();

const emit = defineEmits<{
  (e: 'create-location', data: any): void;
  (e: 'back-to-search'): void;
  (e: 'add-language'): void;
  (e: 'close'): void;
}>();

const dialogRef = ref<HTMLDialogElement | null>(null);
const currentLanguage = ref(props.languages[0] || 'en');

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

const handleLanguageChange = (lang: string) => {
  currentLanguage.value = lang;
};

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

const close = () => {
  if (dialogRef.value) {
    dialogRef.value.close();
    emit('close');
  }
};

// Expose methods to parent
defineExpose({ close, dialogRef });
</script>

<template>
  <dialog
    ref="dialogRef"
    class="create-location-form"
    aria-labelledby="create-location-title"
    aria-modal="true"
    @click.self="close"
  >
    <div class="modal-content">
      <!-- Header -->
      <header class="modal-header">
        <h2 id="create-location-title">Create Location</h2>
        <button
          type="button"
          class="close-button"
          @click="close"
          aria-label="Close dialog"
        >
          &times;
        </button>
      </header>

      <!-- Form -->
      <div class="form-body">
        <!-- Basic Information Section -->
        <section class="form-section">
          <h3 class="section-title">Basic Information</h3>

          <div class="form-field">
            <input
              v-model="formData.name"
              type="text"
              class="form-input"
              placeholder="Location name *"
              aria-label="Location name (required)"
              required
            />
          </div>

          <div class="form-field">
            <input
              v-model="formData.address"
              type="text"
              class="form-input"
              placeholder="Street address"
              aria-label="Street address"
            />
          </div>

          <div class="form-row">
            <input
              v-model="formData.city"
              type="text"
              class="form-input"
              placeholder="City"
              aria-label="City"
            />
            <input
              v-model="formData.state"
              type="text"
              class="form-input form-input--state"
              placeholder="State"
              aria-label="State"
            />
            <input
              v-model="formData.postalCode"
              type="text"
              class="form-input form-input--zip"
              placeholder="Postal code"
              aria-label="Postal code"
            />
          </div>
        </section>

        <!-- Accessibility Information Section -->
        <section class="form-section">
          <h3 class="section-title">Accessibility Information</h3>

          <LanguageTabSelector
            v-model="currentLanguage"
            :languages="languages"
            @add-language="handleAddLanguage"
          />

          <div class="form-field">
            <textarea
              v-model="accessibilityInfo[currentLanguage]"
              class="form-textarea"
              placeholder="Accessibility information (optional)"
              :aria-label="`Accessibility information in ${currentLanguage}`"
              rows="4"
            />
          </div>
        </section>
      </div>

      <!-- Footer -->
      <footer class="modal-footer">
        <PillButton
          variant="ghost"
          size="sm"
          @click="handleBackToSearch"
        >
          Back to search
        </PillButton>
        <PillButton
          variant="primary"
          size="sm"
          :disabled="!isValid"
          @click="handleSubmit"
        >
          Create Location
        </PillButton>
      </footer>
    </div>
  </dialog>
</template>

<style scoped lang="scss">
@use '../../assets/style/components/event-management' as *;

.create-location-form {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  overflow: auto;
  z-index: 1000;

  &::backdrop {
    background-color: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
  }

  &[open] {
    display: flex;
    align-items: center;
    justify-content: center;
  }
}

.modal-content {
  background: white;
  border-radius: 0.75rem;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  width: 90vw;
  max-width: 42rem;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--pav-color-stone-200);

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-800);
    border-color: var(--pav-color-stone-700);
  }
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid var(--pav-color-stone-200);

  @media (prefers-color-scheme: dark) {
    border-bottom-color: var(--pav-color-stone-700);
  }

  h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0;
    color: var(--pav-color-stone-900);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-100);
    }
  }

  .close-button {
    background: transparent;
    border: none;
    font-size: 2rem;
    line-height: 1;
    color: var(--pav-color-stone-500);
    cursor: pointer;
    padding: 0;
    width: 2rem;
    height: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.25rem;
    transition: all 0.15s ease;

    &:hover {
      background: var(--pav-color-stone-100);
      color: var(--pav-color-stone-700);

      @media (prefers-color-scheme: dark) {
        background: var(--pav-color-stone-700);
        color: var(--pav-color-stone-300);
      }
    }

    &:focus-visible {
      outline: 2px solid var(--pav-color-orange-500);
      outline-offset: 2px;
    }
  }
}

.form-body {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
  min-height: 0;
}

.form-section {
  margin-bottom: 2rem;

  &:last-child {
    margin-bottom: 0;
  }

  .section-title {
    font-size: 0.875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--pav-color-stone-600);
    margin: 0 0 1rem 0;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }
}

.form-field {
  margin-bottom: 1rem;
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
  gap: 0.75rem;
  margin-bottom: 1rem;

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

.modal-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-top: 1px solid var(--pav-color-stone-200);

  @media (prefers-color-scheme: dark) {
    border-top-color: var(--pav-color-stone-700);
  }
}
</style>
