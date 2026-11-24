<script setup lang="ts">
/**
 * Calendar export leaf: the owner downloads every event the calendar
 * publishes as one .ics file, in one of its languages.
 *
 * - The language list comes from the server's export endpoint, never from the
 *   calendar model; the picker shows it in the server's order, pre-filled with
 *   the interface language when listed, otherwise the first entry, and is not
 *   rendered for a one-language list. `lang` is sent on every download.
 * - The download is fetched with the bearer token and saved as a blob: a plain
 *   link would carry no token. The filename follows the server's rule,
 *   `<url-name>-<lang>.ics`. A count of 0 saves nothing and says so.
 * - The outcome and any error go to two live regions under the button that are
 *   always mounted, so screen readers announce text swapped into them. The
 *   button is never disabled: a running download is guarded in script.
 * - The settings layout supplies the page heading, so this leaf has no h1.
 */
import { onMounted, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import CalendarService from '@/client/service/calendar';
import { downloadIcs } from '@/common/utils/ics-generator';
import { languageDisplayName } from '@/common/i18n/language-names';
import LoadingMessage from '@/client/components/common/loading_message.vue';
import PillButton from '@/client/components/common/pill-button.vue';

const props = defineProps<{
  calendarId: string;
  calendarUrlName: string;
}>();

const { t, i18next } = useTranslation('calendars', { keyPrefix: 'export' });
const calendarService = new CalendarService();

const loading = ref(true);
const languages = ref<string[]>([]);
const selectedLanguage = ref('');
const downloading = ref(false);
const statusText = ref('');
const errorText = ref('');

/** Error keys shared by both calls, by exception name; never the message. */
const ERROR_KEYS: Record<string, string> = {
  CalendarEditorPermissionError: 'error_permission',
  CalendarNotFoundError: 'error_not_found',
};

function errorKey(error: unknown, extra: Record<string, string>, fallback: string): string {
  const name = error instanceof Error ? error.name : '';
  return extra[name] ?? ERROR_KEYS[name] ?? fallback;
}

async function loadLanguages(): Promise<void> {
  try {
    const list = await calendarService.getExportLanguages(props.calendarId);
    languages.value = list;
    // Read the interface language now, not at setup: it may have changed.
    selectedLanguage.value = list.includes(i18next.language) ? i18next.language : list[0];
  }
  catch (error: unknown) {
    errorText.value = t(errorKey(error, {}, 'error_loading'));
  }
  finally {
    loading.value = false;
  }
}

async function download(): Promise<void> {
  if (downloading.value) {
    return;
  }
  downloading.value = true;
  statusText.value = '';
  errorText.value = '';
  const lang = selectedLanguage.value;
  try {
    const { ics, eventCount } = await calendarService.exportCalendar(props.calendarId, lang);
    if (eventCount === 0) {
      statusText.value = t('empty');
      return;
    }
    const filename = `${props.calendarUrlName}-${lang}.ics`;
    downloadIcs(ics, filename);
    statusText.value = t('download_started', { filename });
  }
  catch (error: unknown) {
    errorText.value = t(errorKey(error, {
      ValidationError: 'error_language',
      CalendarExportError: 'error_export_failed',
    }, 'error_generic'));
  }
  finally {
    downloading.value = false;
  }
}

onMounted(loadLanguages);
</script>

<template>
  <div class="calendar-export">
    <div class="calendar-export__card">
      <p class="calendar-export__description">{{ t('description') }}</p>

      <LoadingMessage v-if="loading" :description="t('loading')" />

      <div v-else-if="languages.length > 0" class="calendar-export__controls">
        <div v-if="languages.length > 1" class="calendar-export__field">
          <label for="calendar-export-language" class="calendar-export__label">
            {{ t('language_label') }}
          </label>
          <select
            id="calendar-export-language"
            v-model="selectedLanguage"
            class="calendar-export__select"
          >
            <option
              v-for="code in languages"
              :key="code"
              :value="code"
            >{{ languageDisplayName(code, i18next.language) }}</option>
          </select>
        </div>

        <PillButton variant="primary" @click="download">
          {{ downloading ? t('downloading') : t('download_button') }}
        </PillButton>
      </div>

      <div class="calendar-export__feedback">
        <p
          class="calendar-export__status"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >{{ statusText }}</p>
        <p
          class="calendar-export__error"
          :class="{ 'alert alert--error': errorText }"
          role="alert"
          aria-atomic="true"
        >{{ errorText }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '../../../assets/style/components/calendar-admin' as *;
@use '@/client/assets/style/tokens/breakpoint-mixins' as *;

.calendar-export {
  max-width: 36rem;
  padding-block: var(--pav-space-6);

  @include pav-media-down(md) {
    padding-block: var(--pav-space-4);
  }
}

.calendar-export__card {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4);
  background: var(--pav-surface-primary);
  border-radius: 0.75rem;
  padding: var(--pav-space-6);

  @include pav-media-down(md) {
    padding: var(--pav-space-4);
  }
}

.calendar-export__description {
  margin: 0;
  color: var(--pav-text-secondary);
  line-height: 1.5;
}

.calendar-export__controls {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--pav-space-4);
}

.calendar-export__field {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-2);
  inline-size: 100%;
}

.calendar-export__label {
  font-size: 1rem;
  font-weight: 500;
  color: var(--pav-text-primary);
}

.calendar-export__select {
  @include admin-form-input;

  max-inline-size: 20rem;
  cursor: pointer;
}

// The regions stay in the accessibility tree while empty (never display:
// none), so text swapped into them is announced. Empty, they take no space.
.calendar-export__status,
.calendar-export__error {
  margin: 0;
}

.calendar-export__status:not(:empty) + .calendar-export__error.alert {
  margin-block-start: var(--pav-space-2);
}
</style>
