<script setup lang="ts">
/**
 * The confirm step of an editor's Leave calendar row (nav-list.vue).
 *
 * - Leaving revokes the viewer's own edit access, then drops the calendar
 *   from the calendar store and forgets it as the current calendar, so no
 *   list, switcher or forward still offers it.
 * - The store changes before the navigation: the settings root's forward at
 *   md+ reads the store, and must not land back on the calendar just left.
 *   The root replaces the page being left, whose calendar no longer
 *   resolves, so Back does not return to it.
 * - Dropping the calendar removes the row that mounted this dialog, so
 *   everything after the leave runs on the router and toast singletons, not
 *   on this component's state.
 */
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import CalendarService from '@/client/service/calendar';
import { calendarDisplayName } from '@/client/service/calendar-display';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { useToast } from '@/client/composables/useToast';
import ConfirmDeleteDialog from '@/client/components/common/confirm-delete-dialog.vue';
import { focusSettingsHeading } from './heading-focus';

const props = defineProps<{
  calendarUrlName: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useTranslation('calendars', { keyPrefix: 'editors' });
const router = useRouter();
const toast = useToast();
const calendarStore = useCalendarStore();

const isLeaving = ref(false);

async function leave() {
  const calendar = calendarStore.getCalendarByUrlName(props.calendarUrlName);
  if (!calendar || isLeaving.value) {
    return;
  }
  isLeaving.value = true;
  try {
    await new CalendarService().leaveCalendar(calendar);
  }
  catch (error) {
    console.error('Error leaving calendar:', error);
    toast.error(t('error_leaving_calendar'));
    isLeaving.value = false;
    return;
  }
  toast.success(t('left_calendar_success', { calendar: calendarDisplayName(calendar) }));
  await router.replace({ name: 'settings' });
  focusSettingsHeading();
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
