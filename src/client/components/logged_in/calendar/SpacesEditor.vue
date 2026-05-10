<style scoped lang="scss">
@use '../../../assets/style/components/calendar-admin' as *;

/*
 * Spaces section list — scoped to this component. The list-item card with
 * name + accessibility preview + edit/delete buttons is a new pattern; if a
 * second consumer appears, lift the .space-item / .space-actions / .icon-button
 * triplet out into a shared partial.
 */
.spaces-editor {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-md);
}

.space-list {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-sm);
  margin: 0;
  padding: 0;
  list-style: none;
}

.space-item {
  display: flex;
  align-items: center;
  gap: var(--pav-space-md);
  padding: var(--pav-space-md);
  border: var(--pav-border-width-1) solid var(--pav-border-secondary);
  border-radius: var(--pav-border-radius-md);
  background: var(--pav-surface-card);
}

.space-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-0_5);

  &__name {
    font-weight: var(--pav-font-weight-medium);
    color: var(--pav-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__meta {
    font-size: var(--pav-font-size-xs);
    color: var(--pav-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  &__new-affordance {
    margin-inline-start: var(--pav-space-1_5);
    font-size: var(--pav-font-size-xs);
    font-weight: var(--pav-font-weight-regular);
    color: var(--pav-text-muted);
  }
}

.space-actions {
  display: flex;
  align-items: center;
  gap: var(--pav-space-xs);
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
  padding: var(--pav-space-sm) 0;
  font-size: var(--pav-font-size-sm);
  color: var(--pav-text-secondary);
}

.add-space-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--pav-space-1_5);
  width: 100%;
  padding: var(--pav-space-sm) var(--pav-space-3_5);
  border: var(--pav-border-width-1) dashed var(--pav-border-primary);
  background: transparent;
  color: var(--pav-text-secondary);
  border-radius: var(--pav-border-radius-md);
  font-size: var(--pav-font-size-sm);
  font-weight: var(--pav-font-weight-medium);
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;

  &:hover {
    background-color: var(--pav-interactive-hover);
    border-color: var(--pav-border-color-strong);
    color: var(--pav-text-primary);
  }

  &:focus-visible {
    outline: 2px solid var(--pav-color-orange-500);
    outline-offset: 2px;
  }
}
</style>

<template>
  <div class="spaces-editor">
    <!-- Spaces list (working buffer view; staged Spaces show '(new)').
         When editing an existing row, the inline editor replaces that
         row's list item so the row and the editor never appear side
         by side. Add-new renders the editor below the list. -->
    <ul
      v-if="spaces.length > 0"
      class="space-list"
    >
      <template
        v-for="space in spaces"
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
              v-if="!hideRemove"
              type="button"
              class="icon-button icon-button--danger delete-space-button"
              :aria-label="t('space.delete_space_button', { name: spaceDisplayName(space) })"
              @click="emit('remove-space', space)"
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
</template>

<script setup lang="ts">
/**
 * SpacesEditor — list + inline-editor surface for the Spaces (rooms) of an
 * EventLocation (Place). Extracted from edit-place.vue's room-list section so
 * it can be reused by the inline create-location flow.
 *
 * Removal-policy-agnostic by design: the component never reads `eventCount`
 * and never opens a reassign dialog. When the user clicks the delete button
 * on a row, the component emits `remove-space` and lets the parent decide
 * whether to confirm, reassign events, and finally drop the row from the
 * v-modeled `spaces` array. Adds and edits emit `update:spaces` directly
 * because they require no parent intervention.
 *
 * The component manages its own inline-editor state machine (open/closed,
 * which row is being edited) but keeps the `spaces` array itself owned by
 * the parent via v-model.
 */
import { ref, computed, nextTick } from 'vue';
import { useTranslation } from 'i18next-vue';
import i18next from 'i18next';
import { Pencil, Plus, Trash2 } from 'lucide-vue-next';
import EditSpace from '@/client/components/logged_in/calendar/edit-space.vue';
import { EventLocationSpace } from '@/common/model/location';

const props = withDefaults(
  defineProps<{
    spaces: EventLocationSpace[];
    /**
     * When true, the per-row delete button is not rendered. The component
     * still emits `remove-space` programmatically if a parent calls it, but
     * the editor's own UI offers no removal affordance — used by consumers
     * (like the add-space sheet) where deletion is handled in a dedicated
     * full place editor and would be out of scope here.
     */
    hideRemove?: boolean;
  }>(),
  {
    hideRemove: false,
  },
);

const emit = defineEmits<{
  (e: 'update:spaces', value: EventLocationSpace[]): void;
  (e: 'remove-space', space: EventLocationSpace): void;
}>();

const { t } = useTranslation('calendars', {
  keyPrefix: 'places',
});

// Reactive view of the current UI language so multilingual content updates
// when the user switches the app language at runtime.
const uiLanguage = computed(() => i18next.language ?? 'en');

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

// Ref into the Add button — used to restore focus on editor close.
const addSpaceButtonRef = ref<HTMLElement | null>(null);

/**
 * Stable per-row key for the Spaces list. Existing Spaces have a server id;
 * staged Spaces have a clientId.
 */
function spaceRowKey(space: EventLocationSpace): string {
  return space.id || (space.clientId ?? '');
}

/**
 * True when this Space is staged-but-unsaved — used to decorate the list with
 * a '(new)' affordance.
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
 * (the server echoes `clientId` on every newly-created Space row).
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
 * Merge a staged Space content payload into the spaces array. Called when the
 * inline editor emits its save event with a freshly-built `EventLocationSpace`.
 *
 * - Edit mode (`editingSpaceId` set): replace the matching entry. Identity is
 *   keyed on the row key (server `id` for already-saved Spaces, `clientId`
 *   for staged-but-unsaved ones).
 * - Create mode (`editingSpaceId` null): stamp a fresh `clientId` and append.
 *
 * Emits `update:spaces` with the new array so the parent's v-model receives
 * the mutation. The parent commits the resulting snapshot atomically on save.
 */
function handleSpaceSaved(staged: EventLocationSpace) {
  const editingKey = editingSpaceId.value;
  let next: EventLocationSpace[];

  if (editingKey) {
    // Edit mode: replace the matching entry. Preserve the row's existing
    // identity (server id and/or clientId) — the staged payload already
    // carries them through, so a wholesale replace is correct.
    next = props.spaces.map(s =>
      spaceRowKey(s) === editingKey ? staged : s,
    );
  }
  else {
    // Create mode: stamp a fresh clientId so the row has a stable key in the
    // working buffer until the server echoes back its assigned id.
    if (!staged.clientId) {
      staged.clientId = generateClientId();
    }
    next = [...props.spaces, staged];
  }

  emit('update:spaces', next);
  closeSpaceEditor();
}
</script>
