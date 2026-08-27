<template>
  <div class="widget-domains">
    <!-- Error Display -->
    <div
      v-if="state.error"
      class="alert alert--error"
      role="alert"
      aria-live="polite">
      {{ state.error }}
    </div>

    <!--
      Funding gate. The card decides for itself whether the widget-embedding
      gate is known to be closed, so nothing here branches on funding state.
      Once a plan is started the domain the gate refused is re-issued, so the
      reader does not have to type it again.
    -->
    <FundingUpsellCard
      :calendarId="props.calendarId"
      :feature="WIDGET_FEATURE"
      @plan-started="retryRefusedDomain"
    />

    <!-- Success Display -->
    <div
      v-if="state.success"
      class="alert alert--success"
      role="alert"
      aria-live="polite">
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

<script setup lang="ts">
import { reactive, onMounted } from 'vue';
import { useTranslation } from 'i18next-vue';
import axios from 'axios';
import PillButton from '@/client/components/common/pill-button.vue';
import LoadingMessage from '@/client/components/common/loading_message.vue';
import FundingUpsellCard from '@/client/components/common/FundingUpsellCard.vue';
import { useFundingAccess } from '@/client/composables/useFundingAccess';
import { validateAndEncodeId } from '@/client/service/utils';
import type { FundingGatedFeature } from '@/common/model/funding-plan';

// Props
const props = defineProps<{
  calendarId: string;
}>();

/**
 * The registry key the upsell card is shown for. Annotated so the string is
 * checked against `FUNDING_GATED_FEATURES` here rather than only at the card.
 */
const WIDGET_FEATURE: FundingGatedFeature = 'widget_embedding';

// Translations
const { t } = useTranslation('calendars', {
  keyPrefix: 'widget.domains',
});

// Shared funding-gate state. Only the denial recorder is used here — the
// reading of the gate, and every decision about what to show for it, belongs
// to FundingUpsellCard.
const { recordAccessDenial } = useFundingAccess(props.calendarId);

// Component state
const state = reactive<{
  isLoading: boolean;
  isAdding: boolean;
  removingId: boolean | null;
  error: string;
  success: string;
  newDomain: string;
  currentDomain: string | null;
}>({
  isLoading: false,
  isAdding: false,
  removingId: null,
  error: '',
  success: '',
  newDomain: '',
  currentDomain: null, // Changed from domains array to single domain
});

// Whether the last write was refused by the funding gate. The typed domain is
// left in the input in that case, so the card's plan-started can retry it.
let domainRefused = false;

/**
 * Validate domain format
 */
const isValidDomain = (domain: string) => {
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
    domainRefused = false;
    state.success = t('add_success');
    clearMessages();
  }
  catch (error) {
    console.error('Error setting domain:', error);

    // A funding refusal is recorded in the shared funding cache and answered
    // by FundingUpsellCard, which appears with the explanation and the way to
    // act on it. No alert here would add anything, and a timed one would
    // expire while the upsell it duplicates stays on screen.
    //
    // Nothing checks for an admin: recognition is the composable's, and the
    // gate itself already exempts admins server-side, so a client-side second
    // guess can only disagree with the server about what just happened.
    if (recordAccessDenial(error)) {
      domainRefused = true;
      return;
    }

    const errorName = (error as { response?: { data?: { errorName?: string } } } | null)
      ?.response?.data?.errorName;
    if (errorName === 'InvalidDomainFormatError') {
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
 * Re-issue the write the funding gate refused, now that a plan has been
 * started and the card has already re-read the calendar's access. Nothing to
 * retry when no write was refused, or the reader has since cleared the input.
 */
const retryRefusedDomain = async () => {
  if (!domainRefused || !state.newDomain.trim()) {
    return;
  }
  await addDomain();
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
  color: var(--pav-text-secondary);
  margin: 0;
}

.help-text {
  margin: 0;
  color: var(--pav-text-secondary);
  font-size: 0.875rem;
  line-height: 1.5;
}

.form-input {
  @include admin-form-input;
  width: 100%;
}

.update-button {
  width: 100%;
}

// Error/success variants come from the shared admin-alert mixin
// (semantic error tokens; the colorblind-safe blue success palette).
.alert {
  @include admin-alert;
}
</style>
