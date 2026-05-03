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
 * - 'validating': initial GET in flight
 * - 'valid':      token validated, awaiting explicit user click
 * - 'invalid':    token rejected, expired, missing, or network failure
 * - 'success':    POST succeeded; show success copy
 *
 * Anti-enumeration / email-scanner protection: all failure modes (404,
 * expired, already-consumed, network error, POST failure) collapse to the
 * same 'invalid' state and the same single user-facing copy. The POST
 * is only fired by the user clicking the button — never on mount.
 */
type RenderState = 'validating' | 'valid' | 'invalid' | 'success';

const state = reactive({
  render: 'validating' as RenderState,
  isSubmitting: false,
});

/**
 * Confirms the application token by POSTing to the confirm endpoint.
 *
 * SECURITY: This must only be invoked by an explicit user click. Email
 * security gateways and prefetch services follow GET links automatically;
 * the explicit POST is the user-action gate that prevents accidental
 * confirmation by automated link scanners.
 */
async function handleConfirmClick() {
  if (state.isSubmitting) {
    return;
  }
  state.isSubmitting = true;
  const token = route.params.token as string;

  try {
    const response = await axios.post(`/api/v1/applications/confirm/${token}`);
    if (response?.data?.success === true) {
      state.render = 'success';
    }
    else {
      // Backend returns { valid: false } for every terminal failure. Collapse
      // any non-success shape to the same generic invalid state.
      state.render = 'invalid';
    }
  }
  catch {
    // Network or server failure: same anti-enumeration posture as the
    // backend — collapse to the generic invalid copy.
    state.render = 'invalid';
  }
  finally {
    state.isSubmitting = false;
  }
}

onMounted(async () => {
  const token = route.params.token as string;
  // Defensive: a missing token short-circuits to invalid without ever
  // hitting the network. The router param is required, but be explicit.
  if (!token) {
    state.render = 'invalid';
    return;
  }

  try {
    const response = await axios.get(`/api/v1/applications/confirm/${token}`);
    state.render = response?.data?.valid === true ? 'valid' : 'invalid';
  }
  catch {
    state.render = 'invalid';
  }
});
</script>

<template>
  <div>
    <!-- Validating state -->
    <div v-if="state.render === 'validating'" class="welcome-card">
      <h3>{{ t('title') }}</h3>
      <p
        class="status-message"
        role="status"
        aria-live="polite"
      >
        {{ t('validating') }}
      </p>
    </div>

    <!-- Valid token: explicit confirm button -->
    <div v-else-if="state.render === 'valid'" class="welcome-card">
      <h3>{{ t('title') }}</h3>
      <p class="intro-message">{{ t('valid_intro') }}</p>
      <button
        type="button"
        class="btn btn--pill btn--primary"
        :disabled="state.isSubmitting"
        :aria-disabled="state.isSubmitting || undefined"
        @click="handleConfirmClick"
      >{{ state.isSubmitting ? t('confirming') : t('confirm_button') }}</button>
    </div>

    <!-- Success state -->
    <div v-else-if="state.render === 'success'" class="welcome-card">
      <h3>{{ t('title') }}</h3>
      <p
        class="success-message"
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
      <h3>{{ t('title') }}</h3>
      <p
        class="invalid-message"
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
h3 {
  margin-block-end: var(--pav-space-4);
}

.status-message,
.intro-message,
.success-message,
.invalid-message {
  font-size: 1.125rem; /* 18px */
  color: var(--pav-color-stone-600);
  margin-block-end: var(--pav-space-6);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-300);
  }
}
</style>
