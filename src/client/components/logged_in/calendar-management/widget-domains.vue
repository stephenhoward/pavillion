<template>
  <div class="widget-domains">
    <!-- Error Display -->
    <div v-if="state.error" class="alert alert--error">
      {{ state.error }}
    </div>

    <!-- Success Display -->
    <div v-if="state.success" class="alert alert--success">
      {{ state.success }}
    </div>

    <!-- Loading State -->
    <LoadingMessage v-if="state.isLoading" :description="t('loading')" />

    <!-- Domains List -->
    <div v-else class="domains-content">
      <!-- Add Domain Form (shown when no domain or when changing domain) -->
      <div class="domain-form">
        <label for="newDomain" class="form-label">{{ t('add_domain_label') }}</label>
        <p class="help-text">{{ t('add_domain_help') }}</p>
        <input
          id="newDomain"
          v-model="state.newDomain"
          type="text"
          class="form-input"
          :placeholder="state.currentDomain || 'example.com'"
          :disabled="state.isAdding"
          @keyup.enter="addDomain"
        />
        <PillButton
          variant="primary"
          class="update-button"
          @click="addDomain"
          :disabled="state.isAdding || !state.newDomain.trim()"
        >
          {{ state.isAdding ? t('adding') : t('update_button') }}
        </PillButton>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, onMounted } from 'vue';
import { useTranslation } from 'i18next-vue';
import axios from 'axios';
import PillButton from '@/client/components/common/PillButton.vue';
import LoadingMessage from '@/client/components/common/loading_message.vue';
import { validateAndEncodeId } from '@/client/service/utils';

// Props
const props = defineProps({
  calendarId: {
    type: String,
    required: true,
  },
});

// Translations
const { t } = useTranslation('calendars', {
  keyPrefix: 'widget.domains',
});

// Component state
const state = reactive({
  isLoading: false,
  isAdding: false,
  removingId: null,
  error: '',
  success: '',
  newDomain: '',
  currentDomain: null, // Changed from domains array to single domain
});

/**
 * Validate domain format
 */
const isValidDomain = (domain) => {
  if (!domain || domain.trim() === '') {
    return false;
  }

  // Reject domains with protocol
  if (domain.includes('://')) {
    return false;
  }

  // Reject domains with path
  if (domain.includes('/')) {
    return false;
  }

  // Reject domains with spaces
  if (domain.includes(' ')) {
    return false;
  }

  // Basic domain validation: letters, numbers, dots, hyphens, and optional port
  const domainPattern = /^[a-z0-9.-]+(:\d+)?$/i;
  if (!domainPattern.test(domain)) {
    return false;
  }

  // Must have at least one dot (e.g., "example.com")
  if (!domain.includes('.')) {
    return false;
  }

  return true;
};

/**
 * Clear messages with a timeout
 */
const clearMessages = (delay = 5000) => {
  setTimeout(() => {
    state.error = '';
    state.success = '';
  }, delay);
};

/**
 * Load allowed domain
 */
const loadDomains = async () => {
  try {
    state.isLoading = true;
    state.error = '';

    const encodedId = validateAndEncodeId(props.calendarId, 'Calendar ID');
    const response = await axios.get(`/api/v1/calendars/${encodedId}/widget/domain`);
    state.currentDomain = response.data.domain;
  }
  catch (error) {
    console.error('Error loading domain:', error);
    state.error = t('error_loading');
    clearMessages();
  }
  finally {
    state.isLoading = false;
  }
};

/**
 * Set the allowed domain
 */
const addDomain = async () => {
  const domain = state.newDomain.trim();

  if (!isValidDomain(domain)) {
    state.error = t('error_invalid_domain');
    clearMessages();
    return;
  }

  try {
    state.isAdding = true;
    state.error = '';
    state.success = '';

    const encodedId = validateAndEncodeId(props.calendarId, 'Calendar ID');
    const response = await axios.put(`/api/v1/calendars/${encodedId}/widget/domain`, {
      domain: domain,
    });

    state.currentDomain = response.data.domain;
    state.newDomain = '';
    state.success = t('add_success');
    clearMessages();
  }
  catch (error) {
    console.error('Error setting domain:', error);
    if (error.response?.data?.errorName === 'InvalidDomainFormatError') {
      state.error = t('error_invalid_domain');
    }
    else {
      state.error = t('error_adding');
    }
    clearMessages();
  }
  finally {
    state.isAdding = false;
  }
};

/**
 * Clear the allowed domain
 */
const removeDomain = async () => {
  if (!window.confirm(t('confirm_remove', { domain: state.currentDomain }))) {
    return;
  }

  try {
    state.removingId = true;
    state.error = '';
    state.success = '';

    const encodedCalendarId = validateAndEncodeId(props.calendarId, 'Calendar ID');
    await axios.delete(`/api/v1/calendars/${encodedCalendarId}/widget/domain`);

    state.currentDomain = null;
    state.success = t('remove_success');
    clearMessages();
  }
  catch (error) {
    console.error('Error clearing domain:', error);
    state.error = t('error_removing');
    clearMessages();
  }
  finally {
    state.removingId = null;
  }
};

// Load domains when component mounts
onMounted(loadDomains);
</script>

<style scoped lang="scss">
@use '../../../assets/style/components/calendar-admin' as *;

.widget-domains {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4);
}

.domains-content {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4);
}

.domain-form {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-3);
}

.form-label {
  font-weight: 500;
  font-size: 0.875rem;
  color: var(--pav-color-stone-700);
  margin: 0;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-300);
  }
}

.help-text {
  margin: 0;
  color: var(--pav-color-stone-600);
  font-size: 0.875rem;
  line-height: 1.5;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.form-input {
  @include admin-form-input;
  width: 100%;
}

.update-button {
  width: 100%;
}

.alert {
  padding: var(--pav-space-3);
  margin-bottom: var(--pav-space-4);
  border-radius: 0.75rem;
  font-size: 0.875rem;

  &.alert--error {
    background-color: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.2);
    color: var(--pav-color-red-700);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-red-400);
    }
  }

  &.alert--success {
    background-color: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.2);
    color: var(--pav-color-green-700);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-green-400);
    }
  }
}
</style>
