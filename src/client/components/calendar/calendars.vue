<script setup>
import { onBeforeMount, reactive, inject, ref, watch, nextTick, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { EmptyValueError, InvalidUrlNameError, UnauthenticatedError, UrlNameAlreadyExistsError } from '../../../common/exceptions';
import CalendarService from '../../service/calendar';

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
  <div v-if="state.calendars.length > 0">
    <p>{{ t('my_calendars_header') }}</p>
    <ul v-for="calendar in state.calendars">
      <RouterLink :to="`/calendar/${calendar.urlName}`">
        <li>{{ calendar.content("en").name || calendar.urlName }}</li>
      </RouterLink>
    </ul>
  </div>
  <div v-else class="empty-screen">
    <div class="calendar-url">
      <input
        type="text"
        v-model="newCalendarName"
        :style="{ width: inputWidth }"
        ref="inputRef"
        :placeholder="calendar_name_placeholder"
        @focus="updateInputWidth"
        @keydown.enter="createCalendar"
      />@{{ site_domain }}
    </div>
    <div class="help-text">{{ t('calendar_name_help') }}</div>
    <div v-if="state.errorMessage" class="error-message">{{ state.errorMessage }}</div>
    <button type="button"
            class="primary"
            @click="createCalendar"
            :disabled="state.isLoading">
      {{ state.isLoading ? t('creating_calendar') : t('create_calendar_button') }}
    </button>
  </div>
</template>

<style scoped lang="scss">
@use '../../assets/mixins' as *;

div.calendar-url {
  font-size: 12pt;
  color: $light-mode-secondary-text;
  input {
    border: 0;
    border-bottom: 1px solid $light-mode-border;
    background: none;
    font-size: 100%;
    color: $light-mode-text;
    text-align: end;
  }
  @include medium-size-device {
    font-size: 14pt;
  }
}

.error-message {
  color: #d32f2f; // Using a standard red color for errors in light mode
  font-size: 0.9rem;
}

.help-text {
  color: $light-mode-secondary-text;
  font-size: 0.85rem;
  margin-top: 0.5rem;
  margin-bottom: 0.5rem;
  line-height: 1.4;
}

@include dark-mode {
    div.calendar-url {
        color: $dark-mode-secondary-text;
        input {
          border-color: $dark-mode-border;
          color: $dark-mode-text;
        }
    }

    .error-message {
      color: #f44336; // A brighter red for visibility in dark mode
    }

    .help-text {
      color: $dark-mode-secondary-text;
    }
}

.empty-screen {
  @include empty-screen;
}
</style>
