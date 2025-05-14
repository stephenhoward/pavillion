<script setup>
import { onBeforeMount, reactive, inject, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { Calendar } from '../../../common/model/calendar';
import ModelService from '../../service/models';

const site_config = inject('site_config');
const site_domain = site_config.settings().domain;

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

onBeforeMount(async () => {
  await loadCalendars();
});

// Load all calendars from the server
async function loadCalendars() {
  try {
    let calendars = await ModelService.listModels('/api/v1/calendars');
    if (calendars.length == 1) {
      // If there is only one calendar, redirect to it
      let calendar = calendars[0];
      router.push({ path: '/calendar/' + calendar.urlName });
    }
    else {
      state.calendars = calendars.map(calendar => Calendar.fromObject(calendar));
    }
  }
  catch (error) {
    console.error('Error loading calendars:', error);
    state.err = 'Failed to load calendars';
  }
}

// Create a new calendar with the name from the input field
// TODO: run this function when the user hits enter
async function createCalendar() {
  if (!newCalendarName.value || newCalendarName.value.trim() === '') {
    state.errorMessage = t('error_empty_calendar_name');
    return;
  }

  state.isLoading = true;
  state.errorMessage = '';

  try {
    // Check if calendar name is already taken
    const existingCalendars = await ModelService.listModels('/api/v1/calendars');
    const nameExists = existingCalendars.some(cal =>
      cal.urlName && cal.urlName.toLowerCase() === newCalendarName.value.toLowerCase(),
    );

    if (nameExists) {
      state.errorMessage = t('error_calendar_name_taken');
      state.isLoading = false;
      return;
    }

    // Create new calendar with the entered name
    const newCalendar = new Calendar();
    newCalendar.urlName = newCalendarName.value;

    // Set content for the default language
    const content = newCalendar.content('en');
    content.name = newCalendarName.value;

    // Send to server
    const createdCalendar = await ModelService.createModel(newCalendar, '/api/v1/calendars');

    // Navigate to the new calendar
    router.push({ path: '/calendar/' + newCalendarName.value });
  }
  catch (error) {
    console.error('Error creating calendar:', error);
    state.errorMessage = t('error_create_calendar');
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
      https://{{ site_domain }}/@<input type="text" v-model="newCalendarName" placeholder="your-calendar-name" />
    </div>
    <div v-if="state.errorMessage" class="error-message">{{ state.errorMessage }}</div>
    <button type="button"
            class="primary"
            @click="createCalendar"
            :disabled="state.isLoading">
      {{ state.isLoading ? t('creating_calendar') : t('create_calendar_button') }}
    </button>
  </div>
</template>

<style lang="scss">
@use '../../assets/mixins' as *;

div.calendar-url {
  font-size: 12pt;
  margin: 6px 0px;
  color: $light-mode-secondary-text;
  margin-bottom: 30px;
  input {
    border: 0;
    border-bottom: 1px solid $light-mode-border;
    background: none;
    font-size: 100%;
    color: $light-mode-text;
  }
  @include medium-size-device {
    font-size: 14pt;
  }
}

.error-message {
  color: #d32f2f; // Using a standard red color for errors in light mode
  font-size: 0.9rem;
  margin-bottom: 15px;
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
}
</style>
