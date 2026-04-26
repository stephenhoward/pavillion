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

    <!-- ===== DNS TXT STEP (placeholder until pv-jutm.6 ships) ===== -->
    <section
      v-else-if="currentStep === 'dns-txt'"
      class="verify-wizard verify-wizard--step"
      data-test="verify-wizard-dns-step"
      :aria-labelledby="dnsHeadingId"
    >
      <!--
        Placeholder body for the DNS challenge step. The real
        DnsChallengeStep component is implemented in pv-jutm.6 and will
        replace this v-if branch wholesale. Rendering a minimal informational
        body here keeps the wizard navigable in the meantime so the picker
        and change-method affordance are exercisable end-to-end.
      -->
      <h3 :id="dnsHeadingId" class="verify-wizard__sr-only">
        {{ t('method_dns_title') }}
      </h3>
      <p class="verify-wizard__placeholder">
        {{ t('method_dns_title') }}
      </p>

      <div class="verify-wizard__actions">
        <button
          type="button"
          class="btn-ghost"
          data-test="verify-wizard-change-method"
          @click="returnToPicker"
        >
          {{ t('change_method_button') }}
        </button>
      </div>
    </section>

    <!-- ===== REL=ME STEP (placeholder until pv-jutm.7 ships) ===== -->
    <section
      v-else-if="currentStep === 'rel-me'"
      class="verify-wizard verify-wizard--step"
      data-test="verify-wizard-relme-step"
      :aria-labelledby="relmeHeadingId"
    >
      <!--
        Placeholder body for the rel="me" challenge step. The real
        RelMeChallengeStep component lands in pv-jutm.7 and will replace
        this v-if branch wholesale.
      -->
      <h3 :id="relmeHeadingId" class="verify-wizard__sr-only">
        {{ t('method_relme_title') }}
      </h3>
      <p class="verify-wizard__placeholder">
        {{ t('method_relme_title') }}
      </p>

      <div class="verify-wizard__actions">
        <button
          type="button"
          class="btn-ghost"
          data-test="verify-wizard-change-method"
          @click="returnToPicker"
        >
          {{ t('change_method_button') }}
        </button>
      </div>
    </section>
  </ModalLayout>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import { Globe, Link2 } from 'lucide-vue-next';

import ModalLayout from '@/client/components/common/modal.vue';
import type {
  ImportSource,
  ImportSourceVerificationType,
} from '@/common/model/import_source';

/**
 * Multi-step wizard that hosts the import-source ownership-verification
 * flow. Inlines the method-picker step (DNS TXT vs. rel="me") rather than
 * extracting it to its own component, per the complexity-advisor finding
 * during epic shaping (pv-jutm): the picker is two cards and a heading,
 * splitting it would add a one-prop, one-event component without saving
 * meaningful complexity.
 *
 * Step components for the actual challenges (`DnsChallengeStep`,
 * `RelMeChallengeStep`) ship in pv-jutm.6 and pv-jutm.7 respectively. Until
 * they arrive, the dns-txt and rel-me v-if branches render minimal
 * placeholder content so the wizard's picker → step → change-method
 * navigation is exercisable end-to-end and the entry rule can be tested.
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
 * @see bead pv-jutm.5
 */

const props = defineProps<{
  source: ImportSource;
  /**
   * The instance host component of the DNS challenge value. Forwarded to
   * the DNS step when it ships; held by the wizard so the parent only has
   * to pass it once at the wizard level.
   */
  instanceHost: string;
  /**
   * The per-source HMAC verification token. Forwarded to the DNS step when
   * it ships. May be empty while the parent is still loading the challenge
   * metadata.
   */
  challengeToken: string;
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
const dnsHeadingId = `verify-wizard-dns-heading-${uid}`;
const relmeHeadingId = `verify-wizard-relme-heading-${uid}`;

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

const onClose = (): void => {
  emit('close');
};
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
   * Visually hidden heading used to give the placeholder step sections
   * accessible names while their real components (with visible headings)
   * are pending in pv-jutm.6 and pv-jutm.7. Standard sr-only pattern;
   * not promoted to a global utility because the rest of the codebase
   * uses ad-hoc sr-only helpers rather than a shared one.
   */
  &__sr-only {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
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

  &__placeholder {
    margin: 0;
    color: var(--pav-text-secondary);
    font-size: var(--pav-font-size-body);
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
