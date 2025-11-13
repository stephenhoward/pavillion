<template>
  <div class="editors-tab">

    <!-- Error Display -->
    <div v-if="state.error" class="error">
      {{ state.error }}
    </div>

    <!-- Success Display -->
    <div v-if="state.success" class="success">
      {{ state.success }}
    </div>

    <!-- Loading State -->
    <LoadingMessage v-if="state.isLoading" :description="t('loading')" />

    <!-- Editors and Invitations List -->
    <div v-else-if="state.editors.length > 0 || state.pendingInvitations.length > 0" class="editors-list">
      <div class="hstack--end">
        <button
          v-if="canLeaveCalendar()"
          type="button"
          class="secondary leave-calendar-btn"
          @click="confirmLeaveCalendar"
          :disabled="state.isLeavingCalendar"
        >
          <span v-if="state.isLeavingCalendar" class="loading-spinner"/>
          {{ state.isLeavingCalendar ? t('leaving') : t('leave_calendar_button') }}
        </button>
        <button
          type="button"
          class="primary add-editor-btn"
          @click="openAddForm"
          :disabled="state.isLoading || state.isAdding"
        >
          {{ t('add_editor_button') }}
        </button>
      </div>

      <!-- Active Editors Section -->
      <div v-if="state.editors.length > 0" class="section active-editors">
        <h3 class="section-title">{{ t('active_editors_title') }}</h3>
        <div
          v-for="editor in state.editors"
          :key="editor.id"
          class="editor-item"
          :class="{ 'is-removing': state.isRemoving === editor.id }"
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
            <span v-if="state.isRemoving === editor.id" class="loading-spinner"/>
            {{ state.isRemoving === editor.id ? t('removing') : t('remove_button') }}
          </button>
        </div>
      </div>

      <!-- Pending Invitations Section -->
      <div v-if="state.pendingInvitations.length > 0" class="section pending-invitations">
        <h3 class="section-title">{{ t('pending_invitations_title') }}</h3>
        <div
          v-for="invitation in state.pendingInvitations"
          :key="invitation.id"
          class="editor-item invitation-item"
          :class="{ 'is-processing': state.invitationOperations[invitation.id] }"
        >
          <div class="editor-info">
            <span class="editor-account">{{ invitation.email }}</span>
          </div>
          <div class="invitation-actions">
            <button
              type="button"
              class="secondary resend-btn"
              @click="resendInvitation(invitation.id)"
              :disabled="state.invitationOperations[invitation.id]"
            >
              <span v-if="state.invitationOperations[invitation.id] === 'resending'" class="loading-spinner"/>
              {{ state.invitationOperations[invitation.id] === 'resending' ? t('resending') : t('resend_button') }}
            </button>
            <button
              type="button"
              class="danger cancel-btn"
              @click="cancelInvitation(invitation.id)"
              :disabled="state.invitationOperations[invitation.id]"
            >
              <span v-if="state.invitationOperations[invitation.id] === 'canceling'" class="loading-spinner"/>
              {{ state.invitationOperations[invitation.id] === 'canceling' ? t('canceling') : t('cancel_button') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <EmptyLayout v-else :title="t('no_editors')" :description="t('no_editors_description')">
      <button
        type="button"
        class="primary add-editor-btn"
        @click="openAddForm"
        :disabled="state.isLoading || state.isAdding"
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
            <span v-if="state.isAdding" class="loading-spinner"/>
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
            <span v-if="state.isRemoving === state.editorToRemove?.id" class="loading-spinner"/>
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

    <!-- Leave Calendar Confirmation Modal -->
    <ModalLayout
      v-if="state.showLeaveConfirm"
      :title="t('confirm_leave_title')"
      @close="cancelLeaveCalendar"
    >
      <div class="leave-confirmation">
        <p>{{ t('confirm_leave_message') }}</p>
        <div class="form-actions">
          <button
            type="button"
            class="danger"
            @click="leaveCalendar"
            :disabled="state.isLeavingCalendar"
          >
            <span v-if="state.isLeavingCalendar" class="loading-spinner"/>
            {{ state.isLeavingCalendar ? t('leaving') : t('leave_calendar_button') }}
          </button>
          <button
            type="button"
            @click="cancelLeaveCalendar"
            :disabled="state.isLeavingCalendar"
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
import AuthenticationService from '@/client/service/authn';
import ModalLayout from '@/client/components/common/modal.vue';
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
@use '../../../assets/mixins' as *;

.editors-tab {
  .editors-header {
    display: flex;
    justify-content: flex-end;
    margin-bottom: $spacing-2xl;
  }

  .editors-list {
    display: flex;
    flex-direction: column;
    gap: $spacing-md;
    max-width: 800px;
    margin: 0 auto;

    // Add horizontal padding on mobile for better spacing
    @media (max-width: 480px) {
      padding: 0 $spacing-sm;
    }

    .hstack--end {
      display: flex;
      gap: $spacing-md;
      justify-content: flex-end;
      margin-bottom: $spacing-lg;
      flex-wrap: wrap;

      @media (max-width: 480px) {
        flex-direction: column;
        align-items: stretch;

        button {
          width: 100%;
          min-height: 44px; // Better touch target size
        }
      }
    }

    .leave-calendar-btn {
      padding: $spacing-sm $spacing-lg;
      font-size: 14px;
      transition: all 0.2s ease;

      &:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    }
  }

  .editor-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: $spacing-lg;
    background: $light-mode-panel-background;
    transition: all 0.2s ease;
    position: relative;
    overflow: hidden;

    @include dark-mode {
      background: $dark-mode-panel-background;
      border-color: $dark-mode-border;
    }

    // Add loading overlay when removing
    &.is-removing {
      opacity: 0.7;
      pointer-events: none;

      &::after {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(
          90deg,
          transparent 0%,
          rgba(255, 255, 255, 0.3) 50%,
          transparent 100%
        );
        animation: shimmer 1.5s infinite;
      }
    }

    // Tablet layout adjustments
    @media (max-width: 768px) {
      padding: $spacing-md;
    }

    // Mobile layout - stack elements
    @media (max-width: 576px) {
      flex-direction: column;
      align-items: flex-start;
      gap: $spacing-md;
      padding: $spacing-lg $spacing-md;
    }
  }

  .editor-info {
    flex: 1;
    min-width: 0; // Allow text truncation

    .editor-account {
      font-weight: $font-medium;
      color: $light-mode-text;
      word-break: break-word;
      display: flex;
      align-items: center;
      min-width: 0; // Allow text truncation

      @include dark-mode {
        color: $dark-mode-text;
      }

      // Add icon before email for better visual hierarchy
      &::before {
        content: '👤';
        margin-right: $spacing-sm;
        opacity: 0.7;
        flex-shrink: 0; // Prevent icon from shrinking
      }

      // On mobile, make text smaller if needed
      @media (max-width: 480px) {
        font-size: 14px;
      }
    }
  }

  .remove-btn {
    padding: $spacing-sm $spacing-lg;
    font-size: 14px;
    white-space: nowrap;
    transition: all 0.2s ease;

    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    @media (max-width: 576px) {
      align-self: flex-end;
      width: 100%;
    }
  }

  @keyframes shimmer {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(100%);
    }
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
      margin-bottom: $spacing-xl;

      label {
        display: block;
        margin-bottom: $spacing-sm;
        font-weight: $font-medium;
        color: $light-mode-text;

        @include dark-mode {
          color: $dark-mode-text;
        }
      }

      input {
        width: 100%;
        padding: $spacing-md $spacing-lg;
        border: 1px solid $light-mode-border;
        border-radius: $component-border-radius-small;
        font-size: 16px; // Prevent iOS zoom on focus
        background: $light-mode-panel-background;
        color: $light-mode-text;
        transition: all 0.2s ease;
        min-height: 44px; // Better touch target size

        @include dark-mode {
          background: $dark-mode-input-background;
          border-color: $dark-mode-border;
          color: $dark-mode-input-text;
        }

        &:focus {
          outline: none;
          border-color: $focus-color;
          box-shadow: 0 0 0 3px rgba($focus-color, 0.1);

          @include dark-mode {
            border-color: $focus-color-dark;
            box-shadow: 0 0 0 3px rgba($focus-color-dark, 0.1);
          }
        }

        &:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          background: rgba(0, 0, 0, 0.05);

          @include dark-mode {
            background: rgba(255, 255, 255, 0.05);
          }
        }
      }

      .help-text {
        margin: $spacing-sm 0 0 0;
        font-size: 12px;
        color: $light-mode-secondary-text;

        @include dark-mode {
          color: $dark-mode-secondary-text;
        }
      }
    }

    .form-actions {
      display: flex;
      gap: $spacing-md;
      justify-content: flex-end;
      margin-top: $spacing-2xl;

      @media (max-width: 480px) {
        flex-direction: column-reverse;

        button {
          width: 100%;
        }
      }
    }
  }

  .remove-confirmation {
    p {
      margin: 0 0 $spacing-2xl 0;
      color: $light-mode-text;
      line-height: 1.5;

      @include dark-mode {
        color: $dark-mode-text;
      }
    }

    .form-actions {
      display: flex;
      gap: $spacing-md;
      justify-content: flex-end;

      @media (max-width: 480px) {
        flex-direction: column-reverse;

        button {
          width: 100%;
        }
      }
    }
  }

  .leave-confirmation {
    p {
      margin: 0 0 $spacing-2xl 0;
      color: $light-mode-text;
      line-height: 1.5;

      @include dark-mode {
        color: $dark-mode-text;
      }
    }

    .form-actions {
      display: flex;
      gap: $spacing-md;
      justify-content: flex-end;

      @media (max-width: 480px) {
        flex-direction: column-reverse;

        button {
          width: 100%;
        }
      }
    }
  }

  .error {
    padding: $spacing-lg;
    margin-bottom: $spacing-lg;
    background-color: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.25);
    border-radius: $component-border-radius-small;
    color: rgb(153, 27, 27);
    font-size: 14px;
    line-height: 1.4;
    border-left: 4px solid rgba(239, 68, 68, 0.5);
    animation: slideIn 0.3s ease;

    @include dark-mode {
      background-color: rgba(239, 68, 68, 0.15);
      border-color: rgba(239, 68, 68, 0.3);
      color: rgb(248, 113, 113);
    }

    // Add warning icon
    &::before {
      content: '⚠️';
      margin-right: $spacing-sm;
    }
  }

  .success {
    padding: $spacing-lg;
    margin-bottom: $spacing-lg;
    background-color: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.25);
    border-radius: $component-border-radius-small;
    color: rgb(21, 128, 61);
    font-size: 14px;
    line-height: 1.4;
    border-left: 4px solid rgba(34, 197, 94, 0.5);
    animation: slideIn 0.3s ease;

    @include dark-mode {
      background-color: rgba(34, 197, 94, 0.15);
      border-color: rgba(34, 197, 94, 0.3);
      color: rgb(74, 222, 128);
    }

    // Add success icon
    &::before {
      content: '✅';
      margin-right: $spacing-sm;
    }
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  // Enhanced loading state
  .loading {
    text-align: center;
    padding: $spacing-4xl $spacing-2xl;
    color: $light-mode-secondary-text;

    @include dark-mode {
      color: $dark-mode-secondary-text;
    }
  }

  // Loading spinner for buttons
  .loading-spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-radius: 50%;
    border-top-color: rgba(255, 255, 255, 0.8);
    animation: spin 0.8s linear infinite;
    margin-right: $spacing-sm;
    vertical-align: middle;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  // Button loading state adjustments
  button {
    position: relative;
    transition: all 0.2s ease;

    &:disabled {
      opacity: 0.7;
      cursor: not-allowed;
      transform: none !important;
    }

    .loading-spinner {
      // Adjust spinner color for different button types
      border-color: rgba(255, 255, 255, 0.3);
      border-top-color: rgba(255, 255, 255, 0.8);
    }

    &.secondary .loading-spinner {
      border-color: rgba(0, 0, 0, 0.3);
      border-top-color: rgba(0, 0, 0, 0.6);

      @include dark-mode {
        border-color: rgba(255, 255, 255, 0.3);
        border-top-color: rgba(255, 255, 255, 0.8);
      }
    }
  }

  // Section styling for active editors and pending invitations
  .section {
    margin-bottom: $spacing-2xl;

    &:last-child {
      margin-bottom: 0;
    }

    .section-title {
      font-size: 18px;
      font-weight: $font-medium;
      color: $light-mode-text;
      margin: 0 0 $spacing-lg 0;
      padding-bottom: $spacing-sm;
      border-bottom: 2px solid $light-mode-border;

      @include dark-mode {
        color: $dark-mode-text;
        border-color: $dark-mode-border;
      }
    }
  }

  // Invitation-specific styling
  .invitation-item {

    &.is-processing {
      opacity: 0.7;
      pointer-events: none;
    }

    .editor-info {
      display: flex;
      flex-direction: column;
      gap: $spacing-xs;

      @media (min-width: 576px) {
        flex-direction: row;
        align-items: center;
        gap: $spacing-md;
      }
    }

    .editor-status {
      font-size: 12px;
      font-weight: $font-medium;
      padding: $spacing-xs $spacing-sm;
      border-radius: $component-border-radius-small;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      flex-shrink: 0;

      &.active {
        background: rgba(34, 197, 94, 0.1);
        color: rgb(21, 128, 61);
        border: 1px solid rgba(34, 197, 94, 0.25);

        @include dark-mode {
          background: rgba(34, 197, 94, 0.15);
          border-color: rgba(34, 197, 94, 0.3);
          color: rgb(74, 222, 128);
        }
      }

      &.pending {
        background: rgba(245, 158, 11, 0.1);
        color: rgb(146, 64, 14);
        border: 1px solid rgba(245, 158, 11, 0.25);

        @include dark-mode {
          background: rgba(245, 158, 11, 0.15);
          border-color: rgba(245, 158, 11, 0.3);
          color: rgb(251, 191, 36);
        }
      }
    }

    .invitation-actions {
      display: flex;
      gap: $spacing-sm;
      flex-shrink: 0;

      @media (max-width: 576px) {
        width: 100%;
        justify-content: space-between;
      }

      .resend-btn, .cancel-btn {
        padding: $spacing-sm $spacing-md;
        font-size: 14px;
        white-space: nowrap;
        transition: all 0.2s ease;

        &:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        @media (max-width: 576px) {
          flex: 1;
          min-height: 44px; // Better touch target size on mobile
          font-size: 16px; // Prevent iOS zoom on focus
        }
      }

      .resend-btn {
        min-width: 80px;
      }

      .cancel-btn {
        min-width: 70px;
      }
    }
  }
}
</style>
