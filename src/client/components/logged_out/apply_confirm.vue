<script setup lang="ts">
import { reactive, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import axios from 'axios';

const { t } = useTranslation('registration', {
  keyPrefix: 'apply_confirm',
});

const route = useRoute();

/**
 * Render state for the confirmation page.
 *
 * - 'confirming': POST in flight (also the initial state)
 * - 'success':    POST succeeded; show success copy
 * - 'invalid':    token rejected, expired, missing, or network failure
 *
 * Anti-enumeration / email-scanner protection: all failure modes (404,
 * expired, already-consumed, network error) collapse to the same 'invalid'
 * state and the same single user-facing copy.
 */
type RenderState = 'confirming' | 'success' | 'invalid';

const state = reactive({
  render: 'confirming' as RenderState,
});

onMounted(async () => {
  const token = route.params.token as string;
  // Defensive: a missing token short-circuits to invalid without ever
  // hitting the network. The router param is required, but be explicit.
  if (!token) {
    state.render = 'invalid';
    return;
  }

  try {
    const response = await axios.post(`/api/v1/applications/confirm/${token}`);
    state.render = response?.data?.success === true ? 'success' : 'invalid';
  }
  catch {
    // Network or server failure: same anti-enumeration posture as the
    // backend — collapse to the generic invalid copy.
    state.render = 'invalid';
  }
});
</script>

<template>
  <div>
    <!-- Confirming state (initial + while POST is in flight) -->
    <div v-if="state.render === 'confirming'" class="welcome-card">
      <h2>{{ t('title') }}</h2>
      <p
        class="status-message confirm-message"
        role="status"
        aria-live="polite"
      >
        {{ t('confirming') }}
      </p>
    </div>

    <!-- Success state -->
    <div v-else-if="state.render === 'success'" class="welcome-card">
      <h2>{{ t('title') }}</h2>
      <p
        class="success-message confirm-message"
        role="status"
        aria-live="polite"
      >{{ t('success_message') }}</p>
      <router-link
        class="forgot"
        :to="{ name: 'login' }"
      >{{ t('go_login') }}</router-link>
    </div>

    <!-- Invalid / expired / failed state -->
    <div v-else class="welcome-card">
      <h2>{{ t('title') }}</h2>
      <p
        class="invalid-message confirm-message"
        role="alert"
      >{{ t('invalid_message') }}</p>
      <router-link
        class="forgot"
        :to="{ name: 'register-apply' }"
      >{{ t('reapply_link') }}</router-link>
    </div>
  </div>
</template>

<style scoped lang="scss">
h2 {
  margin-block-end: var(--pav-space-4);
}
</style>
