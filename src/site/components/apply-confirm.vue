<script setup lang="ts">
import { reactive, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import axios from 'axios';

const { t } = useTranslation('system', {
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
  <main class="apply-confirm">
    <h1 class="apply-confirm__heading">{{ t('heading') }}</h1>

    <!-- Validating state -->
    <p
      v-if="state.render === 'validating'"
      class="apply-confirm__status"
      role="status"
      aria-live="polite"
    >
      {{ t('validating') }}
    </p>

    <!-- Valid token: explicit confirm button -->
    <div v-else-if="state.render === 'valid'" class="apply-confirm__valid">
      <p class="apply-confirm__intro">{{ t('valid_intro') }}</p>
      <button
        type="button"
        class="apply-confirm__button"
        :disabled="state.isSubmitting"
        :aria-disabled="state.isSubmitting || undefined"
        @click="handleConfirmClick"
      >{{ state.isSubmitting ? t('confirming') : t('confirm_button') }}</button>
    </div>

    <!-- Success state -->
    <div v-else-if="state.render === 'success'" class="apply-confirm__success">
      <p
        class="apply-confirm__success-message"
        role="status"
      >{{ t('success_message') }}</p>
      <a
        href="/"
        class="apply-confirm__home-link"
      >{{ t('go_home') }}</a>
    </div>

    <!-- Invalid / expired / failed state -->
    <div v-else class="apply-confirm__invalid">
      <p
        class="apply-confirm__invalid-message"
        role="alert"
      >{{ t('invalid_message') }}</p>
      <a
        href="/auth/apply"
        class="apply-confirm__reapply-link"
      >{{ t('reapply_link') }}</a>
    </div>
  </main>
</template>

<style scoped lang="scss">
@use '../assets/mixins' as *;

// ================================================================
// APPLY CONFIRM (Site / Anonymous)
// ================================================================
// Public confirmation landing page reached from the email link sent
// after submitting an account application. Anti-enumeration: every
// failure state collapses to the same generic copy. The POST is fired
// only by an explicit user click (email-scanner protection).
// ================================================================

.apply-confirm {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: $public-space-3xl $public-space-xl;
  flex: 1;
}

.apply-confirm__heading {
  font-size: $public-font-size-2xl;
  font-weight: $public-font-weight-semibold;
  color: $public-text-primary-light;
  margin: 0 0 $public-space-lg 0;

  @include public-dark-mode {
    color: $public-text-primary-dark;
  }
}

.apply-confirm__status,
.apply-confirm__intro {
  font-size: $public-font-size-md;
  color: $public-text-secondary-light;
  line-height: $public-line-height-relaxed;
  margin: 0 0 $public-space-xl 0;

  @include public-dark-mode {
    color: $public-text-secondary-dark;
  }
}

.apply-confirm__valid,
.apply-confirm__success,
.apply-confirm__invalid {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: $public-space-lg;
  width: 100%;
  max-width: 480px;
}

.apply-confirm__button {
  @include public-button-primary;

  padding: $public-space-sm $public-space-xl;
  font-size: $public-font-size-base;
}

.apply-confirm__success-message {
  font-size: $public-font-size-md;
  color: $public-success-light;
  line-height: $public-line-height-relaxed;
  margin: 0;

  @include public-dark-mode {
    color: $public-success-dark;
  }
}

.apply-confirm__invalid-message {
  font-size: $public-font-size-md;
  color: $public-error-light;
  line-height: $public-line-height-relaxed;
  margin: 0;

  @include public-dark-mode {
    color: $public-error-dark;
  }
}

.apply-confirm__home-link,
.apply-confirm__reapply-link {
  @include public-button-ghost;

  padding: $public-space-sm $public-space-lg;
  font-size: $public-font-size-base;
  text-decoration: none;

  &:hover {
    text-decoration: none;
  }
}
</style>
