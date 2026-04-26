<template>
  <section
    class="dns-challenge-step"
    data-test="verify-wizard-dns-step"
    :aria-labelledby="headingId"
  >
    <header class="dns-challenge-step__header">
      <h3 :id="headingId" class="dns-challenge-step__heading">
        {{ t('dns_challenge.modal_title') }}
      </h3>
      <p class="dns-challenge-step__instructions">
        {{ t('dns_challenge.instructions', { name: recordName, value: recordValue }) }}
      </p>
    </header>

    <div class="dns-challenge-step__field">
      <label :for="nameInputId" class="dns-challenge-step__label">
        {{ t('dns_challenge.record_name_label') }}
      </label>
      <div class="dns-challenge-step__row">
        <input
          :id="nameInputId"
          type="text"
          class="dns-challenge-step__input"
          readonly
          :value="recordName"
        />
        <button
          type="button"
          class="btn-ghost dns-challenge-step__copy-btn"
          :aria-label="t('dns_challenge.copy_record_name')"
          @click="copy('name')"
        >
          <Copy :size="16" :stroke-width="2" aria-hidden="true" />
          {{ copied === 'name' ? t('dns_challenge.copied') : t('dns_challenge.copy_record') }}
        </button>
      </div>
    </div>

    <div class="dns-challenge-step__field">
      <label :for="valueInputId" class="dns-challenge-step__label">
        {{ t('dns_challenge.record_value_label') }}
      </label>
      <div class="dns-challenge-step__row">
        <input
          :id="valueInputId"
          type="text"
          class="dns-challenge-step__input"
          readonly
          :value="recordValue"
        />
        <button
          type="button"
          class="btn-ghost dns-challenge-step__copy-btn"
          :aria-label="t('dns_challenge.copy_record_value')"
          @click="copy('value')"
        >
          <Copy :size="16" :stroke-width="2" aria-hidden="true" />
          {{ copied === 'value' ? t('dns_challenge.copied') : t('dns_challenge.copy_record') }}
        </button>
      </div>
    </div>

    <!--
      Live region that announces "Copied" to screen readers when either copy
      button is clicked. Visually hidden; only accessible-tech consumers see
      it. WCAG SC 4.1.3 Status Messages.
    -->
    <span
      class="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ copied ? t('dns_challenge.copied') : '' }}
    </span>

    <div
      v-if="errorMessage"
      class="alert alert--error dns-challenge-step__error"
      role="alert"
      aria-live="polite"
    >
      {{ errorMessage }}
    </div>

    <div class="dns-challenge-step__actions">
      <button
        type="button"
        class="btn-ghost"
        data-test="verify-wizard-change-method"
        :disabled="isVerifying"
        @click="onChangeMethod"
      >
        {{ t('verify_wizard.change_method_button') }}
      </button>
      <PillButton
        variant="primary"
        :disabled="isVerifying"
        @click="onVerify"
      >
        {{ isVerifying ? t('dns_challenge.verifying') : t('dns_challenge.verify_button') }}
      </PillButton>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, onBeforeUnmount } from 'vue';
import { useTranslation } from 'i18next-vue';
import { Copy } from 'lucide-vue-next';

import PillButton from '@/client/components/common/pill-button.vue';
import ImportSourceService from '@/client/service/import_source';
import type { ImportSource } from '@/common/model/import_source';
import { ImportSourceDnsVerificationError } from '@/common/exceptions/import';

/**
 * Step component that walks a calendar editor through the DNS TXT verification
 * flow for an ICS import source. Designed to be rendered inside the
 * {@link VerifyOwnershipWizard} as the body of the `dns-txt` step. Displays
 * the challenge record name and value, exposes copy-to-clipboard on each,
 * and calls `ImportSourceService.verifySource` on confirm.
 *
 * Unlike the legacy {@link DnsChallengeModal} this component does NOT wrap
 * itself in a ModalLayout — the wizard owns the modal chrome (title, focus
 * trap, escape handling, backdrop). The step emits `change-method` so the
 * wizard can return to the picker, and `verified` when verification
 * succeeds. Wizard-level dismissal stays with the wizard.
 *
 * @see bead pv-jutm.6
 */

const props = defineProps<{
  source: ImportSource;
  /**
   * The instance host component of the challenge value. Paired with the
   * token below to form `pavillion-verify=v1:{instanceHost}:{token}`.
   *
   * Passed from the wizard because the domain is a server-side config value
   * (not on the ImportSource model) that must be known by the UI to render
   * the TXT record string exactly as the DNS verifier will read it.
   */
  instanceHost: string;
  /**
   * The per-source HMAC verification token. Rendered only in the challenge
   * value and never persisted client-side. May be empty while the wizard is
   * still loading the challenge metadata — the step still renders, but the
   * value field will be visibly incomplete.
   */
  challengeToken: string;
}>();

const emit = defineEmits<{
  (event: 'change-method'): void;
  (event: 'verified', source: ImportSource): void;
}>();

const { t } = useTranslation('calendars', { keyPrefix: 'import' });

const service = new ImportSourceService();

const isVerifying = ref(false);
const errorMessage = ref<string | null>(null);
const copied = ref<'name' | 'value' | null>(null);
let copyTimeout: ReturnType<typeof setTimeout> | null = null;

// Unique field ids so multiple instances (if mounted concurrently in
// different sections) do not collide.
const uid = Math.random().toString(36).slice(2, 10);
const headingId = `dns-challenge-step-heading-${uid}`;
const nameInputId = `dns-challenge-step-name-${uid}`;
const valueInputId = `dns-challenge-step-value-${uid}`;

/**
 * Record name derived from the source URL hostname. Mirrors the server
 * verifier's derivation so the admin and verifier always agree on which
 * TXT record is being queried.
 */
const recordName = computed<string>(() => {
  try {
    const parsed = new URL(props.source.url);
    return `_pavillion-challenge.${parsed.hostname}`;
  }
  catch {
    // Defensive fallback: should not occur because URLs are validated
    // server-side before the source is created, but the step must still
    // render something rather than throwing.
    return '_pavillion-challenge.';
  }
});

/**
 * Full TXT record value the owner must publish. Exactly matches the format
 * produced by `formatVerificationRecord()` on the server.
 */
const recordValue = computed<string>(() => {
  return `pavillion-verify=v1:${props.instanceHost}:${props.challengeToken}`;
});

/**
 * Copy the record name or value to the clipboard. Uses the async
 * navigator.clipboard API; when unavailable (older environments / tests
 * without a clipboard mock) the operation is a no-op but still updates the
 * `copied` indicator so users get feedback that the action ran.
 */
const copy = async (field: 'name' | 'value'): Promise<void> => {
  const text = field === 'name' ? recordName.value : recordValue.value;

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
    }
  }
  catch {
    // Clipboard access may be denied by the browser; treat as soft failure
    // — the input field is selectable for manual copy.
  }

  copied.value = field;
  if (copyTimeout) {
    clearTimeout(copyTimeout);
  }
  copyTimeout = setTimeout(() => {
    copied.value = null;
    copyTimeout = null;
  }, 1500);
};

/**
 * Map an error returned by verifySource to an i18n key under
 * `calendars.import.errors.*`. Falls back to a generic unknown_verify
 * message so the UI never displays an empty error surface.
 */
const errorKeyFor = (err: unknown): string => {
  if (err instanceof ImportSourceDnsVerificationError) {
    switch (err.reason) {
      case 'IMPORT_DNS_NOT_FOUND': return 'errors.dns_not_found';
      case 'IMPORT_DNS_MISMATCH': return 'errors.dns_mismatch';
      case 'IMPORT_DNS_RESOLVER_DISAGREEMENT': return 'errors.dns_resolver_disagreement';
      case 'IMPORT_DNS_RESOLVER_UNAVAILABLE': return 'errors.dns_resolver_unavailable';
      case 'IMPORT_DNS_PSL_VIOLATION': return 'errors.dns_psl_violation';
      default: return 'errors.unknown_verify';
    }
  }
  const name = (err as { name?: string })?.name;
  if (name === 'ImportSourceVerifyRateLimitError') {
    return 'errors.rate_limited';
  }
  if (name === 'ImportSourceFetchError') {
    return 'errors.fetch_error';
  }
  if (name === 'ImportSourceSsrfBlockedError') {
    return 'errors.ssrf_blocked';
  }
  if (name === 'ImportSourceParseError') {
    return 'errors.parse_error';
  }
  return 'errors.unknown_verify';
};

const onVerify = async (): Promise<void> => {
  if (isVerifying.value) {
    return;
  }
  isVerifying.value = true;
  errorMessage.value = null;
  try {
    const updated = await service.verifySource(
      props.source.calendarId,
      props.source.id,
    );
    emit('verified', updated);
  }
  catch (err) {
    errorMessage.value = t(errorKeyFor(err));
  }
  finally {
    isVerifying.value = false;
  }
};

const onChangeMethod = (): void => {
  if (isVerifying.value) {
    return;
  }
  emit('change-method');
};

onBeforeUnmount(() => {
  if (copyTimeout) {
    clearTimeout(copyTimeout);
    copyTimeout = null;
  }
});
</script>

<style scoped lang="scss">
@use '../../../../assets/style/components/calendar-admin' as *;
@use '../../../../assets/style/mixins/visibility' as *;
@use '../../../../assets/style/mixins/challenge-step' as *;

// Visually hide content while keeping it accessible to screen readers.
// Used for the "Copied" live region; pattern mirrors the shared sr-only
// pattern in admin/root.vue (WCAG SC 4.1.3 Status Messages).
.sr-only {
  @include sr-only;
}

.dns-challenge-step {
  @include challenge-step;

  &__header {
    @include challenge-step-header;
  }

  &__heading {
    @include challenge-step-title;
  }

  &__instructions {
    @include challenge-step-instructions;
  }

  &__field {
    @include challenge-step-field;
  }

  &__label {
    @include challenge-step-label;
  }

  &__row {
    @include challenge-step-row;
  }

  &__input {
    @include challenge-step-code-input;
    border-width: 0;
    background: var(--pav-surface-card);
  }

  &__copy-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--pav-space-1);
    flex-shrink: 0;
  }

  &__error {
    margin: 0;
  }

  &__actions {
    @include challenge-step-actions;
  }
}

.btn-ghost {
  @include admin-ghost-button;
}
</style>
