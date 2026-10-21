<script setup lang="ts">
/**
 * The confirm step of an editor's Leave button on the Account → Calendars
 * screen (account-calendars.vue).
 *
 * Leaving revokes the viewer's own edit access; the service then drops the
 * calendar from the calendar store and forgets it as the current calendar,
 * so no list, switcher or forward still offers it. On success the dialog
 * emits `left` and the screen decides where focus goes; on failure it stays
 * open with an error toast.
 */
import { ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import CalendarService from '@/client/service/calendar';
import { calendarDisplayName } from '@/client/service/calendar-display';
import { useToast } from '@/client/composables/useToast';
import ConfirmDeleteDialog from '@/client/components/common/confirm-delete-dialog.vue';
import type { Calendar } from '@/common/model/calendar';

const props = defineProps<{
  calendar: Calendar;
}>();

const emit = defineEmits<{
  close: [];
  left: [];
}>();

const { t } = useTranslation('calendars', { keyPrefix: 'editors' });
const toast = useToast();

const isLeaving = ref(false);

async function leave() {
  if (isLeaving.value) {
    return;
  }
  isLeaving.value = true;
  try {
    await new CalendarService().leaveCalendar(props.calendar);
  }
  catch (error) {
    console.error('Error leaving calendar:', error);
    toast.error(t('error_leaving_calendar'));
    isLeaving.value = false;
    return;
  }
  toast.success(t('left_calendar_success', { calendar: calendarDisplayName(props.calendar) }));
  emit('left');
}
</script>

<template>
  <ConfirmDeleteDialog
    :visible="true"
    :title="t('confirm_leave_title')"
    :message="t('confirm_leave_message')"
    :is-deleting="isLeaving"
    :delete-label="t('leave_calendar_button')"
    :deleting-label="t('leaving')"
    :cancel-label="t('cancel_button')"
    @confirm="leave"
    @close="emit('close')"
  />
</template>
