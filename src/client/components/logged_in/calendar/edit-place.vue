<style scoped lang="scss">
/* Full-page place editor container - uses 100vh since it renders as a top-level route */
.place-editor-page {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background-color: var(--pav-color-stone-50);

  @media (prefers-color-scheme: dark) {
    background-color: var(--pav-color-stone-900);
  }
}

/* Page header with back button, title, and action buttons */
.page-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.5rem 2rem;
  border-bottom: 1px solid var(--pav-color-stone-200);
  background-color: white;
  position: sticky;
  top: 0;
  z-index: 10;

  @media (prefers-color-scheme: dark) {
    background-color: var(--pav-color-stone-800);
    border-bottom-color: var(--pav-color-stone-700);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-left: auto;
  }

  .back-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border: none;
    border-radius: 0.5rem;
    background-color: transparent;
    color: var(--pav-color-stone-700);
    cursor: pointer;
    transition: all 0.15s ease;
    flex-shrink: 0;

    svg {
      width: 20px;
      height: 20px;
      min-width: 20px;
      display: block;
      flex-shrink: 0;
    }

    &:hover {
      background-color: var(--pav-color-stone-100);
      color: var(--pav-color-stone-900);
    }

    &:focus-visible {
      outline: 2px solid var(--pav-color-orange-500);
      outline-offset: 2px;
    }

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);

      &:hover {
        background-color: var(--pav-color-stone-800);
        color: var(--pav-color-stone-200);
      }
    }
  }

  h1 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 500;
    color: var(--pav-color-stone-900);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-100);
    }
  }

  @media (max-width: 480px) {
    flex-wrap: wrap;
    padding: 1rem;
    gap: 0.5rem;

    h1 {
      flex: 1;
    }

    .header-actions {
      width: 100%;
      margin-left: 0;
      justify-content: flex-end;
    }
  }
}

/* Loading state */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--pav-space-4xl);
  color: var(--pav-color-text-secondary);

  .loading-spinner {
    font-size: 24px;
    margin-bottom: var(--pav-space-md);
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
}

/* Main form container - single column */
main.editor-main {
  flex: 1;
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
  padding: 0;
  box-sizing: border-box;
}

/* Form styling */
form {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.btn-cancel {
  padding: 0;
  border: none;
  background: none;
  color: var(--pav-color-stone-600);
  font-size: 0.9375rem;
  font-weight: 400;
  cursor: pointer;
  transition: color 0.15s ease;

  &:hover {
    color: var(--pav-color-stone-900);
  }

  &:focus-visible {
    outline: 2px solid var(--pav-color-orange-500);
    outline-offset: 2px;
  }

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);

    &:hover {
      color: var(--pav-color-stone-200);
    }
  }
}

.btn-save {
  padding: 0.625rem 1.5rem;
  border: none;
  background: var(--pav-color-orange-500);
  color: white;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  border-radius: 9999px;
  transition: all 0.15s ease;

  &:hover {
    background: var(--pav-color-orange-600);
  }

  &:focus-visible {
    outline: 2px solid var(--pav-color-orange-500);
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

/* Single column container */
.editor-container {
  display: flex;
  flex-direction: column;
  gap: 2rem;
  padding: 2rem;

  @media (max-width: 768px) {
    padding: 1rem;
    gap: 1.5rem;
  }
}

/* Section styling */
.editor-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.section-header {
  margin: 0;
  padding: 0;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--pav-color-stone-500);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.section-card {
  background: white;
  border: 1px solid var(--pav-color-stone-200);
  border-radius: 0.5rem;
  padding: 1.5rem;

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-800);
    border-color: var(--pav-color-stone-700);
  }
}

/* Place fields */
.place-fields {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.field-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--pav-color-stone-700);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-300);
  }
}

.field-input,
.field-textarea {
  padding: 0.625rem 0.875rem;
  border: 1px solid var(--pav-color-stone-200);
  border-radius: 0.375rem;
  font-size: 0.9375rem;
  background: var(--pav-color-stone-50);
  color: var(--pav-color-stone-900);
  font-family: inherit;
  transition: all 0.15s ease;

  &:focus-visible {
    outline: 2px solid var(--pav-color-orange-500);
    outline-offset: 1px;
    border-color: var(--pav-color-orange-500);
    background: white;
  }

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-900);
    border-color: var(--pav-color-stone-600);
    color: var(--pav-color-stone-100);

    &:focus-visible {
      background: var(--pav-color-stone-800);
    }
  }
}

.field-textarea {
  resize: vertical;
  min-height: 80px;
  line-height: 1.5;
}

.address-row {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  gap: 0.75rem;

  @media (max-width: 480px) {
    grid-template-columns: 1fr;
  }
}

/* Error styling */
.error {
  position: relative;
  color: var(--pav-color-red-700);
  font-size: 0.9rem;
  padding: 1rem 2.5rem 1rem 1.5rem;
  border-radius: 0.75rem;
  background-color: var(--pav-color-red-50);
  border: 1px solid var(--pav-color-red-200);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-red-300);
    background-color: rgba(239, 68, 68, 0.1);
    border-color: var(--pav-color-red-900);
  }

  ul {
    margin: 0;
    padding-left: var(--pav-space-md);
    list-style-type: disc;
  }

  li {
    margin-bottom: var(--pav-space-xs);

    &:last-child {
      margin-bottom: 0;
    }
  }
}

.error-dismiss {
  position: absolute;
  top: 0.5rem;
  right: 0.75rem;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1.25rem;
  line-height: 1;
  color: var(--pav-color-red-700);
  padding: 0.125rem 0.25rem;
  border-radius: 0.25rem;

  &:hover {
    background-color: var(--pav-color-red-100);
  }

  &:focus-visible {
    outline: 2px solid var(--pav-color-red-700);
    outline-offset: 2px;
  }

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-red-300);

    &:hover {
      background-color: rgba(239, 68, 68, 0.2);
    }
  }
}
</style>

<template>
  <div class="place-editor-page">
    <!-- Page Header with Back Button and Actions -->
    <header class="page-header">
      <button type="button"
              class="back-button"
              @click="handleBack"
              :aria-label="t('back_button')">
        <ArrowLeft :size="20" aria-hidden="true" />
      </button>
      <h1>{{ isEditMode ? t('editor_title_edit') : t('editor_title_new') }}</h1>
      <div class="header-actions">
        <button
          type="button"
          class="btn-cancel"
          @click="handleBack"
        >
          {{ t('cancel') }}
        </button>
        <button
          type="submit"
          form="place-form"
          class="btn-save"
          :disabled="state.isSaving"
        >
          {{ t('save') }}
        </button>
      </div>
    </header>

    <!-- Loading State -->
    <div
      v-if="state.isLoading"
      class="loading-container"
      role="status"
      aria-live="polite"
    >
      <span class="loading-spinner" aria-hidden="true">&#8987;</span>
      <span>{{ t('editor_loading') }}</span>
    </div>

    <!-- Main Content -->
    <main
      v-else
      :aria-label="t('editor_aria_label')"
      class="editor-main"
    >
      <form id="place-form" @submit.prevent="handleSave" :aria-label="t('editor_form_aria_label')">

        <!-- Error Display -->
        <div v-if="state.error"
             ref="errorContainer"
             class="error"
             role="alert"
             aria-live="polite">
          <button
            class="error-dismiss"
            type="button"
            :aria-label="t('dismiss_error')"
            @click="state.error = ''"
          >&times;</button>
          <div v-if="Array.isArray(state.error)">
            <ul>
              <li v-for="(err, index) in state.error" :key="index">{{ err }}</li>
            </ul>
          </div>
          <div v-else>
            {{ state.error }}
          </div>
        </div>

        <!-- Single Column Layout -->
        <div class="editor-container">

          <!-- BASIC INFORMATION Section -->
          <section class="editor-section">
            <h2 class="section-header">{{ t('section_basic_info') }}</h2>

            <div class="section-card">
              <div class="place-fields">
                <div class="form-field">
                  <label for="place-name" class="field-label">{{ t('field_name') }}</label>
                  <input
                    id="place-name"
                    type="text"
                    v-model="formData.name"
                    class="field-input"
                    required
                  />
                </div>

                <div class="form-field">
                  <label for="place-address" class="field-label">{{ t('field_address') }}</label>
                  <input
                    id="place-address"
                    type="text"
                    v-model="formData.address"
                    class="field-input"
                  />
                </div>

                <div class="address-row">
                  <div class="form-field">
                    <label for="place-city" class="field-label">{{ t('field_city') }}</label>
                    <input
                      id="place-city"
                      type="text"
                      v-model="formData.city"
                      class="field-input"
                    />
                  </div>
                  <div class="form-field">
                    <label for="place-state" class="field-label">{{ t('field_state') }}</label>
                    <input
                      id="place-state"
                      type="text"
                      v-model="formData.state"
                      class="field-input"
                    />
                  </div>
                  <div class="form-field">
                    <label for="place-postal-code" class="field-label">{{ t('field_postal_code') }}</label>
                    <input
                      id="place-postal-code"
                      type="text"
                      v-model="formData.postalCode"
                      class="field-input"
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- ACCESSIBILITY INFORMATION Section -->
          <section class="editor-section">
            <h2 class="section-header">{{ t('section_accessibility') }}</h2>

            <div class="section-card">
              <LanguageTabSelector
                v-model="currentLanguage"
                :languages="languages"
                @add-language="openLanguagePicker"
              />

              <div class="place-fields">
                <div class="form-field">
                  <label :for="`place-accessibility-${currentLanguage}`" class="field-label">
                    {{ t('field_accessibility_info') }}
                  </label>
                  <textarea
                    :id="`place-accessibility-${currentLanguage}`"
                    v-model="accessibilityInfo[currentLanguage]"
                    class="field-textarea"
                    rows="4"
                  />
                </div>
              </div>
            </div>
          </section>

        </div>
      </form>
    </main>
  </div>

  <div v-if="showLanguagePicker">
    <language-picker :languages="availableLanguages"
                     :selectedLanguages="languages"
                     @close="closeLanguagePicker"
                     @select="handleAddLanguage" />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onBeforeMount, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { ArrowLeft } from 'lucide-vue-next';
import LanguageTabSelector from '@/client/components/common/language-tab-selector.vue';
import languagePicker from '@/client/components/common/language-picker.vue';
import LocationService from '@/client/service/location';
import CalendarService from '@/client/service/calendar';
import { EventLocation, validateLocationHierarchy } from '@/common/model/location';
import iso6391 from 'iso-639-1-dir';

const props = defineProps({
  placeId: {
    type: String,
    default: null,
  },
});

const route = useRoute();
const router = useRouter();
const locationService = new LocationService();
const calendarService = new CalendarService();

const { t } = useTranslation('calendars', {
  keyPrefix: 'places',
});

const calendarUrlName = computed(() => route.params.calendar as string);

const isEditMode = computed(() => !!props.placeId);

const state = reactive({
  isLoading: false,
  isSaving: false,
  error: '' as string | string[],
  calendarId: '' as string,
});

// Error container ref for focus management
const errorContainer = ref<HTMLElement | null>(null);

// Form data for basic fields
const formData = reactive({
  name: '',
  address: '',
  city: '',
  state: '',
  postalCode: '',
});

// Accessibility info keyed by language
const accessibilityInfo = reactive<Record<string, string>>({});

// Language management
const defaultLanguage = 'en';
const languages = ref<string[]>([defaultLanguage]);
const currentLanguage = ref(defaultLanguage);
const showLanguagePicker = ref(false);

/**
 * Scroll error container into view when an error occurs.
 */
watch(() => state.error, async (newError) => {
  if (newError) {
    await nextTick();
    errorContainer.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

/**
 * Available languages for the language picker (excludes already-selected languages).
 */
const availableLanguages = computed(() => {
  const allLanguages = iso6391.getAllCodes();
  return allLanguages.filter((code: string) => !languages.value.includes(code));
});

/**
 * Navigate back to the places tab on the calendar view.
 */
function handleBack() {
  router.push(`/calendar/${calendarUrlName.value}?tab=places`);
}

/**
 * Open the language picker modal.
 */
function openLanguagePicker() {
  showLanguagePicker.value = true;
}

/**
 * Close the language picker modal.
 */
function closeLanguagePicker() {
  showLanguagePicker.value = false;
}

/**
 * Handle adding a new language from the picker.
 */
function handleAddLanguage(language: string) {
  if (!languages.value.includes(language)) {
    languages.value.push(language);
    currentLanguage.value = language;
  }
  closeLanguagePicker();
}

/**
 * Build an EventLocation model from the current form data.
 */
function buildLocationFromForm(): EventLocation {
  const location = new EventLocation(
    isEditMode.value ? props.placeId : undefined,
    formData.name.trim(),
    formData.address.trim(),
    formData.city.trim(),
    formData.state.trim(),
    formData.postalCode.trim(),
  );

  // Add accessibility content for each language that has info
  for (const lang of languages.value) {
    const info = accessibilityInfo[lang];
    if (info && info.trim().length > 0) {
      const content = location.content(lang);
      content.accessibilityInfo = info.trim();
    }
  }

  return location;
}

/**
 * Populate form data from an existing EventLocation model.
 */
function populateFormFromLocation(location: EventLocation) {
  formData.name = location.name;
  formData.address = location.address;
  formData.city = location.city;
  formData.state = location.state;
  formData.postalCode = location.postalCode;

  // Populate accessibility info from content
  const contentLanguages = Object.keys(location._content);
  if (contentLanguages.length > 0) {
    for (const lang of contentLanguages) {
      if (!languages.value.includes(lang)) {
        languages.value.push(lang);
      }
      accessibilityInfo[lang] = location._content[lang].accessibilityInfo || '';
    }
    currentLanguage.value = languages.value[0];
  }
}

/**
 * Handle form submission (create or update).
 */
async function handleSave() {
  state.error = '';

  // Validate name is required
  if (!formData.name.trim()) {
    state.error = t('error_name_required');
    return;
  }

  const location = buildLocationFromForm();

  // Validate location hierarchy
  const hierarchyErrors = validateLocationHierarchy(location);
  if (hierarchyErrors.length > 0) {
    state.error = hierarchyErrors.map(key => t(key)).join('. ');
    return;
  }

  state.isSaving = true;

  try {
    if (isEditMode.value) {
      await locationService.updateLocation(state.calendarId, location);
    }
    else {
      await locationService.createLocation(state.calendarId, location);
    }

    // Navigate back to places tab on success
    handleBack();
  }
  catch (error) {
    console.error('Error saving place:', error);
    state.error = t('error_saving');
  }
  finally {
    state.isSaving = false;
  }
}

/**
 * Initialize the editor: resolve calendar and load existing location if editing.
 */
onBeforeMount(async () => {
  state.isLoading = true;

  try {
    // Resolve calendar from URL name
    const calendar = await calendarService.getCalendarByUrlName(calendarUrlName.value);
    if (!calendar) {
      state.error = t('error_calendar_not_found');
      state.isLoading = false;
      return;
    }

    state.calendarId = calendar.id;

    // If editing, load the existing location
    if (isEditMode.value && props.placeId) {
      const location = await locationService.getLocationById(calendar.id, props.placeId);
      populateFormFromLocation(location);
    }
  }
  catch (error) {
    console.error('Error initializing place editor:', error);
    state.error = t('error_loading');
  }
  finally {
    state.isLoading = false;

    // Focus the name input after loading completes
    await nextTick();
    document.querySelector<HTMLInputElement>('#place-name')?.focus();
  }
});
</script>
