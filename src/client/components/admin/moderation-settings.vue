<script setup lang="ts">
import { onMounted, reactive } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useModerationStore } from '@/client/stores/moderation-store';
import LoadingMessage from '@/client/components/common/loading_message.vue';

const { t } = useTranslation('admin', {
  keyPrefix: 'moderation.settings',
});

const moderationStore = useModerationStore();

const state = reactive({
  autoEscalationHours: 72,
  adminReportEscalationHours: 24,
  reminderBeforeEscalationHours: 12,
  autoEscalationThreshold: 5,
  ipHashRetentionDays: 30,
  ipSubnetRetentionDays: 90,
  isSaving: false,
  validationErrors: {
    autoEscalationHours: '',
    adminReportEscalationHours: '',
    reminderBeforeEscalationHours: '',
    autoEscalationThreshold: '',
    ipHashRetentionDays: '',
    ipSubnetRetentionDays: '',
  },
  successMessage: '',
  errorMessage: '',
});

onMounted(async () => {
  await moderationStore.fetchModerationSettings();
  const settings = moderationStore.moderationSettings;
  if (settings) {
    state.autoEscalationHours = settings.autoEscalationHours;
    state.adminReportEscalationHours = settings.adminReportEscalationHours;
    state.reminderBeforeEscalationHours = settings.reminderBeforeEscalationHours;
    state.autoEscalationThreshold = settings.autoEscalationThreshold;
    state.ipHashRetentionDays = settings.ipHashRetentionDays;
    state.ipSubnetRetentionDays = settings.ipSubnetRetentionDays;
  }
});

function validateForm(): boolean {
  let isValid = true;

  // Reset errors
  state.validationErrors = {
    autoEscalationHours: '',
    adminReportEscalationHours: '',
    reminderBeforeEscalationHours: '',
    autoEscalationThreshold: '',
    ipHashRetentionDays: '',
    ipSubnetRetentionDays: '',
  };

  // Validate auto escalation hours
  if (!state.autoEscalationHours || state.autoEscalationHours < 1) {
    state.validationErrors.autoEscalationHours = t('error.must_be_positive');
    isValid = false;
  }

  // Validate admin report escalation hours
  if (!state.adminReportEscalationHours || state.adminReportEscalationHours < 1) {
    state.validationErrors.adminReportEscalationHours = t('error.must_be_positive');
    isValid = false;
  }

  // Validate reminder hours
  if (!state.reminderBeforeEscalationHours || state.reminderBeforeEscalationHours < 1) {
    state.validationErrors.reminderBeforeEscalationHours = t('error.must_be_positive');
    isValid = false;
  }

  // Validate auto-escalation threshold (allow 0 to disable)
  if (state.autoEscalationThreshold < 0) {
    state.validationErrors.autoEscalationThreshold = t('error.must_be_non_negative');
    isValid = false;
  }


  // Validate IP hash retention days
  if (!state.ipHashRetentionDays || state.ipHashRetentionDays < 1) {
    state.validationErrors.ipHashRetentionDays = t('error.must_be_positive');
    isValid = false;
  }

  // Validate IP subnet retention days
  if (!state.ipSubnetRetentionDays || state.ipSubnetRetentionDays < 1) {
    state.validationErrors.ipSubnetRetentionDays = t('error.must_be_positive');
    isValid = false;
  }

  return isValid;
}

async function saveSettings() {
  if (!validateForm()) {
    return;
  }

  state.isSaving = true;
  state.errorMessage = '';
  state.successMessage = '';

  try {
    await moderationStore.saveModerationSettings({
      autoEscalationHours: state.autoEscalationHours,
      adminReportEscalationHours: state.adminReportEscalationHours,
      reminderBeforeEscalationHours: state.reminderBeforeEscalationHours,
      autoEscalationThreshold: state.autoEscalationThreshold,
      ipHashRetentionDays: state.ipHashRetentionDays,
      ipSubnetRetentionDays: state.ipSubnetRetentionDays,
    });

    state.successMessage = t('success');
  }
  catch (error) {
    console.error('Error saving settings:', error);
    state.errorMessage = moderationStore.adminError || t('error.save_failed');
  }
  finally {
    state.isSaving = false;
  }
}
</script>

<template>
  <div class="moderation-settings">
    <!-- Page Header -->
    <div class="page-header">
      <div class="page-header-text">
        <h1>{{ t('title') }}</h1>
        <p class="page-subtitle">{{ t('subtitle') }}</p>
      </div>
    </div>

    <!-- Loading State -->
    <LoadingMessage
      v-if="moderationStore.loadingSettings"
      :description="t('loading')"
    />

    <!-- Error State -->
    <div v-else-if="moderationStore.adminError && !state.errorMessage" class="error-message">
      <p>{{ t('load_error') }}: {{ moderationStore.adminError }}</p>
    </div>

    <!-- Settings Form -->
    <div v-else class="settings-content">
      <!-- Status Messages -->
      <div role="status" aria-live="polite">
        <div v-if="state.successMessage" class="message message-success">
          <svg class="message-icon"
               width="20"
               height="20"
               viewBox="0 0 24 24"
               fill="none"
               stroke="currentColor"
               stroke-width="2"
               stroke-linecap="round"
               stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          {{ state.successMessage }}
        </div>
        <div v-if="state.errorMessage" class="message message-error">
          <svg class="message-icon"
               width="20"
               height="20"
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
          {{ state.errorMessage }}
        </div>
      </div>

      <section class="settings-card" aria-labelledby="escalation-settings-heading">
        <div class="settings-card-header">
          <h2 id="escalation-settings-heading">{{ t('escalation_settings') }}</h2>
        </div>

        <div class="settings-card-body">
          <form class="settings-form" @submit.prevent="saveSettings">
            <!-- Auto Escalation Hours -->
            <div class="form-group">
              <label for="auto-escalation" class="form-label">
                {{ t('auto_escalation_hours') }}
              </label>
              <input
                id="auto-escalation"
                type="number"
                v-model.number="state.autoEscalationHours"
                class="form-input"
                :class="{ 'has-error': state.validationErrors.autoEscalationHours }"
                min="1"
                step="1"
                :disabled="state.isSaving"
                :aria-invalid="!!state.validationErrors.autoEscalationHours"
                :aria-describedby="state.validationErrors.autoEscalationHours ? 'auto-escalation-error' : 'auto-escalation-help'"
              />
              <p v-if="state.validationErrors.autoEscalationHours"
                 id="auto-escalation-error"
                 class="error-text"
                 role="alert">
                {{ state.validationErrors.autoEscalationHours }}
              </p>
              <p v-else id="auto-escalation-help" class="help-text">
                {{ t('auto_escalation_help') }}
              </p>
            </div>

            <!-- Admin Report Escalation Hours -->
            <div class="form-group">
              <label for="admin-escalation" class="form-label">
                {{ t('admin_report_escalation_hours') }}
              </label>
              <input
                id="admin-escalation"
                type="number"
                v-model.number="state.adminReportEscalationHours"
                class="form-input"
                :class="{ 'has-error': state.validationErrors.adminReportEscalationHours }"
                min="1"
                step="1"
                :disabled="state.isSaving"
                :aria-invalid="!!state.validationErrors.adminReportEscalationHours"
                :aria-describedby="state.validationErrors.adminReportEscalationHours ? 'admin-escalation-error' : 'admin-escalation-help'"
              />
              <p v-if="state.validationErrors.adminReportEscalationHours"
                 id="admin-escalation-error"
                 class="error-text"
                 role="alert">
                {{ state.validationErrors.adminReportEscalationHours }}
              </p>
              <p v-else id="admin-escalation-help" class="help-text">
                {{ t('admin_escalation_help') }}
              </p>
            </div>

            <!-- Reminder Before Escalation Hours -->
            <div class="form-group">
              <label for="reminder-hours" class="form-label">
                {{ t('reminder_before_hours') }}
              </label>
              <input
                id="reminder-hours"
                type="number"
                v-model.number="state.reminderBeforeEscalationHours"
                class="form-input"
                :class="{ 'has-error': state.validationErrors.reminderBeforeEscalationHours }"
                min="1"
                step="1"
                :disabled="state.isSaving"
                :aria-invalid="!!state.validationErrors.reminderBeforeEscalationHours"
                :aria-describedby="state.validationErrors.reminderBeforeEscalationHours ? 'reminder-hours-error' : 'reminder-hours-help'"
              />
              <p v-if="state.validationErrors.reminderBeforeEscalationHours"
                 id="reminder-hours-error"
                 class="error-text"
                 role="alert">
                {{ state.validationErrors.reminderBeforeEscalationHours }}
              </p>
              <p v-else id="reminder-hours-help" class="help-text">
                {{ t('reminder_help') }}
              </p>
            </div>

            <!-- Save Button -->

            <!-- Auto Escalation Threshold -->
            <div class="form-group">
              <label for="auto-escalation-threshold" class="form-label">
                {{ t('auto_escalation_threshold') }}
              </label>
              <input
                id="auto-escalation-threshold"
                type="number"
                v-model.number="state.autoEscalationThreshold"
                class="form-input"
                :class="{ 'has-error': state.validationErrors.autoEscalationThreshold }"
                min="0"
                step="1"
                :disabled="state.isSaving"
                :aria-invalid="!!state.validationErrors.autoEscalationThreshold"
                :aria-describedby="state.validationErrors.autoEscalationThreshold ? 'auto-escalation-threshold-error' : 'auto-escalation-threshold-help'"
              />
              <p v-if="state.validationErrors.autoEscalationThreshold"
                 id="auto-escalation-threshold-error"
                 class="error-text"
                 role="alert">
                {{ state.validationErrors.autoEscalationThreshold }}
              </p>
              <p v-else id="auto-escalation-threshold-help" class="help-text">
                {{ t('auto_escalation_threshold_help') }}
              </p>
            </div>

            <!-- IP Hash Retention Days -->
            <div class="form-group">
              <label for="ip-hash-retention" class="form-label">
                {{ t('ip_hash_retention_days') }}
              </label>
              <input
                id="ip-hash-retention"
                type="number"
                v-model.number="state.ipHashRetentionDays"
                class="form-input"
                :class="{ 'has-error': state.validationErrors.ipHashRetentionDays }"
                min="1"
                step="1"
                :disabled="state.isSaving"
                :aria-invalid="!!state.validationErrors.ipHashRetentionDays"
                :aria-describedby="state.validationErrors.ipHashRetentionDays ? 'ip-hash-retention-error' : 'ip-hash-retention-help'"
              />
              <p v-if="state.validationErrors.ipHashRetentionDays"
                 id="ip-hash-retention-error"
                 class="error-text"
                 role="alert">
                {{ state.validationErrors.ipHashRetentionDays }}
              </p>
              <p v-else id="ip-hash-retention-help" class="help-text">
                {{ t('ip_hash_retention_help') }}
              </p>
            </div>

            <!-- IP Subnet Retention Days -->
            <div class="form-group">
              <label for="ip-subnet-retention" class="form-label">
                {{ t('ip_subnet_retention_days') }}
              </label>
              <input
                id="ip-subnet-retention"
                type="number"
                v-model.number="state.ipSubnetRetentionDays"
                class="form-input"
                :class="{ 'has-error': state.validationErrors.ipSubnetRetentionDays }"
                min="1"
                step="1"
                :disabled="state.isSaving"
                :aria-invalid="!!state.validationErrors.ipSubnetRetentionDays"
                :aria-describedby="state.validationErrors.ipSubnetRetentionDays ? 'ip-subnet-retention-error' : 'ip-subnet-retention-help'"
              />
              <p v-if="state.validationErrors.ipSubnetRetentionDays"
                 id="ip-subnet-retention-error"
                 class="error-text"
                 role="alert">
                {{ state.validationErrors.ipSubnetRetentionDays }}
              </p>
              <p v-else id="ip-subnet-retention-help" class="help-text">
                {{ t('ip_subnet_retention_help') }}
              </p>
            </div>

            <div class="form-actions">
              <button
                type="submit"
                class="save-button"
                :disabled="state.isSaving"
              >
                {{ state.isSaving ? t('saving') : t('save') }}
              </button>
            </div>
          </form>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '../../assets/style/tokens/breakpoints' as *;

.moderation-settings {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-6);
  max-width: 800px;

  .page-header {
    .page-header-text {
      h1 {
        margin: 0 0 var(--pav-space-1) 0;
        font-size: var(--pav-font-size-2xl);
        font-weight: var(--pav-font-weight-light);
        color: var(--pav-color-text-primary);
      }

      .page-subtitle {
        margin: 0;
        font-size: var(--pav-font-size-xs);
        color: var(--pav-color-text-muted);
      }
    }
  }

  .error-message {
    padding: var(--pav-space-4);
    background: var(--pav-color-error-bg);
    color: var(--pav-color-error-text);
    border-radius: var(--pav-border-radius-lg);
    border: 1px solid var(--pav-color-error);
  }

  .settings-content {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-5);

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
  }

  .settings-card {
    background: var(--pav-color-surface-primary);
    border: 1px solid var(--pav-border-color-light);
    border-radius: var(--pav-border-radius-card);
    overflow: hidden;

    .settings-card-header {
      padding: var(--pav-space-4) var(--pav-space-6);
      border-bottom: 1px solid var(--pav-border-color-light);

      h2 {
        margin: 0;
        font-size: var(--pav-font-size-base);
        font-weight: var(--pav-font-weight-medium);
        color: var(--pav-color-text-primary);
      }
    }

    .settings-card-body {
      padding: var(--pav-space-6);

      .settings-form {
        display: flex;
        flex-direction: column;
        gap: var(--pav-space-5);

        .form-group {
          display: flex;
          flex-direction: column;
          gap: var(--pav-space-2);

          .form-label {
            font-size: var(--pav-font-size-xs);
            font-weight: var(--pav-font-weight-medium);
            color: var(--pav-color-text-secondary);
          }

          .form-input {
            display: block;
            max-width: 20rem;
            width: 100%;
            padding: var(--pav-space-2_5) var(--pav-space-5);
            font-size: var(--pav-font-size-xs);
            font-family: inherit;
            color: var(--pav-color-text-primary);
            background: var(--pav-color-surface-primary);
            border: 1px solid var(--pav-color-stone-300);
            border-radius: var(--pav-border-radius-input);
            outline: none;
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
            box-sizing: border-box;

            &:focus {
              border-color: var(--pav-color-brand-primary);
              box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.15);
            }

            &.has-error {
              border-color: var(--pav-color-error);
            }

            &:disabled {
              opacity: 0.6;
              cursor: not-allowed;
              background: var(--pav-color-surface-secondary);
            }
          }

          .error-text {
            margin: 0;
            font-size: var(--pav-font-size-2xs);
            color: var(--pav-color-error);
          }

          .help-text {
            margin: 0;
            font-size: var(--pav-font-size-2xs);
            color: var(--pav-color-text-muted);
          }
        }

        .form-actions {
          padding-top: var(--pav-space-2);

          .save-button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: var(--pav-space-2_5) var(--pav-space-6);
            font-size: var(--pav-font-size-xs);
            font-weight: var(--pav-font-weight-medium);
            font-family: inherit;
            color: #fff;
            background: var(--pav-color-brand-primary);
            border: none;
            border-radius: var(--pav-border-radius-full);
            cursor: pointer;
            transition: background-color 0.2s ease;

            &:hover:not(:disabled) {
              background: var(--pav-color-brand-primary-dark);
            }

            &:focus-visible {
              outline: 2px solid var(--pav-color-brand-primary);
              outline-offset: 2px;
            }

            &:disabled {
              opacity: 0.6;
              cursor: not-allowed;
            }
          }
        }
      }
    }
  }
}

@media (prefers-color-scheme: dark) {
  .moderation-settings {
    .settings-content {
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
    }

    .settings-card {
      .settings-card-body {
        .settings-form {
          .form-group {
            .form-input {
              background: var(--pav-color-surface-secondary);
              border-color: var(--pav-color-stone-600);

              &:focus {
                border-color: var(--pav-color-brand-primary);
                box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.2);
              }
            }
          }
        }
      }
    }
  }
}
</style>
