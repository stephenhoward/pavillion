<script setup lang="ts">
import { reactive, computed, onBeforeMount, nextTick, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute, useRouter } from 'vue-router';
import { useTabNavigation } from '@/client/composables/useTabNavigation';
import EditorsTab from './editors.vue';
import SettingsTab from './settings.vue';
import WidgetTab from './widget-tab.vue';
import ImportSourcesSection from './import-sources/ImportSourcesSection.vue';
import ReportsDashboard from '@/client/components/moderation/reports-dashboard.vue';
import ReportDetail from '@/client/components/moderation/report-detail.vue';
import CalendarService from '../../../service/calendar';
import Config from '@/client/service/config';
import { CalendarInfo } from '@/common/model/calendar_info';

// Canonical list of tab names this component knows how to render. Used to
// distinguish "you can't see this tab" (a real tab name not in visibleTabs)
// from "that tab doesn't exist" (e.g. ?tab=foobar) so unknown values fall
// back silently to the default rather than parking the user on the
// unauthorized landing (pv-2ppm).
const KNOWN_TABS = ['editors', 'reports', 'settings', 'import', 'widget'];

const route = useRoute();
const router = useRouter();
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

// Template ref on the unauthorized panel's heading. We move focus here after
// the panel renders so keyboard / screen-reader users arriving from a deep
// link get an explicit announcement of the state change (pv-2ppm).
const unauthorizedHeadingRef = ref<HTMLElement | null>(null);

const calendar = computed(() => state.calendarInfo?.calendar ?? null);
const isOwner = computed(() => state.calendarInfo?.isOwner ?? false);
const canReviewReports = computed(() => state.calendarInfo?.canReviewReports ?? false);
const instanceHost = computed(() => new Config().settings()?.domain);

onBeforeMount(async () => {
  state.loading = true;
  try {
    const calendarsWithRelationship = await calendarService.loadCalendarsWithRelationship();
    const found = calendarsWithRelationship.find(
      (info) => info.calendar.urlName === calendarUrlName,
    );
    state.calendarInfo = found ?? null;

    // Restore tab from query param (e.g. after Stripe checkout redirect, or
    // from an inbox notification deep-link with ?tab=reports&report=<id>).
    // If a tab is requested that the visitor cannot see, we don't silently
    // fall back to the default tab — that lands the visitor on a panel
    // whose mount immediately 403s (pv-2ppm). Instead we render an
    // unauthorized panel and strip the ?tab / ?report params so reloads
    // don't reproduce the state. Unknown tab names (?tab=foobar) fall back
    // silently to the default — they're a malformed URL, not a permissions
    // mismatch.
    const requestedTab = route.query.tab as string | undefined;
    if (requestedTab) {
      if (visibleTabs.value.includes(requestedTab)) {
        state.activeTab = requestedTab;

        // Deep-link to a specific report from the inbox.
        if (state.activeTab === 'reports' && typeof route.query.report === 'string') {
          selectedReportId.value = route.query.report;
        }
      }
      else if (state.calendarInfo && KNOWN_TABS.includes(requestedTab)) {
        // Tab requested is real but not visible to this visitor — surface a
        // graceful unauthorized panel rather than dropping them onto a panel
        // that will 403 on mount.
        state.activeTab = 'unauthorized';

        // Strip the deep-link query params so a reload doesn't keep the
        // user stuck on the unauthorized landing.
        await router.replace({
          name: route.name ?? undefined,
          params: route.params,
          query: {},
          hash: route.hash,
        });

        // Move focus to the unauthorized heading so keyboard / screen-reader
        // users get an explicit announcement of the state change instead of
        // landing with focus in an indeterminate position.
        await nextTick();
        unauthorizedHeadingRef.value?.focus();
      }
    }
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
 * The reports tab is visible to anyone who can review reports — owners
 * always, editors only when can_review_reports has been granted on the
 * membership (pv-2ppm).
 */
const visibleTabs = computed(() => {
  const tabs = ['editors'];
  if (canReviewReports.value) {
    tabs.push('reports');
  }
  if (isOwner.value) {
    tabs.push('settings', 'import');
  }
  tabs.push('widget');
  return tabs;
});

const activateTab = (tab: string) => {
  // Prevent non-owners from activating owner-only tabs
  if ((tab === 'settings' || tab === 'import') && !isOwner.value) {
    return;
  }
  // Reports tab is gated on report-review permission, not ownership
  if (tab === 'reports' && !canReviewReports.value) {
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
              :aria-selected="state.activeTab === 'editors'"
              aria-controls="editors-panel"
              :tabindex="state.activeTab === 'editors' ? 0 : -1"
              class="calendar-management-root__tab"
              @click="activateTab('editors')"
            >
              {{ t('editors_tab') }}
            </button>
            <button
              v-if="canReviewReports"
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
          <!--
            Mount EditorsTab only when the editors panel is the active tab.
            Switching from :hidden to v-if keeps EditorsTab.onMounted() from
            firing for the unauthorized landing, which would otherwise fetch
            /calendar/:id/editors and surface a 403 toast (pv-2ppm).
          -->
          <EditorsTab
            v-if="state.activeTab === 'editors'"
            :calendar-id="calendar.id"
            :is-owner="isOwner"
          />
        </div>

        <div
          id="reports-panel"
          role="tabpanel"
          aria-labelledby="reports-tab"
          :aria-hidden="state.activeTab !== 'reports' || !canReviewReports"
          :hidden="state.activeTab !== 'reports' || !canReviewReports"
          class="calendar-management-root__panel"
        >
          <template v-if="canReviewReports">
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

        <!--
          Unauthorized landing for deep-links that target a tab the visitor
          cannot see (e.g. an inbox notification sent to a co-editor who is
          not a report reviewer). Replaces the previous silent fallback to
          the editors tab, which fired a 403 on mount (pv-2ppm).
        -->
        <div
          v-if="state.activeTab === 'unauthorized'"
          id="unauthorized-panel"
          role="region"
          aria-labelledby="unauthorized-heading"
          class="calendar-management-root__panel calendar-management-root__unauthorized"
        >
          <h2
            id="unauthorized-heading"
            ref="unauthorizedHeadingRef"
            tabindex="-1"
          >{{ t('unauthorized_title') }}</h2>
          <p>{{ t('unauthorized_body') }}</p>
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

  &__unauthorized {
    padding: var(--pav-space-6) var(--pav-space-4);
    text-align: center;
    color: var(--pav-text-secondary);

    h2 {
      font-size: 1.125rem;
      font-weight: 400;
      margin: 0 0 var(--pav-space-2) 0;
      color: var(--pav-text-primary);
    }

    p {
      margin: 0;
      max-width: 32rem;
      margin-inline: auto;
    }
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
