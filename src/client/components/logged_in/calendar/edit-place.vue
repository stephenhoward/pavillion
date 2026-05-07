<style scoped lang="scss">
@use '../../../assets/style/components/calendar-admin' as *;

/* Full-page place editor container - uses 100vh since it renders as a top-level route */
.place-editor-page {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background-color: var(--pav-color-stone-50);

  @media (prefers-color-scheme: dark) {
    background-color: var(--pav-color-stone-900);
  }
}

/* Page header with back button, title, and action buttons */
.page-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.5rem 2rem;
  border-bottom: 1px solid var(--pav-color-stone-200);
  background-color: white;
  position: sticky;
  top: 0;
  z-index: 10;

  @media (prefers-color-scheme: dark) {
    background-color: var(--pav-color-stone-800);
    border-bottom-color: var(--pav-color-stone-700);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-inline-start: auto;
  }

  .back-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border: none;
    border-radius: 0.5rem;
    background-color: transparent;
    color: var(--pav-color-stone-700);
    cursor: pointer;
    transition: all 0.15s ease;
    flex-shrink: 0;

    svg {
      width: 20px;
      height: 20px;
      min-width: 20px;
      display: block;
      flex-shrink: 0;
    }

    &:hover {
      background-color: var(--pav-color-stone-100);
      color: var(--pav-color-stone-900);
    }

    &:focus-visible {
      outline: 2px solid var(--pav-color-orange-500);
      outline-offset: 2px;
    }

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);

      &:hover {
        background-color: var(--pav-color-stone-800);
        color: var(--pav-color-stone-200);
      }
    }
  }

  h1 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 500;
    color: var(--pav-color-stone-900);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-100);
    }
  }

  @media (max-width: 480px) {
    flex-wrap: wrap;
    padding: 1rem;
    gap: 0.5rem;

    h1 {
      flex: 1;
    }

    .header-actions {
      width: 100%;
      margin-inline-start: 0;
      justify-content: flex-end;
    }
  }
}

/* Loading state */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--pav-space-2xl);
  color: var(--pav-text-secondary);

  .loading-spinner {
    font-size: 24px;
    margin-bottom: var(--pav-space-md);
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
}

/* Main form container - single column */
main.editor-main {
  flex: 1;
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
  padding: 0;
  box-sizing: border-box;
}

/* Form styling */
form {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.btn-cancel {
  padding: 0;
  border: none;
  background: none;
  color: var(--pav-text-secondary);
  font-size: var(--pav-font-size-sm);
  cursor: pointer;
  transition: color 0.15s ease;

  &:hover:not(:disabled) {
    color: var(--pav-text-primary);
  }

  &:focus-visible {
    outline: 2px solid var(--pav-color-interactive-active);
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.btn-save {
  padding: var(--pav-space-sm) var(--pav-space-lg);
  border: none;
  background: var(--pav-color-interactive-active);
  color: var(--pav-text-inverse);
  font-size: var(--pav-font-size-sm);
  font-weight: var(--pav-font-weight-medium);
  cursor: pointer;
  border-radius: var(--pav-border-radius-full);
  transition: all 0.15s ease;

  &:hover:not(:disabled) {
    filter: brightness(0.95);
  }

  &:focus-visible {
    outline: 2px solid var(--pav-color-interactive-active);
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

/* Single column container */
.editor-container {
  display: flex;
  flex-direction: column;
  gap: 2rem;
  padding: 2rem;

  @media (max-width: 768px) {
    padding: 1rem;
    gap: 1.5rem;
  }
}

/* Section styling */
.editor-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.section-header {
  margin: 0;
  padding: 0;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--pav-color-stone-500);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.section-card {
  background: white;
  border: 1px solid var(--pav-color-stone-200);
  border-radius: 0.5rem;
  padding: 1.5rem;

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-800);
    border-color: var(--pav-color-stone-700);
  }
}

/*
 * Form-field primitives (.form-field, .field-label, .field-input,
 * .field-textarea, .required-indicator) and the .translatable-form-fields
 * container live in the shared _translatable-form.scss partial loaded via
 * @layer components — see edit-space.vue for the other consumer.
 */

.address-row {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  gap: 0.75rem;

  @media (max-width: 480px) {
    grid-template-columns: 1fr;
  }
}

/* Error styling */
.error {
  position: relative;
  color: var(--pav-color-red-700);
  font-size: 0.9rem;
  padding: 1rem 2.5rem 1rem 1.5rem;
  border-radius: 0.75rem;
  background-color: var(--pav-color-red-50);
  border: 1px solid var(--pav-color-red-200);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-red-300);
    background-color: rgba(239, 68, 68, 0.1);
    border-color: var(--pav-color-red-900);
  }

  ul {
    margin: 0;
    padding-inline-start: var(--pav-space-md);
    list-style-type: disc;
  }

  li {
    margin-bottom: var(--pav-space-xs);

    &:last-child {
      margin-bottom: 0;
    }
  }
}

.error-dismiss {
  position: absolute;
  top: 0.5rem;
  right: 0.75rem;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1.25rem;
  line-height: 1;
  color: var(--pav-color-red-700);
  padding: 0.125rem 0.25rem;
  border-radius: 0.25rem;

  &:hover {
    background-color: var(--pav-color-red-100);
  }

  &:focus-visible {
    outline: 2px solid var(--pav-color-red-700);
    outline-offset: 2px;
  }

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-red-300);

    &:hover {
      background-color: rgba(239, 68, 68, 0.2);
    }
  }
}

/*
 * Spaces section list — scoped to this section. The list-item card with
 * name + accessibility preview + edit/delete buttons is a new pattern; if a
 * second consumer appears, lift the .space-item / .space-actions / .icon-button
 * triplet out into a shared partial. (Tracked in the bead's commit message.)
 */
.spaces-section .section-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.space-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.space-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--pav-color-stone-200);
  border-radius: 0.5rem;
  background: var(--pav-color-stone-50);

  @media (prefers-color-scheme: dark) {
    border-color: var(--pav-color-stone-700);
    background: var(--pav-color-stone-900);
  }
}

.space-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;

  &__name {
    font-weight: 500;
    color: var(--pav-color-stone-900);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-100);
    }
  }

  &__meta {
    font-size: 0.875rem;
    color: var(--pav-color-stone-600);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }
}

.space-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
}

.icon-button {
  @include admin-icon-button;

  &--danger {
    @include admin-icon-button--danger;
  }
}

.spaces-empty {
  margin: 0;
  padding: 0.5rem 0;
  font-size: 0.9375rem;
  color: var(--pav-color-stone-600);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

/* '(new)' affordance applied to staged-but-unsaved Spaces in the list */
.space-info__new-affordance {
  margin-inline-start: 0.375rem;
  font-size: 0.875rem;
  font-weight: 400;
  color: var(--pav-color-stone-500);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

/* Reassign-events dialog (eventCount > 0 branch) */
.reassign-dialog {
  display: flex;
  flex-direction: column;
  gap: 1rem;

  &__prompt {
    margin: 0;
    color: var(--pav-color-stone-800);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-200);
    }
  }

  &__options {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin: 0;
    padding: 0;
    border: none;
  }

  &__actions {
    @include admin-dialog-layout;
    /* admin-dialog-layout supplies .btn-ghost styling for the Cancel button */
    display: flex;
    align-items: center;
    justify-content: end;
    gap: 0.75rem;
    margin-block-start: 0.5rem;
  }
}

.reassign-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-size: 0.9375rem;

  input[type="radio"] {
    margin: 0;
  }

  &__default {
    margin-inline-start: 0.25rem;
    font-style: italic;
    color: var(--pav-color-stone-500);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }

  &__label {
    flex-shrink: 0;
  }

  &__select {
    flex: 1;
    padding: 0.375rem 0.5rem;
    border: 1px solid var(--pav-color-stone-300);
    border-radius: 0.375rem;
    background: var(--pav-color-stone-50);
    font-size: 0.9375rem;

    @media (prefers-color-scheme: dark) {
      background: var(--pav-color-stone-900);
      border-color: var(--pav-color-stone-600);
      color: var(--pav-color-stone-100);
    }
  }
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.add-space-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  width: 100%;
  padding: 0.5rem 0.875rem;
  border: 1px dashed var(--pav-color-stone-300);
  background: transparent;
  color: var(--pav-color-stone-700);
  border-radius: 0.5rem;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;

  &:hover {
    background-color: var(--pav-color-stone-100);
    border-color: var(--pav-color-stone-400);
    color: var(--pav-color-stone-900);
  }

  &:focus-visible {
    outline: 2px solid var(--pav-color-orange-500);
    outline-offset: 2px;
  }

  @media (prefers-color-scheme: dark) {
    border-color: var(--pav-color-stone-600);
    color: var(--pav-color-stone-300);

    &:hover {
      background-color: var(--pav-color-stone-800);
      border-color: var(--pav-color-stone-500);
      color: var(--pav-color-stone-100);
    }
  }
}
</style>

<template>
  <div class="place-editor-page">
    <!-- Page Header with Back Button and Actions -->
    <header class="page-header">
      <button type="button"
              class="back-button"
              @click="handleBack"
              :aria-label="t('back_button')">
        <ArrowLeft :size="20" aria-hidden="true" />
      </button>
      <h1>{{ isEditMode ? t('editor_title_edit') : t('editor_title_new') }}</h1>
      <div class="header-actions">
        <button
          type="button"
          class="btn-cancel"
          @click="handleBack"
        >
          {{ t('cancel') }}
        </button>
        <button
          type="submit"
          form="place-form"
          class="btn-save"
          :disabled="state.isSaving"
        >
          {{ t('save') }}
        </button>
      </div>
    </header>

    <!-- Loading State -->
    <div
      v-if="state.isLoading"
      class="loading-container"
      role="status"
      aria-live="polite"
    >
      <span class="loading-spinner" aria-hidden="true">&#8987;</span>
      <span>{{ t('editor_loading') }}</span>
    </div>

    <!-- Main Content -->
    <main
      v-else
      :aria-label="t('editor_aria_label')"
      class="editor-main"
    >
      <form id="place-form" @submit.prevent="handleSave" :aria-label="t('editor_form_aria_label')">

        <!-- Error Display -->
        <div v-if="state.error"
             ref="errorContainer"
             class="error"
             role="alert"
             aria-live="polite"
             tabindex="-1">
          <button
            class="error-dismiss"
            type="button"
            :aria-label="t('dismiss_error')"
            @click="state.error = ''"
          >&times;</button>
          <div v-if="Array.isArray(state.error)">
            <ul>
              <li v-for="(err, index) in state.error" :key="index">{{ err }}</li>
            </ul>
          </div>
          <div v-else>
            {{ state.error }}
          </div>
        </div>

        <!-- Single Column Layout -->
        <div class="editor-container">

          <!-- BASIC INFORMATION Section -->
          <section class="editor-section">
            <h2 class="section-header">{{ t('section_basic_info') }}</h2>

            <div class="section-card">
              <div class="translatable-form-fields">
                <div class="form-field">
                  <label for="place-name" class="field-label">{{ t('field_name') }} <span class="required-indicator" aria-hidden="true">*</span></label>
                  <input
                    id="place-name"
                    type="text"
                    v-model="formData.name"
                    class="field-input"
                    required
                  />
                </div>

                <div class="form-field">
                  <label for="place-address" class="field-label">{{ t('field_address') }}</label>
                  <input
                    id="place-address"
                    type="text"
                    v-model="formData.address"
                    class="field-input"
                  />
                </div>

                <div class="address-row">
                  <div class="form-field">
                    <label for="place-city" class="field-label">{{ t('field_city') }}</label>
                    <input
                      id="place-city"
                      type="text"
                      v-model="formData.city"
                      class="field-input"
                    />
                  </div>
                  <div class="form-field">
                    <label for="place-state" class="field-label">{{ t('field_state') }}</label>
                    <input
                      id="place-state"
                      type="text"
                      v-model="formData.state"
                      class="field-input"
                    />
                  </div>
                  <div class="form-field">
                    <label for="place-postal-code" class="field-label">{{ t('field_postal_code') }}</label>
                    <input
                      id="place-postal-code"
                      type="text"
                      v-model="formData.postalCode"
                      class="field-input"
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- ACCESSIBILITY INFORMATION Section -->
          <section class="editor-section">
            <h2 class="section-header">{{ t('section_accessibility') }}</h2>

            <div class="section-card">
              <LanguageTabSelector
                ref="accessibilityLangTabs"
                v-model="currentLanguage"
                :languages="languages"
                @add-language="openLanguagePicker"
              />

              <div
                :id="accessibilityLangTabs?.panelId(currentLanguage)"
                role="tabpanel"
                :aria-labelledby="accessibilityLangTabs?.tabId(currentLanguage)"
                class="translatable-form-fields"
              >
                <div class="form-field">
                  <label :for="`place-accessibility-${currentLanguage}`" class="field-label">
                    {{ t('field_accessibility_info') }}
                  </label>
                  <textarea
                    :id="`place-accessibility-${currentLanguage}`"
                    v-model="accessibilityInfo[currentLanguage]"
                    class="field-textarea"
                    rows="4"
                  />
                </div>
              </div>
            </div>
          </section>

          <!-- SPACES Section — visible in both create and edit modes per
               pv-0pht atomic Place + Spaces save model. -->
          <section class="editor-section spaces-section">
            <h2 class="section-header">{{ t('space.section_title') }}</h2>

            <div class="section-card">
              <!-- Spaces list (working buffer view; staged Spaces show '(new)').
                   When editing an existing row, the inline editor replaces that
                   row's list item so the row and the editor never appear side
                   by side. Add-new renders the editor below the list. -->
              <ul
                v-if="spacesForPlace.length > 0"
                class="space-list"
              >
                <template
                  v-for="space in spacesForPlace"
                  :key="spaceRowKey(space)"
                >
                  <li
                    v-if="editorOpen && editingSpaceId === spaceRowKey(space)"
                    class="space-edit-slot"
                  >
                    <EditSpace
                      :space="space"
                      @save="handleSpaceSaved"
                      @cancel="closeSpaceEditor"
                    />
                  </li>
                  <li
                    v-else
                    class="space-item"
                  >
                    <div class="space-info">
                      <div class="space-info__name">
                        {{ spaceDisplayName(space) }}
                        <span
                          v-if="isStagedSpace(space)"
                          class="space-info__new-affordance"
                          aria-hidden="true"
                        >{{ t('space.reassign_new_suffix') }}</span>
                      </div>
                      <div
                        v-if="spaceAccessibilityPreview(space)"
                        class="space-info__meta"
                      >
                        {{ spaceAccessibilityPreview(space) }}
                      </div>
                    </div>
                    <div class="space-actions">
                      <button
                        type="button"
                        class="icon-button edit-space-button"
                        :aria-label="t('space.edit_space_button', { name: spaceDisplayName(space) })"
                        @click="openSpaceEditor(spaceRowKey(space))"
                      >
                        <Pencil :size="20" :stroke-width="2" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        class="icon-button icon-button--danger delete-space-button"
                        :aria-label="t('space.delete_space_button', { name: spaceDisplayName(space) })"
                        @click="confirmDeleteSpace(space, $event)"
                      >
                        <Trash2 :size="20" :stroke-width="2" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                </template>
              </ul>

              <!-- Empty state (hidden while creating the first Space inline). -->
              <p
                v-else-if="!(editorOpen && !editingSpaceId)"
                class="spaces-empty"
              >
                {{ t('space.no_spaces') }}
              </p>

              <!-- Add-new editor: only mounts when creating a new Space.
                   Editing an existing Space renders the editor inline above
                   in place of the matching list item. -->
              <EditSpace
                v-if="editorOpen && !editingSpaceId"
                :space="null"
                @save="handleSpaceSaved"
                @cancel="closeSpaceEditor"
              />

              <!-- Add Space button (hidden while editor is open) -->
              <button
                v-if="!editorOpen"
                ref="addSpaceButtonRef"
                type="button"
                class="add-space-button"
                @click="openSpaceEditor(null)"
              >
                <Plus :size="18" :stroke-width="2" aria-hidden="true" />
                <span>{{ t('space.add_button') }}</span>
              </button>
            </div>
          </section>

        </div>
      </form>
    </main>
  </div>

  <div v-if="showLanguagePicker">
    <language-picker :languages="availableLanguages"
                     :selectedLanguages="languages"
                     @close="closeLanguagePicker"
                     @select="handleAddLanguage" />
  </div>

  <!-- Delete Space confirmation: plain confirm when eventCount === 0; the
       reassign dialog (below) takes over when eventCount > 0. -->
  <ConfirmDeleteDialog
    v-if="targetEventCount === 0"
    :visible="state.showDeleteSpaceDialog && !!state.spaceToDelete"
    :title="t('space.confirm_delete_title')"
    :message="deleteSpaceMessage"
    :is-deleting="false"
    :delete-label="t('space.delete_button')"
    :deleting-label="t('space.deleting')"
    :cancel-label="t('space.cancel')"
    modal-class="delete-space-modal"
    @confirm="stageSpaceRemoval"
    @close="cancelDeleteSpace"
  />

  <!-- Reassign-events dialog: shown when the Space being deleted has
       eventCount > 0. Whole-venue is the default selection (FK SET NULL on
       events.space_id handles those automatically); a non-whole-venue choice
       lands in pendingReassigns and fires post-save. -->
  <ModalLayout
    v-if="targetEventCount > 0 && state.showDeleteSpaceDialog && !!state.spaceToDelete"
    :title="t('space.reassign_dialog_title', { name: spaceDisplayName(state.spaceToDelete) })"
    modal-class="reassign-space-modal"
    @close="cancelDeleteSpace"
  >
    <div class="reassign-dialog">
      <p class="reassign-dialog__prompt">
        {{ t('space.reassign_dialog_prompt', { count: targetEventCount }) }}
      </p>
      <fieldset class="reassign-dialog__options">
        <legend class="visually-hidden">{{ t('space.reassign_dropdown_label') }}</legend>
        <label class="reassign-option">
          <input
            type="radio"
            name="reassign-target"
            value="whole-venue"
            v-model="state.reassignTarget"
          />
          <span>
            {{ t('space.reassign_option_whole_venue') }}
            <em class="reassign-option__default">{{ t('space.reassign_option_default_suffix') }}</em>
          </span>
        </label>
        <label
          v-if="reassignTargetSpaces.length > 0"
          class="reassign-option"
        >
          <input
            type="radio"
            name="reassign-target"
            value="other-space"
            v-model="state.reassignTarget"
          />
          <span class="reassign-option__label">
            {{ t('space.reassign_option_other_space') }}
          </span>
          <select
            class="reassign-option__select"
            :aria-label="t('space.reassign_dropdown_label')"
            v-model="state.reassignOtherTarget"
            @change="state.reassignTarget = 'other-space'"
          >
            <option
              v-for="opt in reassignTargetSpaces"
              :key="spaceRowKey(opt)"
              :value="spaceRowKey(opt)"
            >
              {{ spaceDisplayName(opt) }}<template v-if="isStagedSpace(opt)"> {{ t('space.reassign_new_suffix') }}</template>
            </option>
          </select>
        </label>
      </fieldset>
      <div class="reassign-dialog__actions">
        <button
          ref="reassignCancelRef"
          type="button"
          class="btn-ghost"
          @click="cancelDeleteSpace"
        >
          {{ t('space.cancel') }}
        </button>
        <PillButton
          variant="danger"
          @click="stageSpaceRemoval"
        >
          {{ t('space.reassign_confirm_button') }}
        </PillButton>
      </div>
    </div>
  </ModalLayout>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onBeforeMount, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import i18next from 'i18next';
import { ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-vue-next';
import LanguageTabSelector from '@/client/components/common/language-tab-selector.vue';
import languagePicker from '@/client/components/common/language-picker.vue';
import ConfirmDeleteDialog from '@/client/components/common/confirm-delete-dialog.vue';
import ModalLayout from '@/client/components/common/modal.vue';
import PillButton from '@/client/components/common/pill-button.vue';
import EditSpace from '@/client/components/logged_in/calendar/edit-space.vue';
import LocationService from '@/client/service/location';
import CalendarService from '@/client/service/calendar';
import { useToast } from '@/client/composables/useToast';
import { EventLocation, EventLocationSpace, validateLocationHierarchy } from '@/common/model/location';
import iso6391 from 'iso-639-1-dir';

const props = defineProps({
  placeId: {
    type: String,
    default: null,
  },
});

const route = useRoute();
const router = useRouter();
const locationService = new LocationService();
const calendarService = new CalendarService();
const toast = useToast();

const { t } = useTranslation('calendars', {
  keyPrefix: 'places',
});

const calendarUrlName = computed(() => route.params.calendar as string);

const isEditMode = computed(() => !!props.placeId);

// Reactive view of the current UI language so multilingual content updates
// when the user switches the app language at runtime.
const uiLanguage = computed(() => i18next.language ?? 'en');

const state = reactive({
  isLoading: false,
  isSaving: false,
  error: '' as string | string[],
  calendarId: '' as string,

  // Spaces UI state. The staging buffer for Place + Spaces lives in `place`
  // (below); this reactive only tracks transient UI flags around the inline
  // editor and delete dialog.
  showDeleteSpaceDialog: false,
  spaceToDelete: null as EventLocationSpace | null,
  deleteTriggerElement: null as HTMLElement | null,
  // Reassign dialog branch (eventCount > 0). 'whole-venue' keeps the FK
  // SET NULL behavior; 'other-space' is a sentinel meaning "use the
  // dropdown selection in reassignOtherTarget" — this decouples the radio
  // from the select so a keyboard user changing the select implicitly
  // checks the "other space" radio (WCAG 3.2.2 On Input).
  reassignTarget: 'whole-venue' as 'whole-venue' | 'other-space',
  reassignOtherTarget: '' as string,
});

/**
 * Single working buffer for the entire Place + Spaces tree. All edits — basic
 * fields, accessibility content, Space adds/edits/deletes — flow through this
 * reactive snapshot. The parent Save commits it atomically via a single
 * PUT/POST; the post-save reassign loop fires sequentially after.
 *
 * Created via `EventLocation.fromObject(initialPlace.toObject())` so it's a
 * full deep clone (sharing no references with the cache). Initial value is
 * an empty Place; populated in onBeforeMount for edit mode.
 */
const initialPlace = ref<EventLocation>(new EventLocation());
const place = ref<EventLocation>(new EventLocation());

/**
 * Reassign decisions made via the delete dialog. Only non-whole-venue targets
 * land here — whole-venue choices are not staged because the FK SET NULL on
 * `events.space_id` handles them automatically when the Space is dropped from
 * `place.spaces`. Key is the deleted Space's server `id`; value is the target
 * Space's server `id` or staged `clientId` (translated post-save via the
 * server's clientId echo).
 */
const pendingReassigns = reactive<Map<string, string>>(new Map());

/**
 * Whether the inline Space editor is open. Decoupled from `editingSpaceId`
 * so that the editor can be opened in create mode (where `editingSpaceId` is
 * intentionally `null`) without colliding with the "closed" sentinel.
 */
const editorOpen = ref<boolean>(false);

/**
 * The Space currently being edited inline. `null` while the editor is in
 * create mode; otherwise carries the row key (server `id` or `clientId`).
 */
const editingSpaceId = ref<string | null>(null);

// Refs into the Spaces section.
const addSpaceButtonRef = ref<HTMLElement | null>(null);
const reassignCancelRef = ref<HTMLElement | null>(null);

/**
 * Clone an EventLocation into a detached working buffer. `EventLocation.toObject`
 * intentionally omits `eventCount` (read-only, never round-tripped into writes),
 * so the JSON-shaped clone loses it. Reattach it onto matching Space rows so the
 * delete dialog branch logic — which keys off `space.eventCount` — survives the
 * staging-buffer hand-off.
 */
function cloneLocationForBuffer(source: EventLocation): EventLocation {
  const clone = EventLocation.fromObject(source.toObject());
  // Patch eventCount back onto each Space whose id matches a source row.
  if (source.spaces && source.spaces.length > 0) {
    const eventCountById = new Map<string, number>();
    for (const sourceSpace of source.spaces) {
      if (sourceSpace.id && typeof sourceSpace.eventCount === 'number') {
        eventCountById.set(sourceSpace.id, sourceSpace.eventCount);
      }
    }
    for (const cloneSpace of clone.spaces) {
      if (cloneSpace.id && eventCountById.has(cloneSpace.id)) {
        cloneSpace.eventCount = eventCountById.get(cloneSpace.id);
      }
    }
  }
  return clone;
}

/**
 * Spaces currently in the working buffer. The list-rendering loop binds to
 * this; existing Spaces use their server `id` as the key, staged Spaces use
 * their `clientId`.
 */
const spacesForPlace = computed<EventLocationSpace[]>(() => place.value.spaces ?? []);

/**
 * Stable per-row key for the Spaces list. Existing Spaces have a server id;
 * staged Spaces have a clientId.
 */
function spaceRowKey(space: EventLocationSpace): string {
  return space.id || (space.clientId ?? '');
}

/**
 * True when this Space is staged-but-unsaved — used to decorate the list with
 * a '(new)' affordance and to feed the reassign-dialog dropdown.
 */
function isStagedSpace(space: EventLocationSpace): boolean {
  return !space.id;
}

/**
 * Pick the best display name for a Space, preferring the current UI language
 * with a fallback to the Space's first available content language.
 */
function spaceDisplayName(space: EventLocationSpace): string {
  const preferred = space.content(uiLanguage.value)?.name;
  if (preferred && preferred.trim().length > 0) return preferred;
  for (const lang of space.getLanguages()) {
    const name = space.content(lang)?.name;
    if (name && name.trim().length > 0) return name;
  }
  return t('space.unnamed_space');
}

/**
 * Pick the best accessibility-info preview for a Space, mirroring the
 * `spaceDisplayName` fallback logic.
 */
function spaceAccessibilityPreview(space: EventLocationSpace): string {
  const preferred = space.content(uiLanguage.value)?.accessibilityInfo;
  if (preferred && preferred.trim().length > 0) return preferred;
  for (const lang of space.getLanguages()) {
    const info = space.content(lang)?.accessibilityInfo;
    if (info && info.trim().length > 0) return info;
  }
  return '';
}

/**
 * Plain-confirm message for delete-when-eventCount-zero. The reassign branch
 * (eventCount > 0) renders its own dedicated dialog further down.
 */
const deleteSpaceMessage = computed(() => {
  const space = state.spaceToDelete;
  if (!space) return '';
  const name = spaceDisplayName(space);
  return t('space.confirm_delete_message', { name });
});

/**
 * `eventCount > 0` for the targeted Space → render the reassign dialog. The
 * count is read inline from `space.eventCount` (populated by the server's
 * GET response per pv-0pht atomic Place + Spaces wire contract).
 */
const targetEventCount = computed<number>(() => state.spaceToDelete?.eventCount ?? 0);

/**
 * Other Spaces in the current snapshot — excludes the Space being deleted.
 * The reassign dropdown rebuilds from this; staged Spaces flow through with
 * the '(new)' affordance applied at the option-label level.
 */
const reassignTargetSpaces = computed<EventLocationSpace[]>(() => {
  if (!state.spaceToDelete) return [];
  const targetKey = spaceRowKey(state.spaceToDelete);
  return spacesForPlace.value.filter(s => spaceRowKey(s) !== targetKey);
});

/**
 * Open the inline Space editor. Pass a spaceId to edit (server id OR clientId
 * for a staged-but-unsaved entry), or null to create a new entry.
 */
function openSpaceEditor(spaceIdOrClientId: string | null) {
  editingSpaceId.value = spaceIdOrClientId;
  editorOpen.value = true;
}

/**
 * Close the inline Space editor (used by both cancel and successful save).
 * Returns focus to the Add button so keyboard users land somewhere sensible.
 */
function closeSpaceEditor() {
  editorOpen.value = false;
  editingSpaceId.value = null;
  nextTick(() => {
    addSpaceButtonRef.value?.focus();
  });
}

/**
 * Generate a transient `clientId` for a freshly-staged Space row. Used to
 * correlate a draft entry with its server-issued `id` after the atomic save
 * (the server echoes `clientId` on every newly-created Space row per pv-0pht).
 *
 * Prefers `crypto.randomUUID()` when available (browsers + modern test envs);
 * falls back to a timestamp + random suffix to keep tests deterministic-enough
 * without pulling in a new dependency.
 */
function generateClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `client-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Merge a staged Space content payload into `place.spaces`. Called when the
 * inline editor emits its save event with a freshly-built `EventLocationSpace`.
 *
 * - Edit mode (`editingSpaceId` set): replace the matching working-buffer
 *   entry in place. Identity is keyed on the row key (server `id` for
 *   already-saved Spaces, `clientId` for staged-but-unsaved ones).
 * - Create mode (`editingSpaceId` null): stamp a fresh `clientId` and append.
 *
 * The atomic-save commit (`handleSave`) consumes the resulting `place.spaces`
 * snapshot; the per-row identity is what lets the server's PUT diff and the
 * subsequent `clientId` echo line up with the staged rows.
 */
function handleSpaceSaved(staged: EventLocationSpace) {
  const editingKey = editingSpaceId.value;

  if (editingKey) {
    // Edit mode: replace the matching entry in place. Preserve the row's
    // existing identity (server id and/or clientId) — the staged payload
    // already carries them through, so a wholesale replace is correct.
    place.value.spaces = place.value.spaces.map(s =>
      spaceRowKey(s) === editingKey ? staged : s,
    );
  }
  else {
    // Create mode: stamp a fresh clientId so the row has a stable key in the
    // working buffer until the server echoes back its assigned id.
    if (!staged.clientId) {
      staged.clientId = generateClientId();
    }
    place.value.spaces = [...place.value.spaces, staged];
  }

  closeSpaceEditor();
}

/**
 * Open the delete-confirm dialog for a Space. Branches on `eventCount` are
 * driven entirely by the template `v-if`/`v-else` on the two dialog elements.
 */
function confirmDeleteSpace(space: EventLocationSpace, event?: Event) {
  state.deleteTriggerElement = (event?.currentTarget as HTMLElement) ?? null;
  state.spaceToDelete = space;
  state.reassignTarget = 'whole-venue';
  // Seed the dropdown to the first eligible Space so the select has a
  // valid value the moment the user switches the radio.
  const firstOther = reassignTargetSpaces.value[0];
  state.reassignOtherTarget = firstOther ? spaceRowKey(firstOther) : '';
  state.showDeleteSpaceDialog = true;
}

/**
 * Close the delete-confirm dialog and restore focus to the trigger.
 */
function cancelDeleteSpace() {
  const trigger = state.deleteTriggerElement;
  state.spaceToDelete = null;
  state.showDeleteSpaceDialog = false;
  state.deleteTriggerElement = null;
  state.reassignTarget = 'whole-venue';
  state.reassignOtherTarget = '';
  nextTick(() => trigger?.focus());
}

/**
 * Stage a Space removal in the working buffer. If the user picked a non-
 * whole-venue reassign target, register it in `pendingReassigns`; whole-venue
 * choices are NOT staged here — the FK SET NULL on `events.space_id` handles
 * those automatically when the Space drops out of the snapshot.
 */
function stageSpaceRemoval() {
  if (!state.spaceToDelete) return;
  const targetKey = spaceRowKey(state.spaceToDelete);
  const fromId = state.spaceToDelete.id;

  // Pre-existing Space with events → may need a reassign entry. Resolve
  // the 'other-space' sentinel through the dropdown's separate selection
  // so the radio and select stay decoupled (WCAG 3.2.2).
  if (fromId && targetEventCount.value > 0 && state.reassignTarget === 'other-space' && state.reassignOtherTarget) {
    pendingReassigns.set(fromId, state.reassignOtherTarget);
  }

  // Drop the Space from the working buffer. Existing-but-removed entries fall
  // out of the snapshot; the server's PUT diff will destroy() them.
  place.value.spaces = place.value.spaces.filter(s => spaceRowKey(s) !== targetKey);

  cancelDeleteSpace();
}

// Error container ref for focus management
const errorContainer = ref<HTMLElement | null>(null);

// Form data for basic fields
const formData = reactive({
  name: '',
  address: '',
  city: '',
  state: '',
  postalCode: '',
});

// Accessibility info keyed by language
const accessibilityInfo = reactive<Record<string, string>>({});

// Language management
const defaultLanguage = 'en';
const languages = ref<string[]>([defaultLanguage]);
const currentLanguage = ref(defaultLanguage);
const showLanguagePicker = ref(false);
const accessibilityLangTabs = ref<InstanceType<typeof LanguageTabSelector> | null>(null);

/**
 * Scroll error container into view when an error occurs.
 */
watch(() => state.error, async (newError) => {
  if (newError) {
    await nextTick();
    errorContainer.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    errorContainer.value?.focus();
  }
});

/**
 * Available languages for the language picker (excludes already-selected languages).
 */
const availableLanguages = computed(() => {
  const allLanguages = iso6391.getAllCodes();
  return allLanguages.filter((code: string) => !languages.value.includes(code));
});

/**
 * Dirty-state predicate. Per Decision 9 (complexity-playbook): the place
 * working-buffer diff alone is sufficient. Whole-venue choices never land in
 * `pendingReassigns`, and any non-whole-venue choice requires a Space removal
 * which the place diff already detects. JSON.stringify of toObject() gives a
 * stable canonical form for both the snapshot and the original.
 */
const isDirty = computed<boolean>(() => {
  // Sync formData/accessibilityInfo into the working buffer view used here.
  const snapshot = buildLocationFromForm();
  // Carry through the staged Spaces snapshot — buildLocationFromForm only
  // covers the place fields and content. Spaces live on `place.value.spaces`.
  snapshot.spaces = place.value.spaces;
  return JSON.stringify(snapshot.toObject()) !== JSON.stringify(initialPlace.value.toObject());
});

/**
 * Cancel/Back gate: prompt before discarding unsaved edits.
 */
function handleBack() {
  if (isDirty.value) {
    const ok = window.confirm(t('discard_unsaved_changes'));
    if (!ok) return;
  }
  router.push(`/calendar/${calendarUrlName.value}?tab=places`);
}

/**
 * Open the language picker modal.
 */
function openLanguagePicker() {
  showLanguagePicker.value = true;
}

/**
 * Close the language picker modal.
 */
function closeLanguagePicker() {
  showLanguagePicker.value = false;
}

/**
 * Handle adding a new language from the picker.
 */
function handleAddLanguage(language: string) {
  if (!languages.value.includes(language)) {
    languages.value.push(language);
    currentLanguage.value = language;
  }
  closeLanguagePicker();
}

/**
 * Build an EventLocation model from the current form data. Does NOT include
 * `spaces[]` — callers that need a full snapshot copy `place.value.spaces`
 * onto the result. (Used by `isDirty` and `handleSave`.)
 */
function buildLocationFromForm(): EventLocation {
  const location = new EventLocation(
    isEditMode.value ? props.placeId : undefined,
    formData.name.trim(),
    formData.address.trim(),
    formData.city.trim(),
    formData.state.trim(),
    formData.postalCode.trim(),
  );

  // Add accessibility content for each language that has info
  for (const lang of languages.value) {
    const info = accessibilityInfo[lang];
    if (info && info.trim().length > 0) {
      const content = location.content(lang);
      content.accessibilityInfo = info.trim();
    }
  }

  return location;
}

/**
 * Populate form data from an existing EventLocation model.
 */
function populateFormFromLocation(location: EventLocation) {
  formData.name = location.name;
  formData.address = location.address;
  formData.city = location.city;
  formData.state = location.state;
  formData.postalCode = location.postalCode;

  // Populate accessibility info from content
  const contentLanguages = location.getLanguages();
  if (contentLanguages.length > 0) {
    for (const lang of contentLanguages) {
      if (!languages.value.includes(lang)) {
        languages.value.push(lang);
      }
      accessibilityInfo[lang] = location.content(lang).accessibilityInfo || '';
    }
    currentLanguage.value = languages.value[0];
  }
}

/**
 * Handle form submission (create or update). Atomic Place + Spaces save:
 * one PUT/POST commits the entire snapshot; the post-save loop fires
 * `pendingReassigns` sequentially via `locationService.reassignEvents`.
 */
async function handleSave() {
  state.error = '';

  // Validate name is required
  if (!formData.name.trim()) {
    state.error = t('error_name_required');
    return;
  }

  // Build the full snapshot: basic fields + content + the staged Spaces tree.
  const location = buildLocationFromForm();
  location.spaces = place.value.spaces;

  // Validate location hierarchy
  const hierarchyErrors = validateLocationHierarchy(location);
  if (hierarchyErrors.length > 0) {
    state.error = hierarchyErrors.map(key => t(key)).join('. ');
    return;
  }

  state.isSaving = true;

  let saved: EventLocation;
  try {
    if (isEditMode.value) {
      saved = await locationService.updateLocation(state.calendarId, location);
    }
    else {
      saved = await locationService.createLocation(state.calendarId, location);
    }
  }
  catch (error) {
    // Place PUT/POST failure: keep snapshot and pendingReassigns intact for
    // retry, surface inline error.
    console.error('Error saving place:', error);
    state.error = t('error_saving');
    state.isSaving = false;
    return;
  }

  // Build clientId → serverId map from the response. The server echoes the
  // request's clientId on every newly-created Space row (pv-0pht).
  const idMap = new Map<string, string>();
  for (const space of saved.spaces ?? []) {
    if (space.clientId && space.id) {
      idMap.set(space.clientId, space.id);
    }
  }

  // Fire pendingReassigns sequentially. Translate clientId targets via idMap;
  // if a target was a staged Space whose clientId did not echo back, that's a
  // logic bug — fail loud (this manifests as a missing key, which we surface
  // as a partial-failure entry just like a network failure).
  const failures: Array<{ fromId: string; targetId: string; error: unknown }> = [];
  for (const [fromId, toTarget] of pendingReassigns) {
    const realTargetId = idMap.get(toTarget) ?? toTarget;
    try {
      await locationService.reassignEvents(state.calendarId, saved.id, fromId, realTargetId);
    }
    catch (error) {
      console.error('Error reassigning events:', error);
      failures.push({ fromId, targetId: realTargetId, error });
      // Keep going — collect all failures, do not retain pendingReassigns
      // for retry.
    }
  }

  // Always clear; user re-opens editor to retry manually if any failed
  // (no programmatic retry, no retained partial state — Decision 4).
  pendingReassigns.clear();

  if (failures.length > 0) {
    toast.warning(t('error_reassign_partial', { count: failures.length }));
  }

  // Update the initial-snapshot baseline to the freshly-saved state so the
  // dirty-state Cancel prompt does not fire on the navigation that follows.
  initialPlace.value = cloneLocationForBuffer(saved);
  place.value = cloneLocationForBuffer(saved);

  state.isSaving = false;
  router.push(`/calendar/${calendarUrlName.value}?tab=places`);
}

/**
 * Initialize the editor: resolve calendar and load existing location if editing.
 * The working buffer `place` is seeded from the loaded location (or left as a
 * fresh EventLocation in create mode). `initialPlace` captures the baseline
 * for the dirty-state predicate.
 */
onBeforeMount(async () => {
  state.isLoading = true;

  try {
    // Resolve calendar from URL name
    const calendar = await calendarService.getCalendarByUrlName(calendarUrlName.value);
    if (!calendar) {
      state.error = t('error_calendar_not_found');
      state.isLoading = false;
      return;
    }

    state.calendarId = calendar.id;

    // If editing, load the existing location (with `spaces[]` inline per
    // pv-0pht atomic Place + Spaces wire contract).
    if (isEditMode.value && props.placeId) {
      const location = await locationService.getLocationById(calendar.id, props.placeId);
      populateFormFromLocation(location);
      // Seed the working buffer + baseline from the server response. Use the
      // eventCount-preserving clone helper so the dialog branch logic survives
      // (toObject omits eventCount by design).
      place.value = cloneLocationForBuffer(location);
      initialPlace.value = cloneLocationForBuffer(location);
    }
    else {
      // Create mode: empty buffer + matching baseline.
      place.value = new EventLocation();
      initialPlace.value = new EventLocation();
    }
  }
  catch (error) {
    console.error('Error initializing place editor:', error);
    state.error = t('error_loading');
  }
  finally {
    state.isLoading = false;

    // Focus the name input after loading completes
    await nextTick();
    document.querySelector<HTMLInputElement>('#place-name')?.focus();
  }
});
</script>
