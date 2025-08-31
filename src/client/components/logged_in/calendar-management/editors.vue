<template>
  <div class="editors-tab">

    <!-- Error Display -->
    <div v-if="state.error" class="error">
      {{ state.error }}
    </div>

    <!-- Loading State -->
    <LoadingMessage v-if="state.isLoading" :description="t('loading')" />

    <!-- Editors List -->
    <div v-else-if="state.editors.length > 0" class="editors-list">
      <div class="hstack--end">
        <button
          type="button"
          class="primary add-editor-btn"
          @click="openAddForm"
          :disabled="state.isLoading"
        >
          {{ t('add_editor_button') }}
        </button>
      </div>
      <div
        v-for="editor in state.editors"
        :key="editor.id"
        class="editor-item"
      >
        <div class="editor-info">
          <span class="editor-account">{{ editor.email }}</span>
        </div>
        <button
          type="button"
          class="danger remove-btn"
          @click="confirmRemoveEditor(editor)"
          :disabled="state.isRemoving === editor.id"
        >
          {{ state.isRemoving === editor.id ? t('removing') : t('remove_button') }}
        </button>
      </div>
    </div>

    <!-- Empty State -->
    <EmptyLayout v-else :title="t('no_editors')" :description="t('no_editors_description')">
      <button
        type="button"
        class="primary add-editor-btn"
        @click="openAddForm"
        :disabled="state.isLoading"
      >
        {{ t('add_editor_button') }}
      </button>
    </EmptyLayout>

    <!-- Add Editor Form -->
    <ModalLayout
      v-if="state.showAddForm"
      :title="t('add_editor_title')"
      @close="closeAddForm"
    >
      <div class="add-editor-form">
        <div class="form-group">
          <label for="email">{{ t('account_id_label') }}</label>
          <input
            id="email"
            type="text"
            v-model="state.newAccountId"
            :placeholder="t('account_id_placeholder')"
            :disabled="state.isAdding"
            @keyup.enter="addEditor"
            ref="emailInput"
          />
          <p class="help-text">{{ t('account_id_help') }}</p>
        </div>

        <div v-if="state.addError" class="error">
          {{ state.addError }}
        </div>

        <div class="form-actions">
          <button
            type="button"
            class="primary"
            @click="addEditor"
            :disabled="state.isAdding || !state.newAccountId.trim()"
          >
            {{ state.isAdding ? t('adding') : t('add_button') }}
          </button>
          <button
            type="button"
            @click="closeAddForm"
            :disabled="state.isAdding"
          >
            {{ t('cancel_button') }}
          </button>
        </div>
      </div>
    </ModalLayout>

    <!-- Remove Confirmation Modal -->
    <ModalLayout
      v-if="state.editorToRemove"
      :title="t('confirm_remove_title')"
      @close="cancelRemoveEditor"
    >
      <div class="remove-confirmation">
        <p>{{ t('confirm_remove_message', { email: state.editorToRemove.email }) }}</p>
        <div class="form-actions">
          <button
            type="button"
            class="danger"
            @click="removeEditor"
            :disabled="state.isRemoving === state.editorToRemove?.id"
          >
            {{ state.isRemoving === state.editorToRemove?.id ? t('removing') : t('remove_button') }}
          </button>
          <button
            type="button"
            @click="cancelRemoveEditor"
            :disabled="state.isRemoving === state.editorToRemove?.id"
          >
            {{ t('cancel_button') }}
          </button>
        </div>
      </div>
    </ModalLayout>
  </div>
</template>

<script setup>
import { reactive, onMounted, nextTick, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import CalendarService from '@/client/service/calendar';
import ModalLayout from '@/client/components/common/modal.vue';
import { CalendarEditorPermissionError, EditorAlreadyExistsError, EditorNotFoundError } from '@/common/exceptions/editor';
import { EmptyValueError } from '@/common/exceptions';
import EmptyLayout from '@/client/components/common/empty_state.vue';
import LoadingMessage from '@/client/components/common/loading_message.vue';

// Props
const props = defineProps({
  calendarId: {
    type: String,
    required: true,
  },
});

// Emit events
const emit = defineEmits(['editorsUpdated']);

// Translations
const { t } = useTranslation('calendars', {
  keyPrefix: 'editors',
});

// Services
const calendarService = new CalendarService();

// Component state
const state = reactive({
  editors: [],
  isLoading: false,
  error: '',
  showAddForm: false,
  newAccountId: '',
  isAdding: false,
  addError: '',
  editorToRemove: null,
  isRemoving: false,
});

// Refs for form focus
const emailInput = ref(null);

/**
 * Load editors for the calendar
 */
const loadEditors = async () => {
  try {
    state.isLoading = true;
    state.error = '';
    state.editors = await calendarService.listCalendarEditors(props.calendarId);
  }
  catch (error) {
    console.error('Error loading editors:', error);
    if (error instanceof CalendarEditorPermissionError) {
      state.error = t('error_permission_denied');
    }
    else {
      state.error = t('error_loading_editors');
    }
  }
  finally {
    state.isLoading = false;
  }
};

/**
 * Open the add editor form and focus the input
 */
const openAddForm = async () => {
  state.showAddForm = true;
  state.newAccountId = '';
  state.addError = '';

  // Focus the input after the modal is rendered
  await nextTick();
  if (emailInput.value) {
    emailInput.value.focus();
  }
};

/**
 * Close the add editor form
 */
const closeAddForm = () => {
  state.showAddForm = false;
  state.newAccountId = '';
  state.addError = '';
  state.isAdding = false;
};

/**
 * Add an editor to the calendar
 */
const addEditor = async () => {
  if (!state.newAccountId.trim()) {
    state.addError = t('account_id_required');
    return;
  }

  try {
    state.isAdding = true;
    state.addError = '';

    await calendarService.grantCalendarEditAccess(props.calendarId, state.newAccountId.trim());
    await loadEditors();
    closeAddForm();
    emit('editorsUpdated');
  }
  catch (error) {
    console.error('Error adding editor:', error);

    if (error instanceof EditorAlreadyExistsError) {
      state.addError = t('error_editor_already_exists');
    }
    else if (error instanceof CalendarEditorPermissionError) {
      state.addError = t('error_permission_denied');
    }
    else if (error instanceof EmptyValueError) {
      state.addError = t('account_id_required');
    }
    else {
      state.addError = t('error_adding_editor');
    }
  }
  finally {
    state.isAdding = false;
  }
};

/**
 * Confirm removing an editor
 */
const confirmRemoveEditor = (editor) => {
  state.editorToRemove = editor;
};

/**
 * Cancel removing an editor
 */
const cancelRemoveEditor = () => {
  state.editorToRemove = null;
  state.isRemoving = false;
};

/**
 * Remove an editor from the calendar
 */
const removeEditor = async () => {
  if (!state.editorToRemove) {
    return;
  }

  try {
    state.isRemoving = state.editorToRemove.id;

    await calendarService.revokeCalendarEditAccess(props.calendarId, state.editorToRemove.accountId);
    await loadEditors();
    cancelRemoveEditor();
    emit('editorsUpdated');
  }
  catch (error) {
    console.error('Error removing editor:', error);

    if (error instanceof EditorNotFoundError) {
      state.error = t('error_editor_not_found');
    }
    else if (error instanceof CalendarEditorPermissionError) {
      state.error = t('error_permission_denied');
    }
    else {
      state.error = t('error_removing_editor');
    }
  }
  finally {
    state.isRemoving = false;
  }
};

// Load editors when component mounts
onMounted(loadEditors);
</script>

<style scoped lang="scss">
// @use '../../../assets/mixins' as *;

.editors-tab {
  .editors-header {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 24px;
  }

  .editors-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .editor-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    transition: border-color 0.2s ease;

    &:hover {
      border-color: var(--color-border-hover);
    }
  }

  .editor-info {
    flex: 1;

    .editor-account {
      font-weight: 500;
      color: var(--color-text);
    }
  }

  .remove-btn {
    padding: 6px 12px;
    font-size: 14px;
  }

  .empty-state {
    text-align: center;
    padding: 48px 24px;
    color: var(--color-text-secondary);

    p {
      margin: 0 0 8px 0;

      &.description {
        font-size: 14px;
        color: var(--color-text-tertiary);
      }
    }
  }

  .add-editor-form {
    .form-group {
      margin-bottom: 20px;

      label {
        display: block;
        margin-bottom: 6px;
        font-weight: 500;
        color: var(--color-text);
      }

      input {
        width: 100%;
        padding: 10px 12px;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        font-size: 14px;

        &:focus {
          outline: none;
          border-color: var(--color-primary);
          box-shadow: 0 0 0 3px rgba(234, 88, 12, 0.1);
        }

        &:disabled {
          background-color: var(--color-surface-secondary);
          cursor: not-allowed;
        }
      }

      .help-text {
        margin: 6px 0 0 0;
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
    }

    .form-actions {
      display: flex;
      gap: 12px;
      justify-content: flex-end;
      margin-top: 24px;
    }
  }

  .remove-confirmation {
    p {
      margin: 0 0 24px 0;
      color: var(--color-text);
    }

    .form-actions {
      display: flex;
      gap: 12px;
      justify-content: flex-end;
    }
  }

  .error {
    padding: 12px;
    margin-bottom: 16px;
    background-color: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: 6px;
    color: rgb(153, 27, 27);
    font-size: 14px;
  }

  .loading {
    text-align: center;
    padding: 48px 24px;
    color: var(--color-text-secondary);
  }
}
</style>
