<style scoped lang="scss">
@use '../../assets/mixins' as *;
section {
    border-top: 1px soilid $light-mode-border;
    padding: 10px;
    margin-top: 10px;
    label {
        display: block;
        margin-bottom: 10px;
    }
    input {
        -webkit-appearance: none;
        -moz-appearance: none;
        appearance: none;
        font-size: 14px;
        display: block;
        margin: 6px 0;
        border-radius: 6px;
        border: 1px solid $light-mode-border;
        padding: 6px;
        @include dark-mode {
            color: $dark-mode-input-text;
            background: $dark-mode-input-background;
            border-color: $dark-mode-border;
        }
    }
    div.schedule {
        margin-bottom: 15px;
    }
    @include dark-mode {
        border-top: 1px solid $dark-mode-border;
    }
}
section.location, section.description {
    input[type="text"] {
        width: 100%;
    }
}
section.location {
    input[type="text"] {
        max-width: 500px;
    }
}
button {
    font-size: 14px;
    border: 1px solid $light-mode-border;
    border-radius: 6px;
    padding: 6px 10px;
    margin-right: 10px;
    @include dark-mode {
        color: $dark-mode-text;
        background: $dark-mode-background;
        border-color: $dark-mode-border;
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

div.schedule {
    width: 100%;
}
</style>

<template>
  <ModalLayout :title="props.event.id ? t('edit_event_title') : t('create_event_title')" @close="$emit('close')">
    <div class="event">
      <div class="error" v-if="state.err">{{ state.err }}</div>
      <section class="calendar-selection" v-if="availableCalendars.length > 1">
        <label>{{ t('calendar_label') }}</label>
        <select v-model="props.event.calendarId">
          <option v-for="calendar in availableCalendars" :key="calendar.id" :value="calendar.id">
            {{ calendar.content('en').name || calendar.urlName }}
          </option>
        </select>
      </section>
      <section class="description">
        <label>{{ t('event_description_label') }}</label>
        <select v-model="state.lang">
          <option v-for="lang in languages" :value="lang">{{  iso6391.getName(lang) }}</option>
        </select>
        <button :aria-label="t('add_language')" @click="state.showLanguagePicker=true;">➕</button>
        <div v-for="language in languages" >
          <div v-if="language == state.lang" :dir="iso6391.getDir(language) == 'rtl' ? 'rtl' : ''">
            <input type="text"
                   name="name"
                   v-bind:placeholder="t('name_placeholder')"
                   v-model="props.event.content(language).name"/>
            <input type="text"
                   name="description"
                   v-bind:placeholder="t('description_placeholder')"
                   v-model="props.event.content(language).description"/>
            <button @click="removeLanguage(language)">{{ t('remove_language') }}</button>
          </div>
        </div>
      </section>
      <section class="location">
        <label>{{ t('location_label') }}</label>
        <input type="text"
               name="name"
               v-bind:placeholder="t('location_name_placeholder')"
               v-model="props.event.location.name"/>
        <input type="text"
               name="address"
               v-bind:placeholder="t('address_placeholder')"
               v-model="props.event.location.address"/>
        <input type="text"
               name="city"
               v-bind:placeholder="t('city_placeholder')"
               v-model="props.event.location.city"/>
        <input type="text"
               name="state"
               v-bind:placeholder="t('state_placeholder')"
               v-model="props.event.location.state"/>
        <input type="text"
               name="postalCode"
               v-bind:placeholder="t('postalCode_placeholder')"
               v-model="props.event.location.postalCode"/>
      </section>
      <section>
        <label>{{ t('dates_label') }}</label>
        <div class="schedule" v-for="(schedule,index) in props.event.schedules">
          <button class="remove"
                  v-if="props.event.schedules.length > 1"
                  type="button"
                  @click="props.event.dropSchedule(index)">&times;</button>
          <EventRecurrenceView :schedule="schedule" />
        </div>
        <button type="button" @click="props.event.addSchedule()">{{ t("add_date_button") }}</button>
      </section>
      <section>
        <button type="submit" @click="saveModel(props.event)">{{ props.event.id ? t("update_button") : t("create_button") }}</button>
        <button type="button" @click="$emit('close')">{{ t("close_button") }}</button>
      </section>
    </div>
  </ModalLayout>
  <div v-if="state.showLanguagePicker">
    <language-picker :languages="availableLanguages"
                     :selectedLanguages="languages"
                     @close="state.showLanguagePicker = false"
                     @select="(lang) => addLanguage(lang)"/>
  </div>
</template>

<script setup>
import { reactive, ref, onBeforeMount, computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import { CalendarEvent } from '../../../common/model/events';
import { useEventStore } from '../../stores/eventStore';
import CalendarService from '../../service/calendar';
import EventService from '../../service/event';
import EventRecurrenceView from './event_recurrence.vue';
import languagePicker from '../languagePicker.vue';
import ModalLayout from '../modal.vue';
import iso6391 from 'iso-639-1-dir';

const eventStore = useEventStore();
const emit = defineEmits(['close']);

const { t } = useTranslation('event_editor', {
  keyPrefix: 'editor',
});
const props = defineProps({
  event: CalendarEvent,
});

let defaultLanguage = 'en';
let l = props.event.getLanguages();
l.unshift(defaultLanguage);
const languages = ref([...new Set(l)]);

let allLanguages = iso6391.getAllCodes();
allLanguages.unshift(defaultLanguage);
let availableLanguages = ref([...new Set(allLanguages)]);

const state = reactive({
  err: '',
  showLanguagePicker: false,
  lang: defaultLanguage,
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

const availableCalendars = ref([]);

onBeforeMount(async () => {
  try {
    // Load available calendars that the user can edit
    availableCalendars.value = await CalendarService.loadCalendars();

    if (!props.event.calendarId && availableCalendars.value.length > 0) {
      props.event.calendarId = availableCalendars.value[0].id;
    }
  }
  catch (error) {
    console.error('Error loading calendars:', error);
    state.err = t('error_loading_calendars');
  }
});

const saveModel = async (model) => {
  // Ensure we have a calendarId
  if (!model.calendarId && availableCalendars.value.length > 0) {
    model.calendarId = availableCalendars.value[0].id;
  }

  if (!model.calendarId) {
    state.err = t('error_no_calendar');
    return;
  }

  try {
    await EventService.createEvent(model);
  }
  catch (error) {
    console.error('Error saving event:', error);
    state.err = t('error_saving_event');
  }
};
</script>
