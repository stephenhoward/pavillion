<script setup lang="ts">
import { reactive, computed, onBeforeMount, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute } from 'vue-router';
import EditorsTab from './editors.vue';
import SettingsTab from './settings.vue';
import WidgetTab from './widget-tab.vue';
import ReportsDashboard from '@/client/components/moderation/reports-dashboard.vue';
import ReportDetail from '@/client/components/moderation/report-detail.vue';
import CalendarService from '../../../service/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';

const route = useRoute();
const calendarUrlName = Array.isArray(route.params.calendar)
  ? route.params.calendar[0]
  : route.params.calendar || '';

const { t } = useTranslation('calendars', {
  keyPrefix: 'management',
});

const calendarService = new CalendarService();

const state = reactive({
  activeTab: 'editors',
  calendarInfo: null as CalendarInfo | null,
  loading: false,
  error: null as string | null,
});

// Reports sub-navigation state
const selectedReportId = ref<string | null>(null);

const calendar = computed(() => state.calendarInfo?.calendar ?? null);
const isOwner = computed(() => state.calendarInfo?.isOwner ?? false);

onBeforeMount(async () => {
  state.loading = true;
  try {
    const calendarsWithRelationship = await calendarService.loadCalendarsWithRelationship();
    const found = calendarsWithRelationship.find(
      (info) => info.calendar.urlName === calendarUrlName,
    );
    state.calendarInfo = found ?? null;
  }
  catch (error) {
    console.error('Failed to load calendar:', error);
    state.error = t('error_loading_calendar');
  }
  finally {
    state.loading = false;
  }
});

/**
 * Returns the ordered list of visible tabs based on ownership status.
 */
const visibleTabs = computed(() => {
  const tabs = ['editors'];
  if (isOwner.value) {
    tabs.push('reports', 'settings');
  }
  tabs.push('widget');
  return tabs;
});

const activateTab = (tab: string) => {
  // Prevent non-owners from activating owner-only tabs
  if ((tab === 'settings' || tab === 'reports') && !isOwner.value) {
    return;
  }

  state.activeTab = tab;

  // Reset report detail view when switching to reports tab
  if (tab === 'reports') {
    selectedReportId.value = null;
  }
};

/**
 * Handles arrow key navigation within the tab list per ARIA APG tabs pattern.
 * Supports ArrowLeft, ArrowRight, Home, and End keys with roving tabindex.
 *
 * @param event - The keyboard event from the tablist
 */
const handleTabKeydown = (event: KeyboardEvent) => {
  const tabs = visibleTabs.value;
  const currentIndex = tabs.indexOf(state.activeTab);
  let newIndex = currentIndex;
  if (event.key === 'ArrowRight') {
    newIndex = (currentIndex + 1) % tabs.length;
  }
  else if (event.key === 'ArrowLeft') {
    newIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  }
  else if (event.key === 'Home') {
    newIndex = 0;
  }
  else if (event.key === 'End') {
    newIndex = tabs.length - 1;
  }
  else {
    return;
  }
  event.preventDefault();
  const targetTab = document.getElementById(`${tabs[newIndex]}-tab`);
  if (targetTab) {
    targetTab.focus();
    activateTab(tabs[newIndex]);
  }
};

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
            <nav class="calendar-management-root__breadcrumb">
              <span class="calendar-management-root__breadcrumb-item">{{ calendar.urlName }}</span>
              <span class="calendar-management-root__breadcrumb-separator">/</span>
              <span class="calendar-management-root__breadcrumb-item">{{ t('breadcrumb_settings') }}</span>
            </nav>
            <h1 class="calendar-management-root__title">{{ t('page_title') }}</h1>
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
              :aria-selected="state.activeTab === 'editors' ? 'true' : 'false'"
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
              :aria-selected="state.activeTab === 'reports' ? 'true' : 'false'"
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
              :aria-selected="state.activeTab === 'settings' ? 'true' : 'false'"
              aria-controls="settings-panel"
              :tabindex="state.activeTab === 'settings' ? 0 : -1"
              class="calendar-management-root__tab"
              @click="activateTab('settings')"
            >
              {{ t('settings_tab') }}
            </button>
            <button
              id="widget-tab"
              type="button"
              role="tab"
              :aria-selected="state.activeTab === 'widget' ? 'true' : 'false'"
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
          role="tabpanel"
          aria-labelledby="reports-tab"
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
