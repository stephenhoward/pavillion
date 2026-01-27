<style scoped lang="scss">
/* Full-page event editor container - uses 100vh since it renders as a top-level route */
.event-editor-page {
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
    border-radius: 0.5rem; // rounded-lg
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
    font-size: 1.25rem; // text-xl (smaller than before)
    font-weight: 500; // font-medium (lighter than semibold)
    color: var(--pav-color-stone-900);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-100);
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

/* Screen reader only class for accessibility */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Main form container - single column */
main[role="main"].editor-main {
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
  border-radius: 9999px; // Full pill shape
  transition: all 0.15s ease;

  &:hover {
    background: var(--pav-color-orange-600);
  }

  &:focus-visible {
    outline: 2px solid var(--pav-color-orange-500);
    outline-offset: 2px;
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

/* Event fields */
.event-fields {
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

  .info-icon {
    margin-left: 0.25rem;
    color: var(--pav-color-stone-400);
    cursor: help;
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

  &:focus {
    outline: none;
    border-color: var(--pav-color-orange-500);
    background: white;
  }

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-900);
    border-color: var(--pav-color-stone-600);
    color: var(--pav-color-stone-100);

    &:focus {
      background: var(--pav-color-stone-800);
    }
  }
}

.field-textarea {
  resize: vertical;
  min-height: 80px;
  line-height: 1.5;
}

.remove-translation-link {
  align-self: flex-start;
  padding: 0;
  border: none;
  background: none;
  color: var(--pav-color-red-600);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.15s ease;

  &:hover {
    color: var(--pav-color-red-700);
    text-decoration: underline;
  }

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-red-400);

    &:hover {
      color: var(--pav-color-red-300);
    }
  }
}

/* Location display/editor */
.location-display {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

.location-info {
  flex: 1;
}

.location-name {
  font-size: 1rem;
  font-weight: 500;
  color: var(--pav-color-stone-900);
  margin-bottom: 0.25rem;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-100);
  }
}

.location-address {
  font-size: 0.875rem;
  color: var(--pav-color-stone-600);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.btn-change {
  padding: 0.5rem 1rem;
  border: 1px solid var(--pav-color-stone-300);
  background: white;
  color: var(--pav-color-stone-700);
  font-size: 0.875rem;
  font-weight: 500;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: var(--pav-color-stone-50);
    border-color: var(--pav-color-stone-400);
  }

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-800);
    border-color: var(--pav-color-stone-600);
    color: var(--pav-color-stone-300);

    &:hover {
      background: var(--pav-color-stone-700);
    }
  }
}

.location-editor {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.location-row {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  gap: 0.5rem;

  @media (max-width: 480px) {
    grid-template-columns: 1fr;
  }
}

/* Schedule list */
.schedule-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 1rem;
}

.schedule-item {
  padding: 1rem;
  background: var(--pav-color-stone-50);
  border: 1px solid var(--pav-color-stone-200);
  border-radius: 0.5rem;

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-900);
    border-color: var(--pav-color-stone-700);
  }
}

.add-schedule-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 2px dashed var(--pav-color-stone-300);
  background: transparent;
  color: var(--pav-color-stone-600);
  font-size: 0.875rem;
  font-weight: 500;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.15s ease;
  width: 100%;
  justify-content: center;

  &:hover {
    border-color: var(--pav-color-stone-400);
    background: var(--pav-color-stone-50);
  }

  @media (prefers-color-scheme: dark) {
    border-color: var(--pav-color-stone-600);
    color: var(--pav-color-stone-400);

    &:hover {
      border-color: var(--pav-color-stone-500);
      background: var(--pav-color-stone-800);
    }
  }
}

.schedule-help-text {
  margin: 0.75rem 0 0 0;
  font-size: 0.8125rem;
  color: var(--pav-color-stone-500);
  line-height: 1.5;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

/* Error styling */
.error {
  color: var(--pav-color-red-700);
  font-size: 0.9rem;
  padding: 1rem 1.5rem;
  border-radius: 0.75rem; // rounded-xl
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

/* Form group styling (for general use) */
.form-group {
  margin-bottom: 0;

  label {
    display: block;
    margin-bottom: var(--pav-space-xs);
    font-weight: var(--pav-font-weight-medium);
    color: var(--pav-color-text-primary);
  }
}

/* Form actions footer */
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding-top: 2rem;
  margin-top: 2rem;
  border-top: 1px solid var(--pav-color-stone-200);

  @media (prefers-color-scheme: dark) {
    border-top-color: var(--pav-color-stone-700);
  }

  @media (max-width: 768px) {
    flex-direction: column-reverse;

    button {
      width: 100%;
    }
  }
}

/* Button styling that follows semantic system */
button {
  font-size: 14px;
  border: 1px solid var(--pav-color-border-primary);
  border-radius: var(--pav-border-radius-sm);
  padding: var(--pav-space-sm) var(--pav-space-lg);
  background-color: var(--pav-color-surface-primary);
  color: var(--pav-color-text-primary);
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background-color: var(--pav-color-interactive-secondary-hover);
  }

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px rgba(var(--pav-color-interactive-primary-rgb), 0.2);
  }

  &.primary {
    background-color: var(--pav-color-interactive-primary);
    color: white;
    border-color: var(--pav-color-interactive-primary);

    &:hover {
      opacity: 0.9;
    }
  }

  &.danger {
    background-color: var(--pav-color-danger, #dc3545);
    color: white;
    border-color: var(--pav-color-danger, #dc3545);

    &:hover {
      opacity: 0.9;
    }
  }

  &.remove {
    font-size: 20px;
    background: none;
    border: none;
    display: block;
    float: right;
  }

  img {
    width: 16px;
  }
}

/* Unsaved changes confirmation dialog */
.unsaved-changes-confirmation {
  p {
    margin: 0 0 var(--pav-space-xl) 0;
    color: var(--pav-color-text-primary);
    line-height: 1.5;
  }

  .dialog-actions {
    display: flex;
    gap: var(--pav-space-md);
    justify-content: flex-end;

    @media (max-width: 599px) {
      flex-direction: column-reverse;

      button {
        width: 100%;
      }
    }
  }
}
</style>

<template>
  <div class="event-editor-page">
    <!-- Page Header with Back Button and Actions -->
    <header class="page-header">
      <button type="button"
              class="back-button"
              @click="handleBack"
              :aria-label="t('back_button', 'Go back')">
        <ArrowLeft :size="20" aria-hidden="true" />
      </button>
      <h1>{{ pageTitle }}</h1>
      <div class="header-actions">
        <button
          type="button"
          class="btn-cancel"
          @click="handleBack"
        >
          Cancel
        </button>
        <button
          type="submit"
          form="event-form"
          class="btn-save"
        >
          Save Changes
        </button>
      </div>
    </header>

    <!-- Loading State -->
    <div v-if="state.isLoading" class="loading-container">
      <span class="loading-spinner" aria-hidden="true">&#8987;</span>
      <span>Loading...</span>
    </div>

    <!-- Main Content - only render when event is loaded -->
    <main
      v-else-if="state.event"
      role="main"
      aria-label="Event Editor"
      class="editor-main"
    >
      <form id="event-form" @submit.prevent="saveModel()" aria-label="Event Information Form">

        <!-- Error Display -->
        <div v-if="state.err"
             ref="errorContainer"
             class="error"
             role="alert"
             aria-live="polite">
          <div v-if="Array.isArray(state.err)">
            <ul>
              <li v-for="(error, index) in state.err" :key="index">{{ error }}</li>
            </ul>
          </div>
          <div v-else>
            {{ state.err }}
          </div>
        </div>

        <!-- Single Column Layout -->
        <div class="editor-container">

          <!-- EVENT DETAILS Section -->
          <section class="editor-section">
            <h2 class="section-header">EVENT DETAILS</h2>

            <div class="section-card">
              <!-- Language Tabs -->
              <LanguageTabSelector
                v-model="state.lang"
                :languages="languages"
                @add-language="state.showLanguagePicker = true"
                @remove-language="removeLanguage"
              />

              <!-- Event Content Fields (for selected language) -->
              <div
                :dir="iso6391.getDir(state.lang) === 'rtl' ? 'rtl' : 'ltr'"
                class="event-fields"
              >
                <div class="form-field">
                  <label :for="`event-name-${state.lang}`" class="field-label">Event Title</label>
                  <input
                    :id="`event-name-${state.lang}`"
                    type="text"
                    name="name"
                    v-model="state.event.content(state.lang).name"
                    class="field-input"
                    required
                  />
                </div>

                <div class="form-field">
                  <label :for="`event-description-${state.lang}`" class="field-label">Description</label>
                  <textarea
                    :id="`event-description-${state.lang}`"
                    name="description"
                    v-model="state.event.content(state.lang).description"
                    class="field-textarea"
                    rows="4"
                  />
                </div>

                <div class="form-field">
                  <label :for="`event-accessibility-${state.lang}`" class="field-label">
                    Accessibility Information
                    <span class="info-icon" title="Information about accessibility features">ⓘ</span>
                  </label>
                  <textarea
                    :id="`event-accessibility-${state.lang}`"
                    name="accessibility"
                    v-model="state.event.content(state.lang).accessibilityInfo"
                    class="field-textarea"
                    rows="3"
                  />
                </div>

                <button
                  v-if="languages.length > 1"
                  type="button"
                  class="remove-translation-link"
                  @click="removeLanguage(state.lang)"
                >
                  Remove {{ iso6391.getName(state.lang) }} translation
                </button>
              </div>
            </div>
          </section>

          <!-- LOCATION Section -->
          <section class="editor-section">
            <h2 class="section-header">LOCATION</h2>

            <LocationDisplayCard
              :location="state.event.location"
              @change-location="handleOpenLocationPicker"
              @add-location="handleOpenLocationPicker"
            />
          </section>

          <!-- EVENT IMAGE Section -->
          <section class="editor-section">
            <h2 class="section-header">EVENT IMAGE</h2>

            <div class="section-card">
              <ImageUpload
                :calendar-id="state.event.calendarId || 'default'"
                :multiple="false"
                @upload-complete="handleImageUpload"
                aria-label="Event Image Upload"
              />
            </div>
          </section>

          <!-- CATEGORIES Section -->
          <section class="editor-section">
            <h2 class="section-header">CATEGORIES</h2>

            <div class="section-card">
              <CategorySelector
                :calendar-id="state.event.calendarId"
                :selected-categories="state.selectedCategories"
                @categories-changed="handleCategoriesChanged"
                aria-label="Select Event Categories"
              />
            </div>
          </section>

          <!-- DATE & TIME Section -->
          <section class="editor-section">
            <h2 class="section-header">DATE & TIME</h2>

            <div class="section-card">
              <div class="schedule-list" role="group" aria-label="Event Schedules">
                <div
                  v-for="(schedule, index) in state.event.schedules"
                  :key="index"
                  class="schedule-item"
                >
                  <EventRecurrenceView
                    :schedule="schedule"
                    @remove-schedule="state.event.dropSchedule(index)"
                  />
                </div>
              </div>

              <button
                type="button"
                class="add-schedule-btn"
                @click="state.event.addSchedule()"
              >
                <Plus :size="16" aria-hidden="true" />
                Add another schedule
              </button>

              <p class="schedule-help-text">
                Add multiple schedules to create events that occur at different times or with different patterns.
              </p>
            </div>
          </section>

        </div>
      </form>
    </main>

    <!-- Error state when event failed to load -->
    <main v-else role="main" aria-label="Event Editor Error">
      <div class="error" role="alert">
        {{ state.err || 'Failed to load event' }}
      </div>
    </main>
  </div>

  <div v-if="state.showLanguagePicker">
    <language-picker :languages="availableLanguages"
                     :selectedLanguages="languages"
                     @close="state.showLanguagePicker = false"
                     @select="(lang) => addLanguage(lang)" />
  </div>

  <!-- Location Picker Modal -->
  <LocationPickerModal
    v-if="state.showLocationPicker"
    ref="locationPickerRef"
    :locations="state.availableLocations"
    :selected-location-id="state.event?.locationId || null"
    @location-selected="handleLocationSelected"
    @create-new="handleCreateNewLocation"
    @remove-location="handleRemoveLocation"
    @close="state.showLocationPicker = false"
  />

  <!-- Create Location Form Modal -->
  <CreateLocationForm
    v-if="state.showCreateLocationForm"
    ref="createLocationFormRef"
    :languages="languages"
    @create-location="handleLocationCreated"
    @back-to-search="handleBackToSearch"
    @close="state.showCreateLocationForm = false"
  />

  <!-- Unsaved Changes Confirmation Dialog -->
  <ModalLayout
    v-if="state.showUnsavedChangesDialog"
    :title="t('unsaved_changes_title', 'Unsaved Changes')"
    @close="cancelLeave"
  >
    <div class="unsaved-changes-confirmation">
      <p>{{ t('unsaved_changes_message', 'You have unsaved changes. Are you sure you want to leave?') }}</p>
      <div class="dialog-actions">
        <PillButton
          type="button"
          variant="ghost"
          @click="cancelLeave"
        >
          {{ t('unsaved_changes_cancel', 'Stay') }}
        </PillButton>
        <PillButton
          type="button"
          variant="secondary"
          class="danger"
          @click="confirmLeave"
        >
          {{ t('unsaved_changes_confirm', 'Leave') }}
        </PillButton>
      </div>
    </div>
  </ModalLayout>
</template>

<script setup>
import { reactive, ref, onBeforeMount, onMounted, computed, watch, nextTick } from 'vue';
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { ArrowLeft, Plus, X, MapPin, Image, Calendar, Clock, Repeat, Trash2, Tag } from 'lucide-vue-next';
import { CalendarEvent } from '@/common/model/events';
import { EventLocation } from '@/common/model/location';
import { validateLocationHierarchy } from '@/common/model/location';
import { useCalendarStore } from '@/client/stores/calendarStore';
import CalendarService from '@/client/service/calendar';
import EventService from '@/client/service/event';
import CategoryService from '@/client/service/category';
import LocationService from '@/client/service/location';
import ModelService from '@/client/service/models';
import EventRecurrenceView from './event_recurrence.vue';
import languagePicker from '@/client/components/common/languagePicker.vue';
import ImageUpload from '@/client/components/common/media/ImageUpload.vue';
import CategorySelector from './CategorySelector.vue';
import ModalLayout from '@/client/components/common/modal.vue';
import PillButton from '@/client/components/common/PillButton.vue';
import LanguageTabSelector from '@/client/components/common/LanguageTabSelector.vue';
import LocationDisplayCard from '@/client/components/common/LocationDisplayCard.vue';
import LocationPickerModal from '@/client/components/common/LocationPickerModal.vue';
import CreateLocationForm from '@/client/components/common/CreateLocationForm.vue';
import EditorPanel from './EditorPanel.vue';
import iso6391 from 'iso-639-1-dir';
import { useEventDuplication } from '@/client/composables/useEventDuplication';

// Icon aliases for template use
const CalendarIcon = Calendar;
const ImageIcon = Image;
const TagIcon = Tag;

// Props for edit mode (eventId passed from route)
const props = defineProps({
  eventId: {
    type: String,
    default: null,
  },
});

// Router and route
const route = useRoute();
const router = useRouter();

// Services
const eventService = new EventService();
const calendarService = new CalendarService();
const categoryService = new CategoryService();
const locationService = new LocationService();
const calendarStore = useCalendarStore();
const { stripEventForDuplication } = useEventDuplication();

// Translation
const { t } = useTranslation('event_editor', {
  keyPrefix: 'editor',
});

// Default language setup
const defaultLanguage = 'en';
const languages = ref([defaultLanguage]);
const allLanguages = iso6391.getAllCodes();
const availableLanguages = ref([...new Set([defaultLanguage, ...allLanguages])]);

// Error container ref for scrolling
const errorContainer = ref(null);

// Modal refs
const locationPickerRef = ref(null);
const createLocationFormRef = ref(null);

// Dirty state tracking
const isDirty = ref(false);
const originalEventSnapshot = ref(null);
const snapshotReady = ref(false);

// Pending navigation for unsaved changes confirmation
const pendingNavigation = ref(null);

// Component state
const state = reactive({
  isLoading: true,
  err: '',
  showLanguagePicker: false,
  showLocationPicker: false,
  showCreateLocationForm: false,
  showUnsavedChangesDialog: false,
  lang: defaultLanguage,
  availableCalendars: [],
  availableLocations: [],
  mediaId: null,
  calendar: null,
  selectedCategories: [],
  invalidFields: [],
  event: null,
  isDuplicationMode: false,
  mode: 'create', // 'create', 'edit', 'duplicate'
});

/**
 * Create a snapshot of the current event state for comparison
 * Uses _content (Record) from the TranslatedModel base class
 */
const createEventSnapshot = () => {
  if (!state.event) return null;

  // Get content from _content Record and convert to a sorted array for consistent comparison
  const contentEntries = state.event._content
    ? Object.entries(state.event._content).sort(([a], [b]) => a.localeCompare(b)).map(([lang, c]) => ({
      language: lang,
      name: c.name || '',
      description: c.description || '',
    }))
    : [];

  // Create a serializable snapshot of the event data
  return JSON.stringify({
    calendarId: state.event.calendarId,
    contents: contentEntries,
    location: state.event.location ? {
      name: state.event.location.name || '',
      address: state.event.location.address || '',
      city: state.event.location.city || '',
      state: state.event.location.state || '',
      postalCode: state.event.location.postalCode || '',
    } : {},
    schedules: state.event.schedules?.map(s => ({
      startDate: s.startDate,
      endDate: s.endDate,
      allDay: s.allDay,
      rrule: s.rrule,
    })) || [],
    categories: [...state.selectedCategories].sort(),
    mediaId: state.mediaId,
  });
};

/**
 * Check if the current event state differs from the original snapshot
 */
const checkDirtyState = () => {
  if (!originalEventSnapshot.value || !state.event || !snapshotReady.value) {
    return false;
  }

  const currentSnapshot = createEventSnapshot();
  return currentSnapshot !== originalEventSnapshot.value;
};

/**
 * Computed property to determine the page title based on mode
 */
const pageTitle = computed(() => {
  if (state.isDuplicationMode || state.mode === 'duplicate') {
    return t('duplicate_event_title');
  }
  if (state.mode === 'edit' && state.event?.id) {
    return t('edit_event_title');
  }
  return t('create_event_title');
});

/**
 * Handle back button navigation with unsaved changes check
 */
const handleBack = async () => {
  if (isDirty.value) {
    // Show confirmation dialog
    state.showUnsavedChangesDialog = true;
    pendingNavigation.value = () => {
      if (window.history.length > 1) {
        router.back();
      }
      else {
        router.push({ name: 'calendars' });
      }
    };
  }
  else {
    // Navigate back directly
    if (window.history.length > 1) {
      router.back();
    }
    else {
      router.push({ name: 'calendars' });
    }
  }
};

/**
 * Confirm leaving with unsaved changes
 */
const confirmLeave = () => {
  state.showUnsavedChangesDialog = false;
  isDirty.value = false; // Reset dirty state to allow navigation

  if (pendingNavigation.value) {
    pendingNavigation.value();
    pendingNavigation.value = null;
  }
};

/**
 * Cancel leaving and stay on the page
 */
const cancelLeave = () => {
  state.showUnsavedChangesDialog = false;
  pendingNavigation.value = null;
};

/**
 * Navigation guard to check for unsaved changes
 */
onBeforeRouteLeave((to, from, next) => {
  if (isDirty.value && !state.showUnsavedChangesDialog) {
    // Show confirmation dialog and block navigation
    state.showUnsavedChangesDialog = true;
    pendingNavigation.value = () => next();
    next(false);
  }
  else if (state.showUnsavedChangesDialog) {
    // Already showing dialog, block navigation
    next(false);
  }
  else {
    // No unsaved changes, allow navigation
    next();
  }
});

/**
 * Add a language to the event
 */
const addLanguage = (language) => {
  languages.value = [...new Set(languages.value.concat(language))];
  state.lang = language;
};

/**
 * Remove a language from the event
 */
const removeLanguage = (language) => {
  if (state.event) {
    state.event.dropContent(language);
  }
  languages.value = languages.value.filter(l => l != language);
  state.lang = languages.value[0];
};

/**
 * Handle image upload completion
 */
const handleImageUpload = (results) => {
  if (results && results.length > 0 && results[0].success) {
    state.mediaId = results[0].media.id;
  }
};

/**
 * Handle category selection changes
 */
const handleCategoriesChanged = (categories) => {
  state.selectedCategories = categories;
};

/**
 * Fetch locations for the current calendar
 */
const fetchLocations = async (calendarId) => {
  if (!calendarId) return;

  try {
    state.availableLocations = await locationService.getLocations(calendarId);
  }
  catch (error) {
    console.error('Error fetching locations:', error);
    state.availableLocations = [];
  }
};

/**
 * Handle opening the location picker modal
 */
const handleOpenLocationPicker = async () => {
  // Fetch latest locations before showing picker
  await fetchLocations(state.event.calendarId);
  state.showLocationPicker = true;
};

/**
 * Handle location selection from the picker
 */
const handleLocationSelected = async (location) => {
  // Set the locationId on the event
  state.event.locationId = location.id;

  // Also set the location object for display purposes
  state.event.location = location;

  // Close the picker
  state.showLocationPicker = false;
};

/**
 * Handle "Create New" button click from location picker
 */
const handleCreateNewLocation = () => {
  // Close picker and open create form
  state.showLocationPicker = false;
  state.showCreateLocationForm = true;
};

/**
 * Handle location creation from the create form
 */
const handleLocationCreated = async (locationData) => {
  try {
    // Create the location via API
    const newLocation = await locationService.createLocation(state.event.calendarId, locationData);

    // Add to available locations
    state.availableLocations.push(newLocation);

    // Auto-select the newly created location
    state.event.locationId = newLocation.id;
    state.event.location = newLocation;

    // Close the create form
    state.showCreateLocationForm = false;
  }
  catch (error) {
    console.error('Error creating location:', error);
    state.err = 'Failed to create location';
  }
};

/**
 * Handle "Remove location" button click
 */
const handleRemoveLocation = () => {
  // Clear the location reference
  state.event.locationId = null;
  state.event.location = new EventLocation();

  // Close the picker
  state.showLocationPicker = false;
};

/**
 * Handle "Back to search" from create location form
 */
const handleBackToSearch = () => {
  state.showCreateLocationForm = false;
  state.showLocationPicker = true;
};

// Watch for location picker visibility and show/hide the modal
watch(() => state.showLocationPicker, async (newValue) => {
  if (newValue) {
    await nextTick();
    locationPickerRef.value?.dialogRef?.showModal();
  }
});

// Watch for create location form visibility and show/hide the modal
watch(() => state.showCreateLocationForm, async (newValue) => {
  if (newValue) {
    await nextTick();
    createLocationFormRef.value?.dialogRef?.showModal();
  }
});

// Watch for error changes and scroll into view
watch(() => state.err, async (newError) => {
  if (newError) {
    await nextTick();
    await nextTick();

    if (errorContainer.value) {
      // Scroll to top of the page container
      const pageContainer = errorContainer.value.closest('.event-editor-page');
      if (pageContainer) {
        pageContainer.scrollTo({
          top: 0,
          behavior: 'smooth',
        });
      }
    }
  }
}, { deep: true });

// Watch for changes in event data and update dirty state
watch(
  () => state.event,
  () => {
    if (snapshotReady.value && originalEventSnapshot.value) {
      isDirty.value = checkDirtyState();
    }
  },
  { deep: true },
);

// Watch for changes in selected categories
watch(
  () => state.selectedCategories,
  () => {
    if (snapshotReady.value && originalEventSnapshot.value) {
      isDirty.value = checkDirtyState();
    }
  },
  { deep: true },
);

// Watch for changes in media
watch(
  () => state.mediaId,
  () => {
    if (snapshotReady.value && originalEventSnapshot.value) {
      isDirty.value = checkDirtyState();
    }
  },
);

/**
 * Determine the mode based on route parameters
 * - Edit mode: /event/:eventId
 * - Duplicate mode: /event?from=:eventId
 * - Create mode: /event (default)
 */
const determineMode = () => {
  const eventIdParam = props.eventId || route.params.eventId;
  const fromParam = route.query.from;

  if (eventIdParam) {
    return 'edit';
  }
  if (fromParam) {
    return 'duplicate';
  }
  return 'create';
};

/**
 * Initialize a new event for create mode
 */
const initializeNewEvent = (calendar) => {
  const event = new CalendarEvent();
  event.location = new EventLocation();
  event.addSchedule();
  if (calendar) {
    event.calendarId = calendar.id;
  }
  // Pre-populate default language content to avoid triggering dirty state when template renders
  event.content(defaultLanguage);
  return event;
};

/**
 * Load event for edit or duplicate mode
 * Uses ModelService which includes JWT authentication via axios interceptor
 */
const loadEvent = async (eventId) => {
  try {
    const eventData = await ModelService.getModel(`/api/v1/events/${eventId}`);

    if (!eventData) {
      // Event not found
      state.err = 'Event not found';
      router.push({ name: 'calendars' });
      return null;
    }

    return CalendarEvent.fromObject(eventData);
  }
  catch (error) {
    console.error('Error loading event:', error);

    // Check for axios error with response status
    if (error.response) {
      if (error.response.status === 401) {
        // Not authenticated
        router.push({ name: 'login' });
        return null;
      }
      if (error.response.status === 403) {
        // No permission
        router.push({ name: 'calendars' });
        return null;
      }
    }

    state.err = 'Failed to load event';
    return null;
  }
};

/**
 * Main initialization logic
 */
onBeforeMount(async () => {
  try {
    state.isLoading = true;

    // Determine mode from route
    state.mode = determineMode();
    state.isDuplicationMode = state.mode === 'duplicate';

    // Load available calendars
    state.availableCalendars = await calendarService.loadCalendars();

    if (state.availableCalendars.length === 0) {
      // No calendars, redirect to calendar creation
      router.push({ name: 'calendars' });
      return;
    }

    // Handle different modes
    if (state.mode === 'edit') {
      // Edit mode: Load existing event
      const eventId = props.eventId || route.params.eventId;
      const loadedEvent = await loadEvent(eventId);

      if (!loadedEvent) {
        return; // Redirect handled in loadEvent
      }

      state.event = loadedEvent;
      // Ensure default language content exists
      state.event.content(defaultLanguage);

      // Load categories for existing event
      try {
        const eventCategories = await categoryService.getEventCategories(loadedEvent.id);
        state.selectedCategories = eventCategories.map(cat => cat.id);
      }
      catch (error) {
        console.error('Error loading event categories:', error);
      }
    }
    else if (state.mode === 'duplicate') {
      // Duplicate mode: Load source event and strip IDs
      const sourceEventId = route.query.from;
      const sourceEvent = await loadEvent(sourceEventId);

      if (!sourceEvent) {
        return; // Redirect handled in loadEvent
      }

      // Strip the event for duplication
      state.event = stripEventForDuplication(sourceEvent);
      // Ensure default language content exists
      state.event.content(defaultLanguage);

      // Preserve categories from source event
      if (sourceEvent.categories && sourceEvent.categories.length > 0) {
        state.selectedCategories = sourceEvent.categories.map(cat => cat.id);
      }

      // Preserve media reference
      if (sourceEvent.mediaId) {
        state.mediaId = sourceEvent.mediaId;
      }
    }
    else {
      // Create mode: Initialize new event
      // Check for pre-selected calendar from store
      const preSelectedCalendar = calendarStore.getLastInteractedCalendar;

      if (preSelectedCalendar) {
        state.event = initializeNewEvent(preSelectedCalendar);
      }
      else if (state.availableCalendars.length === 1) {
        state.event = initializeNewEvent(state.availableCalendars[0]);
      }
      else {
        // Multiple calendars, use first one as default
        state.event = initializeNewEvent(state.availableCalendars[0]);
      }
    }

    // Update languages from event
    if (state.event) {
      const eventLanguages = state.event.getLanguages();
      eventLanguages.unshift(defaultLanguage);
      languages.value = [...new Set(eventLanguages)];

      // Set current calendar
      state.calendar = state.availableCalendars.find(c => c.id === state.event.calendarId);

      // Fetch locations for the calendar
      await fetchLocations(state.event.calendarId);
    }
  }
  catch (error) {
    console.error('Error initializing event editor:', error);
    state.err = t('error_loading_calendars');
  }
  finally {
    state.isLoading = false;
  }
});

/**
 * After component is mounted and rendered, take the initial snapshot
 */
onMounted(async () => {
  // Wait for the next tick(s) to ensure the template has rendered
  // and any v-model bindings have initialized the content
  await nextTick();
  await nextTick();
  await nextTick();

  // Now take the snapshot - this captures the state after template rendering
  originalEventSnapshot.value = createEventSnapshot();
  snapshotReady.value = true;
});

/**
 * Save the event (create or update)
 */
const saveModel = async () => {
  const model = state.event;

  // Clear previous validation errors
  state.err = '';
  state.invalidFields = [];

  // Ensure we have a calendarId
  if (!model.calendarId && state.availableCalendars.length > 0) {
    model.calendarId = state.availableCalendars[0].id;
  }

  if (!model.calendarId) {
    state.err = t('error_no_calendar');
    return;
  }

  try {
    if (state.mediaId) {
      model.mediaId = state.mediaId;
    }

    // Set locationId if a location has been selected
    // (The location object is only for display purposes in the UI)
    if (state.event.locationId) {
      model.locationId = state.event.locationId;
    }

    // Save the event
    const savedEvent = await eventService.saveEvent(model);

    // Save category assignments if any categories are selected
    if (state.selectedCategories.length > 0) {
      try {
        await categoryService.assignCategoriesToEvent(savedEvent.id, state.selectedCategories);
      }
      catch (categoryError) {
        console.error('Error saving event categories:', categoryError);
        // Don't fail the entire save for category errors
      }
    }

    // Update selected calendar
    calendarStore.setSelectedCalendar(model.calendarId);

    // Reset dirty state after successful save to allow navigation
    isDirty.value = false;
    originalEventSnapshot.value = createEventSnapshot();

    // Navigate to the calendar view for this event's calendar
    const calendar = state.availableCalendars.find(c => c.id === model.calendarId);
    if (calendar) {
      router.push({
        name: 'calendar',
        params: { calendar: calendar.urlName },
      });
    }
    else {
      router.push({ name: 'calendars' });
    }
  }
  catch (error) {
    console.error('Error saving event:', error);
    state.err = t('error_saving_event');
  }
};

// Expose isDirty for testing
defineExpose({
  isDirty,
  state,
  confirmLeave,
  cancelLeave,
});
</script>
