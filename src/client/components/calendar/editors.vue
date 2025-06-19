<template>
  <div class="editors-management">
    <div class="editors-header">
      <h3>{{ t('title') }}</h3>
      <button
        type="button"
        class="primary add-editor-btn"
        @click="state.showAddForm = true"
        :disabled="state.isLoading"
      >
        {{ t('add_editor_button') }}
      </button>
    </div>

    <!-- Error Display -->
    <div v-if="state.error" class="error">
      {{ state.error }}
    </div>

    <!-- Loading State -->
    <div v-if="state.isLoading" class="loading">
      {{ t('loading') }}
    </div>

    <!-- Editors List -->
    <div v-else-if="state.editors.length > 0" class="editors-list">
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
    <div v-else class="empty-state">
      <p>{{ t('no_editors') }}</p>
    </div>

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
      <div class="confirm-remove">
        <p>{{ t('confirm_remove_message', { email: state.editorToRemove.email }) }}</p>

        <div class="form-actions">
          <button
            type="button"
            class="danger"
            @click="removeEditor"
            :disabled="state.isRemoving"
          >
            {{ state.isRemoving ? t('removing') : t('confirm_remove_button') }}
          </button>
          <button
            type="button"
            @click="cancelRemoveEditor"
            :disabled="state.isRemoving"
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
import CalendarService from '../../service/calendar';
import ModalLayout from '../modal.vue';
import { CalendarEditorPermissionError, EditorAlreadyExistsError, EditorNotFoundError } from '@/common/exceptions/editor';
import { EmptyValueError } from '@/common/exceptions';

// Props
const props = defineProps({
  calendarId: {
    type: String,
    required: true,
  },
});

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
  if (state.isAdding) return; // Don't close if operation in progress

  state.showAddForm = false;
  state.newAccountId = '';
  state.addError = '';
};

/**
 * Add a new editor
 */
const addEditor = async () => {
  if (!state.newAccountId.trim()) {
    state.addError = t('error_empty_account_id');
    return;
  }

  try {
    state.isAdding = true;
    state.addError = '';

    const editor = await calendarService.grantEditAccess(props.calendarId, state.newAccountId.trim());
    state.editors.push(editor);

    // Reset state before closing form
    state.isAdding = false;
    closeAddForm();
  }
  catch (error) {
    console.error('Error adding editor:', error);

    if (error instanceof EmptyValueError) {
      state.addError = t('error_empty_account_id');
    }
    else if (error instanceof EditorAlreadyExistsError) {
      state.addError = t('error_editor_already_exists');
    }
    else if (error instanceof CalendarEditorPermissionError) {
      state.addError = t('error_permission_denied');
    }
    else {
      state.addError = t('error_adding_editor');
    }

    state.isAdding = false;
  }
};

/**
 * Show confirmation modal before removing an editor
 */
const confirmRemoveEditor = (editor) => {
  state.editorToRemove = editor;
};

/**
 * Cancel the remove operation
 */
const cancelRemoveEditor = () => {
  if (state.isRemoving) return; // Don't close if operation in progress

  state.editorToRemove = null;
};

/**
 * Remove an editor
 */
const removeEditor = async () => {
  if (!state.editorToRemove) return;

  try {
    state.isRemoving = state.editorToRemove.id;

    await calendarService.revokeEditAccess(props.calendarId, state.editorToRemove.email);

    // Remove from local list
    const index = state.editors.findIndex(e => e.id === state.editorToRemove.id);
    if (index >= 0) {
      state.editors.splice(index, 1);
    }

    state.editorToRemove = null;
  }
  catch (error) {
    console.error('Error removing editor:', error);

    if (error instanceof EditorNotFoundError) {
      state.error = t('error_editor_not_found');
      // Remove from local list anyway since it doesn't exist on server
      const index = state.editors.findIndex(e => e.id === state.editorToRemove.id);
      if (index >= 0) {
        state.editors.splice(index, 1);
      }
      state.editorToRemove = null;
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
onMounted(() => {
  loadEditors();
});
</script>

<style scoped lang="scss">
@use '../../assets/mixins' as *;

.editors-management {
  background: white;
  border-radius: 8px;
  padding: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.editors-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  border-bottom: 1px solid #e5e7eb;
  padding-bottom: 16px;

  h3 {
    margin: 0;
    color: #1f2937;
    font-size: 1.25rem;
    font-weight: 600;
  }
}

.add-editor-btn {
  font-size: 14px;
  padding: 8px 16px;
}

.error {
  background-color: #fef2f2;
  border: 1px solid #fecaca;
  color: #dc2626;
  padding: 12px;
  border-radius: 6px;
  margin-bottom: 16px;
}

.loading {
  text-align: center;
  padding: 40px 20px;
  color: #6b7280;
}

.editors-list {
  .editor-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    margin-bottom: 8px;

    &:last-child {
      margin-bottom: 0;
    }

    .editor-info {
      .editor-account {
        font-weight: 500;
        color: #374151;
      }
    }

    .remove-btn {
      font-size: 14px;
      padding: 6px 12px;
    }
  }
}

.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: #6b7280;

  p {
    margin: 0;
    font-style: italic;
  }
}

.add-editor-form {
  .form-group {
    margin-bottom: 20px;

    label {
      display: block;
      margin-bottom: 6px;
      font-weight: 500;
      color: #374151;
    }

    input[type="text"] {
      width: 100%;
      font-size: 14pt;
      background-color: rgba(255, 255, 255, 0.5);
      border: 1px solid #d1d5db;
      border-radius: $form-input-border-radius;
      padding: 12px 16px;
      box-sizing: border-box;

      &:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      &:disabled {
        background-color: #f9fafb;
        color: #6b7280;
      }
    }

    .help-text {
      font-size: 12px;
      color: #6b7280;
      margin: 4px 0 0 0;
    }
  }

  .form-actions {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
    margin-top: 24px;
  }
}

.confirm-remove {
  p {
    margin-bottom: 24px;
    color: #374151;
  }

  .form-actions {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
  }
}

@include dark-mode {
  .editors-management {
    background: $dark-mode-bg-secondary;
  }

  .editors-header {
    border-bottom-color: #374151;

    h3 {
      color: $dark-mode-text;
    }
  }

  .error {
    background-color: #7f1d1d;
    border-color: #991b1b;
    color: #fca5a5;
  }

  .loading {
    color: #9ca3af;
  }

  .editors-list .editor-item {
    border-color: #374151;
    background: $dark-mode-bg;

    .editor-info .editor-account {
      color: $dark-mode-text;
    }
  }

  .empty-state {
    color: #9ca3af;
  }

  .add-editor-form .form-group {
    label {
      color: $dark-mode-text;
    }

    input[type="text"] {
      background-color: rgba(100, 100, 100, 0.2);
      border-color: #4b5563;
      color: $dark-mode-text;

      &:focus {
        border-color: #60a5fa;
        box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.1);
      }

      &:disabled {
        background-color: #1f2937;
        color: #6b7280;
      }
    }

    .help-text {
      color: #9ca3af;
    }
  }

  .confirm-remove p {
    color: $dark-mode-text;
  }
}
</style>
