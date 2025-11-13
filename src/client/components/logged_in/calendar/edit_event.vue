<style scoped lang="scss">
@use '@/client/assets/mixins' as *;

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
  padding: var(--pav-space-lg);
}

/* Form styling */
form {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-lg);
}

/* Error styling */
.error {
  color: #d32f2f;
  font-size: 0.9rem;
  padding: var(--pav-space-sm);
  border-radius: var(--pav-border-radius-sm);
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
  padding: var(--pav-space-lg);
  margin: 0;
  background-color: var(--pav-color-surface-primary);

  legend {
    font-weight: var(--pav-font-weight-semibold);
    font-size: var(--pav-font-size-heading-5);
    color: var(--pav-color-text-primary);
    padding: 0 var(--pav-space-sm);
  }
}

/* Form group styling */
.form-group {
  margin-bottom: var(--pav-space-md);

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
    padding: var(--pav-space-sm);
    background-color: var(--pav-color-surface-primary);
    color: var(--pav-color-text-primary);
    transition: border-color 0.2s ease;

    &:focus {
      outline: none;
      border-color: var(--pav-color-interactive-primary);
      box-shadow: 0 0 0 2px rgba(var(--pav-color-interactive-primary-rgb), 0.2);
    }

    &:required {
      border-left: 3px solid var(--pav-color-interactive-primary);
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
    @extend input;
  }
}

/* Language controls */
.language-controls {
  display: flex;
  align-items: end;
  gap: var(--pav-space-sm);
  margin-bottom: var(--pav-space-md);

  label {
    margin-bottom: var(--pav-space-xs);
  }

  select {
    flex: 1;
  }

  button {
    padding: var(--pav-space-sm);
    border: 1px solid var(--pav-color-border-primary);
    border-radius: var(--pav-border-radius-sm);
    background-color: var(--pav-color-surface-secondary);
    color: var(--pav-color-text-primary);
    cursor: pointer;

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
  padding: var(--pav-space-md);
  background-color: var(--pav-color-surface-secondary);
  border-radius: var(--pav-border-radius-sm);
  border: 1px solid var(--pav-color-border-secondary);
}

/* Location fieldset specific styling */
fieldset.location {
  .form-group {
    &:nth-child(1) input { // Location name
      max-width: 500px;
    }
  }
}

/* Schedule styling */
.schedule-list {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-md);
}

.schedule {
  position: relative;
  padding: var(--pav-space-md);
  border: 1px solid var(--pav-color-border-secondary);
  border-radius: var(--pav-border-radius-sm);
  background-color: var(--pav-color-surface-secondary);

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

    &:hover {
      color: var(--pav-color-danger);
      background-color: rgba(var(--pav-color-danger-rgb), 0.1);
      border-radius: var(--pav-border-radius-sm);
    }
  }
}

/* Form actions footer */
.form-actions {
  display: flex;
  gap: var(--pav-space-md);
  justify-content: flex-end;
  padding-top: var(--pav-space-lg);
  border-top: 1px solid var(--pav-color-border-secondary);
  margin-top: var(--pav-space-lg);
}

/* Legacy compatibility - maintain existing section styling patterns */
section {
  /* Maintain backward compatibility for any remaining section elements */
  border-top: 1px solid var(--pav-color-border-primary);
  padding: 10px;
  margin-top: 10px;

  @include dark-mode {
    border-top: 1px solid var(--pav-color-border-primary);
  }
}

/* Button styling that follows semantic system */
button {
  font-size: 14px;
  border: 1px solid var(--pav-color-border-primary);
  border-radius: var(--pav-border-radius-sm);
  padding: var(--pav-space-sm) var(--pav-space-md);
  margin-right: var(--pav-space-sm);
  background-color: var(--pav-color-surface-primary);
  color: var(--pav-color-text-primary);
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background-color: var(--pav-color-interactive-secondary-hover);
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
</style>

<template>
  <ModalLayout :title="getModalTitle" @close="$emit('close')">
    <main role="main" aria-label="Event Editor">
      <form @submit.prevent="saveModel(props.event)" aria-label="Event Information Form">
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
          <label for="calendar-select" class="sr-only">Choose Calendar</label>
          <select id="calendar-select"
                  v-model="props.event.calendarId"
                  :aria-describedby="state.err ? 'calendar-error' : null">
            <option v-for="calendar in state.availableCalendars" :key="calendar.id" :value="calendar.id">
              {{ calendar.content('en').name || calendar.urlName }}
            </option>
          </select>
        </fieldset>

        <!-- Event Description -->
        <fieldset class="description">
          <legend>{{ t('event_description_label') }}</legend>
          <div class="language-controls">
            <label for="language-select">Language</label>
            <select id="language-select" v-model="state.lang">
              <option v-for="lang in languages" :value="lang">{{ iso6391.getName(lang) }}</option>
            </select>
            <button type="button"
                    :aria-label="t('add_language')"
                    @click="state.showLanguagePicker=true;">
              ➕
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
                       v-model="props.event.content(language).name"
                       required />
              </div>

              <div class="form-group">
                <label :for="`event-description-${language}`">Event Description</label>
                <input :id="`event-description-${language}`"
                       type="text"
                       name="description"
                       :placeholder="t('description_placeholder')"
                       v-model="props.event.content(language).description" />
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
                   v-model="props.event.location.name" />
          </div>

          <div class="form-group">
            <label for="location-address">Address</label>
            <input id="location-address"
                   type="text"
                   name="address"
                   :placeholder="t('address_placeholder')"
                   :class="{ invalid: state.invalidFields.includes('address') }"
                   v-model="props.event.location.address" />
          </div>

          <div class="form-group">
            <label for="location-city">City</label>
            <input id="location-city"
                   type="text"
                   name="city"
                   :placeholder="t('city_placeholder')"
                   :class="{ invalid: state.invalidFields.includes('city') }"
                   v-model="props.event.location.city" />
          </div>

          <div class="form-group">
            <label for="location-state">State/Province</label>
            <input id="location-state"
                   type="text"
                   name="state"
                   :placeholder="t('state_placeholder')"
                   :class="{ invalid: state.invalidFields.includes('state') }"
                   v-model="props.event.location.state" />
          </div>

          <div class="form-group">
            <label for="location-postal">Postal Code</label>
            <input id="location-postal"
                   type="text"
                   name="postalCode"
                   :placeholder="t('postalCode_placeholder')"
                   :class="{ invalid: state.invalidFields.includes('postalCode') }"
                   v-model="props.event.location.postalCode" />
          </div>
        </fieldset>

        <!-- Media Upload -->
        <fieldset class="images">
          <legend>{{ t('image_label') }}</legend>
          <ImageUpload
            :calendar-id="props.event.calendarId || 'default'"
            :multiple="false"
            @upload-complete="handleImageUpload"
            aria-label="Event Image Upload"
          />
        </fieldset>

        <!-- Categories -->
        <fieldset class="categories">
          <legend>Event Categories</legend>
          <CategorySelector
            :calendar-id="props.event.calendarId"
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
                 v-for="(schedule, index) in props.event.schedules"
                 :key="index"
                 role="group"
                 :aria-label="`Schedule ${index + 1}`">
              <button class="remove"
                      v-if="props.event.schedules.length > 1"
                      type="button"
                      @click="props.event.dropSchedule(index)"
                      :aria-label="`Remove schedule ${index + 1}`">
                &times;
              </button>
              <EventRecurrenceView :schedule="schedule" />
            </div>
          </div>
          <button type="button"
                  @click="props.event.addSchedule()"
                  aria-label="Add new schedule">
            {{ t("add_date_button") }}
          </button>
        </fieldset>

        <!-- Form Actions -->
        <footer class="form-actions">
          <button type="submit" class="primary">
            {{ (props.event.id && !props.isDuplicationMode) ? t("update_button") : t("create_button") }}
          </button>
          <button type="button"
                  class="btn btn--secondary"
                  @click="$emit('close')">
            {{ t("close_button") }}
          </button>
        </footer>
      </form>
    </main>
  </ModalLayout>

  <div v-if="state.showLanguagePicker">
    <language-picker :languages="availableLanguages"
                     :selectedLanguages="languages"
                     @close="state.showLanguagePicker = false"
                     @select="(lang) => addLanguage(lang)" />
  </div>
</template>

<script setup>
import { reactive, ref, onBeforeMount, computed, watch, nextTick } from 'vue';
import { useTranslation } from 'i18next-vue';
import { CalendarEvent } from '@/common/model/events';
import { validateLocationHierarchy } from '@/common/model/location';
import CalendarService from '@/client/service/calendar';
import EventService from '@/client/service/event';
import CategoryService from '@/client/service/category';
import EventRecurrenceView from './event_recurrence.vue';
import languagePicker from '@/client/components/common/languagePicker.vue';
import ModalLayout from '@/client/components/common/modal.vue';
import ImageUpload from '@/client/components/common/media/ImageUpload.vue';
import CategorySelector from './CategorySelector.vue';
import iso6391 from 'iso-639-1-dir';
import { useEventDuplication } from '@/client/composables/useEventDuplication';

const emit = defineEmits(['close']);
const eventService = new EventService();
const categoryService = new CategoryService();
const { stripEventForDuplication } = useEventDuplication();

const { t } = useTranslation('event_editor', {
  keyPrefix: 'editor',
});
const props = defineProps({
  event: CalendarEvent,
  isDuplicationMode: {
    type: Boolean,
    default: false,
  },
});
const calendarService = new CalendarService();

let defaultLanguage = 'en';
let l = props.event.getLanguages();
l.unshift(defaultLanguage);
const languages = ref([...new Set(l)]);

let allLanguages = iso6391.getAllCodes();
allLanguages.unshift(defaultLanguage);
let availableLanguages = ref([...new Set(allLanguages)]);

const errorContainer = ref(null);

const state = reactive({
  err: '',
  showLanguagePicker: false,
  lang: defaultLanguage,
  availableCalendars: [],
  mediaId: null,
  calendar: null,
  selectedCategories: [],
  invalidFields: [],
});

// Watch for error changes and scroll into view
watch(() => state.err, async (newError) => {
  if (newError) {
    // Wait for the error container to be rendered
    await nextTick();
    await nextTick(); // Double nextTick to ensure v-if has rendered

    if (errorContainer.value) {
      // Find the scrollable dialog container and scroll to top
      const dialog = errorContainer.value.closest('dialog');
      if (dialog) {
        dialog.scrollTo({
          top: 0,
          behavior: 'smooth',
        });
      }
    }
  }
}, { deep: true });

const getModalTitle = computed(() => {
  if (props.isDuplicationMode) {
    return t('duplicate_event_title');
  }
  return props.event.id ? t('edit_event_title') : t('create_event_title');
});

const addLanguage = (language) => {
  languages.value = [...new Set(languages.value.concat(language))];
  state.lang = language;
};

const removeLanguage = (language) => {
  props.event.dropContent(language);
  languages.value = languages.value.filter(l => l != language);
  state.lang = languages.value[0];
};

const handleImageUpload = (results) => {
  if (results && results.length > 0 && results[0].success) {
    state.mediaId = results[0].media.id;
  }
};

const handleCategoriesChanged = (categories) => {
  state.selectedCategories = categories;
};


onBeforeMount(async () => {
  try {
    // If in duplication mode, strip the event data first
    if (props.isDuplicationMode) {
      const strippedEvent = stripEventForDuplication(props.event);
      // Update the event props in place
      Object.assign(props.event, strippedEvent);
    }

    // Load available calendars that the user can edit
    state.availableCalendars = await calendarService.loadCalendars();

    if (!props.event.calendarId && state.availableCalendars.length > 0) {
      props.event.calendarId = state.availableCalendars[0].id;
    }
    state.calendar = state.availableCalendars.filter(c => c.id === props.event.calendarId)[0];

    // Load existing categories for the event
    if (props.event.id && !props.isDuplicationMode) {
      // For existing events, load categories from the API
      try {
        const eventCategories = await categoryService.getEventCategories(props.event.id);
        state.selectedCategories = eventCategories.map(cat => cat.id);
      }
      catch (error) {
        console.error('Error loading event categories:', error);
        // Don't set error state for categories as it's not critical
      }
    }
    else if (props.isDuplicationMode && props.event.categories && props.event.categories.length > 0) {
      // For duplicated events, use the preserved categories from the event
      state.selectedCategories = props.event.categories.map(cat => cat.id);
    }

    // If in duplication mode and event has preserved media, initialize mediaId
    if (props.isDuplicationMode && props.event.mediaId) {
      state.mediaId = props.event.mediaId;
    }
  }
  catch (error) {
    console.error('Error loading calendars:', error);
    state.err = t('error_loading_calendars');
  }
});

const saveModel = async (model) => {
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

    // Save the event first
    await eventService.saveEvent(model);

    // Save category assignments if any categories are selected
    if (state.selectedCategories.length > 0) {
      try {
        await categoryService.assignCategoriesToEvent(model.id, state.selectedCategories);
      }
      catch (categoryError) {
        console.error('Error saving event categories:', categoryError);
        // Don't fail the entire save for category errors
      }
    }

    emit('close');
  }
  catch (error) {
    console.error('Error saving event:', error);
    state.err = t('error_saving_event');
  }
};
</script>
