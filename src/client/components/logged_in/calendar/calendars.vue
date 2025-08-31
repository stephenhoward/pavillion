<script setup>
import { onBeforeMount, reactive, inject, ref, watch, nextTick, onMounted } from 'vue';
import { useRouter } from 'vue-router';
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
const state = reactive({
  err: '',
  calendars: [],
  isLoading: false,
  errorMessage: '',
});

const newCalendarName = ref('');
const inputRef = ref(null);
const inputWidth = ref('100px'); // default width
const calendar_name_placeholder = t('calendar_name_placeholder');

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

// Create a new calendar with the name from the input field
// TODO: run this function when the user hits enter
async function createCalendar() {
  const calendarName = newCalendarName.value.trim();
  state.isLoading = true;
  state.errorMessage = '';

  try {
    const calendar = await calendarService.createCalendar(calendarName);

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
    <nav v-if="state.calendars.length > 0" :aria-label="t('aria_my_calendars_navigation')">
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
    <EmptyLayout  v-else :title="t('create_first_calendar_header')">
      <form @submit.prevent="createCalendar" :aria-label="t('aria_new_calendar_form')">
        <fieldset>
          <legend class="sr-only">{{ t('legend_calendar_creation') }}</legend>
          <div class="calendar-url">
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
            />@{{ site_domain }}
          </div>
          <div v-if="state.errorMessage"
               id="calendar-error"
               class="alert alert--error"
               role="alert"
               aria-live="polite">
            {{ state.errorMessage }}
          </div>
          <div id="calendar-help" class="help-text">{{ t('calendar_name_help') }}</div>
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
