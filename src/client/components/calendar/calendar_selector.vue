<template>
  <ModalLayout :title="t('select_calendar_title')" @close="$emit('cancel')">
    <div class="calendar-selector">
      <div v-if="state.error" class="error">{{ state.error }}</div>
      <p v-if="calendars.length > 0">{{ t('select_calendar_instructions') }}</p>
      <div v-if="state.loading" class="loading">
        {{ t('loading_calendars') }}
      </div>
      <ul v-else-if="calendars.length > 0" class="calendar-list">
        <li v-for="calendar in calendars"
            :key="calendar.id"
            @click="selectCalendar(calendar)"
            class="calendar-item">
          {{ calendar.content('en').name || calendar.urlName }}
        </li>
      </ul>
      <div v-else class="no-calendars">
        <p>{{ t('no_calendars') }}</p>
      </div>
      <div class="actions">
        <button type="button" class="primary-button" @click="$emit('cancel')">{{ t('cancel_button') }}</button>
      </div>
    </div>
  </ModalLayout>
</template>

<script setup>
import { onBeforeMount, reactive, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import ModalLayout from '../modal.vue';
import CalendarService from '../../service/calendar';

const { t } = useTranslation('calendars', {
  keyPrefix: 'selector',
});

const emit = defineEmits(['select', 'cancel']);

const calendars = ref([]);
const state = reactive({
  loading: true,
  error: '',
});

onBeforeMount(async () => {
  try {
    state.loading = true;
    calendars.value = await CalendarService.loadCalendars();
    state.loading = false;
  }
  catch (error) {
    console.error('Error loading calendars:', error);
    state.error = t('error_loading_calendars');
    state.loading = false;
  }
});

const selectCalendar = (calendar) => {
  emit('select', calendar);
};
</script>

<style scoped lang="scss">
@use '../../assets/mixins' as *;

.calendar-selector {
  display: flex;
  flex-direction: column;
  gap: 1rem;

  .error {
    color: red;
    margin-bottom: 1rem;
  }

  .calendar-list {
    list-style: none;
    padding: 0;
    margin: 0;

    .calendar-item {
      padding: 0.8rem 1rem;
      border: 1px solid $light-mode-border;
      border-radius: 6px;
      cursor: pointer;
      margin-bottom: 0.5rem;
      transition: background-color 0.2s;

      &:hover {
        background-color: $light-mode-selected-background;
      }

      @include dark-mode {
        border-color: $dark-mode-border;

        &:hover {
          background-color: $dark-mode-selected-background;
        }
      }
    }
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 1rem;

    button {
      font-size: 14px;
      border: 1px solid $light-mode-border;
      border-radius: 6px;
      padding: 6px 10px;
      margin-left: 10px;

      @include dark-mode {
        color: $dark-mode-text;
        background: $dark-mode-background;
        border-color: $dark-mode-border;
      }
    }
  }
}
</style>
