<template>
  <section
    class="rel-me-challenge"
    data-test="rel-me-challenge-step"
    :aria-labelledby="headingId"
  >
    <header class="rel-me-challenge__header">
      <h3 :id="headingId" class="rel-me-challenge__heading">
        {{ t('verify_wizard.method_relme_title') }}
      </h3>
      <p class="rel-me-challenge__instructions">
        {{ t('rel_me_challenge.instructions') }}
      </p>
    </header>

    <!--
      HTML snippet for the user to copy. CRITICAL SECURITY CONSTRAINT: this
      block MUST NOT use v-html. The snippet is built as a plain string and
      interpolated via {{ }} text binding so the angle brackets render as
      escaped text rather than as a real <a> element. v-html here would
      mean the page rendered an actual <a rel="me"> linking to our
      verification URL, which would (1) make the snippet impossible to
      "copy as code" and (2) defeat the read-only display intent.
    -->
    <div class="rel-me-challenge__field">
      <p :id="snippetLabelId" class="rel-me-challenge__label">
        {{ t('rel_me_challenge.html_snippet_label') }}
      </p>
      <p class="rel-me-challenge__help">
        {{ t('rel_me_challenge.html_snippet_help') }}
      </p>
      <pre
        :id="snippetCodeId"
        :aria-labelledby="snippetLabelId"
        class="rel-me-challenge__code-block"
        data-test="rel-me-html-snippet"
      ><code>{{ htmlSnippet }}</code></pre>
      <button
        type="button"
        class="btn-ghost rel-me-challenge__copy-btn rel-me-challenge__copy-btn--block"
        data-test="rel-me-copy-html"
        :aria-label="t('rel_me_challenge.copy_html_aria')"
        @click="copySnippet"
      >
        <Copy :size="16" :stroke-width="2" aria-hidden="true" />
        {{ copied ? t('rel_me_challenge.copied') : t('rel_me_challenge.copy_html') }}
      </button>
    </div>

    <!-- Page URL input where the owner enters the URL of their verification page -->
    <div class="rel-me-challenge__field">
      <label :for="pageUrlInputId" class="rel-me-challenge__label">
        {{ t('rel_me_challenge.page_url_label') }}
      </label>
      <p class="rel-me-challenge__help">
        {{ t('rel_me_challenge.page_url_help') }}
      </p>
      <input
        :id="pageUrlInputId"
        v-model="pageUrl"
        type="text"
        inputmode="url"
        autocapitalize="off"
        autocomplete="url"
        spellcheck="false"
        required
        class="rel-me-challenge__input"
        data-test="rel-me-page-url-input"
        :placeholder="t('rel_me_challenge.page_url_placeholder')"
        :maxlength="RELME_PAGE_URL_MAX_LENGTH"
        :aria-invalid="errorMessage !== null"
        :aria-describedby="errorMessage ? errorRegionId : undefined"
        @input="onInput"
      />
    </div>

    <!--
      Live region announcing copy and error feedback. Uses role="alert" with
      aria-live="polite" so the screen reader does not interrupt the user but
      still announces the status change. WCAG SC 4.1.3 Status Messages.
    -->
    <div
      v-if="errorMessage"
      :id="errorRegionId"
      class="alert alert--error rel-me-challenge__error"
      data-test="rel-me-error"
      role="alert"
      aria-live="polite"
    >
      {{ errorMessage }}
    </div>

    <span
      class="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ copied ? t('rel_me_challenge.copied') : '' }}
    </span>

    <div class="rel-me-challenge__actions">
      <button
        type="button"
        class="btn-ghost"
        data-test="rel-me-change-method"
        :disabled="isVerifying"
        @click="onChangeMethod"
      >
        {{ t('verify_wizard.change_method_button') }}
      </button>
      <PillButton
        variant="primary"
        :disabled="isVerifying"
        data-test="rel-me-verify-button"
        @click="onVerify"
      >
        {{ isVerifying ? t('rel_me_challenge.verifying') : t('rel_me_challenge.verify_button') }}
      </PillButton>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import { Copy } from 'lucide-vue-next';

import PillButton from '@/client/components/common/pill-button.vue';
import ImportSourceService from '@/client/service/import_source';
import { importSourceErrorKey } from '@/client/service/import_source_errors';
import {
  RELME_PAGE_URL_MAX_LENGTH,
  validateRelMePageUrl,
} from '@/client/service/rel_me_url_validation';
import type { ImportSource } from '@/common/model/import_source';

/**
 * Step component inside the verify-ownership wizard that walks a calendar
 * editor through the `rel="me"` ownership-verification flow for an ICS
 * import source. Displays a copyable HTML snippet (the complete `<a
 * rel="me">` tag for the user to drop onto their verification page),
 * accepts the URL of the page hosting that link, and on Verify calls
 * `issueChallenge('rel-me')` followed by `verifySource(pageUrl)` in that
 * order. The page URL input accepts schemeless input — the validator
 * auto-prepends `https://` rather than rejecting input without a scheme,
 * so users are not punished for typing a hostname rather than pasting a
 * full URL.
 *
 * Issuing the challenge before verifying ensures the server has materialized
 * the challenge token under the rel-me discriminator before the verifier
 * runs. This is a stricter contract than the dns-txt step (which only
 * issues on demand from the parent section); rel-me requires the
 * verification-type discriminator to be set on the source row before the
 * verifier compares the page's rel="me" target to the per-source token URL.
 *
 * CRITICAL SECURITY CONSTRAINT: the HTML snippet is built as a plain
 * string and rendered via Vue's {{ }} text-interpolation binding inside a
 * <pre><code> block. v-html is NEVER used here — letting the snippet
 * parse as actual HTML would (1) make it useless as a copy-paste artifact
 * and (2) render a live <a rel="me"> link inside the admin UI, which is
 * outside the intended affordance. See `security-playbook` (template
 * injection) for the project-wide rule.
 *
 * Error messages reference "the verification page" / field-level state and
 * NEVER echo the user-supplied URL — see `privacy-playbook` (error
 * responses).
 *
 * @see bead pv-jutm.7
 */

const props = defineProps<{
  source: ImportSource;
  /**
   * The instance host component used to construct the expected verification
   * URL. The verification URL the user must link to is
   * `https://{instanceHost}/.well-known/pavillion-verify/{challengeToken}`,
   * matching the format the server's rel-me verifier compares against.
   */
  instanceHost: string;
  /**
   * The per-source HMAC challenge token. Rendered only inside the link
   * target / snippet display. May be empty while the parent is still
   * loading the challenge metadata — the input fields will visibly hold a
   * partial URL until the token arrives.
   */
  challengeToken: string;
}>();

const emit = defineEmits<{
  (event: 'verified', source: ImportSource): void;
  (event: 'change-method'): void;
}>();

const { t } = useTranslation('calendars', { keyPrefix: 'import' });

const service = new ImportSourceService();

const pageUrl = ref<string>('');
const isVerifying = ref<boolean>(false);
const errorMessage = ref<string | null>(null);
const copied = ref<boolean>(false);
let copyTimeout: ReturnType<typeof setTimeout> | null = null;

const uid = Math.random().toString(36).slice(2, 10);
const headingId = `rel-me-challenge-heading-${uid}`;
const snippetCodeId = `rel-me-snippet-${uid}`;
const snippetLabelId = `rel-me-snippet-label-${uid}`;
const pageUrlInputId = `rel-me-page-url-${uid}`;
const errorRegionId = `rel-me-error-${uid}`;

/**
 * Derive the source hostname from the source URL. Used both to render the
 * snippet's display text and to validate that the user-supplied
 * verification page URL is on the same hostname as the calendar feed.
 *
 * Defensive fallback to empty string if the URL fails to parse so the
 * component still renders rather than throwing — the source URL was
 * server-validated before insertion, so this should not occur in practice.
 */
const sourceHostname = computed<string>(() => {
  try {
    return new URL(props.source.url).hostname.toLowerCase();
  }
  catch {
    return '';
  }
});

/**
 * Expected verification URL the user must link to with rel="me". Mirrors
 * the server-side derivation in `verifyRelMeSource()` so the admin and
 * verifier always agree on which URL the rel="me" backlink must target.
 */
const expectedLinkTarget = computed<string>(() => {
  return `https://${props.instanceHost}/.well-known/pavillion-verify/${props.challengeToken}`;
});

/**
 * Pre-built HTML snippet shown to the user in the read-only <pre><code>
 * block. CRITICAL: this is a plain string for text interpolation only —
 * never feed it to v-html. The display text inside the anchor is the
 * source hostname (a value the user already controls), not the user-
 * supplied verification page URL.
 */
const htmlSnippet = computed<string>(() => {
  return `<a href="${expectedLinkTarget.value}" rel="me">${sourceHostname.value}</a>`;
});

/**
 * Clear the error message when the user starts editing again so the
 * stale error does not linger past the user's correction attempt.
 */
const onInput = (): void => {
  if (errorMessage.value !== null) {
    errorMessage.value = null;
  }
};

/**
 * Copy the HTML snippet to the clipboard. Uses the async
 * navigator.clipboard API; when unavailable the operation is a no-op but
 * still updates the `copied` indicator so the user gets feedback that
 * the action ran (the snippet block remains text-selectable for manual
 * copy).
 */
const copySnippet = async (): Promise<void> => {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(htmlSnippet.value);
    }
  }
  catch {
    // Clipboard access may be denied by the browser; treat as soft failure.
  }

  copied.value = true;
  if (copyTimeout) {
    clearTimeout(copyTimeout);
  }
  copyTimeout = setTimeout(() => {
    copied.value = false;
    copyTimeout = null;
  }, 1500);
};

/**
 * Verify the source. Issues the challenge (which sets the
 * verification-type discriminator on the row) BEFORE running the
 * verifier so the server's verifier always sees a consistent
 * discriminator + page URL pair.
 */
const onVerify = async (): Promise<void> => {
  if (isVerifying.value) {
    return;
  }

  // Client-side validation gate. Mirrors the server's validation rules so
  // the user sees field-level feedback locally before round-tripping.
  // The validator also normalizes the URL (auto-prepending `https://`
  // when the scheme is missing), so we forward the normalized form to
  // the verifier rather than the raw input.
  const validation = validateRelMePageUrl(pageUrl.value, sourceHostname.value);
  if (!validation.ok) {
    errorMessage.value = t(validation.key);
    return;
  }

  isVerifying.value = true;
  errorMessage.value = null;
  try {
    // Sequence is contractual: issueChallenge sets the verification-type
    // discriminator on the source row to 'rel-me' before verifySource runs.
    await service.issueChallenge(
      props.source.calendarId,
      props.source.id,
      'rel-me',
    );
    const updated = await service.verifySource(
      props.source.calendarId,
      props.source.id,
      validation.url,
    );
    emit('verified', updated);
  }
  catch (err) {
    errorMessage.value = t(importSourceErrorKey(err, 'verify-rel-me'));
  }
  finally {
    isVerifying.value = false;
  }
};

/**
 * Emit the change-method intent so the wizard shell can return to the
 * picker. The shell owns the step state, so the step itself does not
 * unmount on this event — the wizard's v-if branch swap handles teardown.
 */
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
@use '../../../../assets/style/mixins/challenge-step' as *;
@use '../../../../assets/style/mixins/visibility' as *;

// Visually hide content while keeping it accessible to screen readers.
// Pattern mirrors the shared sr-only pattern used elsewhere in the
// admin UI (WCAG SC 4.1.3 Status Messages).
.sr-only {
  @include sr-only;
}

.rel-me-challenge {
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

  &__help {
    margin: 0;
    color: var(--pav-text-secondary);
    font-size: var(--pav-font-size-small);
    line-height: var(--pav-line-height-normal);
  }

  &__code-block {
    @include challenge-step-code-block;
  }

  &__input {
    inline-size: 100%;
    padding-block: var(--pav-space-2);
    padding-inline: var(--pav-space-3);
    background: var(--pav-surface-card);
    color: var(--pav-text-primary);
    border: var(--pav-border-width-1) solid var(--pav-border-subtle);
    border-radius: var(--pav-border-radius-md);
    font-family: var(--pav-font-family-mono);
    font-size: var(--pav-font-size-small);

    &:focus-visible {
      outline: var(--pav-border-width-2) solid var(--pav-text-primary);
      outline-offset: var(--pav-space-1);
    }

    &[aria-invalid='true'] {
      border-color: var(--pav-color-error);
    }
  }

  &__copy-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--pav-space-1);
    flex-shrink: 0;

    &--block {
      align-self: start;
    }
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

.alert {
  @include admin-alert;
}
</style>
