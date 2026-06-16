<script setup lang="ts">
import { reactive, ref, inject, nextTick, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';

import type AuthenticationService from '@/client/service/authn';

const { t } = useTranslation('authentication', {
  keyPrefix: 'email_confirm',
});

const route = useRoute();
const authn = inject('authn') as AuthenticationService;

/**
 * Render state for the email-change confirmation page.
 *
 * - 'confirming': consume in flight (also the initial state)
 * - 'success':    token consumed; the email change is committed
 * - 'invalid':    token rejected, expired, missing, or network failure
 *
 * Anti-enumeration posture (mirrors the backend collapse and apply-confirm):
 * every failure mode — unknown / expired / already-consumed / address-now-taken
 * / network error — renders the same single 'invalid' copy. The page never
 * reveals which failure occurred.
 */
type RenderState = 'confirming' | 'success' | 'invalid';

const state = reactive({
  render: 'confirming' as RenderState,
});

// Template ref to the terminal-state heading. Only one terminal branch
// (success or invalid) ever renders, so this resolves to whichever one is
// shown. After the async consume settles we move focus here so the screen
// reader announces the title + message on the freshly-swapped view
// (WCAG 4.1.3 / 2.4.3) — the in-flight live region is unreliable.
const resultHeading = ref<HTMLElement | null>(null);

onMounted(async () => {
  const token = route.params.token as string;
  // Defensive: a missing token short-circuits to invalid without ever hitting
  // the network. The router param is required, but be explicit.
  if (!token) {
    state.render = 'invalid';
    await nextTick();
    resultHeading.value?.focus();
    return;
  }

  try {
    const result = await authn.confirmEmailChange(token);
    if (result?.valid === true) {
      state.render = 'success';
      // Propagate the new email into the current session, if one exists. This
      // page may be opened anonymously or on a different device, so a missing
      // or failed refresh is non-fatal — the change is already committed
      // server-side and the success state must stand regardless.
      await authn.refreshToken();
    }
    else {
      state.render = 'invalid';
    }
  }
  catch {
    // Network or server failure: same anti-enumeration posture as the backend —
    // collapse to the generic invalid copy.
    state.render = 'invalid';
  }
  // Move focus to the terminal-state heading after the view swaps.
  await nextTick();
  resultHeading.value?.focus();
});
</script>

<template>
  <div>
    <!-- Confirming state (initial + while the consume is in flight) -->
    <div v-if="state.render === 'confirming'" class="welcome-card">
      <h3>{{ t('title') }}</h3>
      <p
        class="status-message"
        role="status"
        aria-live="polite"
      >
        {{ t('confirming') }}
      </p>
    </div>

    <!-- Success state -->
    <div v-else-if="state.render === 'success'" class="welcome-card">
      <h3
        ref="resultHeading"
        tabindex="-1"
      >{{ t('title') }}</h3>
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
      <h3
        ref="resultHeading"
        tabindex="-1"
      >{{ t('title') }}</h3>
      <p
        class="invalid-message"
        role="alert"
      >{{ t('invalid_message') }}</p>
      <router-link
        class="forgot"
        :to="{ name: 'login' }"
      >{{ t('go_login') }}</router-link>
    </div>
  </div>
</template>

<style scoped lang="scss">
h3 {
  margin-block-end: var(--pav-space-4);
}

.status-message,
.success-message,
.invalid-message {
  font-size: var(--pav-font-size-base);
  color: var(--pav-text-secondary);
  margin-block-end: var(--pav-space-6);
}
</style>
