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
const statusExpanded = ref(false);

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
 * Computed alert level string
 */
const alertLevel = computed(() => {
  if (!status.value) return 'ok';

  const alerts = status.value.alerts;
  if (alerts.includes('critical')) return 'critical';
  if (alerts.includes('warning')) return 'warning';
  return 'ok';
});

/**
 * Computed status badge label
 */
const statusBadgeLabel = computed(() => {
  if (alertLevel.value === 'critical') return t('alert_critical');
  if (alertLevel.value === 'warning') return t('alert_warning');
  return t('healthy', 'Healthy');
});

/**
 * Toggle the expanded/collapsed state
 */
function toggleExpanded() {
  statusExpanded.value = !statusExpanded.value;
}

// Fetch status on mount
onMounted(() => {
  fetchStatus();
});
</script>

<template>
  <section class="status-panel" aria-labelledby="housekeeping-heading">
    <!-- Collapsed header -->
    <button
      class="status-header"
      type="button"
      @click="toggleExpanded"
      :aria-expanded="statusExpanded"
      aria-controls="status-details"
    >
      <div class="status-header-left">
        <h2 id="housekeeping-heading">{{ t("status_title") }}</h2>
        <span v-if="!loading && !error" class="status-badge" :class="alertLevel">
          <span class="status-dot"/>
          {{ statusBadgeLabel }}
        </span>
      </div>
      <svg
        class="chevron-icon"
        :class="{ expanded: statusExpanded }"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </button>

    <!-- Loading state -->
    <div v-if="loading" class="status-loading">
      {{ t("loading") }}
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="status-error" role="alert">
      {{ error }}
    </div>

    <!-- Expanded details -->
    <div
      v-else-if="status && statusExpanded"
      id="status-details"
      class="status-details"
    >
      <div class="status-divider"/>

      <!-- Disk Usage -->
      <div class="disk-usage-section">
        <div class="disk-usage-header">
          <span class="disk-label">{{ t("disk_usage") }}</span>
          <span class="disk-stats-text">
            {{ formatBytes(status.diskUsage.totalBytes - status.diskUsage.freeBytes) }}
            / {{ formatBytes(status.diskUsage.totalBytes) }}
          </span>
        </div>
        <div class="progress-track">
          <div
            class="progress-fill"
            :class="alertLevel"
            :style="{ width: `${status.diskUsage.percentageUsed}%` }"
            role="progressbar"
            :aria-valuenow="status.diskUsage.percentageUsed"
            aria-valuemin="0"
            aria-valuemax="100"
          />
        </div>
        <div class="disk-percentage" :class="alertLevel">
          {{ status.diskUsage.percentageUsed.toFixed(1) }}% {{ t("disk_usage", "used") }}
        </div>
      </div>

      <!-- Backup Info Grid -->
      <div class="info-grid">
        <!-- Last Backup -->
        <div class="info-card">
          <div class="info-card-label">{{ t("last_backup") }}</div>
          <div v-if="status.lastBackup" class="info-card-content">
            <div class="info-card-value">{{ formatAbsoluteTime(status.lastBackup.date) }}</div>
            <div class="info-card-meta">
              {{ formatBytes(status.lastBackup.size) }} &middot; {{ status.lastBackup.type }}
            </div>
          </div>
          <div v-else class="info-card-empty">{{ t("no_backups") }}</div>
        </div>

        <!-- Next Backup -->
        <div class="info-card">
          <div class="info-card-label">{{ t("next_backup") }}</div>
          <div v-if="status.nextBackup" class="info-card-content">
            <div class="info-card-value">{{ formatRelativeTime(status.nextBackup) }}</div>
            <div class="info-card-meta">{{ formatAbsoluteTime(status.nextBackup) }}</div>
          </div>
          <div v-else class="info-card-empty">{{ t("not_scheduled") }}</div>
        </div>

        <!-- Retention Policy -->
        <div class="info-card">
          <div class="info-card-label">{{ t("retention_policy") }}</div>
          <div class="retention-list">
            <div class="retention-row">
              <span class="retention-label">{{ t("daily") }}</span>
              <span class="retention-value">
                <span class="retention-current">{{ status.retentionStats.daily.current }}</span>
                / {{ status.retentionStats.daily.target }}
              </span>
            </div>
            <div class="retention-row">
              <span class="retention-label">{{ t("weekly") }}</span>
              <span class="retention-value">
                <span class="retention-current">{{ status.retentionStats.weekly.current }}</span>
                / {{ status.retentionStats.weekly.target }}
              </span>
            </div>
            <div class="retention-row">
              <span class="retention-label">{{ t("monthly") }}</span>
              <span class="retention-value">
                <span class="retention-current">{{ status.retentionStats.monthly.current }}</span>
                / {{ status.retentionStats.monthly.target }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
@use '../../assets/style/tokens/breakpoints' as *;

.status-panel {
  background: var(--pav-color-surface-primary);
  border: 1px solid var(--pav-border-color-light);
  border-radius: var(--pav-border-radius-card);
  overflow: hidden;

  .status-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: var(--pav-space-4) var(--pav-space-6);
    background: none;
    border: none;
    cursor: pointer;
    color: var(--pav-color-text-primary);
    font-family: inherit;

    &:hover {
      background: var(--pav-color-surface-secondary);
    }

    &:focus-visible {
      outline: 2px solid var(--pav-color-brand-primary);
      outline-offset: -2px;
      border-radius: var(--pav-border-radius-card);
    }

    .status-header-left {
      display: flex;
      align-items: center;
      gap: var(--pav-space-3);

      h2 {
        margin: 0;
        font-size: var(--pav-font-size-base);
        font-weight: var(--pav-font-weight-medium);
        color: var(--pav-color-text-primary);
      }

      .status-badge {
        display: inline-flex;
        align-items: center;
        gap: var(--pav-space-1_5);
        padding: var(--pav-space-1) var(--pav-space-2_5);
        border-radius: var(--pav-border-radius-badge);
        font-size: var(--pav-font-size-2xs);
        font-weight: var(--pav-font-weight-medium);

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: var(--pav-border-radius-full);
        }

        &.ok {
          background: var(--pav-color-emerald-50);
          color: var(--pav-color-emerald-800);

          .status-dot {
            background: var(--pav-color-emerald-500);
          }
        }

        &.warning {
          background: var(--pav-color-amber-50);
          color: var(--pav-color-amber-800);

          .status-dot {
            background: var(--pav-color-amber-500);
          }
        }

        &.critical {
          background: var(--pav-color-red-50);
          color: var(--pav-color-red-800);

          .status-dot {
            background: var(--pav-color-red-500);
          }
        }
      }
    }

    .chevron-icon {
      transition: transform 0.2s ease;
      color: var(--pav-color-text-muted);
      flex-shrink: 0;

      &.expanded {
        transform: rotate(180deg);
      }
    }
  }

  .status-loading {
    padding: var(--pav-space-6);
    text-align: center;
    color: var(--pav-color-text-muted);
    font-size: var(--pav-font-size-xs);
  }

  .status-error {
    margin: 0 var(--pav-space-6) var(--pav-space-4);
    padding: var(--pav-space-3);
    background: var(--pav-color-red-50);
    border: 1px solid var(--pav-color-red-200);
    border-radius: var(--pav-border-radius-md);
    color: var(--pav-color-red-700);
    font-size: var(--pav-font-size-xs);
  }

  .status-details {
    padding: 0 var(--pav-space-6) var(--pav-space-6);

    .status-divider {
      height: 1px;
      background: var(--pav-border-color-light);
      margin-bottom: var(--pav-space-5);
    }

    .disk-usage-section {
      margin-bottom: var(--pav-space-5);

      .disk-usage-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--pav-space-2);

        .disk-label {
          font-size: var(--pav-font-size-xs);
          font-weight: var(--pav-font-weight-medium);
          color: var(--pav-color-text-secondary);
        }

        .disk-stats-text {
          font-size: var(--pav-font-size-2xs);
          color: var(--pav-color-text-muted);
        }
      }

      .progress-track {
        width: 100%;
        height: 12px;
        background: var(--pav-color-stone-100);
        border-radius: var(--pav-border-radius-full);
        overflow: hidden;

        .progress-fill {
          height: 100%;
          border-radius: var(--pav-border-radius-full);
          transition: width 0.3s ease;

          &.ok {
            background: var(--pav-color-emerald-500);
          }

          &.warning {
            background: var(--pav-color-amber-500);
          }

          &.critical {
            background: var(--pav-color-red-500);
          }
        }
      }

      .disk-percentage {
        margin-top: var(--pav-space-1_5);
        font-size: var(--pav-font-size-2xs);
        font-weight: var(--pav-font-weight-medium);

        &.ok {
          color: var(--pav-color-emerald-600);
        }

        &.warning {
          color: var(--pav-color-amber-600);
        }

        &.critical {
          color: var(--pav-color-red-600);
        }
      }
    }

    .info-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: var(--pav-space-3);

      @include pav-media(sm) {
        grid-template-columns: repeat(3, 1fr);
      }

      .info-card {
        background: var(--pav-color-surface-secondary);
        border-radius: var(--pav-border-radius-md);
        padding: var(--pav-space-4);

        .info-card-label {
          font-size: var(--pav-font-size-2xs);
          font-weight: var(--pav-font-weight-medium);
          color: var(--pav-color-text-muted);
          text-transform: uppercase;
          letter-spacing: var(--pav-letter-spacing-wider);
          margin-bottom: var(--pav-space-2);
        }

        .info-card-value {
          font-size: var(--pav-font-size-xs);
          font-weight: var(--pav-font-weight-medium);
          color: var(--pav-color-text-primary);
          margin-bottom: var(--pav-space-1);
        }

        .info-card-meta {
          font-size: var(--pav-font-size-2xs);
          color: var(--pav-color-text-muted);
        }

        .info-card-empty {
          font-size: var(--pav-font-size-xs);
          color: var(--pav-color-text-muted);
          font-style: italic;
        }

        .retention-list {
          display: flex;
          flex-direction: column;
          gap: var(--pav-space-1_5);

          .retention-row {
            display: flex;
            justify-content: space-between;
            align-items: center;

            .retention-label {
              font-size: var(--pav-font-size-2xs);
              color: var(--pav-color-text-secondary);
            }

            .retention-value {
              font-size: var(--pav-font-size-2xs);
              color: var(--pav-color-text-muted);

              .retention-current {
                font-weight: var(--pav-font-weight-semibold);
                color: var(--pav-color-brand-primary);
              }
            }
          }
        }
      }
    }
  }
}

@media (prefers-color-scheme: dark) {
  .status-panel {
    .status-header {
      .status-header-left {
        .status-badge {
          &.ok {
            background: rgba(16, 185, 129, 0.15);
            color: var(--pav-color-emerald-300);
          }

          &.warning {
            background: rgba(245, 158, 11, 0.15);
            color: var(--pav-color-amber-300);
          }

          &.critical {
            background: rgba(239, 68, 68, 0.15);
            color: var(--pav-color-red-300);
          }
        }
      }
    }

    .status-error {
      background: rgba(239, 68, 68, 0.1);
      border-color: rgba(239, 68, 68, 0.3);
      color: var(--pav-color-red-300);
    }

    .status-details {
      .disk-usage-section {
        .progress-track {
          background: var(--pav-color-stone-700);
        }

        .disk-percentage {
          &.ok {
            color: var(--pav-color-emerald-300);
          }

          &.warning {
            color: var(--pav-color-amber-300);
          }

          &.critical {
            color: var(--pav-color-red-300);
          }
        }
      }
    }
  }
}
</style>
