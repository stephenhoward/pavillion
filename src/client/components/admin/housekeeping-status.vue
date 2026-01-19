<script setup>
import { ref, onMounted, computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import { DateTime } from 'luxon';
import axios from 'axios';

const { t } = useTranslation('admin', {
  keyPrefix: 'housekeeping',
});

// Reactive state
const status = ref(null);
const loading = ref(true);
const error = ref('');

/**
 * Fetches housekeeping status from API
 */
async function fetchStatus() {
  loading.value = true;
  error.value = '';

  try {
    const response = await axios.get('/api/v1/admin/housekeeping/status');
    status.value = response.data;
  }
  catch (err) {
    console.error('Error fetching housekeeping status:', err);
    error.value = t('status_fetch_error');
  }
  finally {
    loading.value = false;
  }
}

/**
 * Formats bytes to human-readable size
 */
function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Number(bytes);
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Formats ISO date to relative time
 */
function formatRelativeTime(isoDate) {
  if (!isoDate) return t('never');

  const date = DateTime.fromISO(isoDate);
  const now = DateTime.now();
  const diff = date.diff(now, ['days', 'hours', 'minutes']);

  if (diff.days >= 1) {
    return t('in_days', { count: Math.floor(diff.days) });
  }
  else if (diff.hours >= 1) {
    return t('in_hours', { count: Math.floor(diff.hours) });
  }
  else {
    return t('in_minutes', { count: Math.floor(diff.minutes) });
  }
}

/**
 * Formats ISO date to absolute time
 */
function formatAbsoluteTime(isoDate) {
  if (!isoDate) return t('never');

  const date = DateTime.fromISO(isoDate);
  return date.toLocaleString(DateTime.DATETIME_MED);
}

/**
 * Computed alert class for disk usage
 */
const diskAlertClass = computed(() => {
  if (!status.value) return '';

  const alerts = status.value.alerts;
  if (alerts.includes('critical')) return 'critical';
  if (alerts.includes('warning')) return 'warning';
  return 'ok';
});

/**
 * Computed disk usage color for progress bar
 */
const diskUsageColor = computed(() => {
  if (!status.value) return '#4CAF50';

  const alerts = status.value.alerts;
  if (alerts.includes('critical')) return '#f44336';
  if (alerts.includes('warning')) return '#ff9800';
  return '#4CAF50';
});

// Fetch status on mount
onMounted(() => {
  fetchStatus();
});
</script>

<template>
  <section class="housekeeping-status" aria-labelledby="housekeeping-heading">
    <h2 id="housekeeping-heading">{{ t("status_title") }}</h2>

    <div v-if="loading" class="loading">
      {{ t("loading") }}
    </div>

    <div v-else-if="error" class="error-message" role="alert">
      {{ error }}
    </div>

    <div v-else-if="status" class="status-content">
      <!-- Disk Usage -->
      <div class="status-item disk-usage" :class="diskAlertClass">
        <div class="status-label">{{ t("disk_usage") }}</div>
        <div class="disk-progress">
          <div class="progress-bar">
            <div
              class="progress-fill"
              :style="{ width: `${status.diskUsage.percentageUsed}%`, backgroundColor: diskUsageColor }"
              role="progressbar"
              :aria-valuenow="status.diskUsage.percentageUsed"
              aria-valuemin="0"
              aria-valuemax="100"
            />
          </div>
          <div class="disk-stats">
            <span class="percentage">{{ status.diskUsage.percentageUsed.toFixed(1) }}%</span>
            <span class="details">
              {{ formatBytes(status.diskUsage.totalBytes - status.diskUsage.freeBytes) }}
              / {{ formatBytes(status.diskUsage.totalBytes) }}
            </span>
          </div>
        </div>
      </div>

      <!-- Last Backup -->
      <div class="status-item">
        <div class="status-label">{{ t("last_backup") }}</div>
        <div class="status-value" v-if="status.lastBackup">
          <div class="backup-date">{{ formatAbsoluteTime(status.lastBackup.date) }}</div>
          <div class="backup-details">
            {{ formatBytes(status.lastBackup.size) }} ({{ status.lastBackup.type }})
          </div>
        </div>
        <div class="status-value empty" v-else>
          {{ t("no_backups") }}
        </div>
      </div>

      <!-- Next Backup -->
      <div class="status-item">
        <div class="status-label">{{ t("next_backup") }}</div>
        <div class="status-value" v-if="status.nextBackup">
          {{ formatRelativeTime(status.nextBackup) }}
        </div>
        <div class="status-value empty" v-else>
          {{ t("not_scheduled") }}
        </div>
      </div>

      <!-- Alert Status -->
      <div class="status-item" v-if="status.alerts.includes('warning') || status.alerts.includes('critical')">
        <div class="status-label">{{ t("alerts") }}</div>
        <div class="alert-badge" :class="diskAlertClass">
          <span v-if="status.alerts.includes('critical')">{{ t("alert_critical") }}</span>
          <span v-else-if="status.alerts.includes('warning')">{{ t("alert_warning") }}</span>
        </div>
      </div>

      <!-- Retention Stats -->
      <div class="status-item retention-stats">
        <div class="status-label">{{ t("retention_policy") }}</div>
        <div class="retention-grid">
          <div class="retention-item">
            <span class="retention-label">{{ t("daily") }}</span>
            <span class="retention-value">{{ status.retentionStats.daily.current }} / {{ status.retentionStats.daily.target }}</span>
          </div>
          <div class="retention-item">
            <span class="retention-label">{{ t("weekly") }}</span>
            <span class="retention-value">{{ status.retentionStats.weekly.current }} / {{ status.retentionStats.weekly.target }}</span>
          </div>
          <div class="retention-item">
            <span class="retention-label">{{ t("monthly") }}</span>
            <span class="retention-value">{{ status.retentionStats.monthly.current }} / {{ status.retentionStats.monthly.target }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
@use '../../assets/mixins' as *;

.housekeeping-status {
  padding: 1.5rem;
  background: $light-mode-background;
  border-radius: 8px;
  margin-bottom: 2rem;

  @media (prefers-color-scheme: dark) {
    background: $dark-mode-background;
  }

  h2 {
    font-weight: $font-medium;
    font-size: 1.5rem;
    margin-bottom: 1.5rem;
    color: $light-mode-text;

    @media (prefers-color-scheme: dark) {
      color: $dark-mode-text;
    }
  }

  .loading {
    text-align: center;
    padding: 2rem;
    color: $light-mode-text;

    @media (prefers-color-scheme: dark) {
      color: $dark-mode-text;
    }
  }

  .error-message {
    padding: 0.75rem;
    background-color: #fff0f0;
    border: 1px solid #d87373;
    color: #7d2a2a;
    border-radius: 4px;

    @media (prefers-color-scheme: dark) {
      background-color: #4a2a2a;
      border-color: #d87373;
      color: #ffcccc;
    }
  }

  .status-content {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .status-item {
    .status-label {
      font-weight: $font-medium;
      margin-bottom: 0.5rem;
      color: $light-mode-text;

      @media (prefers-color-scheme: dark) {
        color: $dark-mode-text;
      }
    }

    .status-value {
      color: $light-mode-text;

      @media (prefers-color-scheme: dark) {
        color: $dark-mode-text;
      }

      &.empty {
        opacity: 0.6;
        font-style: italic;
      }
    }
  }

  .disk-usage {
    .disk-progress {
      .progress-bar {
        width: 100%;
        height: 20px;
        background-color: #e0e0e0;
        border-radius: 10px;
        overflow: hidden;
        margin-bottom: 0.5rem;

        @media (prefers-color-scheme: dark) {
          background-color: #555;
        }

        .progress-fill {
          height: 100%;
          transition: width 0.3s ease, background-color 0.3s ease;
        }
      }

      .disk-stats {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 0.9rem;

        .percentage {
          font-weight: $font-bold;
          font-size: 1.1rem;
        }

        .details {
          opacity: 0.8;
        }
      }
    }

    &.critical .disk-stats .percentage {
      color: #f44336;
    }

    &.warning .disk-stats .percentage {
      color: #ff9800;
    }

    &.ok .disk-stats .percentage {
      color: #4CAF50;
    }
  }

  .backup-date {
    font-size: 1rem;
    margin-bottom: 0.25rem;
  }

  .backup-details {
    font-size: 0.85rem;
    opacity: 0.7;
  }

  .alert-badge {
    display: inline-block;
    padding: 0.5rem 1rem;
    border-radius: 4px;
    font-weight: $font-medium;

    &.critical {
      background-color: #ffebee;
      color: #c62828;
      border: 1px solid #ef5350;

      @media (prefers-color-scheme: dark) {
        background-color: #4a2a2a;
        color: #ffcccc;
        border-color: #ef5350;
      }
    }

    &.warning {
      background-color: #fff3e0;
      color: #e65100;
      border: 1px solid #ff9800;

      @media (prefers-color-scheme: dark) {
        background-color: #4a3a2a;
        color: #ffddaa;
        border-color: #ff9800;
      }
    }
  }

  .retention-stats {
    .retention-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;

      .retention-item {
        display: flex;
        flex-direction: column;
        padding: 0.75rem;
        background-color: #f5f5f5;
        border-radius: 4px;

        @media (prefers-color-scheme: dark) {
          background-color: #444;
        }

        .retention-label {
          font-size: 0.85rem;
          opacity: 0.8;
          margin-bottom: 0.25rem;
        }

        .retention-value {
          font-size: 1.1rem;
          font-weight: $font-medium;
        }
      }
    }
  }
}
</style>
