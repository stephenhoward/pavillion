<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import { Copy } from 'lucide-vue-next';

/**
 * CopyButton — reusable button that writes a string to the clipboard,
 * flashes a "Copied" label for `feedbackMs`, and announces the copy to
 * assistive tech via a polite `role="status"` live region.
 *
 * The clipboard write is a soft-fail: when `navigator.clipboard` is
 * unavailable (older browsers, JSDOM tests without a clipboard mock,
 * permission-denied) the button still flashes its "copied" state so the
 * user gets UI feedback that the action ran. The caller's source element
 * remains text-selectable for manual copy.
 *
 * Two visual variants:
 * - `ghost` (default): inline icon+label, transparent background
 * - `primary`: filled orange button, used when copy is the page's primary action
 */

const props = withDefaults(defineProps<{
  /** The string written to the clipboard when the button is activated. */
  text: string;
  /** Visible label. Defaults to the system "Copy" translation. */
  label?: string;
  /** Visible label shown during the post-copy feedback window. Defaults to the system "Copied" translation. */
  copiedLabel?: string;
  /** Accessible label override. Defaults to `label`. */
  ariaLabel?: string;
  /** Duration in milliseconds for the post-copy feedback state. */
  feedbackMs?: number;
  /** Render the Lucide Copy icon before the label. */
  withIcon?: boolean;
  /** Disable the button. */
  disabled?: boolean;
  /** Visual variant. */
  variant?: 'ghost' | 'primary';
}>(), {
  label: undefined,
  copiedLabel: undefined,
  ariaLabel: undefined,
  feedbackMs: 1500,
  withIcon: true,
  disabled: false,
  variant: 'ghost',
});

const emit = defineEmits<{
  (event: 'copied'): void;
  (event: 'error', err: unknown): void;
}>();

const { t } = useTranslation('system', { keyPrefix: 'copy_button' });

const copied = ref<boolean>(false);
let copyTimeout: ReturnType<typeof setTimeout> | null = null;

const resolvedLabel = computed<string>(() => props.label ?? t('copy'));
const resolvedCopiedLabel = computed<string>(() => props.copiedLabel ?? t('copied'));
const resolvedAriaLabel = computed<string>(() => props.ariaLabel ?? resolvedLabel.value);

const onClick = async (): Promise<void> => {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(props.text);
    }
    emit('copied');
  }
  catch (err) {
    emit('error', err);
    // Soft-fail: still flash the "copied" indicator so the user sees the
    // action ran. The source value stays user-selectable for manual copy.
  }

  copied.value = true;
  if (copyTimeout) {
    clearTimeout(copyTimeout);
  }
  copyTimeout = setTimeout(() => {
    copied.value = false;
    copyTimeout = null;
  }, props.feedbackMs);
};

onBeforeUnmount(() => {
  if (copyTimeout) {
    clearTimeout(copyTimeout);
  }
});
</script>

<template>
  <button
    type="button"
    class="copy-button"
    :class="[
      `copy-button--${variant}`,
      { 'copy-button--copied': copied },
    ]"
    :aria-label="resolvedAriaLabel"
    :disabled="disabled"
    :aria-disabled="disabled"
    @click="onClick"
  >
    <Copy
      v-if="withIcon"
      :size="16"
      :stroke-width="2"
      aria-hidden="true"
    />
    <span class="copy-button__label">
      {{ copied ? resolvedCopiedLabel : resolvedLabel }}
    </span>
    <span
      class="copy-button__live-region"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ copied ? resolvedCopiedLabel : '' }}
    </span>
  </button>
</template>

<style scoped lang="scss">
@use '../../assets/style/components/calendar-admin' as *;
@use '../../assets/style/mixins/visibility' as *;

.copy-button {
  flex-shrink: 0;

  &__live-region {
    @include sr-only;
  }

  &--ghost {
    @include admin-ghost-button;
  }

  &--primary {
    display: inline-flex;
    align-items: center;
    gap: var(--pav-space-2);
    padding: var(--pav-space-2) var(--pav-space-4);
    background: var(--pav-color-orange-500);
    color: white;
    border: none;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    min-block-size: 36px;

    @media (prefers-color-scheme: dark) {
      background: var(--pav-color-orange-600);
    }

    &:hover:not(:disabled) {
      background: var(--pav-color-orange-600);

      @media (prefers-color-scheme: dark) {
        background: var(--pav-color-orange-500);
      }
    }

    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  }
}
</style>
