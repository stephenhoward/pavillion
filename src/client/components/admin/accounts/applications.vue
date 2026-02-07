<template>
  <section class="applications-section">
    <!-- Status Messages -->
    <div v-if="state.processingSuccess"
         class="message message-success"
         role="status"
         aria-live="polite">
      <svg class="message-icon"
           width="16"
           height="16"
           viewBox="0 0 24 24"
           fill="none"
           stroke="currentColor"
           stroke-width="2"
           stroke-linecap="round"
           stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      {{ t('processing_success', { email: state.processingSuccess }) }}
    </div>
    <div v-if="state.processingError"
         class="message message-error"
         role="alert"
         aria-live="polite">
      <svg class="message-icon"
           width="16"
           height="16"
           viewBox="0 0 24 24"
           fill="none"
           stroke="currentColor"
           stroke-width="2"
           stroke-linecap="round"
           stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="15"
              y1="9"
              x2="9"
              y2="15"/>
        <line x1="9"
              y1="9"
              x2="15"
              y2="15"/>
      </svg>
      {{ t('processing_error', { email: state.processingError }) }}
    </div>

    <div v-if="store.applications && store.applications.length > 0" class="applications-card">
      <!-- Desktop Table -->
      <div class="applications-table-desktop">
        <table class="applications-table">
          <thead>
            <tr>
              <th scope="col">{{ t('email_column') }}</th>
              <th scope="col">{{ t('status_column') }}</th>
              <th scope="col">{{ t('date_column') }}</th>
              <th scope="col" class="col-actions">{{ t('actions_column') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="application in store.applications" :key="application.id">
              <td class="cell-email">{{ application.email }}</td>
              <td>
                <span class="status-badge" :class="getStatusBadgeClass(application.status)">
                  {{ formatStatus(application.status) }}
                </span>
              </td>
              <td class="cell-date">{{ formatDate(application.statusTimestamp) }}</td>
              <td class="cell-actions">
                <button type="button" class="action-link" @click="viewApplication(application)">
                  {{ t('view') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Mobile Cards -->
      <div class="applications-mobile">
        <div v-for="application in store.applications" :key="application.id" class="application-card">
          <div class="application-card-header">
            <div class="application-card-info">
              <p class="application-card-email">{{ application.email }}</p>
              <p class="application-card-date">{{ t('applied_date', { date: formatDate(application.statusTimestamp) }) }}</p>
            </div>
            <span class="status-badge" :class="getStatusBadgeClass(application.status)">
              {{ formatStatus(application.status) }}
            </span>
          </div>
          <button type="button" class="action-button-mobile" @click="viewApplication(application)">
            {{ t('review_application') }}
          </button>
        </div>
      </div>
    </div>
    <EmptyLayout v-else :title="t('noApplications')" :description="t('noApplicationsDescription')" />

    <!-- Application detail modal -->
    <ApplicationReviewView
      v-if="state.modalOpen"
      :application="state.selectedApplication"
      @close="state.modalOpen = false"
      @accept="acceptApplication"
      @reject="rejectApplication"
    />
  </section>
</template>

<script setup>
import { onBeforeMount, reactive, inject, toRaw } from 'vue';
import { useTranslation } from 'i18next-vue';
import { DateTime } from 'luxon';
import { useApplicationStore } from '@/client/stores/applicationStore';
import AccountApplication from '@/common/model/application';
import ApplicationReviewView from './application_review.vue';
import ModelService from '@/client/service/models';
import EmptyLayout from '@/client/components/common/empty_state.vue';

const store = useApplicationStore();
const authn = inject('authn');
const { t } = useTranslation('admin', {
  keyPrefix: 'applications',
});

onBeforeMount(async () => {
  await loadApplications();
});

const loadApplications = async () => {
  try {
    const result = await ModelService.listModels('/api/v1/admin/applications', { dataKey: 'applications' });
    store.setApplications(result.items.map(app => {
      return new AccountApplication(
        app.id,
        app.email,
        app.message,
        app.status,
        app.statusTimestamp ? new Date(app.statusTimestamp) : null,
      );
    }));
  }
  catch (error) {
    console.error('Error loading applications:', error);
  }
};

const formatStatus = (status) => {
  return t(`status_${status}`);
};

const getStatusBadgeClass = (status) => {
  return `status-badge--${status}`;
};

const formatDate = (date) => {
  if (!date) return '';
  return DateTime.fromJSDate(date).toLocaleString({ month: 'short', day: 'numeric', year: 'numeric' });
};

const state = reactive({
  modalOpen: false,
  selectedApplication: null,
  processingSuccess: null,
  processingError: null,
});

const viewApplication = (application) => {
  state.selectedApplication = application;
  state.modalOpen = true;
};

const acceptApplication = async (application) => {
  try {
    await authn.process_application(application.id, true);
    store.removeApplication(toRaw(application));
    state.processingSuccess = application.email;
    state.modalOpen = false;

    setTimeout(() => {
      state.processingSuccess = null;
    }, 3000);
  }
  catch (error) {
    console.error('Error accepting application:', error);
    state.processingError = application.email;
    setTimeout(() => {
      state.processingError = null;
    }, 3000);
  }
};

const rejectApplication = async (application, silent) => {
  try {
    await authn.process_application(application.id, false, silent);
    application.status = 'rejected';
    application.statusTimestamp = new Date();
    state.processingSuccess = application.email;
    state.modalOpen = false;

    setTimeout(() => {
      state.processingSuccess = null;
    }, 3000);
  }
  catch (error) {
    console.error('Error rejecting application:', error);
    state.processingError = application.email;
    setTimeout(() => {
      state.processingError = null;
    }, 3000);
  }
};
</script>

<style scoped lang="scss">
@use '../../../assets/style/tokens/breakpoints' as *;

.applications-section {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4);

  .message {
    display: flex;
    align-items: center;
    gap: var(--pav-space-2);
    padding: var(--pav-space-3) var(--pav-space-4);
    border-radius: var(--pav-border-radius-md);
    font-size: var(--pav-font-size-xs);

    .message-icon {
      flex-shrink: 0;
    }

    &.message-success {
      background: var(--pav-color-emerald-50);
      border: 1px solid var(--pav-color-emerald-200);
      color: var(--pav-color-emerald-800);
    }

    &.message-error {
      background: var(--pav-color-red-50);
      border: 1px solid var(--pav-color-red-200);
      color: var(--pav-color-red-700);
    }
  }

  .applications-card {
    background: var(--pav-color-surface-primary);
    border-radius: var(--pav-border-radius-xl);
    border: 1px solid var(--pav-border-color-light);
    overflow: hidden;

    .applications-table-desktop {
      display: none;

      @include pav-media(md) {
        display: block;
      }

      .applications-table {
        width: 100%;
        border-collapse: collapse;

        thead {
          tr {
            border-bottom: 1px solid var(--pav-border-color-light);
            background: var(--pav-color-stone-50);
          }

          th {
            padding: var(--pav-space-3) var(--pav-space-6);
            text-align: left;
            font-size: var(--pav-font-size-2xs);
            font-weight: var(--pav-font-weight-semibold);
            color: var(--pav-color-text-muted);
            text-transform: uppercase;
            letter-spacing: var(--pav-letter-spacing-wider);

            &.col-actions {
              text-align: right;
            }
          }
        }

        tbody {
          tr {
            border-bottom: 1px solid var(--pav-border-color-light);
            transition: background-color 0.15s ease;

            &:last-child {
              border-bottom: none;
            }

            &:hover {
              background: var(--pav-color-stone-50);
            }
          }

          td {
            padding: var(--pav-space-4) var(--pav-space-6);
          }

          .cell-email {
            font-weight: var(--pav-font-weight-medium);
            color: var(--pav-color-text-primary);
          }

          .cell-date {
            color: var(--pav-color-text-secondary);
            font-size: var(--pav-font-size-xs);
          }

          .cell-actions {
            text-align: right;
          }
        }
      }
    }

    .applications-mobile {
      display: block;

      @include pav-media(md) {
        display: none;
      }

      .application-card {
        padding: var(--pav-space-4);
        border-bottom: 1px solid var(--pav-border-color-light);
        display: flex;
        flex-direction: column;
        gap: var(--pav-space-3);

        &:last-child {
          border-bottom: none;
        }

        .application-card-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--pav-space-3);

          .application-card-info {
            min-width: 0;
            flex: 1;

            .application-card-email {
              margin: 0;
              font-weight: var(--pav-font-weight-medium);
              color: var(--pav-color-text-primary);
              word-break: break-all;
            }

            .application-card-date {
              margin: var(--pav-space-1) 0 0 0;
              font-size: var(--pav-font-size-xs);
              color: var(--pav-color-text-muted);
            }
          }
        }

        .action-button-mobile {
          width: 100%;
          padding: var(--pav-space-2) var(--pav-space-4);
          font-size: var(--pav-font-size-xs);
          font-weight: var(--pav-font-weight-medium);
          font-family: inherit;
          color: var(--pav-color-orange-600);
          background: none;
          border: 1px solid var(--pav-color-orange-200);
          border-radius: var(--pav-border-radius-full);
          cursor: pointer;
          transition: background-color 0.2s ease;

          &:hover {
            background: var(--pav-color-orange-50);
          }
        }
      }
    }
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    padding: var(--pav-space-1) var(--pav-space-2_5);
    border-radius: var(--pav-border-radius-full);
    font-size: var(--pav-font-size-2xs);
    font-weight: var(--pav-font-weight-medium);

    &--pending {
      background: var(--pav-color-amber-100);
      color: var(--pav-color-amber-700);
    }

    &--approved,
    &--accepted {
      background: var(--pav-color-emerald-100);
      color: var(--pav-color-emerald-700);
    }

    &--rejected {
      background: var(--pav-color-red-100);
      color: var(--pav-color-red-700);
    }
  }

  .action-link {
    background: none;
    border: none;
    color: var(--pav-color-orange-600);
    font-size: var(--pav-font-size-xs);
    font-weight: var(--pav-font-weight-medium);
    font-family: inherit;
    cursor: pointer;
    padding: 0;
    transition: color 0.2s ease;

    &:hover {
      color: var(--pav-color-orange-700);
    }
  }
}

@media (prefers-color-scheme: dark) {
  .applications-section {
    .message {
      &.message-success {
        background: rgba(16, 185, 129, 0.1);
        border-color: rgba(16, 185, 129, 0.3);
        color: var(--pav-color-emerald-300);
      }

      &.message-error {
        background: rgba(239, 68, 68, 0.1);
        border-color: rgba(239, 68, 68, 0.3);
        color: var(--pav-color-red-300);
      }
    }

    .applications-card {
      .applications-table-desktop {
        .applications-table {
          thead tr {
            background: rgba(41, 37, 36, 0.5);
          }

          tbody tr:hover {
            background: rgba(41, 37, 36, 0.3);
          }
        }
      }

      .applications-mobile {
        .application-card {
          .action-button-mobile {
            color: var(--pav-color-orange-400);
            border-color: var(--pav-color-orange-800);

            &:hover {
              background: rgba(249, 115, 22, 0.1);
            }
          }
        }
      }
    }

    .status-badge {
      &--pending {
        background: rgba(245, 158, 11, 0.15);
        color: var(--pav-color-amber-300);
      }

      &--approved,
      &--accepted {
        background: rgba(16, 185, 129, 0.15);
        color: var(--pav-color-emerald-300);
      }

      &--rejected {
        background: rgba(239, 68, 68, 0.15);
        color: var(--pav-color-red-300);
      }
    }

    .action-link {
      color: var(--pav-color-orange-400);

      &:hover {
        color: var(--pav-color-orange-300);
      }
    }
  }
}
</style>
