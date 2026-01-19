<script setup>
import { useTranslation } from 'i18next-vue';
import { inject, ref } from 'vue';
import Config from '../../service/config';
import HousekeepingStatus from './housekeeping-status.vue';

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
  <div>
    <!-- System Status Widget -->
    <HousekeepingStatus />

    <!-- General Settings Section -->
    <section class="settings" aria-labelledby="settings-heading">
      <h1 id="settings-heading">{{ t("general_settings") }}</h1>

      <div role="status" aria-live="polite">
        <div v-if="successMessage" class="success-message">{{ successMessage }}</div>
        <div v-if="errorMessage" class="error-message">{{ errorMessage }}</div>
      </div>

      <form class="settings-form">
        <div class="form-group">
          <label id="instance-name-label" class="form-label">{{ t("instance_name") }}</label>
          <div class="form-field" aria-labelledby="instance-name-label">
            <input type="text"
                   :disabled="saving"
                   aria-describedby="site-title-description"
                   v-model="siteTitle"
            />
            <div id="site-title-description" class="description">{{ t("site_title_description") }}</div>
          </div>
        </div>

        <div class="form-group">
          <label for="registrationMode" class="form-label">{{ t("registration_mode") }}</label>
          <div class="form-field">
            <select
              id="registrationMode"
              v-model="selectedRegistrationMode"
              :disabled="saving"
              aria-describedby="reg-mode-description">
              <option v-for="mode in registrationModes" :key="mode.value" :value="mode.value">
                {{ mode.label }}
              </option>
            </select>
            <div id="reg-mode-description" class="description">{{ t("registration_mode_description") }}</div>
          </div>
        </div>

        <div class="form-group">
          <label for="defaultDateRange" class="form-label">{{ t("default_date_range") }}</label>
          <div class="form-field">
            <select
              id="defaultDateRange"
              v-model="selectedDateRange"
              :disabled="saving"
              aria-describedby="date-range-description">
              <option v-for="range in dateRangeOptions" :key="range.value" :value="range.value">
                {{ range.label }}
              </option>
            </select>
            <div id="date-range-description" class="description">{{ t("default_date_range_description") }}</div>
          </div>
        </div>

        <button
          type="button"
          class="primary"
          :disabled="saving"
          @click="updateSettings"
        >{{  t("save_settings_button") }}</button>
      </form>
    </section>
  </div>
</template>

<style scoped lang="scss">
.settings-section {
  margin: 10px;
}

h2 {
  font-weight: 200;
  font-size: 1.5rem;
  margin-bottom: 1.5rem;
}

.success-message {
  margin-bottom: 1.5rem;
  padding: 0.75rem;
  background-color: #f0fff0;
  border: 1px solid #73d873;
  color: #2a7d2a;
  border-radius: 4px;
}

.error-message {
  margin-bottom: 1.5rem;
  padding: 0.75rem;
  background-color: #fff0f0;
  border: 1px solid #d87373;
  color: #7d2a2a;
  border-radius: 4px;
}
</style>
