<script setup lang="ts">
import iso6391 from 'iso-639-1-dir';
import { useTranslation } from 'i18next-vue';
import { inject, onMounted, reactive, ref } from 'vue';
import Config from '../../service/config';
import { useLanguageManagement } from '@/client/composables/useLanguageManagement';
import { DEFAULT_LANGUAGE_CODE } from '@/common/i18n/languages';
import HousekeepingStatus from './housekeeping-status.vue';
import LanguageSettings from './language-settings.vue';
import LanguageTabSelector from '../common/language-tab-selector.vue';
import HelpButton from '@/client/components/common/help-button.vue';

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

// Shared translatable content state — one selected language drives both
// the instance description and instance policy fields, matching the
// event editor pattern where a single tabset governs multiple fields.
// Language selection is delegated to the shared useLanguageManagement
// composable; this component is a read-only consumer (admins manage the
// enabled-languages set through the LanguageSettings sibling card).
const translationState = reactive({
  descriptions: {} as Record<string, string>,
  policies: {} as Record<string, string>,
});

const lang = useLanguageManagement();

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

onMounted(async () => {
  try {
    const configService = await Config.init();
    const settings = configService.settings();
    const languages = settings.enabledLanguages ?? [DEFAULT_LANGUAGE_CODE];
    lang.languages.value = languages;
    lang.currentLanguage.value = languages[0] || DEFAULT_LANGUAGE_CODE;
    translationState.descriptions = { ...settings.instanceDescription } || {};
    translationState.policies = { ...settings.instancePolicy } || {};
  }
  catch (error) {
    console.error('Error loading instance description settings:', error);
  }
});

function currentLanguageDir() {
  return iso6391.getDir(lang.currentLanguage.value) === 'rtl' ? 'rtl' : 'ltr';
}

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
      instanceDescription: translationState.descriptions,
      instancePolicy: translationState.policies,
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
      <div class="page-header__title-row">
        <h1>{{ t("general_settings") }}</h1>
        <HelpButton />
      </div>
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
            <p id="site-title-description" class="form-description">{{ t("site_title_description") }}</p>
            <input
              id="instanceName"
              type="text"
              class="form-input"
              :disabled="saving"
              aria-describedby="site-title-description"
              v-model="siteTitle"
            />
          </div>

          <!-- Translatable instance content (description + policy share one language tabset) -->
          <div class="translatable-fields">
            <LanguageTabSelector
              v-model="lang.currentLanguage.value"
              :languages="lang.languages.value"
            />

            <div class="form-group">
              <label for="instanceDescription" class="form-label">{{ t("instance_description") }}</label>
              <p id="instance-description-help" class="form-description">{{ t("instance_description_help") }}</p>
              <textarea
                id="instanceDescription"
                class="form-textarea"
                :disabled="saving"
                :maxlength="500"
                :dir="currentLanguageDir()"
                :placeholder="t('instance_description_placeholder')"
                aria-describedby="instance-description-help"
                v-model="translationState.descriptions[lang.currentLanguage.value]"
              />
            </div>

            <div class="form-group">
              <label for="instancePolicy" class="form-label">{{ t("instance_policy") }}</label>
              <p id="instance-policy-help" class="form-description">{{ t("instance_policy_help") }}</p>
              <textarea
                id="instancePolicy"
                class="form-textarea"
                :disabled="saving"
                :rows="15"
                :dir="currentLanguageDir()"
                :placeholder="t('instance_policy_placeholder')"
                aria-describedby="instance-policy-help"
                v-model="translationState.policies[lang.currentLanguage.value]"
              />
            </div>
          </div>

          <!-- Registration Mode -->
          <div class="form-group">
            <label for="registrationMode" class="form-label">{{ t("registration_mode") }}</label>
            <p id="reg-mode-description" class="form-description">{{ t("registration_mode_description") }}</p>
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
          </div>

          <!-- Default Date Range -->
          <div class="form-group">
            <label for="defaultDateRange" class="form-label">{{ t("default_date_range") }}</label>
            <p id="date-range-description" class="form-description">{{ t("default_date_range_description") }}</p>
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
    &__title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

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

        // Wrapper that groups the instance description and instance policy
        // fields under a single shared LanguageTabSelector. Matches the
        // settings-form gap so the wrapped fields keep the same vertical
        // rhythm as the surrounding form-groups.
        .translatable-fields {
          display: flex;
          flex-direction: column;
          gap: var(--pav-space-5);
        }

        .form-group {
          .form-label {
            display: block;
            margin-bottom: var(--pav-space-2);
            font-size: var(--pav-font-size-xs);
            font-weight: var(--pav-font-weight-medium);
            color: var(--pav-color-text-secondary);
          }

          .form-input,
          .form-select,
          .form-textarea {
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

          .form-textarea {
            min-height: 6rem;
            resize: vertical;
            line-height: var(--pav-line-height-normal);
            border-radius: var(--pav-border-radius-md);
          }

          .form-select {
            appearance: none;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2378716C' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right 16px center;
            background-size: 1rem 1rem;
            padding-right: var(--pav-space-10);
          }

          // Help text sits between the label and the field so users see
          // guidance before interacting with the input.
          .form-description {
            margin: 0 0 var(--pav-space-2) 0;
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
            .form-select,
            .form-textarea {
              background: var(--pav-color-surface-secondary);
              border-color: var(--pav-color-stone-600);

              &:focus {
                border-color: var(--pav-color-brand-primary);
                box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.2);
              }
            }

            .form-select {
              background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23A8A29E' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
              background-repeat: no-repeat;
              background-position: right 16px center;
              background-size: 1rem 1rem;
            }
          }
        }
      }
    }
  }
}
</style>
