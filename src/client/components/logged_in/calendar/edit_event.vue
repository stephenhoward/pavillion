<style scoped lang="scss">
@use '@/client/assets/mixins' as *;

/* Full-page event editor container - uses 100vh since it renders as a top-level route */
.event-editor-page {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background-color: var(--pav-color-surface-primary);
}

/* Page header with back button and title */
.page-header {
  display: flex;
  align-items: center;
  gap: var(--pav-space-md);
  padding: var(--pav-space-lg) var(--pav-space-xl);
  border-bottom: 1px solid var(--pav-color-border-secondary);
  background-color: var(--pav-color-surface-primary);
  position: sticky;
  top: 0;
  z-index: 10;

  @include dark-mode {
    background-color: var(--pav-color-surface-secondary);
  }

  .back-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border: 1px solid var(--pav-color-border-primary);
    border-radius: var(--pav-border-radius-md);
    background-color: transparent;
    color: var(--pav-color-text-primary);
    cursor: pointer;
    transition: all 0.2s ease;
    flex-shrink: 0;

    &:hover {
      background-color: var(--pav-color-interactive-secondary-hover);
      border-color: var(--pav-color-border-focus);
    }

    &:focus {
      outline: none;
      box-shadow: 0 0 0 2px rgba(var(--pav-color-interactive-primary-rgb), 0.2);
    }

    .back-icon {
      font-size: 20px;
      line-height: 1;
    }
  }

  h1 {
    margin: 0;
    font-size: var(--pav-font-size-heading-3);
    font-weight: var(--pav-font-weight-semibold);
    color: var(--pav-color-text-primary);
    flex: 1;
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

/* Main form container */
main[role="main"] {
  flex: 1;
  padding: var(--pav-space-xl);
  max-width: 900px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;

  @include mobile-only {
    padding: var(--pav-space-lg);
  }
}

/* Form styling */
form {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-xl);
}

/* Error styling */
.error {
  color: #d32f2f;
  font-size: 0.9rem;
  padding: var(--pav-space-md);
  border-radius: var(--pav-border-radius-md);
  background-color: rgba(211, 47, 47, 0.1);
  border: 1px solid rgba(211, 47, 47, 0.3);

  @media (prefers-color-scheme: dark) {
    color: #f44336;
    background-color: rgba(244, 67, 54, 0.1);
    border-color: rgba(244, 67, 54, 0.3);
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

/* Fieldset styling */
fieldset {
  border: 1px solid var(--pav-color-border-primary);
  border-radius: var(--pav-border-radius-md);
  padding: var(--pav-space-xl);
  margin: 0;
  background-color: var(--pav-color-surface-primary);

  @include dark-mode {
    background-color: var(--pav-color-surface-secondary);
  }

  legend {
    font-weight: var(--pav-font-weight-semibold);
    font-size: var(--pav-font-size-heading-5);
    color: var(--pav-color-text-primary);
    padding: 0 var(--pav-space-sm);
  }
}

/* Form group styling */
.form-group {
  margin-bottom: var(--pav-space-lg);

  &:last-child {
    margin-bottom: 0;
  }

  label {
    display: block;
    margin-bottom: var(--pav-space-xs);
    font-weight: var(--pav-font-weight-medium);
    color: var(--pav-color-text-primary);
  }

  input {
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    font-size: 14px;
    display: block;
    width: 100%;
    border-radius: var(--pav-border-radius-sm);
    border: 1px solid var(--pav-color-border-primary);
    padding: var(--pav-space-md);
    background-color: var(--pav-color-surface-primary);
    color: var(--pav-color-text-primary);
    transition: border-color 0.2s ease, box-shadow 0.2s ease;

    &:focus {
      outline: none;
      border-color: var(--pav-color-border-focus);
      box-shadow: 0 0 0 2px rgba(var(--pav-color-interactive-primary-rgb), 0.2);
    }

    &:required {
      border-left: 3px solid var(--pav-color-border-focus);
    }

    &.invalid {
      border-color: #d32f2f;
      border-width: 2px;

      @media (prefers-color-scheme: dark) {
        border-color: #f44336;
      }
    }

    @include dark-mode {
      background-color: var(--pav-color-surface-secondary);
    }
  }

  select {
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    font-size: 14px;
    display: block;
    width: 100%;
    border-radius: var(--pav-border-radius-sm);
    border: 1px solid var(--pav-color-border-primary);
    padding: var(--pav-space-md);
    background-color: var(--pav-color-surface-primary);
    color: var(--pav-color-text-primary);
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
    cursor: pointer;

    &:focus {
      outline: none;
      border-color: var(--pav-color-border-focus);
      box-shadow: 0 0 0 2px rgba(var(--pav-color-interactive-primary-rgb), 0.2);
    }

    @include dark-mode {
      background-color: var(--pav-color-surface-secondary);
    }
  }
}

/* Language controls */
.language-controls {
  display: flex;
  align-items: flex-end;
  gap: var(--pav-space-md);
  margin-bottom: var(--pav-space-lg);

  .form-group {
    flex: 1;
    margin-bottom: 0;
  }

  button {
    padding: var(--pav-space-md);
    border: 1px solid var(--pav-color-border-primary);
    border-radius: var(--pav-border-radius-sm);
    background-color: var(--pav-color-surface-secondary);
    color: var(--pav-color-text-primary);
    cursor: pointer;
    flex-shrink: 0;

    &:hover {
      background-color: var(--pav-color-interactive-secondary-hover);
    }
  }
}

/* Event content fields */
.event-content-fields {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-md);
  padding: var(--pav-space-lg);
  background-color: var(--pav-color-surface-secondary);
  border-radius: var(--pav-border-radius-sm);
  border: 1px solid var(--pav-color-border-secondary);

  @include dark-mode {
    background-color: var(--pav-color-surface-primary);
  }
}

/* Location fieldset specific styling */
fieldset.location {
  .form-group {
    &:first-child input {
      max-width: 500px;
    }
  }
}

/* Schedule styling */
.schedule-list {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-lg);
}

.schedule {
  position: relative;
  padding: var(--pav-space-lg);
  border: 1px solid var(--pav-color-border-secondary);
  border-radius: var(--pav-border-radius-md);
  background-color: var(--pav-color-surface-secondary);

  @include dark-mode {
    background-color: var(--pav-color-surface-primary);
  }

  .remove {
    position: absolute;
    top: var(--pav-space-sm);
    right: var(--pav-space-sm);
    font-size: 20px;
    background: none;
    border: none;
    color: var(--pav-color-text-secondary);
    cursor: pointer;
    padding: var(--pav-space-xs);
    border-radius: var(--pav-border-radius-sm);
    transition: all 0.2s ease;

    &:hover {
      color: var(--pav-color-danger);
      background-color: rgba(var(--pav-color-danger-rgb), 0.1);
    }
  }
}

/* Form actions footer */
.form-actions {
  display: flex;
  gap: var(--pav-space-md);
  justify-content: flex-end;
  padding-top: var(--pav-space-xl);
  border-top: 1px solid var(--pav-color-border-secondary);
  margin-top: var(--pav-space-lg);

  @include mobile-only {
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

    @include mobile-only {
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
    <!-- Page Header with Back Button -->
    <header class="page-header">
      <button type="button"
              class="back-button"
              @click="handleBack"
              :aria-label="t('back_button', 'Go back')">
        <span class="back-icon" aria-hidden="true">&larr;</span>
      </button>
      <h1>{{ pageTitle }}</h1>
    </header>

    <!-- Loading State -->
    <div v-if="state.isLoading" class="loading-container">
      <span class="loading-spinner" aria-hidden="true">&#8987;</span>
      <span>Loading...</span>
    </div>

    <!-- Main Content - only render when event is loaded -->
    <main v-else-if="state.event" role="main" aria-label="Event Editor">
      <form @submit.prevent="saveModel()" aria-label="Event Information Form">
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

        <!-- Calendar Selection -->
        <fieldset v-if="state.availableCalendars.length > 1" class="calendar-selection">
          <legend>{{ t('calendar_label') }}</legend>
          <div class="form-group">
            <label for="calendar-select" class="sr-only">Choose Calendar</label>
            <select id="calendar-select"
                    v-model="state.event.calendarId"
                    :aria-describedby="state.err ? 'calendar-error' : null">
              <option v-for="calendar in state.availableCalendars" :key="calendar.id" :value="calendar.id">
                {{ calendar.content('en').name || calendar.urlName }}
              </option>
            </select>
          </div>
        </fieldset>

        <!-- Event Description -->
        <fieldset class="description">
          <legend>{{ t('event_description_label') }}</legend>
          <div class="language-controls">
            <div class="form-group">
              <label for="language-select">Language</label>
              <select id="language-select" v-model="state.lang">
                <option v-for="lang in languages" :key="lang" :value="lang">{{ iso6391.getName(lang) }}</option>
              </select>
            </div>
            <button type="button"
                    :aria-label="t('add_language')"
                    @click="state.showLanguagePicker=true;">
              +
            </button>
          </div>

          <div v-for="language in languages" :key="language">
            <div v-if="language == state.lang"
                 :dir="iso6391.getDir(language) == 'rtl' ? 'rtl' : ''"
                 class="event-content-fields">
              <div class="form-group">
                <label :for="`event-name-${language}`">Event Name</label>
                <input :id="`event-name-${language}`"
                       type="text"
                       name="name"
                       :placeholder="t('name_placeholder')"
                       v-model="state.event.content(language).name"
                       required />
              </div>

              <div class="form-group">
                <label :for="`event-description-${language}`">Event Description</label>
                <input :id="`event-description-${language}`"
                       type="text"
                       name="description"
                       :placeholder="t('description_placeholder')"
                       v-model="state.event.content(language).description" />
              </div>

              <button type="button"
                      @click="removeLanguage(language)"
                      :aria-label="`Remove ${iso6391.getName(language)} language`">
                {{ t('remove_language') }}
              </button>
            </div>
          </div>
        </fieldset>

        <!-- Location Information -->
        <fieldset class="location">
          <legend>{{ t('location_label') }}</legend>
          <div class="form-group">
            <label for="location-name">Location Name</label>
            <input id="location-name"
                   type="text"
                   name="name"
                   :placeholder="t('location_name_placeholder')"
                   v-model="state.event.location.name" />
          </div>

          <div class="form-group">
            <label for="location-address">Address</label>
            <input id="location-address"
                   type="text"
                   name="address"
                   :placeholder="t('address_placeholder')"
                   :class="{ invalid: state.invalidFields.includes('address') }"
                   v-model="state.event.location.address" />
          </div>

          <div class="form-group">
            <label for="location-city">City</label>
            <input id="location-city"
                   type="text"
                   name="city"
                   :placeholder="t('city_placeholder')"
                   :class="{ invalid: state.invalidFields.includes('city') }"
                   v-model="state.event.location.city" />
          </div>

          <div class="form-group">
            <label for="location-state">State/Province</label>
            <input id="location-state"
                   type="text"
                   name="state"
                   :placeholder="t('state_placeholder')"
                   :class="{ invalid: state.invalidFields.includes('state') }"
                   v-model="state.event.location.state" />
          </div>

          <div class="form-group">
            <label for="location-postal">Postal Code</label>
            <input id="location-postal"
                   type="text"
                   name="postalCode"
                   :placeholder="t('postalCode_placeholder')"
                   :class="{ invalid: state.invalidFields.includes('postalCode') }"
                   v-model="state.event.location.postalCode" />
          </div>
        </fieldset>

        <!-- Media Upload -->
        <fieldset class="images">
          <legend>{{ t('image_label') }}</legend>
          <ImageUpload
            :calendar-id="state.event.calendarId || 'default'"
            :multiple="false"
            @upload-complete="handleImageUpload"
            aria-label="Event Image Upload"
          />
        </fieldset>

        <!-- Categories -->
        <fieldset class="categories">
          <legend>Event Categories</legend>
          <CategorySelector
            :calendar-id="state.event.calendarId"
            :selected-categories="state.selectedCategories"
            @categories-changed="handleCategoriesChanged"
            aria-label="Select Event Categories"
          />
        </fieldset>

        <!-- Event Scheduling -->
        <fieldset class="scheduling">
          <legend>{{ t('dates_label') }}</legend>
          <div class="schedule-list" role="group" aria-label="Event Schedules">
            <div class="schedule"
                 v-for="(schedule, index) in state.event.schedules"
                 :key="index"
                 role="group"
                 :aria-label="`Schedule ${index + 1}`">
              <button class="remove"
                      v-if="state.event.schedules.length > 1"
                      type="button"
                      @click="state.event.dropSchedule(index)"
                      :aria-label="`Remove schedule ${index + 1}`">
                &times;
              </button>
              <EventRecurrenceView :schedule="schedule" />
            </div>
          </div>
          <button type="button"
                  @click="state.event.addSchedule()"
                  aria-label="Add new schedule">
            {{ t("add_date_button") }}
          </button>
        </fieldset>

        <!-- Form Actions -->
        <footer class="form-actions">
          <button type="button"
                  class="btn btn--secondary"
                  @click="handleBack">
            {{ t("close_button") }}
          </button>
          <button type="submit" class="primary">
            {{ (state.event.id && !state.isDuplicationMode) ? t("update_button") : t("create_button") }}
          </button>
        </footer>
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

  <!-- Unsaved Changes Confirmation Dialog -->
  <ModalLayout
    v-if="state.showUnsavedChangesDialog"
    :title="t('unsaved_changes_title', 'Unsaved Changes')"
    @close="cancelLeave"
  >
    <div class="unsaved-changes-confirmation">
      <p>{{ t('unsaved_changes_message', 'You have unsaved changes. Are you sure you want to leave?') }}</p>
      <div class="dialog-actions">
        <button
          type="button"
          @click="cancelLeave"
        >
          {{ t('unsaved_changes_cancel', 'Stay') }}
        </button>
        <button
          type="button"
          class="danger"
          @click="confirmLeave"
        >
          {{ t('unsaved_changes_confirm', 'Leave') }}
        </button>
      </div>
    </div>
  </ModalLayout>
</template>

<script setup>
import { reactive, ref, onBeforeMount, onMounted, computed, watch, nextTick } from 'vue';
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { CalendarEvent } from '@/common/model/events';
import { EventLocation } from '@/common/model/location';
import { validateLocationHierarchy } from '@/common/model/location';
import { useCalendarStore } from '@/client/stores/calendarStore';
import CalendarService from '@/client/service/calendar';
import EventService from '@/client/service/event';
import CategoryService from '@/client/service/category';
import ModelService from '@/client/service/models';
import EventRecurrenceView from './event_recurrence.vue';
import languagePicker from '@/client/components/common/languagePicker.vue';
import ImageUpload from '@/client/components/common/media/ImageUpload.vue';
import CategorySelector from './CategorySelector.vue';
import ModalLayout from '@/client/components/common/modal.vue';
import iso6391 from 'iso-639-1-dir';
import { useEventDuplication } from '@/client/composables/useEventDuplication';

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
  showUnsavedChangesDialog: false,
  lang: defaultLanguage,
  availableCalendars: [],
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

  // Validate location hierarchy
  const locationErrors = validateLocationHierarchy(model.location);
  if (locationErrors.length > 0) {
    state.err = locationErrors.map(errorCode => {
      switch (errorCode) {
        case 'LOCATION_CITY_REQUIRES_ADDRESS':
          return t('error_location_city_requires_address');
        case 'LOCATION_STATE_REQUIRES_CITY':
          return t('error_location_state_requires_city');
        case 'LOCATION_STATE_REQUIRES_ADDRESS':
          return t('error_location_state_requires_address');
        case 'LOCATION_POSTAL_CODE_REQUIRES_STATE':
          return t('error_location_postal_code_requires_state');
        case 'LOCATION_POSTAL_CODE_REQUIRES_CITY':
          return t('error_location_postal_code_requires_city');
        case 'LOCATION_POSTAL_CODE_REQUIRES_ADDRESS':
          return t('error_location_postal_code_requires_address');
        default:
          return t('error_invalid_location');
      }
    });

    // Determine which fields are invalid based on error messages
    locationErrors.forEach(error => {
      if (error.includes('REQUIRES_CITY')) {
        state.invalidFields.push('city');
      }
      if (error.includes('REQUIRES_ADDRESS')) {
        state.invalidFields.push('address');
      }
      if (error.includes('REQUIRES_STATE')) {
        state.invalidFields.push('state');
      }
      if (error.includes('REQUIRES_POSTAL_CODE')) {
        state.invalidFields.push('postalCode');
      }
    });

    return;
  }

  try {
    if (state.mediaId) {
      model.mediaId = state.mediaId;
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

    // Update last interacted calendar
    calendarStore.setLastInteractedCalendar(model.calendarId);

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
