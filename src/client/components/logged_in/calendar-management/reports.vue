<script setup lang="ts">
/**
 * The calendar's Reports leaf: the owner's moderation dashboard, and the
 * report named by reports/:reportId. calendar-management/root.vue mounts
 * this only for the calendar's owner, so ownership is not re-checked here.
 *
 * A reportId opens only after two gates, in order: it is a single well-formed
 * UUID v4, then the report resolves on this calendar. Any failure (malformed,
 * unknown, another calendar's, forbidden, or a failed request) replaces to
 * the plain list silently, so the URL never discloses whether a report
 * exists. The leaf watches the param, so a new reportId on the mounted leaf
 * opens that report.
 */
import { nextTick, ref, useId, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ReportsDashboard from '@/client/components/moderation/reports-dashboard.vue';
import ReportDetail from '@/client/components/moderation/report-detail.vue';
import ModerationService from '@/client/service/moderation';
import { isReportId } from '@/client/service/settings-guards';

const props = defineProps<{
  calendarId: string;
}>();

const route = useRoute();
const router = useRouter();
const moderationService = new ModerationService();

const headingId = useId();
const selectedReportId = ref<string | null>(null);
const regionRef = ref<HTMLElement | null>(null);

const reportsRoute = () => ({
  name: 'calendar_reports',
  params: { calendar: route.params.calendar },
});

/**
 * Opens the report a reportId param names, or falls back to the list.
 *
 * Resolves through ModerationService directly, never the moderation store's
 * fetchReport, which would leave a stale store error behind on failure.
 *
 * @param requested - The route's reportId param, absent on the list route
 */
const openReport = async (requested: unknown) => {
  if (requested === undefined) {
    selectedReportId.value = null;
    return;
  }

  if (!isReportId(requested)) {
    selectedReportId.value = null;
    router.replace(reportsRoute());
    return;
  }

  let resolved = true;
  try {
    await moderationService.getReport(props.calendarId, requested);
  }
  catch {
    // Unknown and inaccessible reports are indistinguishable: no banner, no
    // toast. The service still logs the failure to the console.
    resolved = false;
  }

  // The param moved on while the request was in flight; that change owns the outcome.
  if (route.params.reportId !== requested) {
    return;
  }

  if (!resolved) {
    selectedReportId.value = null;
    router.replace(reportsRoute());
    return;
  }

  selectedReportId.value = requested;
  try {
    await nextTick();
    regionRef.value?.focus();
  }
  catch {
    // Focus is best-effort. This flush first renders ReportDetail, so a throw
    // from any job in it must not turn a rendered report into an error state.
  }
};

// Only this leaf's two routes are acted on: a navigation away (say, to the
// admin moderation_report_detail) changes the param before this unmounts.
watch(() => route.params.reportId, (requested) => {
  if (route.name === 'calendar_reports' || route.name === 'calendar_report_detail') {
    openReport(requested);
  }
}, { immediate: true });

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
  <div
    v-if="selectedReportId"
    ref="regionRef"
    tabindex="-1"
    role="region"
    :aria-labelledby="headingId"
  >
    <ReportDetail
      :key="selectedReportId"
      :calendar-id="calendarId"
      :report-id="selectedReportId"
      :heading-id="headingId"
      @back="router.push(reportsRoute())"
    />
  </div>
  <ReportsDashboard
    v-else
    :calendar-id="calendarId"
    @view-report="viewReport"
  />
</template>

