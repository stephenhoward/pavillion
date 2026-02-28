<script setup lang="ts">
import { onBeforeMount, reactive, inject, ref, watch, nextTick, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { EmptyValueError, InvalidUrlNameError, UnauthenticatedError, UrlNameAlreadyExistsError } from '@/common/exceptions';
import CalendarService from '@/client/service/calendar';
import EmptyLayout from '@/client/components/common/empty_state.vue';

const site_config = inject('site_config');
const site_domain = site_config.settings().domain;
const calendarService = new CalendarService();

const { t } = useTranslation('calendars', {
  keyPrefix: 'list',
});

const router = useRouter();
const route = useRoute();
const state = reactive({
  err: '',
  calendars: [],
  isLoading: false,
  errorMessage: '',
  showCreationForm: false,
});

const newCalendarName = ref('');
const newCalendarTitle = ref('');
const inputRef = ref(null);
const inputWidth = ref('100px'); // default width
const calendar_name_placeholder = t('calendar_name_placeholder');
// Tracks whether the user has manually edited the calendar name field.
// Once true, auto-fill from title is disabled.
const calendarNameManuallyEdited = ref(false);

// Regex matching server-side isValidUrlName
const VALID_URL_NAME_RE = /^[a-z0-9][a-z0-9_-]{1,22}[a-z0-9_]$/i;

/**
 * Converts a human-readable title into a URL-safe calendar name slug.
 * Lowercases, strips special characters, replaces spaces with hyphens,
 * collapses consecutive hyphens, truncates to 24 chars, and strips
 * leading/trailing hyphens or underscores.
 */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 24)
    .replace(/^[-_]|[-_]$/g, '');
}

// Auto-populate calendar name from title while the user hasn't manually edited it
watch(newCalendarTitle, (title) => {
  if (!calendarNameManuallyEdited.value) {
    newCalendarName.value = slugify(title);
  }
});

// Mark the calendar name field as manually edited when the user types in it directly
function onCalendarNameInput() {
  calendarNameManuallyEdited.value = true;
}

// Function to calculate and set the width of the input
const updateInputWidth = () => {
  if (!inputRef.value) return;

  // Create a temporary span to measure text width
  const tempSpan = document.createElement('span');
  tempSpan.style.visibility = 'hidden';
  tempSpan.style.position = 'absolute';
  tempSpan.style.fontSize = window.getComputedStyle(inputRef.value).fontSize;
  tempSpan.style.fontFamily = window.getComputedStyle(inputRef.value).fontFamily;
  tempSpan.style.padding = window.getComputedStyle(inputRef.value).padding;

  // Use either the input value or placeholder for measurement
  const textToMeasure = newCalendarName.value || calendar_name_placeholder;
  tempSpan.textContent = textToMeasure;

  document.body.appendChild(tempSpan);
  const width = tempSpan.getBoundingClientRect().width;
  document.body.removeChild(tempSpan);

  // Set the width with a small buffer (10px)
  inputWidth.value = `${Math.max(width + 10, 50)}px`;
};

onMounted(() => {
  updateInputWidth();
});

// Watch for changes in the input value to update width
watch(newCalendarName, () => {
  nextTick(updateInputWidth);
});

onBeforeMount(async () => {
  loadCalendars();
  state.isLoading = true;
});

// Load calendar data and handle routing
async function loadCalendars() {
  try {
    const calendars = await calendarService.loadCalendars();

    // If the route is /calendar/new, always show the creation form
    if (route.path === '/calendar/new') {
      state.showCreationForm = true;
      return;
    }

    // If there is only one calendar, redirect to it
    if (calendars.length === 1) {
      router.push({ path: '/calendar/' + calendars[0].urlName });
    }
    else {
      state.calendars = calendars;
    }
  }
  catch (error) {
    console.error('Error loading calendars:', error);
    state.err = 'Failed to load calendars';
  }
  finally {
    state.isLoading = false;
  }
}

// Validate url name client-side before sending to server
function validateCalendarName(calendarName: string): string | null {
  if (!calendarName || calendarName.trim() === '') {
    return t('error_empty_calendar_name');
  }
  if (!VALID_URL_NAME_RE.test(calendarName.trim())) {
    return t('error_invalid_calendar_name');
  }
  return null;
}

// Create a new calendar with the name from the input field
async function createCalendar() {
  const calendarName = newCalendarName.value.trim();
  const calendarTitle = newCalendarTitle.value.trim();
  state.errorMessage = '';

  // Client-side validation — skip server round-trip for known-invalid input
  const validationError = validateCalendarName(calendarName);
  if (validationError) {
    state.errorMessage = validationError;
    return;
  }

  state.isLoading = true;

  try {
    const calendar = await calendarService.createCalendar(calendarName, calendarTitle || undefined);

    // Navigate to the new calendar
    router.push({ path: '/calendar/' + calendar.urlName });
  }
  catch (error) {
    console.error('Error creating calendar:', error);
    switch( error.constructor ) {
      case EmptyValueError:
        state.errorMessage = t('error_empty_calendar_name');
        break;
      case InvalidUrlNameError:
        state.errorMessage = t('error_invalid_calendar_name');
        break;
      case UrlNameAlreadyExistsError:
        state.errorMessage = t('error_calendar_name_taken');
        break;
      case UnauthenticatedError:
        router.push({ path: '/auth/login' });
        break;
      default:
        state.errorMessage = t('error_create_calendar');
    }
  }
  finally {
    state.isLoading = false;
  }
}
</script>

<template>
  <main role="main" :aria-label="t('aria_calendar_management')">
    <nav v-if="state.calendars.length > 0 && !state.showCreationForm" :aria-label="t('aria_my_calendars_navigation')">
      <section>
        <h2>{{ t('my_calendars_header') }}</h2>
        <ul role="list">
          <li v-for="calendar in state.calendars" :key="calendar.id" role="listitem">
            <RouterLink
              :to="`/calendar/${calendar.urlName}`"
              :aria-label="t('aria_view_calendar', { calendarName: calendar.content('en').name || calendar.urlName })">
              {{ calendar.content("en").name || calendar.urlName }}
            </RouterLink>
          </li>
        </ul>
      </section>
    </nav>
    <EmptyLayout v-else :title="t('create_first_calendar_header')">
      <form @submit.prevent="createCalendar" :aria-label="t('aria_new_calendar_form')">
        <fieldset>
          <legend class="sr-only">{{ t('legend_calendar_creation') }}</legend>
          <div class="calendar-title-field">
            <label for="calendar-title">{{ t('label_calendar_title') }}</label>
            <input
              id="calendar-title"
              type="text"
              v-model="newCalendarTitle"
              :placeholder="t('calendar_title_placeholder')"
              class="title-input"
              aria-describedby="calendar-title-help"
            />
            <div id="calendar-title-help" class="help-text">{{ t('calendar_title_help') }}</div>
          </div>
          <div class="calendar-url" :class="{ 'calendar-url--error': state.errorMessage }">
            <label for="calendar-name" class="sr-only">{{ t('label_calendar_name') }}</label>
            <input
              id="calendar-name"
              type="text"
              v-model="newCalendarName"
              :style="{ width: inputWidth }"
              ref="inputRef"
              :placeholder="calendar_name_placeholder"
              :aria-describedby="state.errorMessage ? 'calendar-error' : 'calendar-help'"
              @focus="updateInputWidth"
              @keydown.enter="createCalendar"
              @input="onCalendarNameInput"
            />@{{ site_domain }}
          </div>
          <div v-if="state.errorMessage"
               id="calendar-error"
               class="alert alert--error"
               role="alert"
               aria-live="polite">
            {{ state.errorMessage }}
          </div>
          <div v-if="!state.errorMessage" id="calendar-help" class="help-text">{{ t('calendar_name_help') }}</div>
          <button type="submit"
                  class="primary"
                  :disabled="state.isLoading"
                  :aria-label="state.isLoading ? t('creating_calendar') : t('create_calendar_button')">
            {{ state.isLoading ? t('creating_calendar') : t('create_calendar_button') }}
          </button>
        </fieldset>
      </form>
    </EmptyLayout>
  </main>
</template>

<style scoped lang="scss">

/* Semantic nav styling */
nav[aria-label="My Calendars Navigation"] {
  margin: var(--pav-space-lg) 0;

  section {
    padding: var(--pav-space-md);
  }

  h2 {
    font-size: var(--pav-font-size-heading-4);
    font-weight: var(--pav-font-weight-semibold);
    color: var(--pav-color-text-primary);
    margin-bottom: var(--pav-space-md);
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;

    li {
      margin-bottom: var(--pav-space-sm);

      a {
        display: block;
        padding: var(--pav-space-sm) var(--pav-space-md);
        color: var(--pav-color-text-primary);
        text-decoration: none;
        border-radius: var(--pav-border-radius-md);
        transition: background-color 0.2s ease;

        &:hover, &:focus {
          background-color: var(--pav-color-surface-secondary);
          text-decoration: underline;
        }

        &:focus-visible {
          outline: var(--pav-border-width-2) solid var(--pav-border-color-focus);
          outline-offset: var(--pav-space-xs);
        }
      }
    }
  }
}

.calendar-title-field {
  margin-bottom: var(--pav-space-md);

  label {
    display: block;
    font-size: var(--pav-font-size-body);
    font-weight: var(--pav-font-weight-medium);
    color: var(--pav-color-text-primary);
    margin-bottom: var(--pav-space-xs);
  }

  .title-input {
    width: 100%;
    max-width: 24rem;
    padding: var(--pav-space-sm);
    font-size: var(--pav-font-size-body);
    border: 1px solid var(--pav-color-border-primary);
    border-radius: var(--pav-border-radius-md);
    background: var(--pav-color-surface-primary);
    color: var(--pav-color-text-primary);

    &:focus {
      outline: none;
      border-color: var(--pav-border-color-focus);
    }
  }
}

div.calendar-url {
  font-size: 12pt;
  color: var(--pav-color-text-secondary);
  #calendar-name {
    border: 0;
    border-bottom: 1px solid var(--pav-color-border-primary);
    background: none;
    font-size: 100%;
    color: var(--pav-color-text-primary);
    text-align: end;
    &:focus {
      outline: none;
      border-bottom: 1px solid var(--pav-border-color-focus);
      box-shadow: none;
    }
  }
  &.calendar-url--error #calendar-name {
    border-bottom-color: var(--pav-color-border-error);
  }
  @media (min-width: 768px) {
    font-size: 14pt;
  }
}

.help-text {
  color: var(--pav-color-text-secondary);
  font-size: 0.85rem;
  margin-top: 0.5rem;
  margin-bottom: 0.5rem;
  line-height: 1.4;
}

</style>
