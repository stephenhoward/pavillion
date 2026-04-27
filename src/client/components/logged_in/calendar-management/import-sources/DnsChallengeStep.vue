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
        <CopyButton
          :text="recordName"
          :label="t('dns_challenge.copy_record')"
          :copied-label="t('dns_challenge.copied')"
          :aria-label="t('dns_challenge.copy_record_name')"
          class="dns-challenge-step__copy-btn"
        />
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
        <CopyButton
          :text="recordValue"
          :label="t('dns_challenge.copy_record')"
          :copied-label="t('dns_challenge.copied')"
          :aria-label="t('dns_challenge.copy_record_value')"
          class="dns-challenge-step__copy-btn"
        />
      </div>
    </div>

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
import { computed, ref } from 'vue';
import { useTranslation } from 'i18next-vue';

import CopyButton from '@/client/components/common/CopyButton.vue';
import PillButton from '@/client/components/common/pill-button.vue';
import ImportSourceService from '@/client/service/import_source';
import { importSourceErrorKey } from '@/client/service/import_source_errors';
import type { ImportSource } from '@/common/model/import_source';

/**
 * Step component that walks a calendar editor through the DNS TXT verification
 * flow for an ICS import source. Designed to be rendered inside the
 * {@link VerifyOwnershipWizard} as the body of the `dns-txt` step. Displays
 * the challenge record name and value, exposes copy-to-clipboard on each,
 * and calls `ImportSourceService.verifySource` on confirm.
 *
 * This component does NOT wrap itself in a ModalLayout — the wizard owns
 * the modal chrome (title, focus trap, escape handling, backdrop). The
 * step emits `change-method` so the wizard can return to the picker, and
 * `verified` when verification succeeds. Wizard-level dismissal stays
 * with the wizard.
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
    errorMessage.value = t(importSourceErrorKey(err, 'verify-dns'));
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
</script>

<style scoped lang="scss">
@use '../../../../assets/style/components/calendar-admin' as *;
@use '../../../../assets/style/mixins/challenge-step' as *;

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
