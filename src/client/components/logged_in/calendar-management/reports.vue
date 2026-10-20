<script setup lang="ts">
/**
 * The calendar's Reports leaf: the owner's moderation dashboard. Opening a
 * report navigates to its detail route. calendar-management/root.vue mounts
 * this only for the calendar's owner.
 */
import { useRoute, useRouter } from 'vue-router';
import ReportsDashboard from '@/client/components/moderation/reports-dashboard.vue';

defineProps<{
  calendarId: string;
}>();

const route = useRoute();
const router = useRouter();

/**
 * Opens a report's detail route on this calendar.
 *
 * @param reportId - The report the dashboard row names
 */
const viewReport = (reportId: string) => {
  router.push({
    name: 'calendar_report_detail',
    params: { calendar: route.params.calendar, reportId },
  });
};
</script>

<template>
  <ReportsDashboard
    :calendar-id="calendarId"
    @view-report="viewReport"
  />
</template>
