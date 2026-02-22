<script setup>
import { useTranslation } from 'i18next-vue';
import { inject, ref } from 'vue';
import Config from '../../service/config';
import HousekeepingStatus from './housekeeping-status.vue';
import LanguageSettings from './language-settings.vue';

const site_config = inject('site_config');
const { t } = useTranslation('admin', {
  keyPrefix: 'settings',
});

// Create reactive variables
const saving = ref(false);
const successMessage = ref('');
const errorMessage = ref('');

// Initialize with current settings
const selectedRegistrationMode = ref(site_config.settings().registrationMode || 'closed');
const siteTitle = ref(site_config.settings().siteTitle);
const selectedDateRange = ref(site_config.settings().defaultDateRange || '2weeks');

// Registration mode options
const registrationModes = [
  { value: 'open', label: t('registration_mode_open') },
  { value: 'apply', label: t('registration_mode_apply') },
  { value: 'invitation', label: t('registration_mode_invite') },
  { value: 'closed', label: t('registration_mode_closed') },
];

// Default date range options
const dateRangeOptions = [
  { value: '1week', label: t('date_range_1week') },
  { value: '2weeks', label: t('date_range_2weeks') },
  { value: '1month', label: t('date_range_1month') },
];

/**
 * Updates the site settings
 */
async function updateSettings() {
  saving.value = true;
  errorMessage.value = '';
  successMessage.value = '';

  try {
    const configService = await Config.init();
    const success = await configService.updateSettings({
      registrationMode: selectedRegistrationMode.value,
      siteTitle: siteTitle.value,
      defaultDateRange: selectedDateRange.value,
    });

    if (success) {
      successMessage.value = t('settings_update_success');
      // Update the site config after successful update
      site_config.settings.registrationMode = selectedRegistrationMode.value;
    }
    else {
      errorMessage.value = t('settings_update_failed');
    }
  }
  catch (error) {
    console.error('Error updating registration mode:', error);
    errorMessage.value = t('settings_update_failed');
  }
  finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="settings-page">
    <!-- Page Header -->
    <div class="page-header">
      <h1>{{ t("general_settings") }}</h1>
      <p class="page-subtitle">{{ t("settings_subtitle", "Monitor system health and configure instance settings") }}</p>
    </div>

    <!-- System Status Widget -->
    <HousekeepingStatus />

    <!-- Instance Settings Card -->
    <section class="settings-card" aria-labelledby="instance-settings-heading">
      <div class="settings-card-header">
        <h2 id="instance-settings-heading">{{ t("instance_settings", "Instance Settings") }}</h2>
      </div>

      <div class="settings-card-body">
        <!-- Status Messages -->
        <div role="status" aria-live="polite">
          <div v-if="successMessage" class="message message-success">
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
            {{ successMessage }}
          </div>
          <div v-if="errorMessage" class="message message-error">
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
            {{ errorMessage }}
          </div>
        </div>

        <form class="settings-form" @submit.prevent="updateSettings">
          <!-- Instance Name -->
          <div class="form-group">
            <label for="instanceName" class="form-label">{{ t("instance_name") }}</label>
            <input
              id="instanceName"
              type="text"
              class="form-input"
              :disabled="saving"
              aria-describedby="site-title-description"
              v-model="siteTitle"
            />
            <p id="site-title-description" class="form-description">{{ t("site_title_description") }}</p>
          </div>

          <!-- Registration Mode -->
          <div class="form-group">
            <label for="registrationMode" class="form-label">{{ t("registration_mode") }}</label>
            <select
              id="registrationMode"
              class="form-select"
              v-model="selectedRegistrationMode"
              :disabled="saving"
              aria-describedby="reg-mode-description"
            >
              <option v-for="mode in registrationModes" :key="mode.value" :value="mode.value">
                {{ mode.label }}
              </option>
            </select>
            <p id="reg-mode-description" class="form-description">{{ t("registration_mode_description") }}</p>
          </div>

          <!-- Default Date Range -->
          <div class="form-group">
            <label for="defaultDateRange" class="form-label">{{ t("default_date_range") }}</label>
            <select
              id="defaultDateRange"
              class="form-select"
              v-model="selectedDateRange"
              :disabled="saving"
              aria-describedby="date-range-description"
            >
              <option v-for="range in dateRangeOptions" :key="range.value" :value="range.value">
                {{ range.label }}
              </option>
            </select>
            <p id="date-range-description" class="form-description">{{ t("default_date_range_description") }}</p>
          </div>

          <!-- Save Button -->
          <div class="form-actions">
            <button
              type="submit"
              class="save-button"
              :disabled="saving"
            >
              {{ saving ? t("saving", "Saving...") : t("save_settings_button") }}
            </button>
          </div>
        </form>
      </div>
    </section>

    <!-- Language Settings Card -->
    <LanguageSettings />
  </div>
</template>

<style scoped lang="scss">
@use '../../assets/style/tokens/breakpoints' as *;

.settings-page {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-6);
  max-width: 800px;

  .page-header {
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

      .message {
        display: flex;
        align-items: center;
        gap: var(--pav-space-2);
        padding: var(--pav-space-3) var(--pav-space-4);
        border-radius: var(--pav-border-radius-md);
        font-size: var(--pav-font-size-xs);
        margin-bottom: var(--pav-space-5);

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

      .settings-form {
        display: flex;
        flex-direction: column;
        gap: var(--pav-space-5);

        .form-group {
          .form-label {
            display: block;
            margin-bottom: var(--pav-space-2);
            font-size: var(--pav-font-size-xs);
            font-weight: var(--pav-font-weight-medium);
            color: var(--pav-color-text-secondary);
          }

          .form-input,
          .form-select {
            display: block;
            max-width: 28rem;
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

            &:disabled {
              opacity: 0.6;
              cursor: not-allowed;
              background: var(--pav-color-surface-secondary);
            }
          }

          .form-select {
            appearance: none;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2378716C' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right 16px center;
            padding-right: var(--pav-space-10);
          }

          .form-description {
            margin: var(--pav-space-1_5) 0 0 0;
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
  .settings-page {
    .settings-card {
      .settings-card-body {
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

        .settings-form {
          .form-group {
            .form-input,
            .form-select {
              background: var(--pav-color-surface-secondary);
              border-color: var(--pav-color-stone-600);

              &:focus {
                border-color: var(--pav-color-brand-primary);
                box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.2);
              }
            }

            .form-select {
              background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23A8A29E' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
            }
          }
        }
      }
    }
  }
}
</style>
