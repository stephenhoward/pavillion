<script setup lang="ts">
/**
 * ImageAltEditor
 *
 * Shared alt-text editor for the image panel of the event editor, the series
 * editor, and calendar settings. Alt text is translated content, so it lives on
 * the parent's `*_content` rows next to name and description; this component
 * writes `model.content(language).imageAlt` on the parent's working model
 * directly, exactly as those editors already bind name and description.
 *
 * The component has no language selector of its own — it follows the language
 * its parent panel is already showing.
 *
 * Decorative is the default and a legitimate choice: most event images repeat
 * information the name, date, and description already carry, and an image that
 * adds nothing is better hidden from screen readers than described badly.
 *
 * "Decorative" is not a separate stored flag — it is the absence of alt text in
 * every language. Switching Describe -> Decorative therefore has to clear the
 * model, which would destroy the author's writing if they toggled by mistake.
 * The cleared values are kept in a local stash so switching back restores them,
 * and a warning names the pending loss while the stash is held. The stash is
 * deliberately local and dies with the component: the alternative — leaving the
 * model untouched and applying "decorative" at save time — would put mode state
 * and a save hook into all three parents.
 */

import { computed, ref, useId, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import iso6391 from 'iso-639-1-dir';
import { TranslatedModel } from '@/common/model/model';
import {
  anyLanguageHasAlt,
  clearImageAlt,
  type ImageAltContent,
} from '@/client/components/common/media/image-alt';

/**
 * Mirrors IMAGE_ALT_MAX_LENGTH in src/server/calendar/service/image_alt.ts,
 * which rejects (never truncates) a longer value. The client cannot import the
 * server constant, so the cap is restated here to stop an author writing past
 * the limit rather than letting them discover it at save time.
 */
const IMAGE_ALT_MAX_LENGTH = 500;

type AltMode = 'decorative' | 'describe';

const { t } = useTranslation('media', { keyPrefix: 'alt_editor' });

const props = withDefaults(defineProps<{
  model: TranslatedModel<ImageAltContent>;
  language: string;
  disabled?: boolean;
}>(), {
  disabled: false,
});

const uid = useId();
const modeName = `${uid}-mode`;
const decorativeId = `${uid}-decorative`;
const decorativeHelpId = `${uid}-decorative-help`;
const describeId = `${uid}-describe`;
const describeHelpId = `${uid}-describe-help`;
const textareaId = `${uid}-description`;
const hintId = `${uid}-description-hint`;

const mode = ref<AltMode>(anyLanguageHasAlt(props.model) ? 'describe' : 'decorative');

/**
 * Alt text cleared from the model by a switch to Decorative, keyed by language.
 * Only non-empty values are held: the stash exists to make the switch
 * reversible and to warn about losing writing, and an empty alt text is
 * neither restorable nor a loss.
 */
const stash = ref<Record<string, string>>({});

const hasStash = computed(() => Object.keys(stash.value).length > 0);

const languageName = computed(() => iso6391.getName(props.language) || props.language);

// A different parent model (a different event, series, or calendar) is a
// different set of alt text: re-seed the mode from it and drop the stash, which
// belongs to the model it was cleared from.
watch(() => props.model, (model) => {
  stash.value = {};
  mode.value = anyLanguageHasAlt(model) ? 'describe' : 'decorative';
});

/**
 * Applies a mode chosen by the author, moving alt text between the model and
 * the stash so that what the parent saves always matches what is shown.
 *
 * Describe -> Decorative stashes every language's alt text and clears it on the
 * model. Decorative -> Describe restores the stashed text to every language the
 * model still has, then empties the stash; a language removed while decorative
 * is not resurrected. The membership test is `getLanguages()` rather than
 * `hasContent()` because while decorative the alt text is blank, so a language
 * whose only content was its alt text would read as empty and lose the very
 * text being restored.
 *
 * @param {AltMode} next - The mode the author selected
 */
function setMode(next: AltMode): void {
  if (next === mode.value) return;

  if (next === 'decorative') {
    const cleared: Record<string, string> = {};
    for (const lang of props.model.getLanguages()) {
      const alt = props.model.content(lang).imageAlt;
      if (alt !== '') {
        cleared[lang] = alt;
      }
    }
    clearImageAlt(props.model);
    stash.value = cleared;
  }
  else {
    const languages = props.model.getLanguages();
    for (const [lang, alt] of Object.entries(stash.value)) {
      if (languages.includes(lang)) {
        props.model.content(lang).imageAlt = alt;
      }
    }
    stash.value = {};
  }

  mode.value = next;
}
</script>

<template>
  <div class="image-alt-editor translatable-form-fields">
    <fieldset class="image-alt-editor__modes" :disabled="disabled">
      <legend class="image-alt-editor__legend field-label">{{ t('legend') }}</legend>

      <!--
        The help text sits outside the <label> and is attached with
        aria-describedby instead: inside the label it would join each radio's
        accessible name and then be announced a second time as page text. The
        visible option label stays in a <label for> so clicking it still
        selects the radio.
      -->
      <div class="image-alt-editor__mode">
        <input :id="decorativeId"
               type="radio"
               class="radio"
               :name="modeName"
               value="decorative"
               :checked="mode === 'decorative'"
               :aria-describedby="decorativeHelpId"
               @change="setMode('decorative')" />
        <span class="image-alt-editor__mode-text">
          <label class="image-alt-editor__mode-label" :for="decorativeId">
            {{ t('decorative_label') }}
          </label>
          <span :id="decorativeHelpId" class="field-help">{{ t('decorative_help') }}</span>
        </span>
      </div>

      <p v-if="hasStash"
         class="image-alt-editor__stash-note alert alert--warning"
         role="alert">
        {{ t('stash_note') }}
      </p>

      <div class="image-alt-editor__mode">
        <input :id="describeId"
               type="radio"
               class="radio"
               :name="modeName"
               value="describe"
               :checked="mode === 'describe'"
               :aria-describedby="describeHelpId"
               @change="setMode('describe')" />
        <span class="image-alt-editor__mode-text">
          <label class="image-alt-editor__mode-label" :for="describeId">
            {{ t('describe_label') }}
          </label>
          <span :id="describeHelpId" class="field-help">{{ t('describe_help') }}</span>
        </span>
      </div>
    </fieldset>

    <div v-if="mode === 'describe'" class="form-field">
      <label class="field-label" :for="textareaId">
        {{ t('description_label', { language: languageName }) }}
      </label>
      <textarea :id="textareaId"
                class="field-textarea"
                :maxlength="IMAGE_ALT_MAX_LENGTH"
                :disabled="disabled"
                :aria-describedby="hintId"
                rows="3"
                v-model="model.content(language).imageAlt" />
      <!-- Associated, not merely adjacent: the hint carries the length cap, and
           a forms-mode screen reader never reaches unassociated sibling text. -->
      <p :id="hintId" class="field-help">{{ t('description_hint') }}</p>
    </div>
  </div>
</template>

<style scoped>
/*
 * The root owns its own leading space so the three image panels that host this
 * editor need no wrapper styling. Field primitives (.field-label, .field-help,
 * .field-textarea, the .form-field stack) come from the shared
 * .translatable-form-fields partial; .radio and .alert--warning are global.
 */
.image-alt-editor {
  margin-block-start: var(--pav-space-lg);
}

.image-alt-editor__modes {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-sm);
  border: 0;
  padding: 0;
  margin: 0;
  min-inline-size: 0;
}

.image-alt-editor__legend {
  padding: 0;
  margin-block-end: var(--pav-space-sm);
}

.image-alt-editor__mode {
  display: flex;
  align-items: flex-start;
  gap: var(--pav-space-sm);
}

.image-alt-editor__mode .radio {
  flex-shrink: 0;
  /* Nudge the control onto the first line of the label text. */
  margin-block-start: var(--pav-space-0_5);
}

.image-alt-editor__mode-text {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-xs);
}

/*
 * The pointer cursor belongs to the clickable label alone, not to the whole
 * row: the help text beside it is described-by, not a click target.
 */
.image-alt-editor__mode-label {
  font-size: var(--pav-font-size-sm);
  color: var(--pav-text-primary);
  cursor: pointer;
}

.image-alt-editor__modes:disabled .image-alt-editor__mode-label {
  cursor: default;
}

.image-alt-editor__stash-note {
  margin: 0;
  font-size: var(--pav-font-size-sm);
}
</style>
