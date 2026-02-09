<script setup>
import { reactive, nextTick, onBeforeMount, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute } from 'vue-router';
import CategoriesTab from './categories.vue';
import EditorsTab from './editors.vue';
import SettingsTab from './settings.vue';
import WidgetTab from './widget-tab.vue';
import ReportsDashboard from '@/client/components/moderation/reports-dashboard.vue';
import ReportDetail from '@/client/components/moderation/report-detail.vue';
import CalendarService from '../../../service/calendar';

const route = useRoute();
const calendarUrlName = Array.isArray(route.params.calendar)
  ? route.params.calendar[0]
  : route.params.calendar || '';

const { t } = useTranslation('calendars', {
  keyPrefix: 'management',
});

const calendarService = new CalendarService();

const state = reactive({
  activeTab: 'categories',
  calendar: null,
  loading: false,
  error: null,
});

// Reports sub-navigation state
const selectedReportId = ref(null);

onBeforeMount(async () => {
  state.loading = true;
  try {
    state.calendar = await calendarService.getCalendarByUrlName(calendarUrlName);
    console.log('Calendar data loaded:', state.calendar);
  }
  catch (error) {
    console.error('Failed to load calendar:', error);
    state.error = t('error_loading_calendar');
  }
  finally {
    state.loading = false;
  }
});

const activateTab = (tab) => {
  state.activeTab = tab;

  // Reset report detail view when switching to reports tab
  if (tab === 'reports') {
    selectedReportId.value = null;
  }

  nextTick(() => {
    const panel = document.getElementById(`${tab}-panel`);
    if (panel) {
      panel.focus();
    }
  });
};

/**
 * Navigates to the report detail view within the reports tab.
 *
 * @param reportId - The ID of the report to view
 */
const viewReport = (reportId) => {
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

    <template v-else-if="state.calendar">
      <!-- Header with tabs -->
      <header class="calendar-management-root__header">
        <div class="calendar-management-root__header-content">
          <div class="calendar-management-root__header-top">
            <nav class="calendar-management-root__breadcrumb">
              <span class="calendar-management-root__breadcrumb-item">{{ state.calendar.urlName }}</span>
              <span class="calendar-management-root__breadcrumb-separator">/</span>
              <span class="calendar-management-root__breadcrumb-item">settings</span>
            </nav>
            <h1 class="calendar-management-root__title">{{ t('page_title') }}</h1>
          </div>

          <nav role="tablist" class="calendar-management-root__tabs">
            <button
              type="button"
              role="tab"
              :aria-selected="state.activeTab === 'categories' ? 'true' : 'false'"
              aria-controls="categories-panel"
              class="calendar-management-root__tab"
              @click="activateTab('categories')"
            >
              {{ t('categories_tab') }}
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="state.activeTab === 'editors' ? 'true' : 'false'"
              aria-controls="editors-panel"
              class="calendar-management-root__tab"
              @click="activateTab('editors')"
            >
              {{ t('editors_tab') }}
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="state.activeTab === 'reports' ? 'true' : 'false'"
              aria-controls="reports-panel"
              class="calendar-management-root__tab"
              @click="activateTab('reports')"
            >
              {{ t('reports_tab') }}
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="state.activeTab === 'settings' ? 'true' : 'false'"
              aria-controls="settings-panel"
              class="calendar-management-root__tab"
              @click="activateTab('settings')"
            >
              {{ t('settings_tab') }}
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="state.activeTab === 'widget' ? 'true' : 'false'"
              aria-controls="widget-panel"
              class="calendar-management-root__tab"
              @click="activateTab('widget')"
            >
              {{ t('widget_tab') }}
            </button>
          </nav>
        </div>
      </header>

      <!-- Main content area -->
      <main class="calendar-management-root__main">
        <div
          id="categories-panel"
          role="tabpanel"
          aria-labelledby="categories-tab"
          :aria-hidden="state.activeTab !== 'categories'"
          :hidden="state.activeTab !== 'categories'"
          class="calendar-management-root__panel"
        >
          <CategoriesTab v-if="state.calendar" :calendar-id="state.calendar.id" />
        </div>

        <div
          id="editors-panel"
          role="tabpanel"
          aria-labelledby="editors-tab"
          :aria-hidden="state.activeTab !== 'editors'"
          :hidden="state.activeTab !== 'editors'"
          class="calendar-management-root__panel"
        >
          <EditorsTab :calendar-id="state.calendar.id" />
        </div>

        <div
          id="reports-panel"
          role="tabpanel"
          aria-labelledby="reports-tab"
          :aria-hidden="state.activeTab !== 'reports'"
          :hidden="state.activeTab !== 'reports'"
          class="calendar-management-root__panel"
        >
          <ReportDetail
            v-if="selectedReportId"
            :calendar-id="state.calendar.id"
            :report-id="selectedReportId"
            @back="backToReports"
          />
          <ReportsDashboard
            v-else
            :calendar-id="state.calendar.id"
            @view-report="viewReport"
          />
        </div>

        <div
          id="settings-panel"
          role="tabpanel"
          aria-labelledby="settings-tab"
          :aria-hidden="state.activeTab !== 'settings'"
          :hidden="state.activeTab !== 'settings'"
          class="calendar-management-root__panel"
        >
          <SettingsTab :calendar-id="state.calendar.id" />
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
            :calendar-id="state.calendar.id"
            :calendar-url-name="state.calendar.urlName"
          />
        </div>
      </main>
    </template>
  </div>
</template>
