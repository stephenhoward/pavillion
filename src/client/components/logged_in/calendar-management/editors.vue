<template>
  <div class="editors-tab">

    <!-- Error Display -->
    <div v-if="state.error" class="alert alert--error">
      {{ state.error }}
    </div>

    <!-- Success Display -->
    <div v-if="state.success" class="alert alert--success">
      {{ state.success }}
    </div>

    <!-- Loading State -->
    <LoadingMessage v-if="state.isLoading" :description="t('loading')" />

    <!-- Editors and Invitations List -->
    <div v-else-if="state.editors.length > 0 || state.pendingInvitations.length > 0" class="editors-content">
      <!-- Section Header -->
      <div class="editors-header">
        <h2 class="editors-title">{{ t('calendar_editors') }}</h2>
        <PillButton variant="primary" @click="openAddForm">
          <Plus :size="20" :stroke-width="2" />
          {{ t('add_editor_button') }}
        </PillButton>
      </div>

      <!-- Active Editors Section -->
      <div v-if="state.editors.length > 0" class="editors-section">
        <h3 class="section-label">{{ t('editors_label') }}</h3>
        <div
          v-for="editor in state.editors"
          :key="editor.id"
          class="editor-card"
          :class="{ 'is-removing': state.isRemoving === editor.id }"
        >
          <div class="editor-avatar"></div>
          <div class="editor-info">
            <div class="editor-name-row">
              <span class="editor-name">{{ editor.email }}</span>
            </div>
            <span class="editor-email">{{ editor.email }}</span>
          </div>
          <div class="editor-actions">
            <button
              type="button"
              class="btn-ghost"
              @click="confirmRemoveEditor(editor)"
              :disabled="state.isRemoving === editor.id"
            >
              {{ state.isRemoving === editor.id ? t('removing') : t('remove_button') }}
            </button>
          </div>
        </div>

        <!-- Leave Calendar Button -->
        <div v-if="canLeaveCalendar()" class="leave-calendar-section">
          <button
            type="button"
            class="btn-ghost btn-ghost--danger"
            @click="confirmLeaveCalendar"
            :disabled="state.isLeavingCalendar"
          >
            {{ state.isLeavingCalendar ? t('leaving') : t('leave_calendar_button') }}
          </button>
        </div>
      </div>

      <!-- Pending Invitations Section -->
      <div v-if="state.pendingInvitations.length > 0" class="editors-section">
        <h3 class="section-label">{{ t('pending_invitations') }}</h3>
        <div
          v-for="invitation in state.pendingInvitations"
          :key="invitation.id"
          class="editor-card editor-card--invitation"
          :class="{ 'is-processing': state.invitationOperations[invitation.id] }"
        >
          <div class="invitation-icon">
            <Mail :size="20" :stroke-width="2" />
          </div>
          <div class="editor-info">
            <div class="editor-name">{{ invitation.email }}</div>
            <div class="invitation-status">{{ t('invitation_pending') }}</div>
          </div>
          <div class="editor-actions">
            <button
              type="button"
              class="btn-text btn-text--primary"
              @click="resendInvitation(invitation.id)"
              :disabled="state.invitationOperations[invitation.id]"
            >
              {{ state.invitationOperations[invitation.id] === 'resending' ? t('resending') : t('resend_button') }}
            </button>
            <button
              type="button"
              class="btn-text"
              @click="cancelInvitation(invitation.id)"
              :disabled="state.invitationOperations[invitation.id]"
            >
              {{ state.invitationOperations[invitation.id] === 'canceling' ? t('canceling') : t('cancel_button') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <EmptyLayout v-else :title="t('no_editors')" :description="t('no_editors_description')">
      <PillButton variant="primary" @click="openAddForm">
        <Plus :size="20" :stroke-width="2" />
        {{ t('add_editor_button') }}
      </PillButton>
    </EmptyLayout>

    <!-- Add Editor Form -->
    <ModalLayout
      v-if="state.showAddForm"
      :title="t('add_editor_title')"
      @close="closeAddForm"
    >
      <div class="add-editor-form">
        <div v-if="state.addError" class="alert alert--error">
          {{ state.addError }}
        </div>

        <div class="form-group">
          <label for="email">{{ t('account_id_label') }}</label>
          <input
            id="email"
            type="text"
            class="form-input"
            v-model="state.newAccountId"
            :placeholder="t('account_id_placeholder')"
            :disabled="state.isAdding"
            @keyup.enter="addEditor"
            ref="emailInput"
          />
          <p class="help-text">{{ t('account_id_help') }}</p>
        </div>

        <div class="form-actions">
          <button
            type="button"
            class="btn-ghost"
            @click="closeAddForm"
            :disabled="state.isAdding"
          >
            {{ t('cancel_button') }}
          </button>
          <PillButton
            variant="primary"
            @click="addEditor"
            :disabled="state.isAdding || !state.newAccountId.trim()"
          >
            {{ state.isAdding ? t('adding') : t('add_editor_button') }}
          </PillButton>
        </div>
      </div>
    </ModalLayout>

    <!-- Remove Confirmation Modal -->
    <ModalLayout
      v-if="state.editorToRemove"
      :title="t('confirm_remove_title')"
      @close="cancelRemoveEditor"
    >
      <div class="confirmation-modal">
        <p>{{ t('confirm_remove_message', { email: state.editorToRemove.email }) }}</p>
        <div class="form-actions">
          <button
            type="button"
            class="btn-ghost"
            @click="cancelRemoveEditor"
            :disabled="state.isRemoving === state.editorToRemove?.id"
          >
            {{ t('cancel_button') }}
          </button>
          <PillButton
            variant="danger"
            @click="removeEditor"
            :disabled="state.isRemoving === state.editorToRemove?.id"
          >
            {{ state.isRemoving === state.editorToRemove?.id ? t('removing') : t('remove_button') }}
          </PillButton>
        </div>
      </div>
    </ModalLayout>

    <!-- Leave Calendar Confirmation Modal -->
    <ModalLayout
      v-if="state.showLeaveConfirm"
      :title="t('confirm_leave_title')"
      @close="cancelLeaveCalendar"
    >
      <div class="confirmation-modal">
        <p>{{ t('confirm_leave_message') }}</p>
        <div class="form-actions">
          <button
            type="button"
            class="btn-ghost"
            @click="cancelLeaveCalendar"
            :disabled="state.isLeavingCalendar"
          >
            {{ t('cancel_button') }}
          </button>
          <PillButton
            variant="danger"
            @click="leaveCalendar"
            :disabled="state.isLeavingCalendar"
          >
            {{ state.isLeavingCalendar ? t('leaving') : t('leave_calendar_button') }}
          </PillButton>
        </div>
      </div>
    </ModalLayout>
  </div>
</template>

<script setup>
import { reactive, onMounted, nextTick, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import { Plus, Crown, Globe, Mail, ArrowUp, Trash2, X } from 'lucide-vue-next';
import CalendarService from '@/client/service/calendar';
import AuthenticationService from '@/client/service/authn';
import ModalLayout from '@/client/components/common/modal.vue';
import PillButton from '@/client/components/common/PillButton.vue';
import { CalendarEditorPermissionError, EditorAlreadyExistsError, EditorNotFoundError } from '@/common/exceptions/editor';
import { EmptyValueError, AccountInviteAlreadyExistsError } from '@/common/exceptions';
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
const authService = new AuthenticationService(localStorage);

// Get current user email
const currentUserEmail = authService.userEmail();

// Component state
const state = reactive({
  editors: [],
  pendingInvitations: [],
  isLoading: false,
  error: '',
  success: '',
  showAddForm: false,
  newAccountId: '',
  isAdding: false,
  addError: '',
  editorToRemove: null,
  isRemoving: false,
  isLeavingCalendar: false,
  showLeaveConfirm: false,
  invitationOperations: {}, // Track loading states for invitation operations
});

// Refs for form focus
const emailInput = ref(null);

/**
 * Check if current user is an editor (but not owner) of this calendar
 */
const isCurrentUserEditor = () => {
  if (!currentUserEmail) return false;
  return state.editors.some(editor => editor.email === currentUserEmail);
};

/**
 * Check if the current user can leave the calendar
 * (is an editor but not owner - this is determined on the backend)
 */
const canLeaveCalendar = () => {
  return currentUserEmail && isCurrentUserEditor();
};

/**
 * Clear messages with a timeout
 */
const clearMessages = (delay = 5000) => {
  setTimeout(() => {
    state.error = '';
    state.success = '';
  }, delay);
};

/**
 * Load editors for the calendar
 */
const loadEditors = async () => {
  try {
    state.isLoading = true;
    state.error = '';
    state.success = '';
    const response = await calendarService.listCalendarEditors(props.calendarId);
    state.editors = response.activeEditors;
    state.pendingInvitations = response.pendingInvitations;
  }
  catch (error) {
    console.error('Error loading editors:', error);
    if (error instanceof CalendarEditorPermissionError) {
      state.error = t('error_permission_denied');
    }
    else {
      state.error = t('error_loading_editors');
    }
    clearMessages();
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
  state.error = ''; // Clear any global errors
  state.success = ''; // Clear any success messages

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
  // Prevent closing the form while an operation is in progress
  if (state.isAdding) {
    return;
  }

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

    await calendarService.grantEditAccess(props.calendarId, state.newAccountId.trim());
    await loadEditors();

    // Show success message
    state.success = t('editor_added_success', { email: state.newAccountId.trim() });
    clearMessages();

    // Reset isAdding before closing form on success
    state.isAdding = false;
    closeAddForm();
    emit('editorsUpdated');
  }
  catch (error) {
    console.error('Error adding editor:', error);

    if (error instanceof EditorAlreadyExistsError) {
      state.addError = t('error_editor_already_exists');
    }
    else if (error instanceof AccountInviteAlreadyExistsError) {
      state.addError = t('error_invite_already_exists');
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

    // Reset isAdding in error case
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

  const editorEmail = state.editorToRemove.email;

  try {
    state.isRemoving = state.editorToRemove.id;

    await calendarService.revokeEditAccess(props.calendarId, state.editorToRemove.id);
    await loadEditors();

    // Show success message
    state.success = t('editor_removed_success', { email: editorEmail });
    clearMessages();

    cancelRemoveEditor();
    emit('editorsUpdated');
  }
  catch (error) {
    console.error('Error removing editor:', error);

    if (error instanceof EditorNotFoundError) {
      state.error = t('error_editor_not_found');
      // If the editor is not found on the server, remove it from our local list
      // to keep the UI in sync with the server state
      state.editors = state.editors.filter(editor => editor.id !== state.editorToRemove.id);
      cancelRemoveEditor();
      emit('editorsUpdated');
    }
    else if (error instanceof CalendarEditorPermissionError) {
      state.error = t('error_permission_denied');
    }
    else {
      state.error = t('error_removing_editor');
    }
    clearMessages();
  }
  finally {
    state.isRemoving = false;
  }
};

/**
 * Show confirmation for leaving calendar
 */
const confirmLeaveCalendar = () => {
  state.showLeaveConfirm = true;
};

/**
 * Cancel leaving calendar
 */
const cancelLeaveCalendar = () => {
  state.showLeaveConfirm = false;
  state.isLeavingCalendar = false;
};

/**
 * Leave the calendar (self-removal using unified revoke API)
 */
const leaveCalendar = async () => {
  try {
    state.isLeavingCalendar = true;

    // Find the current user's editor record to get their account ID
    const currentEditor = state.editors.find(editor => editor.email === currentUserEmail);
    if (!currentEditor) {
      state.error = t('editor_not_found');
      return;
    }

    // Use the revoke endpoint for self-removal
    await calendarService.revokeEditAccess(props.calendarId, currentEditor.id);

    // After leaving, we should redirect or refresh the page
    // since the user is no longer an editor
    window.location.href = '/';
  }
  catch (error) {
    console.error('Error leaving calendar:', error);

    if (error instanceof CalendarEditorPermissionError) {
      state.error = t('error_permission_denied');
    }
    else {
      state.error = t('error_leaving_calendar');
    }
  }
  finally {
    state.isLeavingCalendar = false;
    state.showLeaveConfirm = false;
  }
};

/**
 * Cancel a pending invitation
 */
const cancelInvitation = async (invitationId) => {
  try {
    state.invitationOperations[invitationId] = 'canceling';

    await calendarService.cancelInvitation(props.calendarId, invitationId);
    await loadEditors();

    // Show success message
    state.success = t('invitation_canceled_success');
    clearMessages();

    emit('editorsUpdated');
  }
  catch (error) {
    console.error('Error canceling invitation:', error);
    state.error = t('error_canceling_invitation');
    clearMessages();
  }
  finally {
    delete state.invitationOperations[invitationId];
  }
};

/**
 * Resend a pending invitation
 */
const resendInvitation = async (invitationId) => {
  try {
    state.invitationOperations[invitationId] = 'resending';

    await calendarService.resendInvitation(props.calendarId, invitationId);

    // Show success message
    state.success = t('invitation_resent_success');
    clearMessages();
  }
  catch (error) {
    console.error('Error resending invitation:', error);
    state.error = t('error_resending_invitation');
    clearMessages();
  }
  finally {
    delete state.invitationOperations[invitationId];
  }
};

// Load editors when component mounts
onMounted(loadEditors);
</script>

<style scoped lang="scss">
@use '../../../assets/style/components/calendar-admin' as *;

.editors-tab {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-6);
}

.editors-content {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-8);
}

.editors-header {
  @include admin-section-header;
}

.editors-title {
  @include admin-section-title;
}

.editors-section {
  @include admin-section;
}

.section-label {
  @include admin-section-label;
}

.editor-card {
  @include admin-card;

  &.editor-card--invitation {
    border-style: dashed;
  }

  &.is-removing,
  &.is-processing {
    opacity: 0.6;
    pointer-events: none;
  }
}

.editor-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--pav-color-stone-300);
  flex-shrink: 0;

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-700);
  }
}

.invitation-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--pav-color-stone-100);
  color: var(--pav-color-stone-400);
  flex-shrink: 0;

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-800);
    color: var(--pav-color-stone-500);
  }
}

.editor-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-1);
  min-width: 0;
}

.editor-name-row {
  display: flex;
  align-items: center;
  gap: var(--pav-space-2);
}

.editor-name {
  font-weight: 500;
  color: var(--pav-color-stone-900);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-100);
  }
}

.editor-email {
  font-size: 0.875rem;
  color: var(--pav-color-stone-600);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.owner-badge {
  @include admin-badge-orange;
  display: inline-flex;
  align-items: center;
  gap: var(--pav-space-1);
}

.federated-badge {
  @include admin-badge-sky;
}

.invitation-status {
  font-size: 0.875rem;
  color: var(--pav-color-stone-500);
}

.editor-actions {
  display: flex;
  gap: var(--pav-space-2);
  align-items: center;
}

.btn-ghost {
  padding: var(--pav-space-2) var(--pav-space-4);
  background: none;
  border: none;
  color: var(--pav-color-stone-600);
  font-weight: 500;
  cursor: pointer;
  transition: color 0.2s;
  border-radius: 0.375rem;

  &:hover {
    color: var(--pav-color-stone-900);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-100);
    }
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &.btn-ghost--danger {
    color: var(--pav-color-red-600);

    &:hover {
      color: var(--pav-color-red-700);

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-red-400);
      }
    }
  }
}

.btn-text {
  padding: var(--pav-space-1) var(--pav-space-2);
  background: none;
  border: none;
  color: var(--pav-color-stone-600);
  font-weight: 500;
  cursor: pointer;
  transition: color 0.2s;
  font-size: 0.875rem;

  &:hover {
    color: var(--pav-color-stone-900);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-100);
    }
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &.btn-text--primary {
    color: var(--pav-color-orange-600);

    &:hover {
      color: var(--pav-color-orange-700);

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-orange-400);
      }
    }
  }
}

.leave-calendar-section {
  margin-top: var(--pav-space-4);
  padding-top: var(--pav-space-4);
  border-top: 1px solid var(--pav-border-primary);
}

.add-editor-form {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-2);

  label {
    font-weight: 500;
    font-size: 0.875rem;
    color: var(--pav-color-stone-700);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-300);
    }
  }

  .form-input {
    @include admin-form-input;
  }

  .help-text {
    margin: 0;
    color: var(--pav-color-stone-600);
    font-size: 0.875rem;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }
}

.form-actions {
  display: flex;
  gap: var(--pav-space-3);
  justify-content: flex-end;
  margin-top: var(--pav-space-4);
  padding-top: var(--pav-space-4);
  border-top: 1px solid var(--pav-border-primary);
}

.confirmation-modal {
  p {
    margin: 0 0 var(--pav-space-6) 0;
    color: var(--pav-text-primary);
    line-height: 1.5;
  }
}

.alert {
  padding: var(--pav-space-3);
  margin-bottom: var(--pav-space-4);
  border-radius: 0.75rem;
  font-size: 0.875rem;

  &.alert--error {
    background-color: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.2);
    color: var(--pav-color-red-700);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-red-400);
    }
  }

  &.alert--success {
    background-color: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.2);
    color: var(--pav-color-green-700);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-green-400);
    }
  }
}
</style>
