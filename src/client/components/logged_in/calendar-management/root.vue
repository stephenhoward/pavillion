<script setup lang="ts">
import { reactive, computed, onBeforeMount, ref, nextTick } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute } from 'vue-router';
import { useTabNavigation } from '@/client/composables/useTabNavigation';
import EditorsTab from './editors.vue';
import SettingsTab from './settings.vue';
import WidgetTab from './widget-tab.vue';
import ImportSourcesSection from './import-sources/ImportSourcesSection.vue';
import ReportsDashboard from '@/client/components/moderation/reports-dashboard.vue';
import ReportDetail from '@/client/components/moderation/report-detail.vue';
import CalendarService from '../../../service/calendar';
import ModerationService from '@/client/service/moderation';
import Config from '@/client/service/config';
import { CalendarInfo } from '@/common/model/calendar_info';
import HelpButton from '@/client/components/common/help-button.vue';

/**
 * Strict UUID v4 shape, kept identical to the server's path-parameter
 * validation so client and server agree on what counts as malformed.
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const route = useRoute();
const calendarUrlName = Array.isArray(route.params.calendar)
  ? route.params.calendar[0]
  : route.params.calendar || '';

const { t } = useTranslation('calendars', {
  keyPrefix: 'management',
});

const calendarService = new CalendarService();
const moderationService = new ModerationService();

const state = reactive({
  activeTab: 'editors',
  calendarInfo: null as CalendarInfo | null,
  loading: false,
  error: null as string | null,
});

// Reports sub-navigation state
const selectedReportId = ref<string | null>(null);
const reportsPanelRef = ref<HTMLElement | null>(null);

const calendar = computed(() => state.calendarInfo?.calendar ?? null);
const isOwner = computed(() => state.calendarInfo?.isOwner ?? false);
const instanceHost = computed(() => new Config().settings()?.domain);

/**
 * Opens the report named by a `?report=<uuid>` deep link, e.g. when arriving
 * from a notification.
 *
 * Gates before it resolves: ownership first (reusing the same `isOwner`
 * predicate the reports tab is gated on), then the UUID shape, and only then
 * the fetch. An absent, malformed, unauthorised or non-existent report all
 * fall through to the plain management view, so the deep link never discloses
 * whether a report exists.
 */
const openReportFromQuery = async () => {
  const requestedReport = route.query.report;

  if (typeof requestedReport !== 'string') {
    return;
  }

  if (!isOwner.value) {
    return;
  }

  if (!UUID_REGEX.test(requestedReport)) {
    return;
  }

  const calendarId = calendar.value?.id;
  if (!calendarId) {
    return;
  }

  try {
    await moderationService.getReport(calendarId, requestedReport);
  }
  catch {
    // Non-existent and inaccessible reports both fall through to the plain
    // management view. Silent in the UI: no banner, no toast, nothing that
    // distinguishes the two. The service layer still logs the failure to the
    // console, which other callers rely on.
    return;
  }

  state.activeTab = 'reports';
  selectedReportId.value = requestedReport;

  try {
    // The panel is `hidden` until the tab activation renders, and a hidden
    // element cannot take focus, so the focus move waits for that render.
    await nextTick();
    reportsPanelRef.value?.focus();
  }
  catch {
    // Focus is best-effort. This flush is the one that first renders
    // ReportDetail, so a throw from any job in it must not escape into the
    // caller and turn a rendered report into an error state.
  }
};

onBeforeMount(async () => {
  state.loading = true;
  try {
    const calendarsWithRelationship = await calendarService.loadCalendarsWithRelationship();
    const found = calendarsWithRelationship.find(
      (info) => info.calendar.urlName === calendarUrlName,
    );
    state.calendarInfo = found ?? null;

    // Restore tab from query param (e.g. after Stripe checkout redirect)
    const requestedTab = route.query.tab as string | undefined;
    if (requestedTab && visibleTabs.value.includes(requestedTab)) {
      state.activeTab = requestedTab;
    }
  }
  catch (error) {
    console.error('Failed to load calendar:', error);
    state.error = t('error_loading_calendar');
  }
  finally {
    state.loading = false;
  }

  // Runs once the management view is rendering: the deep link focuses the
  // reports panel, which does not exist in the DOM while loading.
  await openReportFromQuery();
});

/**
 * Returns the ordered list of visible tabs based on ownership status.
 */
const visibleTabs = computed(() => {
  const tabs = ['editors'];
  if (isOwner.value) {
    tabs.push('reports', 'settings', 'import');
  }
  tabs.push('widget');
  return tabs;
});

const activateTab = (tab: string) => {
  // Prevent non-owners from activating owner-only tabs
  if ((tab === 'settings' || tab === 'reports' || tab === 'import') && !isOwner.value) {
    return;
  }

  state.activeTab = tab;

  // Reset report detail view when switching to reports tab
  if (tab === 'reports') {
    selectedReportId.value = null;
  }
};

const activeTabRef = computed(() => state.activeTab);
const { handleTabKeydown } = useTabNavigation(visibleTabs, activeTabRef, activateTab);

/**
 * Navigates to the report detail view within the reports tab.
 *
 * @param reportId - The ID of the report to view
 */
const viewReport = (reportId: string) => {
  selectedReportId.value = reportId;
};

/**
 * Returns to the reports dashboard from the report detail view.
 */
const backToReports = () => {
  selectedReportId.value = null;
};

</script>

<template>
  <div class="calendar-management-root">
    <div v-if="state.loading" class="loading-message">
      {{ t('loading_calendar') }}
    </div>

    <div v-else-if="state.error" class="error-message">
      {{ state.error }}
    </div>

    <template v-else-if="calendar">
      <!-- Header with tabs -->
      <header class="calendar-management-root__header">
        <div class="calendar-management-root__header-content">
          <div class="calendar-management-root__header-top">
            <nav class="calendar-management-root__breadcrumb" :aria-label="t('breadcrumb_label')">
              <span class="calendar-management-root__breadcrumb-item">{{ calendar.urlName }}</span>
              <span class="calendar-management-root__breadcrumb-separator">/</span>
              <span class="calendar-management-root__breadcrumb-item">{{ t('breadcrumb_settings') }}</span>
            </nav>
            <div class="calendar-management-root__title-row">
              <h1 class="calendar-management-root__title">{{ t('page_title') }}</h1>
              <HelpButton />
            </div>
          </div>

          <nav
            role="tablist"
            :aria-label="t('tabs_label')"
            class="calendar-management-root__tabs"
            @keydown="handleTabKeydown"
          >
            <button
              id="editors-tab"
              type="button"
              role="tab"
              :aria-selected="state.activeTab === 'editors'"
              aria-controls="editors-panel"
              :tabindex="state.activeTab === 'editors' ? 0 : -1"
              class="calendar-management-root__tab"
              @click="activateTab('editors')"
            >
              {{ t('editors_tab') }}
            </button>
            <button
              v-if="isOwner"
              id="reports-tab"
              type="button"
              role="tab"
              :aria-selected="state.activeTab === 'reports'"
              aria-controls="reports-panel"
              :tabindex="state.activeTab === 'reports' ? 0 : -1"
              class="calendar-management-root__tab"
              @click="activateTab('reports')"
            >
              {{ t('reports_tab') }}
            </button>
            <button
              v-if="isOwner"
              id="settings-tab"
              type="button"
              role="tab"
              :aria-selected="state.activeTab === 'settings'"
              aria-controls="settings-panel"
              :tabindex="state.activeTab === 'settings' ? 0 : -1"
              class="calendar-management-root__tab"
              @click="activateTab('settings')"
            >
              {{ t('settings_tab') }}
            </button>
            <button
              v-if="isOwner"
              id="import-tab"
              type="button"
              role="tab"
              :aria-selected="state.activeTab === 'import'"
              aria-controls="import-panel"
              :tabindex="state.activeTab === 'import' ? 0 : -1"
              class="calendar-management-root__tab"
              @click="activateTab('import')"
            >
              {{ t('import_tab') }}
            </button>
            <button
              id="widget-tab"
              type="button"
              role="tab"
              :aria-selected="state.activeTab === 'widget'"
              aria-controls="widget-panel"
              :tabindex="state.activeTab === 'widget' ? 0 : -1"
              class="calendar-management-root__tab"
              @click="activateTab('widget')"
            >
              {{ t('widget_tab') }}
            </button>
          </nav>
        </div>
      </header>

      <!-- Main content area -->
      <div class="calendar-management-root__main">
        <div
          id="editors-panel"
          role="tabpanel"
          aria-labelledby="editors-tab"
          :aria-hidden="state.activeTab !== 'editors'"
          :hidden="state.activeTab !== 'editors'"
          class="calendar-management-root__panel"
        >
          <EditorsTab
            :calendar-id="calendar.id"
            :is-owner="isOwner"
          />
        </div>

        <div
          id="reports-panel"
          ref="reportsPanelRef"
          role="tabpanel"
          aria-labelledby="reports-tab"
          tabindex="-1"
          :aria-hidden="state.activeTab !== 'reports' || !isOwner ? 'true' : 'false'"
          :hidden="state.activeTab !== 'reports' || !isOwner"
          class="calendar-management-root__panel"
        >
          <template v-if="isOwner">
            <ReportDetail
              v-if="selectedReportId"
              :calendar-id="calendar.id"
              :report-id="selectedReportId"
              @back="backToReports"
            />
            <ReportsDashboard
              v-else
              :calendar-id="calendar.id"
              @view-report="viewReport"
            />
          </template>
        </div>

        <div
          id="settings-panel"
          role="tabpanel"
          aria-labelledby="settings-tab"
          :aria-hidden="state.activeTab !== 'settings' || !isOwner ? 'true' : 'false'"
          :hidden="state.activeTab !== 'settings' || !isOwner"
          class="calendar-management-root__panel"
        >
          <SettingsTab v-if="isOwner" :calendar-id="calendar.id" />
        </div>

        <div
          id="import-panel"
          role="tabpanel"
          aria-labelledby="import-tab"
          :aria-hidden="state.activeTab !== 'import' || !isOwner ? 'true' : 'false'"
          :hidden="state.activeTab !== 'import' || !isOwner"
          class="calendar-management-root__panel"
        >
          <ImportSourcesSection
            v-if="isOwner"
            :calendar-id="calendar.id"
            :instance-host="instanceHost"
          />
        </div>

        <div
          id="widget-panel"
          role="tabpanel"
          aria-labelledby="widget-tab"
          :aria-hidden="state.activeTab !== 'widget'"
          :hidden="state.activeTab !== 'widget'"
          class="calendar-management-root__panel"
        >
          <WidgetTab
            :calendar-id="calendar.id"
            :calendar-url-name="calendar.urlName"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped lang="scss">
@use '@/client/assets/style/components/calendar-admin' as *;
@use '@/client/assets/style/mixins/tabs' as *;

.calendar-management-root {
  min-height: 100vh;
  background: var(--pav-color-stone-50);
  width: 100%;
  min-width: 0;

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-950);
  }

  &__header {
    background: var(--pav-surface-primary);
    border-bottom: 1px solid var(--pav-border-primary);
    overflow: hidden;

    @media (prefers-color-scheme: dark) {
      background: var(--pav-color-stone-900);
      border-bottom-color: var(--pav-color-stone-800);
    }
  }

  &__header-content {
    max-width: 56rem; // max-w-4xl
    margin: 0 auto;
    padding: 0 var(--pav-space-4);
    min-width: 0;
  }

  &__header-top {
    padding: var(--pav-space-4) 0;

    @media (min-width: 640px) {
      padding: var(--pav-space-6) 0;
    }
  }

  &__breadcrumb {
    display: flex;
    align-items: center;
    gap: var(--pav-space-2);
    color: var(--pav-color-stone-500);
    font-size: 0.875rem;
    margin-bottom: var(--pav-space-2);
    min-width: 0;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }

    @media (min-width: 640px) {
      font-size: 0.875rem;
    }
  }

  &__breadcrumb-item {
    color: var(--pav-color-stone-500);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }

  &__breadcrumb-separator {
    color: var(--pav-color-stone-400);
    flex-shrink: 0;
  }

  &__title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__title {
    font-size: 1.25rem;
    font-weight: 300;
    color: var(--pav-color-stone-900);
    margin: 0;

    @media (min-width: 640px) {
      font-size: 1.5rem;
    }

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-100);
    }
  }

  &__tabs {
    @include tab-navigation;
    margin-bottom: 0;
  }

  &__tab {
    @include tab-button;
  }

  &__main {
    max-width: 56rem; // max-w-4xl
    margin: 0 auto;
    padding: 0 var(--pav-space-4);
    min-width: 0;
  }

  &__panel {
    // Panel styles (individual tabs will style their content)
  }

  .loading-message,
  .error-message {
    padding: var(--pav-space-4);
    text-align: center;
    color: var(--pav-text-secondary);
  }

  .error-message {
    color: var(--pav-color-red-600);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-red-400);
    }
  }
}
</style>
