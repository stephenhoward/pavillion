<template>
  <ModalLayout
    :title="t('dns_challenge.modal_title')"
    size="lg"
    modal-class="dns-challenge-modal"
    @close="onClose"
  >
    <div class="dns-challenge">
      <p class="dns-challenge__instructions">
        {{ t('dns_challenge.instructions', { name: recordName, value: recordValue }) }}
      </p>

      <div class="dns-challenge__field">
        <label :for="nameInputId" class="dns-challenge__label">
          {{ t('dns_challenge.record_name_label') }}
        </label>
        <div class="dns-challenge__row">
          <input
            :id="nameInputId"
            type="text"
            class="dns-challenge__input"
            readonly
            :value="recordName"
          />
          <button
            type="button"
            class="btn-ghost dns-challenge__copy-btn"
            :aria-label="t('dns_challenge.copy_record_name')"
            @click="copy('name')"
          >
            <Copy :size="16" :stroke-width="2" aria-hidden="true" />
            {{ copied === 'name' ? t('dns_challenge.copied') : t('dns_challenge.copy_record') }}
          </button>
        </div>
      </div>

      <div class="dns-challenge__field">
        <label :for="valueInputId" class="dns-challenge__label">
          {{ t('dns_challenge.record_value_label') }}
        </label>
        <div class="dns-challenge__row">
          <input
            :id="valueInputId"
            type="text"
            class="dns-challenge__input"
            readonly
            :value="recordValue"
          />
          <button
            type="button"
            class="btn-ghost dns-challenge__copy-btn"
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
        class="alert alert--error dns-challenge__error"
        role="alert"
        aria-live="polite"
      >
        {{ errorMessage }}
      </div>

      <div class="dns-challenge__actions">
        <button
          type="button"
          class="btn-ghost"
          :disabled="isVerifying"
          @click="onClose"
        >
          {{ t('dns_challenge.close_button') }}
        </button>
        <PillButton
          variant="primary"
          :disabled="isVerifying"
          @click="onVerify"
        >
          {{ isVerifying ? t('dns_challenge.verifying') : t('dns_challenge.verify_button') }}
        </PillButton>
      </div>
    </div>
  </ModalLayout>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import { Copy } from 'lucide-vue-next';

import ModalLayout from '@/client/components/common/modal.vue';
import PillButton from '@/client/components/common/pill-button.vue';
import ImportSourceService from '@/client/service/import_source';
import type { ImportSource } from '@/common/model/import_source';
import { ImportSourceDnsVerificationError } from '@/common/exceptions/import';

/**
 * Modal that walks a calendar editor through the DNS TXT verification step
 * for an ICS import source. Displays the challenge record name and value,
 * exposes copy-to-clipboard on each, and calls
 * `ImportSourceService.verifySource` on confirm.
 *
 * Focus management uses the shared <dialog>-based {@link ModalLayout},
 * which handles focus trap, Escape dismissal, and backdrop clicks. Focus
 * returns to the triggering button via the parent component's
 * `trigger-returned-focus` pattern — this modal only emits `close` and
 * `verified` and leaves DOM focus management to the browser/dialog.
 *
 * @see bead pv-1qcp.3.4
 */

const props = defineProps<{
  source: ImportSource;
  /**
   * The instance host component of the challenge value. Paired with the
   * token below to form `pavillion-verify=v1:{instanceHost}:{token}`.
   *
   * Passed from the parent because the domain is a server-side config
   * value (not on the ImportSource model) that must be known by the UI
   * to render the TXT record string exactly as the DNS verifier will
   * read it.
   */
  instanceHost: string;
  /**
   * The per-source HMAC verification token. Rendered only in the
   * challenge value and never persisted client-side. May be empty while
   * the parent is still loading the challenge metadata — the modal
   * still renders, but the value field will be visibly incomplete.
   */
  challengeToken: string;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
  (event: 'verified', source: ImportSource): void;
}>();

const { t } = useTranslation('calendars', { keyPrefix: 'import' });

const service = new ImportSourceService();

const isVerifying = ref(false);
const errorMessage = ref<string | null>(null);
const copied = ref<'name' | 'value' | null>(null);
let copyTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Element that triggered the modal (typically the Verify button in the row).
 * Captured on mount so focus can be returned when the modal closes, per
 * WCAG 2.4.3 Focus Order. The parent renders the modal conditionally with
 * v-if, so onMounted fires each time the modal is opened.
 */
let triggerElement: HTMLElement | null = null;

// Unique field ids so multiple instances (if opened concurrently in
// different sections) do not collide.
const uid = Math.random().toString(36).slice(2, 10);
const nameInputId = `dns-challenge-name-${uid}`;
const valueInputId = `dns-challenge-value-${uid}`;

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
    // server-side before the source is created, but the modal must
    // still render something rather than throwing.
    return '_pavillion-challenge.';
  }
});

/**
 * Full TXT record value the owner must publish. Exactly matches the
 * format produced by `formatVerificationRecord()` on the server.
 */
const recordValue = computed<string>(() => {
  return `pavillion-verify=v1:${props.instanceHost}:${props.challengeToken}`;
});

/**
 * Copy the record name or value to the clipboard. Uses the async
 * navigator.clipboard API; when unavailable (older environments / tests
 * without a clipboard mock) the operation is a no-op but still updates
 * the `copied` indicator so users get feedback that the action ran.
 */
const copy = async (field: 'name' | 'value'): Promise<void> => {
  const text = field === 'name' ? recordName.value : recordValue.value;

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
    }
  }
  catch {
    // Clipboard access may be denied by the browser; treat as soft
    // failure — the input field is selectable for manual copy.
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
    emit('close');
  }
  catch (err) {
    errorMessage.value = t(errorKeyFor(err));
  }
  finally {
    isVerifying.value = false;
  }
};

const onClose = (): void => {
  if (isVerifying.value) {
    return;
  }
  emit('close');
};

onMounted(() => {
  // Capture the element that opened the modal so focus can be restored when
  // it closes. Guarded for environments without `document` (SSR/tests).
  if (typeof document !== 'undefined') {
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      triggerElement = active;
    }
  }
});

onBeforeUnmount(() => {
  // Restore focus to the trigger on the next tick so the element is still
  // visible in the DOM when focus is applied. Using nextTick ensures the
  // modal's teardown has released focus before we reassign it.
  const toFocus = triggerElement;
  triggerElement = null;
  if (toFocus && typeof document !== 'undefined') {
    // Only restore focus if the element is still connected to the DOM
    // (otherwise .focus() is a no-op anyway).
    nextTick(() => {
      if (toFocus.isConnected) {
        toFocus.focus();
      }
    });
  }
  if (copyTimeout) {
    clearTimeout(copyTimeout);
    copyTimeout = null;
  }
});
</script>

<style scoped lang="scss">
@use '../../../../assets/style/components/calendar-admin' as *;

// Visually hide content while keeping it accessible to screen readers.
// Used for the "Copied" live region; pattern mirrors the shared sr-only
// pattern in admin/root.vue (WCAG SC 4.1.3 Status Messages).
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

.dns-challenge {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4);

  &__instructions {
    margin: 0;
    color: var(--pav-text-primary);
    line-height: 1.5;
  }

  &__field {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-2);
  }

  &__label {
    font-weight: 500;
    font-size: 0.875rem;
    color: var(--pav-color-stone-700);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-300);
    }
  }

  &__row {
    display: flex;
    align-items: center;
    gap: var(--pav-space-2);
    flex-wrap: wrap;
  }

  &__input {
    flex: 1;
    min-width: 0;
    padding: 0.5rem 0.75rem;
    border: 0;
    border-radius: 0.5rem;
    background: var(--pav-color-stone-100);
    color: var(--pav-color-stone-900);
    font-family: var(--pav-font-family-mono, monospace);
    font-size: 0.875rem;

    @media (prefers-color-scheme: dark) {
      background: var(--pav-color-stone-800);
      color: var(--pav-color-stone-100);
    }
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
    display: flex;
    gap: var(--pav-space-3);
    justify-content: flex-end;
    margin-top: var(--pav-space-2);
    padding-top: var(--pav-space-3);
    border-top: 1px solid var(--pav-border-primary);
  }
}

.btn-ghost {
  @include admin-ghost-button;
}
</style>
