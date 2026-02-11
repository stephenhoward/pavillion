<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import ModerationAnalyticsService, { type AnalyticsData } from '@/client/service/moderation-analytics';
import LoadingMessage from '@/client/components/common/loading_message.vue';

const { t } = useTranslation('admin', {
  keyPrefix: 'moderation.analytics',
});

const props = defineProps<{
  startDate: string;
  endDate: string;
}>();

const loading = ref(true);
const error = ref<string | null>(null);
const analyticsData = ref<AnalyticsData | null>(null);

const analyticsService = new ModerationAnalyticsService();

/**
 * Computed property to determine if we have trend data to display.
 */
const hasTrendData = computed(() => {
  return analyticsData.value?.reportsTrend && analyticsData.value.reportsTrend.length > 0;
});

/**
 * Computed property to determine if we have top events data to display.
 */
const hasTopEventsData = computed(() => {
  return analyticsData.value?.topReportedEvents && analyticsData.value.topReportedEvents.length > 0;
});

/**
 * Computed property to determine if we have status data to display.
 */
const hasStatusData = computed(() => {
  if (!analyticsData.value?.reportsByStatus) {
    return false;
  }
  return Object.keys(analyticsData.value.reportsByStatus).length > 0;
});

/**
 * Computed property for trend chart data with max value for scaling.
 */
const trendChartData = computed(() => {
  if (!hasTrendData.value) {
    return { maxCount: 0, data: [] };
  }
  const data = analyticsData.value!.reportsTrend;
  const maxCount = Math.max(...data.map(d => d.count));
  return { maxCount, data };
});

/**
 * Computed property for status chart data with colors and percentages.
 */
const statusChartData = computed(() => {
  if (!hasStatusData.value) {
    return [];
  }

  const statusData = analyticsData.value!.reportsByStatus;
  const totalReports = Object.values(statusData).reduce((sum, count) => sum + count, 0);

  // Map statuses to accessible colors
  const statusColors: Record<string, string> = {
    'submitted': 'var(--pav-color-sky-500)',
    'under_review': 'var(--pav-color-amber-500)',
    'escalated': 'var(--pav-color-orange-600)',
    'resolved': 'var(--pav-color-emerald-600)',
    'dismissed': 'var(--pav-color-stone-400)',
  };

  return Object.entries(statusData).map(([status, count]) => ({
    status,
    count,
    percentage: totalReports > 0 ? (count / totalReports) * 100 : 0,
    color: statusColors[status] || 'var(--pav-color-stone-400)',
  }));
});

/**
 * Fetches analytics data from the API.
 */
async function fetchAnalytics() {
  loading.value = true;
  error.value = null;

  try {
    analyticsData.value = await analyticsService.getAnalytics(
      props.startDate,
      props.endDate,
    );
  }
  catch (err: any) {
    error.value = err.message || t('error');
  }
  finally {
    loading.value = false;
  }
}

// Fetch on mount
onMounted(() => {
  fetchAnalytics();
});

// Re-fetch when date range changes
watch(
  () => [props.startDate, props.endDate],
  () => {
    fetchAnalytics();
  },
);

// Expose for testing
defineExpose({
  loading,
  error,
  analyticsData,
});
</script>

<template>
  <div class="analytics-dashboard">
    <!-- Loading State -->
    <div v-if="loading" data-testid="analytics-loading">
      <LoadingMessage :description="t('loading')" />
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="error-state" data-testid="analytics-error">
      <p class="error-message">{{ error }}</p>
    </div>

    <!-- Analytics Content -->
    <div v-else-if="analyticsData" class="analytics-content" data-testid="analytics-content">
      <!-- Overview Metrics Section -->
      <section class="metrics-section" aria-labelledby="overview-heading">
        <h2 id="overview-heading" class="section-heading">
          {{ t('overview') }}
        </h2>

        <div class="metrics-grid">
          <!-- Total Reports -->
          <div class="metric-card">
            <div class="metric-label">{{ t('total_reports') }}</div>
            <div class="metric-value">
              {{ Object.values(analyticsData.reportsByStatus).reduce((sum, count) => sum + count, 0) }}
            </div>
          </div>

          <!-- Resolution Rate -->
          <div class="metric-card">
            <div class="metric-label">{{ t('resolution_rate') }}</div>
            <div class="metric-value">
              {{ (analyticsData.resolutionRate * 100).toFixed(1) }}%
            </div>
          </div>

          <!-- Average Resolution Time -->
          <div class="metric-card">
            <div class="metric-label">{{ t('avg_resolution_time') }}</div>
            <div class="metric-value">
              {{ analyticsData.averageResolutionTime.toFixed(1) }}h
            </div>
          </div>
        </div>
      </section>

      <!-- Reports by Status Section with Chart -->
      <section class="metrics-section" aria-labelledby="status-heading">
        <h2 id="status-heading" class="section-heading">
          {{ t('reports_by_status') }}
        </h2>

        <div v-if="hasStatusData" class="chart-container" data-testid="status-breakdown-chart">
          <!-- Donut Chart -->
          <svg
            class="donut-chart"
            viewBox="0 0 200 200"
            role="img"
            aria-label="Reports by status donut chart"
          >
            <g transform="translate(100, 100)">
              <circle
                cx="0"
                cy="0"
                r="80"
                fill="none"
                :stroke="'var(--pav-color-border-secondary)'"
                stroke-width="40"
              />
              <circle
                v-for="(item, index) in statusChartData"
                :key="item.status"
                cx="0"
                cy="0"
                r="80"
                fill="none"
                :stroke="item.color"
                stroke-width="40"
                :stroke-dasharray="`${item.percentage * 5.03} 502`"
                :stroke-dashoffset="statusChartData.slice(0, index).reduce((sum, d) => sum - (d.percentage * 5.03), 125.75)"
                :aria-label="`${t(`status.${item.status}`)}: ${item.count} reports (${item.percentage.toFixed(1)}%)`"
              />
            </g>
          </svg>

          <!-- Legend -->
          <div class="chart-legend" role="list" aria-label="Chart legend">
            <div
              v-for="item in statusChartData"
              :key="item.status"
              class="legend-item"
              role="listitem"
            >
              <span
                class="legend-color"
                :style="{ backgroundColor: item.color }"
                aria-hidden="true"
              />
              <span class="legend-label">
                {{ t(`status.${item.status}`) }}
              </span>
              <span class="legend-value">
                {{ item.count }} ({{ item.percentage.toFixed(1) }}%)
              </span>
            </div>
          </div>
        </div>

        <div v-else class="empty-state">
          {{ t('no_status_data') }}
        </div>
      </section>

      <!-- Reports Trend Section with Bar Chart -->
      <section v-if="hasTrendData" class="metrics-section" aria-labelledby="trend-heading">
        <h2 id="trend-heading" class="section-heading">
          {{ t('reports_trend') }}
        </h2>

        <div class="chart-container" data-testid="reports-trend-chart">
          <!-- Bar Chart -->
          <svg
            class="bar-chart"
            :viewBox="`0 0 ${trendChartData.data.length * 60} 250`"
            role="img"
            aria-label="Reports trend over time bar chart"
          >
            <!-- Axis labels -->
            <text
              x="0"
              y="15"
              class="chart-axis-label"
              font-size="12"
              fill="var(--pav-color-text-muted)"
            >
              {{ t('report_count') }}
            </text>

            <!-- Bars -->
            <g
              v-for="(point, index) in trendChartData.data"
              :key="point.date"
              :transform="`translate(${index * 60 + 30}, 220)`"
            >
              <!-- Bar -->
              <rect
                class="chart-bar"
                :x="-15"
                :y="-((point.count / trendChartData.maxCount) * 180)"
                width="30"
                :height="(point.count / trendChartData.maxCount) * 180"
                :fill="'var(--pav-color-brand-secondary)'"
                :aria-label="`${point.date}: ${point.count} reports`"
              />
              <!-- Value label -->
              <text
                x="0"
                :y="-((point.count / trendChartData.maxCount) * 180) - 5"
                text-anchor="middle"
                font-size="12"
                fill="var(--pav-color-text-secondary)"
              >
                {{ point.count }}
              </text>
              <!-- Date label -->
              <text
                x="0"
                y="15"
                text-anchor="middle"
                font-size="10"
                fill="var(--pav-color-text-muted)"
                transform="rotate(45)"
              >
                {{ new Date(point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }}
              </text>
            </g>
          </svg>
        </div>
      </section>

      <!-- Top Reported Events Section -->
      <section v-if="hasTopEventsData" class="metrics-section" aria-labelledby="top-events-heading">
        <h2 id="top-events-heading" class="section-heading">
          {{ t('top_reported_events') }}
        </h2>

        <div class="chart-container" data-testid="top-events-chart">
          <!-- Horizontal Bar Chart -->
          <svg
            class="horizontal-bar-chart"
            viewBox="0 0 600 ${analyticsData.topReportedEvents.length * 50 + 20}"
            role="img"
            aria-label="Top reported events horizontal bar chart"
          >
            <g
              v-for="(event, index) in analyticsData.topReportedEvents"
              :key="event.eventId"
              :transform="`translate(10, ${index * 50 + 30})`"
            >
              <!-- Bar background -->
              <rect
                x="0"
                y="0"
                width="580"
                height="30"
                fill="var(--pav-color-surface-secondary)"
                rx="4"
              />
              <!-- Bar fill -->
              <rect
                x="0"
                y="0"
                :width="(event.reportCount / analyticsData.topReportedEvents[0].reportCount) * 580"
                height="30"
                :fill="'var(--pav-color-orange-500)'"
                rx="4"
                :aria-label="`Event ${event.eventId}: ${event.reportCount} reports`"
              />
              <!-- Event ID label -->
              <text
                x="10"
                y="20"
                font-size="12"
                fill="var(--pav-color-text-primary)"
                font-weight="500"
              >
                {{ event.eventId.substring(0, 8) }}...
              </text>
              <!-- Count label -->
              <text
                x="570"
                y="20"
                text-anchor="end"
                font-size="12"
                fill="var(--pav-color-text-primary)"
                font-weight="600"
              >
                {{ event.reportCount }}
              </text>
            </g>
          </svg>
        </div>
      </section>

      <!-- Reporter Volume Section -->
      <section class="metrics-section" aria-labelledby="volume-heading">
        <h2 id="volume-heading" class="section-heading">
          {{ t('reporter_volume') }}
        </h2>

        <div class="volume-breakdown">
          <div
            v-for="(count, type) in analyticsData.reporterVolume"
            :key="type"
            class="volume-item"
          >
            <span class="volume-label">{{ t(`reporter_type.${type}`) }}</span>
            <span class="volume-count">{{ count }}</span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '../../assets/style/tokens/breakpoints' as *;

.analytics-dashboard {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-6);

  .error-state {
    padding: var(--pav-space-4);
    background: var(--pav-color-alert-error-bg);
    border-radius: var(--pav-border-radius-lg);
    border: 1px solid var(--pav-color-error);

    .error-message {
      margin: 0;
      color: var(--pav-color-alert-error-text);
      font-size: var(--pav-font-size-xs);
    }
  }

  .analytics-content {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-6);
  }

  .metrics-section {
    .section-heading {
      margin: 0 0 var(--pav-space-4) 0;
      font-size: var(--pav-font-size-lg);
      font-weight: var(--pav-font-weight-medium);
      color: var(--pav-color-text-primary);
    }
  }

  .metrics-grid {
    display: grid;
    gap: var(--pav-space-4);
    grid-template-columns: 1fr;

    @include pav-media(sm) {
      grid-template-columns: repeat(2, 1fr);
    }

    @include pav-media(md) {
      grid-template-columns: repeat(3, 1fr);
    }

    .metric-card {
      padding: var(--pav-space-4);
      background: var(--pav-color-surface-primary);
      border-radius: var(--pav-border-radius-lg);
      border: 1px solid var(--pav-color-border-secondary);

      .metric-label {
        font-size: var(--pav-font-size-xs);
        color: var(--pav-color-text-muted);
        margin-bottom: var(--pav-space-2);
      }

      .metric-value {
        font-size: var(--pav-font-size-2xl);
        font-weight: var(--pav-font-weight-semibold);
        color: var(--pav-color-text-primary);
      }
    }
  }

  .status-breakdown,
  .volume-breakdown {
    padding: var(--pav-space-4);
    background: var(--pav-color-surface-primary);
    border-radius: var(--pav-border-radius-lg);
    border: 1px solid var(--pav-color-border-secondary);
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-3);
  }

  .status-item,
  .volume-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--pav-space-2) 0;
    border-bottom: 1px solid var(--pav-color-border-secondary);

    &:last-child {
      border-bottom: none;
    }

    .status-label,
    .volume-label {
      font-size: var(--pav-font-size-xs);
      color: var(--pav-color-text-secondary);
    }

    .status-count,
    .volume-count {
      font-size: var(--pav-font-size-base);
      font-weight: var(--pav-font-weight-semibold);
      color: var(--pav-color-text-primary);
    }
  }

  .chart-container {
    padding: var(--pav-space-6);
    background: var(--pav-color-surface-primary);
    border-radius: var(--pav-border-radius-lg);
    border: 1px solid var(--pav-color-border-secondary);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--pav-space-6);

    @include pav-media(sm) {
      flex-direction: row;
      justify-content: space-around;
      align-items: flex-start;
    }
  }

  .donut-chart {
    width: 100%;
    max-width: 200px;
    height: auto;
  }

  .bar-chart,
  .horizontal-bar-chart {
    width: 100%;
    height: auto;
    overflow-x: auto;
  }

  .chart-legend {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-3);
    width: 100%;
    max-width: 300px;

    .legend-item {
      display: flex;
      align-items: center;
      gap: var(--pav-space-2);
      font-size: var(--pav-font-size-xs);

      .legend-color {
        width: 16px;
        height: 16px;
        border-radius: var(--pav-border-radius-sm);
        flex-shrink: 0;
      }

      .legend-label {
        flex: 1;
        color: var(--pav-color-text-secondary);
      }

      .legend-value {
        font-weight: var(--pav-font-weight-semibold);
        color: var(--pav-color-text-primary);
      }
    }
  }

  .chart-axis-label {
    font-size: var(--pav-font-size-xs);
    fill: var(--pav-color-text-muted);
  }

  .empty-state {
    padding: var(--pav-space-6);
    background: var(--pav-color-surface-primary);
    border-radius: var(--pav-border-radius-lg);
    border: 1px solid var(--pav-color-border-secondary);
    text-align: center;
    color: var(--pav-color-text-muted);
    font-size: var(--pav-font-size-xs);
  }
}

// Dark mode adjustments
@media (prefers-color-scheme: dark) {
  .analytics-dashboard {
    .metric-card {
      background: var(--pav-color-surface-secondary);
    }

    .status-breakdown,
    .volume-breakdown,
    .chart-container,
    .empty-state {
      background: var(--pav-color-surface-secondary);
    }
  }
}
</style>
