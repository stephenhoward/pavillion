<style scoped lang="scss">
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
    margin-left: auto;
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
      margin-left: 0;
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
  padding: var(--pav-space-4xl);
  color: var(--pav-color-text-secondary);

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
  color: var(--pav-color-stone-600);
  font-size: 0.9375rem;
  font-weight: 400;
  cursor: pointer;
  transition: color 0.15s ease;

  &:hover {
    color: var(--pav-color-stone-900);
  }

  &:focus-visible {
    outline: 2px solid var(--pav-color-orange-500);
    outline-offset: 2px;
  }

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);

    &:hover {
      color: var(--pav-color-stone-200);
    }
  }
}

.btn-save {
  padding: 0.625rem 1.5rem;
  border: none;
  background: var(--pav-color-orange-500);
  color: white;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  border-radius: 9999px;
  transition: all 0.15s ease;

  &:hover {
    background: var(--pav-color-orange-600);
  }

  &:focus-visible {
    outline: 2px solid var(--pav-color-orange-500);
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
    padding-left: var(--pav-space-md);
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  background: transparent;
  color: var(--pav-color-stone-700);
  border-radius: 0.375rem;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;

  &:hover:not(:disabled) {
    background-color: var(--pav-color-stone-200);
    color: var(--pav-color-stone-900);
  }

  &:focus-visible {
    outline: 2px solid var(--pav-color-orange-500);
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-300);

    &:hover:not(:disabled) {
      background-color: var(--pav-color-stone-700);
      color: var(--pav-color-stone-100);
    }
  }

  &--danger {
    color: var(--pav-color-red-700);

    &:hover:not(:disabled) {
      background-color: var(--pav-color-red-100);
      color: var(--pav-color-red-800);
    }

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-red-300);

      &:hover:not(:disabled) {
        background-color: rgba(239, 68, 68, 0.2);
        color: var(--pav-color-red-200);
      }
    }
  }
}

.spaces-loading,
.spaces-empty {
  margin: 0;
  padding: 0.5rem 0;
  font-size: 0.9375rem;
  color: var(--pav-color-stone-600);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.add-space-button {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  align-self: flex-start;
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

          <!-- SPACES Section (edit mode only — Spaces require an existing Place) -->
          <section
            v-if="isEditMode"
            class="editor-section spaces-section"
            :aria-busy="state.isLoadingSpaces"
          >
            <h2 class="section-header">{{ t('space.section_title') }}</h2>

            <div class="section-card">
              <!-- Loading state -->
              <div
                v-if="state.isLoadingSpaces"
                class="spaces-loading"
                role="status"
                aria-live="polite"
              >
                {{ t('space.loading_spaces') }}
              </div>

              <!-- Spaces list -->
              <ul
                v-else-if="spacesForPlace.length > 0"
                class="space-list"
              >
                <li
                  v-for="space in spacesForPlace"
                  :key="space.id"
                  class="space-item"
                >
                  <div class="space-info">
                    <div class="space-info__name">
                      {{ spaceDisplayName(space) }}
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
                      :disabled="state.deletingSpaceId === space.id"
                      @click="openSpaceEditor(space.id)"
                    >
                      <Pencil :size="20" :stroke-width="2" />
                    </button>
                    <button
                      type="button"
                      class="icon-button icon-button--danger delete-space-button"
                      :aria-label="t('space.delete_space_button', { name: spaceDisplayName(space) })"
                      :disabled="state.deletingSpaceId === space.id"
                      @click="confirmDeleteSpace(space, $event)"
                    >
                      <Trash2 :size="20" :stroke-width="2" />
                    </button>
                  </div>
                </li>
              </ul>

              <!-- Empty state -->
              <p
                v-else
                class="spaces-empty"
              >
                {{ t('space.no_spaces') }}
              </p>

              <!-- Inline editor (mounts on Add or Edit click) -->
              <EditSpace
                v-if="state.spaceEditorOpen"
                :calendar-url-name="calendarUrlName"
                :place-id="props.placeId!"
                :space-id="state.editingSpaceId"
                @save="handleSpaceSaved"
                @cancel="closeSpaceEditor"
              />

              <!-- Add Space button (hidden while editor is open) -->
              <button
                v-if="!state.spaceEditorOpen"
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

  <!-- Delete Space confirmation -->
  <ConfirmDeleteDialog
    :visible="state.showDeleteSpaceDialog && !!state.spaceToDelete"
    :title="t('space.confirm_delete_title')"
    :message="deleteSpaceMessage"
    :is-deleting="!!state.deletingSpaceId && state.deletingSpaceId === state.spaceToDelete?.id"
    :delete-label="t('space.delete_button')"
    :deleting-label="t('space.deleting')"
    :cancel-label="t('space.cancel')"
    modal-class="delete-space-modal"
    @confirm="deleteSpace"
    @close="cancelDeleteSpace"
  />
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
import EditSpace from '@/client/components/logged_in/calendar/edit-space.vue';
import LocationService from '@/client/service/location';
import CalendarService from '@/client/service/calendar';
import { useLocationStore } from '@/client/stores/locationStore';
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
const locationStore = useLocationStore();
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

  // Spaces section state.
  isLoadingSpaces: false,
  spaceEditorOpen: false,
  editingSpaceId: null as string | null,
  showDeleteSpaceDialog: false,
  spaceToDelete: null as EventLocationSpace | null,
  deletingSpaceId: '' as string,
  deleteTriggerElement: null as HTMLElement | null,
});

// Refs into the Spaces section.
const addSpaceButtonRef = ref<HTMLElement | null>(null);

/**
 * Reactive view of the cached Spaces for this Place. Returns an empty array
 * when the cache has not been populated yet (e.g. in create mode, or before
 * `fetchSpaces` resolves).
 */
const spacesForPlace = computed<EventLocationSpace[]>(() => {
  if (!props.placeId) return [];
  return locationStore.getSpacesForPlace(props.placeId);
});

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
 * Build the delete-confirm message for the currently targeted Space, including
 * the event-count consequence sentence when the server-supplied count > 0.
 */
const deleteSpaceMessage = computed(() => {
  const space = state.spaceToDelete;
  if (!space) return '';
  const name = spaceDisplayName(space);
  let msg = t('space.confirm_delete_message', { name });
  // Spaces may be augmented at runtime with an event count from the server.
  const eventCount = (space as unknown as { eventCount?: number }).eventCount ?? 0;
  if (eventCount > 0) {
    msg += ' ' + t('space.confirm_delete_event_count', { count: eventCount });
  }
  return msg;
});

/**
 * Open the inline Space editor. Pass a spaceId to edit, or null to create.
 */
function openSpaceEditor(spaceId: string | null) {
  state.editingSpaceId = spaceId;
  state.spaceEditorOpen = true;
}

/**
 * Close the inline Space editor (used by both cancel and successful save).
 * Returns focus to the Add button so keyboard users land somewhere sensible.
 */
function closeSpaceEditor() {
  state.spaceEditorOpen = false;
  state.editingSpaceId = null;
  nextTick(() => {
    addSpaceButtonRef.value?.focus();
  });
}

/**
 * Refetch Spaces and close the editor after a successful save. The store's
 * `createSpace` / `updateSpace` already refetch internally, but we re-fetch
 * defensively in case the editor was given a stale cache.
 */
async function handleSpaceSaved() {
  closeSpaceEditor();
  if (props.placeId) {
    try {
      await locationStore.fetchSpaces(calendarUrlName.value, props.placeId);
    }
    catch (error) {
      console.error('Error refetching spaces:', error);
    }
  }
}

/**
 * Open the delete-confirm dialog for a Space.
 */
function confirmDeleteSpace(space: EventLocationSpace, event?: Event) {
  state.deleteTriggerElement = (event?.currentTarget as HTMLElement) ?? null;
  state.spaceToDelete = space;
  state.showDeleteSpaceDialog = true;
}

/**
 * Close the delete-confirm dialog and restore focus to the trigger.
 */
function cancelDeleteSpace() {
  const trigger = state.deleteTriggerElement;
  state.spaceToDelete = null;
  state.showDeleteSpaceDialog = false;
  state.deletingSpaceId = '';
  state.deleteTriggerElement = null;
  nextTick(() => trigger?.focus());
}

/**
 * Delete the Space currently targeted by the confirm dialog.
 */
async function deleteSpace() {
  if (!state.spaceToDelete || !props.placeId) return;
  const spaceId = state.spaceToDelete.id;
  state.deletingSpaceId = spaceId;
  try {
    await locationStore.deleteSpace(calendarUrlName.value, props.placeId, spaceId);
    cancelDeleteSpace();
    toast.success(t('space.space_deleted_success'));
  }
  catch (error) {
    console.error('Error deleting space:', error);
    toast.error(t('space.error_deleting'));
  }
  finally {
    state.deletingSpaceId = '';
  }
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
 * Navigate back to the places tab on the calendar view.
 */
function handleBack() {
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
 * Build an EventLocation model from the current form data.
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
 * Handle form submission (create or update).
 */
async function handleSave() {
  state.error = '';

  // Validate name is required
  if (!formData.name.trim()) {
    state.error = t('error_name_required');
    return;
  }

  const location = buildLocationFromForm();

  // Validate location hierarchy
  const hierarchyErrors = validateLocationHierarchy(location);
  if (hierarchyErrors.length > 0) {
    state.error = hierarchyErrors.map(key => t(key)).join('. ');
    return;
  }

  state.isSaving = true;

  try {
    if (isEditMode.value) {
      await locationService.updateLocation(state.calendarId, location);
    }
    else {
      await locationService.createLocation(state.calendarId, location);
    }

    // Navigate back to places tab on success
    handleBack();
  }
  catch (error) {
    console.error('Error saving place:', error);
    state.error = t('error_saving');
  }
  finally {
    state.isSaving = false;
  }
}

/**
 * Initialize the editor: resolve calendar and load existing location if editing.
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

    // If editing, load the existing location
    if (isEditMode.value && props.placeId) {
      const location = await locationService.getLocationById(calendar.id, props.placeId);
      populateFormFromLocation(location);

      // Fetch this Place's Spaces into the locationStore cache. Failure here
      // is non-fatal — the Place editor itself remains usable; the Spaces
      // section just shows the loading-failed empty state.
      state.isLoadingSpaces = true;
      try {
        await locationStore.fetchSpaces(calendarUrlName.value, props.placeId);
      }
      catch (spacesError) {
        console.error('Error loading spaces:', spacesError);
      }
      finally {
        state.isLoadingSpaces = false;
      }
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
