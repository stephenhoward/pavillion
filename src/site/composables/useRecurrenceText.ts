import { computed, type ComputedRef, type Ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import i18next from 'i18next';

/**
 * Structured recurrence intent as emitted by the public API:
 *   `{ key: string, params: Record<string, unknown> }`
 *
 * The key resolves against the `recurrence.*` namespace in `system.json`,
 * and `params` may contain:
 *   - `days`: array of ISO day codes (MO, TU, ...) -> localized & joined via Intl.ListFormat
 *   - `day`: single ISO day code                   -> localized via recurrence.days.{code}
 *   - `ordinal`: integer ordinal (1..4, -1)        -> localized via recurrence.ordinals.{n}
 *   - `n`: interval integer (passed through as-is)
 */
export interface RecurrenceSummary {
  key: string;
  params: Record<string, unknown>;
}

/**
 * Composable that turns a server-provided `recurrenceSummary` into a
 * localized, human-readable string using the active i18next locale.
 *
 * Day codes are resolved via `recurrence.days.{code}` translation keys;
 * ordinals via `recurrence.ordinals.{n}`; multi-day lists are joined
 * using `Intl.ListFormat` in the current locale so punctuation and
 * conjunctions match local conventions (e.g. English "Monday and Friday"
 * vs Spanish "Monday y Friday").
 *
 * Returns an empty string when the summary is null / undefined so the
 * template can conditionally render with `v-if="recurrenceText"`.
 *
 * @param summary - A ref or getter returning the server's recurrenceSummary
 * @returns A computed ref holding the localized recurrence phrase
 */
export function useRecurrenceText(
  summary: Ref<RecurrenceSummary | null | undefined> | (() => RecurrenceSummary | null | undefined),
): ComputedRef<string> {
  const { t } = useTranslation('system');

  return computed(() => {
    const value = typeof summary === 'function' ? summary() : summary.value;
    if (!value) {
      return '';
    }

    const params: Record<string, unknown> = { ...value.params };

    // Resolve array of ISO day codes -> locale-aware joined day names.
    if (Array.isArray(params.days)) {
      const dayNames = (params.days as string[]).map(code => t(`recurrence.days.${code}`));
      const listFormatter = new Intl.ListFormat(i18next.language, {
        style: 'long',
        type: 'conjunction',
      });
      params.days = listFormatter.format(dayNames);
    }

    // Resolve a single ISO day code -> localized day name.
    if (typeof params.day === 'string') {
      params.day = t(`recurrence.days.${params.day}`);
    }

    // Resolve integer ordinal -> localized ordinal word.
    if (typeof params.ordinal === 'number') {
      params.ordinal = t(`recurrence.ordinals.${params.ordinal}`);
    }

    return t(value.key, params);
  });
}
