<template>
  <ModalLayout :title="t('select_calendar_title')" @close="$emit('cancel')">
    <div class="calendar-selector">
      <div v-if="state.error" class="alert error">{{ state.error }}</div>
      <p v-if="calendarsWithRelationship.length > 0">{{ t('select_calendar_instructions') }}</p>
      <div v-if="state.loading" class="loading">
        {{ t('loading_calendars') }}
      </div>
      <ul v-else-if="calendarsWithRelationship.length > 0" class="calendar-list">
        <li v-for="calendarInfo in calendarsWithRelationship"
            :key="calendarInfo.calendar.id"
            @click="selectCalendar(calendarInfo)"
            class="calendar-item"
            :class="{
              'editor-calendar': calendarInfo.isEditor,
              'selected': isSelected(calendarInfo.calendar.id)
            }">
          <div class="calendar-name">
            {{ calendarInfo.calendar.content('en').name || calendarInfo.calendar.urlName }}
          </div>
          <div class="badges">
            <div v-if="isSelected(calendarInfo.calendar.id)" class="relationship-badge last-used">
              {{ t('last_used_badge') }}
            </div>
            <div v-if="calendarInfo.isEditor" class="relationship-badge">
              {{ t('editor_badge') }}
            </div>
          </div>
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
import { onBeforeMount, reactive, ref, computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import ModalLayout from '@/client/components/common/modal.vue';
import CalendarService from '@/client/service/calendar';
import { useCalendarStore } from '@/client/stores/calendarStore';

const { t } = useTranslation('calendars', {
  keyPrefix: 'selector',
});

const emit = defineEmits(['select', 'cancel']);

const calendarStore = useCalendarStore();
const calendarsWithRelationship = ref([]);
const state = reactive({
  loading: true,
  error: '',
});
const calendarService = new CalendarService();

const selectedCalendar = computed(() => calendarStore.selectedCalendar);

onBeforeMount(async () => {
  try {
    state.loading = true;
    calendarsWithRelationship.value = await calendarService.loadCalendarsWithRelationship();
    state.loading = false;
  }
  catch (error) {
    console.error('Error loading calendars:', error);
    state.error = t('error_loading_calendars');
    state.loading = false;
  }
});

const isSelected = (calendarId) => {
  return selectedCalendar.value?.id === calendarId;
};

const selectCalendar = (calendarInfo) => {
  // Update the selected calendar in the store
  calendarStore.setSelectedCalendar(calendarInfo.calendar.id);

  // Emit the calendar object itself, not the CalendarInfo wrapper
  emit('select', calendarInfo.calendar);
};
</script>

<style scoped lang="scss">
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
      border: 1px solid var(--pav-color-border-primary);
      border-radius: 6px;
      cursor: pointer;
      margin-bottom: 0.5rem;
      transition: background-color 0.2s;
      display: flex;
      justify-content: space-between;
      align-items: center;

      &:hover {
        background-color: var(--pav-color-surface-hover);
      }

      &.editor-calendar {
        border-left: 3px solid #3b82f6;
      }

      &.selected {
        background-color: rgba(59, 130, 246, 0.1);
        border-color: #3b82f6;
      }

      .calendar-name {
        flex: 1;
        font-weight: 500;
      }

      .badges {
        display: flex;
        gap: 0.5rem;
      }

      .relationship-badge {
        background-color: #3b82f6;
        color: white;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 500;

        &.last-used {
          background-color: #10b981;
        }
      }

      @media (prefers-color-scheme: dark) {
        &.editor-calendar {
          border-left-color: #60a5fa;
        }

        &.selected {
          background-color: rgba(96, 165, 250, 0.15);
          border-color: #60a5fa;
        }

        .relationship-badge {
          background-color: #60a5fa;

          &.last-used {
            background-color: #34d399;
          }
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
      border: 1px solid var(--pav-color-border-primary);
      border-radius: 6px;
      padding: 6px 10px;
      margin-left: 10px;
      color: var(--pav-color-text-primary);
      background: var(--pav-color-surface-primary);
    }
  }
}
</style>
