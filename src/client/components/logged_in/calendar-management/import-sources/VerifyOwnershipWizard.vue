<template>
  <ModalLayout
    :title="t('title')"
    size="lg"
    modal-class="verify-ownership-wizard"
    @close="onClose"
  >
    <!-- ===== PICKER STEP ===== -->
    <section
      v-if="currentStep === 'pick'"
      class="verify-wizard verify-wizard--picker"
      data-test="verify-wizard-picker"
      :aria-labelledby="pickerHeadingId"
    >
      <header class="verify-wizard__header">
        <h3 :id="pickerHeadingId" class="verify-wizard__heading">
          {{ t('picker_heading') }}
        </h3>
        <p class="verify-wizard__description">
          {{ t('picker_description') }}
        </p>
      </header>

      <div class="verify-wizard__methods">
        <!--
          Card-as-button pattern: each method is a real <button> so it is
          natively keyboard-focusable and announced as "button" by AT.
          The icon + heading + description live inside the button as
          presentational content.
        -->
        <button
          type="button"
          class="verify-wizard__method"
          data-test="verify-wizard-pick-dns"
          @click="selectMethod('dns-txt')"
        >
          <span class="verify-wizard__method-icon" aria-hidden="true">
            <Globe :size="24" :stroke-width="2" />
          </span>
          <span class="verify-wizard__method-body">
            <span class="verify-wizard__method-title">
              {{ t('method_dns_title') }}
            </span>
            <span class="verify-wizard__method-description">
              {{ t('method_dns_description') }}
            </span>
          </span>
        </button>

        <button
          type="button"
          class="verify-wizard__method"
          data-test="verify-wizard-pick-relme"
          @click="selectMethod('rel-me')"
        >
          <span class="verify-wizard__method-icon" aria-hidden="true">
            <Link2 :size="24" :stroke-width="2" />
          </span>
          <span class="verify-wizard__method-body">
            <span class="verify-wizard__method-title">
              {{ t('method_relme_title') }}
            </span>
            <span class="verify-wizard__method-description">
              {{ t('method_relme_description') }}
            </span>
          </span>
        </button>
      </div>

      <div class="verify-wizard__actions">
        <button
          type="button"
          class="btn-ghost"
          data-test="verify-wizard-cancel"
          @click="onClose"
        >
          {{ t('cancel_button') }}
        </button>
      </div>
    </section>

    <!-- ===== DNS TXT STEP ===== -->
    <DnsChallengeStep
      v-else-if="currentStep === 'dns-txt'"
      :source="props.source"
      :instance-host="props.instanceHost"
      :challenge-token="challengeToken"
      @change-method="returnToPicker"
      @verified="onVerified"
    />

    <!-- ===== REL=ME STEP ===== -->
    <RelMeChallengeStep
      v-else-if="currentStep === 'rel-me'"
      :source="props.source"
      :instance-host="props.instanceHost"
      :challenge-token="challengeToken"
      @change-method="returnToPicker"
      @verified="onVerified"
    />
  </ModalLayout>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { Globe, Link2 } from 'lucide-vue-next';

import ModalLayout from '@/client/components/common/modal.vue';
import ImportSourceService from '@/client/service/import_source';
import type {
  ImportSource,
  ImportSourceVerificationType,
} from '@/common/model/import_source';

import DnsChallengeStep from './DnsChallengeStep.vue';
import RelMeChallengeStep from './RelMeChallengeStep.vue';

/**
 * Multi-step wizard that hosts the import-source ownership-verification
 * flow. Inlines the method-picker step (DNS TXT vs. rel="me") rather than
 * extracting it to its own component, per the complexity-advisor finding
 * during epic shaping (pv-jutm): the picker is two cards and a heading,
 * splitting it would add a one-prop, one-event component without saving
 * meaningful complexity.
 *
 * The actual challenge bodies are rendered by the dedicated step components
 * (`DnsChallengeStep`, `RelMeChallengeStep`) which own the verification
 * request lifecycle and copy-to-clipboard interactions. Each step emits
 * `change-method` to bounce back to the picker and `verified` when
 * verification succeeds; the wizard relays `verified` to its own consumer
 * (the import-sources section) and owns wizard-level dismissal via `close`.
 *
 * Step state uses a string discriminant ('pick' | 'dns-txt' | 'rel-me')
 * rather than a numeric `currentStep` because the topology branches: from
 * the picker, the user lands on either the DNS step OR the rel-me step,
 * never one-after-the-other. A numeric counter could not encode that.
 *
 * Entry rule: when `source.verificationType` is one of the known method
 * discriminants, the wizard skips the picker and opens directly on that
 * step. When it is null/undefined/unrecognised the wizard opens on the
 * picker so the owner can choose. The picker can always be returned to via
 * the "Change verification method" button on each step.
 *
 * @see bead pv-jutm.5, pv-jutm.8
 */

const props = defineProps<{
  source: ImportSource;
  /**
   * The instance host component of the DNS challenge value. Forwarded to
   * each step component so the rendered challenge string matches what the
   * server-side verifier will read.
   */
  instanceHost: string;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
  (event: 'verified', source: ImportSource): void;
}>();

const { t } = useTranslation('calendars', { keyPrefix: 'import.verify_wizard' });

type WizardStep = 'pick' | 'dns-txt' | 'rel-me';

/**
 * Set of known verification-method discriminants. Used by the entry-rule
 * computation to decide whether `source.verificationType` represents a
 * concrete method (skip picker) or an unset/unknown value (show picker).
 *
 * Cast through `unknown` because callers may pass `null` to express the
 * "no method chosen yet" state even though the model's TypeScript shape
 * declares `verificationType` as non-nullable.
 */
const KNOWN_METHODS = new Set<string>(['dns-txt', 'rel-me']);

const isKnownMethod = (value: unknown): value is ImportSourceVerificationType => {
  return typeof value === 'string' && KNOWN_METHODS.has(value);
};

/**
 * Determine the initial wizard step from the source's verification type.
 * Encapsulates the entry rule so the change-method affordance can also
 * decide where to land if the parent re-mounts the wizard.
 */
const initialStep = (): WizardStep => {
  return isKnownMethod(props.source.verificationType)
    ? props.source.verificationType
    : 'pick';
};

const currentStep = ref<WizardStep>(initialStep());

const uid = Math.random().toString(36).slice(2, 10);
const pickerHeadingId = `verify-wizard-picker-heading-${uid}`;

const service = new ImportSourceService();

/**
 * Per-source HMAC verification token issued by the server. Empty until the
 * wizard has issued the challenge for the active step. The wizard owns
 * issuance lifecycle so the parent does not have to pre-fetch — this is
 * the change called for in pv-jutm.8 (move issuance from
 * ImportSourcesSection into the wizard).
 *
 * Issuance is per-step rather than per-mount because the server records the
 * verification-method discriminator at issue time. Re-issuing on each
 * non-picker step entry keeps that discriminator aligned with whatever
 * method the user is currently looking at, even if they bounce back and
 * forth via change-method.
 */
const challengeToken = ref<string>('');

const ensureChallengeFor = async (method: 'dns-txt' | 'rel-me'): Promise<void> => {
  try {
    const token = await service.issueChallenge(
      props.source.calendarId,
      props.source.id,
      method,
    );
    // Guard against a step change mid-flight: only adopt the token if the
    // user is still on a non-picker step. The displayed challenge value
    // is permitted to be stale-but-consistent rather than swapped to a
    // token for a method the user just navigated away from.
    if (currentStep.value === method) {
      challengeToken.value = token;
    }
  }
  catch {
    // Issuance failures are deliberately swallowed here: the step still
    // renders a recognisable (but visibly incomplete) challenge value, and
    // the verify request itself surfaces a typed error to the user. Adding
    // a wizard-level error surface would duplicate the per-step alert.
  }
};

const selectMethod = (method: ImportSourceVerificationType): void => {
  currentStep.value = method;
};

/**
 * Return to the picker step. Clears nothing here directly because the
 * step components are unmounted by v-if when the step changes — any
 * in-flight state they hold (typed-in verification-page URL, in-progress
 * verify request) is owned by the step component and discarded with it.
 */
const returnToPicker = (): void => {
  currentStep.value = 'pick';
};

/**
 * Relay `verified` from the active step to the wizard's consumer. The
 * wizard owns dismissal — the parent typically responds to `verified` by
 * unmounting the wizard, which triggers the focus-return logic on the
 * triggering button.
 */
const onVerified = (updated: ImportSource): void => {
  emit('verified', updated);
};

const onClose = (): void => {
  emit('close');
};

/**
 * Issue the challenge whenever the wizard transitions onto a non-picker
 * step. Fires on mount when the entry rule lands directly on a step, and
 * on subsequent picker → step transitions. Returning to the picker
 * intentionally does not re-fetch — the picker has nothing to render with
 * a token.
 */
watch(currentStep, (step) => {
  if (step === 'dns-txt' || step === 'rel-me') {
    void ensureChallengeFor(step);
  }
});

onMounted(() => {
  if (currentStep.value === 'dns-txt' || currentStep.value === 'rel-me') {
    void ensureChallengeFor(currentStep.value);
  }
});
</script>

<style scoped lang="scss">
@use '../../../../assets/style/components/calendar-admin' as *;
@use '../../../../assets/style/mixins/challenge-step' as *;

.verify-wizard {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4);

  &__header {
    @include challenge-step-header;
  }

  &__heading {
    @include challenge-step-title;
  }

  &__description {
    @include challenge-step-instructions;
  }

  /*
   * Method picker layout. Stacked on narrow viewports so each card stays
   * tap-friendly; switches to a two-column grid at the 480px container
   * threshold called for in the bead. Uses logical block/inline grid
   * properties so RTL locales flip cleanly.
   */
  &__methods {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--pav-space-3);

    @media (min-width: 480px) {
      grid-template-columns: 1fr 1fr;
    }
  }

  &__method {
    display: flex;
    align-items: flex-start;
    gap: var(--pav-space-3);
    padding-block: var(--pav-space-4);
    padding-inline: var(--pav-space-4);
    background: var(--pav-surface-card);
    color: var(--pav-text-primary);
    border: var(--pav-border-width-1) solid var(--pav-border-primary);
    border-radius: var(--pav-border-radius-md);
    text-align: start;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;

    &:hover:not(:disabled),
    &:focus-visible {
      background: var(--pav-interactive-hover);
      border-color: var(--pav-text-primary);
    }
  }

  &__method-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--pav-text-primary);
  }

  &__method-body {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-1);
    min-width: 0;
  }

  &__method-title {
    color: var(--pav-text-primary);
    font-size: var(--pav-font-size-body);
    font-weight: var(--pav-font-weight-semibold);
    line-height: var(--pav-line-height-snug);
  }

  &__method-description {
    color: var(--pav-text-secondary);
    font-size: var(--pav-font-size-small);
    line-height: var(--pav-line-height-normal);
  }

  &__actions {
    @include challenge-step-actions;
  }
}

.btn-ghost {
  @include admin-ghost-button;
}
</style>
