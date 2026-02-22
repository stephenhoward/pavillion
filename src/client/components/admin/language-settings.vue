<script setup lang="ts">
import { onMounted, reactive } from 'vue';
import { useTranslation } from 'i18next-vue';
import Config from '../../service/config';
import { AVAILABLE_LANGUAGES } from '@/common/i18n/languages';

const { t } = useTranslation('admin', {
  keyPrefix: 'settings',
});

const state = reactive({
  saving: false,
  successMessage: '',
  errorMessage: '',
  enabledLanguages: [] as string[],
  forceLanguage: null as string | null,
  localeDetectionMethods: {
    urlPrefix: true,
    cookie: true,
    acceptLanguage: true,
  },
});

onMounted(async () => {
  try {
    const configService = await Config.init();
    const settings = configService.settings();
    state.enabledLanguages = settings.enabledLanguages ?? AVAILABLE_LANGUAGES.map(l => l.code);
    state.forceLanguage = settings.forceLanguage ?? null;
    if (settings.localeDetectionMethods) {
      state.localeDetectionMethods = { ...settings.localeDetectionMethods };
    }
  }
  catch (error) {
    console.error('Error loading language settings:', error);
    state.errorMessage = t('settings_update_failed');
  }
});

function isLanguageEnabled(code: string): boolean {
  return state.enabledLanguages.includes(code);
}

function toggleLanguage(code: string): void {
  if (state.enabledLanguages.includes(code)) {
    // Always keep at least one language enabled
    if (state.enabledLanguages.length > 1) {
      state.enabledLanguages = state.enabledLanguages.filter(l => l !== code);
    }
  }
  else {
    state.enabledLanguages = [...state.enabledLanguages, code];
  }
}

async function saveLanguageSettings(): Promise<void> {
  state.saving = true;
  state.errorMessage = '';
  state.successMessage = '';

  try {
    const configService = await Config.init();
    const success = await configService.updateSettings({
      enabledLanguages: state.enabledLanguages,
      forceLanguage: state.forceLanguage,
      localeDetectionMethods: state.localeDetectionMethods,
    });

    if (success) {
      state.successMessage = t('settings_update_success');
    }
    else {
      state.errorMessage = t('settings_update_failed');
    }
  }
  catch (error) {
    console.error('Error saving language settings:', error);
    state.errorMessage = t('settings_update_failed');
  }
  finally {
    state.saving = false;
  }
}
</script>

<template>
  <section class="settings-card" aria-labelledby="language-settings-heading">
    <div class="settings-card-header">
      <h2 id="language-settings-heading">{{ t("language_settings") }}</h2>
      <p class="settings-card-subtitle">{{ t("language_settings_subtitle") }}</p>
    </div>

    <div class="settings-card-body">
      <!-- Status Messages -->
      <div role="status" aria-live="polite">
        <div v-if="state.successMessage" class="message message-success">
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
          {{ state.successMessage }}
        </div>
        <div v-if="state.errorMessage" class="message message-error">
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
          {{ state.errorMessage }}
        </div>
      </div>

      <form class="settings-form" @submit.prevent="saveLanguageSettings">
        <!-- Enabled Languages -->
        <div class="form-group">
          <fieldset class="checkbox-fieldset">
            <legend class="form-label">{{ t("enabled_languages") }}</legend>
            <p class="form-description">{{ t("enabled_languages_description") }}</p>
            <div class="checkbox-group">
              <label
                v-for="lang in AVAILABLE_LANGUAGES"
                :key="lang.code"
                class="checkbox-label"
              >
                <input
                  type="checkbox"
                  class="form-checkbox"
                  :checked="isLanguageEnabled(lang.code)"
                  :disabled="state.saving || (state.enabledLanguages.length === 1 && isLanguageEnabled(lang.code))"
                  @change="toggleLanguage(lang.code)"
                />
                <span class="checkbox-text">{{ lang.nativeName }} ({{ lang.code }})</span>
              </label>
            </div>
          </fieldset>
        </div>

        <!-- Force Language -->
        <div class="form-group">
          <label for="forceLanguage" class="form-label">{{ t("force_language") }}</label>
          <select
            id="forceLanguage"
            class="form-select"
            v-model="state.forceLanguage"
            :disabled="state.saving"
            aria-describedby="force-language-description"
          >
            <option :value="null">{{ t("force_language_none") }}</option>
            <option
              v-for="lang in AVAILABLE_LANGUAGES"
              :key="lang.code"
              :value="lang.code"
            >
              {{ lang.nativeName }} ({{ lang.code }})
            </option>
          </select>
          <p id="force-language-description" class="form-description">{{ t("force_language_description") }}</p>
        </div>

        <!-- Detection Methods -->
        <div class="form-group">
          <fieldset class="checkbox-fieldset">
            <legend class="form-label">{{ t("detection_methods") }}</legend>
            <p class="form-description">{{ t("detection_methods_description") }}</p>
            <div class="checkbox-group">
              <label class="checkbox-label">
                <input
                  type="checkbox"
                  class="form-checkbox"
                  v-model="state.localeDetectionMethods.urlPrefix"
                  :disabled="state.saving"
                />
                <span class="checkbox-text">{{ t("detection_url_prefix") }}</span>
              </label>
              <label class="checkbox-label">
                <input
                  type="checkbox"
                  class="form-checkbox"
                  v-model="state.localeDetectionMethods.cookie"
                  :disabled="state.saving"
                />
                <span class="checkbox-text">{{ t("detection_cookie") }}</span>
              </label>
              <label class="checkbox-label">
                <input
                  type="checkbox"
                  class="form-checkbox"
                  v-model="state.localeDetectionMethods.acceptLanguage"
                  :disabled="state.saving"
                />
                <span class="checkbox-text">{{ t("detection_accept_language") }}</span>
              </label>
            </div>
          </fieldset>
        </div>

        <!-- Save Button -->
        <div class="form-actions">
          <button
            type="submit"
            class="save-button"
            :disabled="state.saving"
          >
            {{ state.saving ? t("saving", "Saving...") : t("save_settings_button") }}
          </button>
        </div>
      </form>
    </div>
  </section>
</template>

<style scoped lang="scss">
.settings-card {
  background: var(--pav-color-surface-primary);
  border: 1px solid var(--pav-border-color-light);
  border-radius: var(--pav-border-radius-card);
  overflow: hidden;

  .settings-card-header {
    padding: var(--pav-space-4) var(--pav-space-6);
    border-bottom: 1px solid var(--pav-border-color-light);

    h2 {
      margin: 0 0 var(--pav-space-1) 0;
      font-size: var(--pav-font-size-base);
      font-weight: var(--pav-font-weight-medium);
      color: var(--pav-color-text-primary);
    }

    .settings-card-subtitle {
      margin: 0;
      font-size: var(--pav-font-size-2xs);
      color: var(--pav-color-text-muted);
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
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2378716C' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 16px center;
          padding-right: var(--pav-space-10);

          &:focus {
            border-color: var(--pav-color-brand-primary);
            box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.15);
          }

          &:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            background-color: var(--pav-color-surface-secondary);
          }
        }

        .form-description {
          margin: var(--pav-space-1_5) 0 0 0;
          font-size: var(--pav-font-size-2xs);
          color: var(--pav-color-text-muted);
        }

        .checkbox-fieldset {
          border: none;
          padding: 0;
          margin: 0;

          legend {
            float: left;
            width: 100%;
            margin-bottom: var(--pav-space-2);
            font-size: var(--pav-font-size-xs);
            font-weight: var(--pav-font-weight-medium);
            color: var(--pav-color-text-secondary);
          }

          p.form-description {
            clear: both;
          }
        }

        .checkbox-group {
          display: flex;
          flex-direction: column;
          gap: var(--pav-space-2);
          margin-top: var(--pav-space-2);
        }

        .checkbox-label {
          display: flex;
          align-items: center;
          gap: var(--pav-space-2);
          cursor: pointer;

          .form-checkbox {
            width: 1rem;
            height: 1rem;
            cursor: pointer;
            accent-color: var(--pav-color-brand-primary);

            &:disabled {
              cursor: not-allowed;
              opacity: 0.5;
            }
          }

          .checkbox-text {
            font-size: var(--pav-font-size-xs);
            color: var(--pav-color-text-primary);
          }
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

@media (prefers-color-scheme: dark) {
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
          .form-select {
            background-color: var(--pav-color-surface-secondary);
            border-color: var(--pav-color-stone-600);
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23A8A29E' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");

            &:focus {
              border-color: var(--pav-color-brand-primary);
              box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.2);
            }

            &:disabled {
              background-color: var(--pav-color-surface-secondary);
            }
          }
        }
      }
    }
  }
}
</style>
