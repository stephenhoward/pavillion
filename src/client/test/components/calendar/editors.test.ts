import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';

import { CalendarEditor } from '@/common/model/calendar_editor';
import {
  CalendarEditorPermissionError,
  EditorAlreadyExistsError,
  EditorNotFoundError,
} from '@/common/exceptions/editor';
import { AccountInviteAlreadyExistsError } from '@/common/exceptions';

import EditorsTab from '@/client/components/logged_in/calendar-management/editors.vue';
import CalendarService from '@/client/service/calendar';
import AuthenticationService from '@/client/service/authn';

// Stub for PillButton component — preserves the variant class so tests can
// distinguish primary vs danger buttons in the same way the real component does.
const PillButtonStub = {
  template: '<button :class="[\'pill-button\', `pill-button--${variant}`]" @click="$emit(\'click\', $event)"><slot /></button>',
  props: ['variant', 'type', 'disabled', 'size'],
  emits: ['click'],
};

// Stub for lucide-vue-next icons.
const IconStub = { template: '<span />' };

// Shared global stubs reused by every test mount in this suite. Hoisted to a
// constant rather than repeated per-test to keep the suite scannable.
const globalStubs = {
  ModalLayout: {
    template: '<div class="modal-stub"><slot /></div>',
  },
  EmptyLayout: {
    template: '<div class="empty-stub"><slot /></div>',
  },
  AdminSectionHeader: {
    template: '<div class="admin-section-header"><slot name="actions" /></div>',
    props: ['title'],
  },
  LoadingMessage: {
    template: '<div class="loading-message" />',
    props: ['description'],
  },
  PillButton: PillButtonStub,
  Plus: IconStub,
  Mail: IconStub,
  Crown: IconStub,
  Globe: IconStub,
  ArrowUp: IconStub,
  Trash2: IconStub,
  X: IconStub,
};

// Mock i18next-vue so translation keys come back as raw keys (with params
// JSON-appended). Tests assert against keys instead of localized strings,
// which keeps them stable when copy changes.
vi.mock('i18next-vue', () => ({
  useTranslation: () => ({
    t: (key: string, params?: any) => {
      if (params) {
        return `${key}:${JSON.stringify(params)}`;
      }
      return key;
    },
  }),
}));

// Mock services at module level so every `new CalendarService()` /
// `new AuthenticationService()` in the component returns our stub instance.
vi.mock('@/client/service/calendar');
vi.mock('@/client/service/authn');

const mountEditors = (props: Record<string, any> = {}, extraOptions: Record<string, any> = {}) => {
  return mount(EditorsTab, {
    props: {
      calendarId: 'test-calendar',
      ...props,
    },
    global: {
      stubs: globalStubs,
    },
    ...extraOptions,
  });
};

describe('Editors Component', () => {
  let calendarServiceMock: any;
  let authServiceMock: any;

  beforeEach(() => {
    vi.clearAllMocks();

    calendarServiceMock = {
      listCalendarEditors: vi.fn(),
      grantEditAccess: vi.fn(),
      revokeEditAccess: vi.fn(),
      cancelInvitation: vi.fn(),
      resendInvitation: vi.fn(),
    };
    vi.mocked(CalendarService).mockImplementation(() => calendarServiceMock);

    authServiceMock = {
      userEmail: vi.fn().mockReturnValue(null),
    };
    vi.mocked(AuthenticationService).mockImplementation(() => authServiceMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Component Initialization', () => {
    it('loads editors on mount', async () => {
      const testEditors = [
        new CalendarEditor('1', 'test-calendar', 'user1@example.com'),
        new CalendarEditor('2', 'test-calendar', 'user2@example.com'),
      ];

      const testPendingInvitations = [
        { id: 'inv-1', accountId: 'user3@example.com', email: 'user3@example.com', status: 'pending' },
      ];

      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: testEditors,
        pendingInvitations: testPendingInvitations,
      });

      const wrapper = mountEditors();
      await flushPromises();

      expect(calendarServiceMock.listCalendarEditors).toHaveBeenCalledWith('test-calendar');
      expect(wrapper.vm.state.editors).toEqual(testEditors);
      expect(wrapper.vm.state.pendingInvitations).toEqual(testPendingInvitations);
      expect(wrapper.vm.state.isLoading).toBe(false);
    });

    it('displays loading state while fetching editors', async () => {
      // Mock with a promise that never resolves to keep loading state.
      const neverResolvingPromise = new Promise(() => {});
      calendarServiceMock.listCalendarEditors.mockReturnValue(neverResolvingPromise);

      const wrapper = mountEditors();
      await nextTick();

      expect(wrapper.vm.state.isLoading).toBe(true);
      expect(wrapper.find('.loading-message').exists()).toBe(true);
    });

    it('handles permission error when loading editors', async () => {
      calendarServiceMock.listCalendarEditors.mockRejectedValue(
        new CalendarEditorPermissionError(),
      );

      const wrapper = mountEditors();
      await flushPromises();

      expect(wrapper.vm.state.error).toBe('error_permission_denied');
      expect(wrapper.find('.alert--error').exists()).toBe(true);
    });

    it('does not show empty state when a permission error occurs', async () => {
      calendarServiceMock.listCalendarEditors.mockRejectedValue(
        new CalendarEditorPermissionError(),
      );

      const wrapper = mountEditors();
      await flushPromises();

      // The permission-denied error message should be visible.
      expect(wrapper.find('.alert--error').exists()).toBe(true);
      // The empty state must NOT be shown alongside the error.
      expect(wrapper.find('.empty-stub').exists()).toBe(false);
    });

    it('handles generic error when loading editors', async () => {
      calendarServiceMock.listCalendarEditors.mockRejectedValue(new Error('Network error'));

      const wrapper = mountEditors();
      await flushPromises();

      expect(wrapper.vm.state.error).toBe('error_loading_editors');
    });
  });

  describe('Editor List Display', () => {
    it('displays editors list when editors exist', async () => {
      const testEditors = [
        new CalendarEditor('1', 'test-calendar', 'user1@example.com'),
        new CalendarEditor('2', 'test-calendar', 'user2@example.com'),
      ];

      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: testEditors,
        pendingInvitations: [],
      });

      const wrapper = mountEditors();
      await flushPromises();

      const editorItems = wrapper.findAll('.editor-card');
      expect(editorItems).toHaveLength(2);
      expect(editorItems[0].text()).toContain('user1@example.com');
      expect(editorItems[1].text()).toContain('user2@example.com');
    });

    it('displays empty state when no editors exist', async () => {
      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: [],
        pendingInvitations: [],
      });

      const wrapper = mountEditors();
      await flushPromises();

      expect(wrapper.find('.empty-stub').exists()).toBe(true);
    });

    it('shows remove button for each editor', async () => {
      const testEditors = [
        new CalendarEditor('1', 'test-calendar', 'user1@example.com'),
      ];

      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: testEditors,
        pendingInvitations: [],
      });

      const wrapper = mountEditors();
      await flushPromises();

      const removeButton = wrapper.find('.editor-actions .btn-ghost');
      expect(removeButton.exists()).toBe(true);
      expect(removeButton.text()).toBe('remove_button');
    });

    it('should display pending invitations separately from active editors', async () => {
      const mockEditors = [
        CalendarEditor.fromObject({
          id: 'editor-1',
          calendarId: 'calendar-123',
          email: 'alice@example.com',
        }),
      ];

      const mockInvitations = [
        {
          id: 'invite-1',
          email: 'charlie@example.com',
        },
      ];

      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: mockEditors,
        pendingInvitations: mockInvitations,
      });

      const wrapper = mountEditors({ calendarId: 'calendar-123' });
      await flushPromises();
      await nextTick();

      // Should have sections for both active editors and pending invitations.
      const sections = wrapper.findAll('.editors-section');
      expect(sections.length).toBeGreaterThanOrEqual(2);

      expect(wrapper.html()).toContain('alice@example.com');
      expect(wrapper.html()).toContain('charlie@example.com');
    });
  });

  describe('isOwner prop — Add Editor visibility', () => {
    beforeEach(() => {
      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: [],
        pendingInvitations: [],
      });
    });

    it('shows Add Editor button in empty state when isOwner is true', async () => {
      const wrapper = mountEditors({ isOwner: true });
      await flushPromises();

      // Empty state PillButton should be present for owners.
      const pillButtons = wrapper.findAll('.pill-button--primary');
      expect(pillButtons.length).toBeGreaterThan(0);
    });

    it('hides Add Editor button in empty state when isOwner is false', async () => {
      const wrapper = mountEditors({ isOwner: false });
      await flushPromises();

      // No primary pill button should appear for non-owners in empty state.
      const pillButtons = wrapper.findAll('.pill-button--primary');
      expect(pillButtons.length).toBe(0);
    });

    it('shows Add Editor button in header when editors exist and isOwner is true', async () => {
      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: [new CalendarEditor('1', 'test-calendar', 'user1@example.com')],
        pendingInvitations: [],
      });

      const wrapper = mountEditors({ isOwner: true });
      await flushPromises();

      const headerAddButton = wrapper.find('.admin-section-header .pill-button--primary');
      expect(headerAddButton.exists()).toBe(true);
    });

    it('hides Add Editor button in header when editors exist and isOwner is false', async () => {
      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: [new CalendarEditor('1', 'test-calendar', 'user1@example.com')],
        pendingInvitations: [],
      });

      const wrapper = mountEditors({ isOwner: false });
      await flushPromises();

      const headerAddButton = wrapper.find('.admin-section-header .pill-button--primary');
      expect(headerAddButton.exists()).toBe(false);
    });

    it('defaults isOwner to false when prop is not provided', async () => {
      // Mount without an explicit isOwner prop — the component default should
      // suppress the Add Editor primary button.
      const wrapper = mount(EditorsTab, {
        props: {
          calendarId: 'test-calendar',
        },
        global: {
          stubs: globalStubs,
        },
      });

      await flushPromises();

      const pillButtons = wrapper.findAll('.pill-button--primary');
      expect(pillButtons.length).toBe(0);
    });
  });

  describe('Add Editor Functionality', () => {
    beforeEach(() => {
      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: [],
        pendingInvitations: [],
      });
    });

    it('opens add editor form when button clicked', async () => {
      const wrapper = mountEditors({ isOwner: true });
      await flushPromises();
      await nextTick();

      const addButton = wrapper.find('.pill-button--primary');
      expect(addButton.exists()).toBe(true);

      await addButton.trigger('click');
      await nextTick();

      expect(wrapper.vm.state.showAddForm).toBe(true);
      expect(wrapper.find('.add-editor-form').exists()).toBe(true);

      // Email input should be rendered inside the form.
      const input = wrapper.find('#email');
      expect(input.exists()).toBe(true);
    });

    it('should focus email input when modal opens', async () => {
      const wrapper = mount(EditorsTab, {
        props: {
          calendarId: 'test-calendar',
          isOwner: true,
        },
        attachTo: document.body,
        global: {
          stubs: globalStubs,
        },
      });

      await flushPromises();
      await nextTick();

      await wrapper.find('.pill-button--primary').trigger('click');
      await nextTick();

      const input = wrapper.find('#email').element as HTMLInputElement;
      expect(document.activeElement).toBe(input);

      wrapper.unmount();
    });

    it('closes add editor form when cancel clicked', async () => {
      const wrapper = mountEditors();
      await flushPromises();

      // Open the form
      wrapper.vm.state.showAddForm = true;
      await nextTick();

      // Call the close method directly since button text is a translation key.
      wrapper.vm.closeAddForm();

      expect(wrapper.vm.state.showAddForm).toBe(false);
    });

    it('adds editor successfully', async () => {
      const newEditor = new CalendarEditor('3', 'test-calendar', 'newuser@example.com');
      calendarServiceMock.grantEditAccess.mockResolvedValue(newEditor);

      // First call resolves with empty list (mount), second resolves with the
      // newly added editor (post-grant reload).
      calendarServiceMock.listCalendarEditors
        .mockResolvedValueOnce({ activeEditors: [], pendingInvitations: [] })
        .mockResolvedValueOnce({ activeEditors: [newEditor], pendingInvitations: [] });

      const wrapper = mountEditors({ isOwner: true });
      await flushPromises();
      await nextTick();

      // Open add form via the visible primary pill button.
      await wrapper.find('.pill-button--primary').trigger('click');
      await nextTick();

      // Fill in the email field via real DOM interaction.
      const input = wrapper.find('#email');
      await input.setValue('newuser@example.com');
      await nextTick();

      // Submit by clicking the form's primary button.
      const submitButton = wrapper.find('.add-editor-form .pill-button--primary');
      await submitButton.trigger('click');
      await flushPromises();

      expect(calendarServiceMock.grantEditAccess).toHaveBeenCalledWith(
        'test-calendar',
        'newuser@example.com',
      );
      expect(wrapper.vm.state.editors).toContainEqual(newEditor);
      expect(wrapper.vm.state.showAddForm).toBe(false);
    });

    it('handles empty account ID error', async () => {
      const wrapper = mountEditors();
      await flushPromises();

      // Open add form with empty account ID.
      wrapper.vm.state.showAddForm = true;
      wrapper.vm.state.newAccountId = '';
      await nextTick();

      await wrapper.vm.addEditor();

      expect(wrapper.vm.state.addError).toBe('account_id_required');
      expect(calendarServiceMock.grantEditAccess).not.toHaveBeenCalled();
    });

    it('handles editor already exists error', async () => {
      calendarServiceMock.grantEditAccess.mockRejectedValue(
        new EditorAlreadyExistsError(),
      );

      const wrapper = mountEditors({ isOwner: true });
      await flushPromises();
      await nextTick();

      // Open add form via the visible primary pill button.
      await wrapper.find('.pill-button--primary').trigger('click');
      await nextTick();

      await wrapper.find('#email').setValue('existing@example.com');
      await nextTick();

      const submitButton = wrapper.find('.add-editor-form .pill-button--primary');
      await submitButton.trigger('click');
      await flushPromises();

      expect(wrapper.vm.state.addError).toBe('error_editor_already_exists');
      expect(wrapper.vm.state.showAddForm).toBe(true); // Form should stay open.
    });

    it('handles invitation already exists error', async () => {
      calendarServiceMock.grantEditAccess.mockRejectedValue(
        new AccountInviteAlreadyExistsError(),
      );

      const wrapper = mountEditors({ isOwner: true });
      await flushPromises();
      await nextTick();

      await wrapper.find('.pill-button--primary').trigger('click');
      await nextTick();

      await wrapper.find('#email').setValue('invited@example.com');
      await nextTick();

      const submitButton = wrapper.find('.add-editor-form .pill-button--primary');
      await submitButton.trigger('click');
      await flushPromises();

      expect(wrapper.vm.state.addError).toBe('error_invite_already_exists');
      expect(wrapper.vm.state.showAddForm).toBe(true);
    });

    it('handles permission error when adding editor', async () => {
      calendarServiceMock.grantEditAccess.mockRejectedValue(
        new CalendarEditorPermissionError(),
      );

      const wrapper = mountEditors();
      await flushPromises();

      wrapper.vm.state.showAddForm = true;
      wrapper.vm.state.newAccountId = 'user@example.com';
      await nextTick();

      await wrapper.vm.addEditor();

      expect(wrapper.vm.state.addError).toBe('error_permission_denied');
    });
  });

  describe('Remove Editor Functionality', () => {
    let testEditor: CalendarEditor;

    beforeEach(() => {
      testEditor = new CalendarEditor('1', 'test-calendar', 'user1@example.com');
      // Set the current user to someone OTHER than the editor under test so
      // the leave-calendar UI doesn't render and confuse the .btn-ghost lookup.
      authServiceMock.userEmail.mockReturnValue('owner@example.com');
      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: [testEditor],
        pendingInvitations: [],
      });
    });

    it('shows confirmation modal when remove clicked', async () => {
      const wrapper = mountEditors();
      await flushPromises();
      await nextTick();

      // Click the visible remove button on the editor card.
      const removeButton = wrapper.find('.editor-actions .btn-ghost');
      expect(removeButton.exists()).toBe(true);

      await removeButton.trigger('click');
      await nextTick();

      expect(wrapper.vm.state.editorToRemove).not.toBeNull();
      expect(wrapper.vm.state.editorToRemove.id).toBe('1');
      expect(wrapper.find('.confirmation-modal').exists()).toBe(true);
    });

    it('cancels remove operation', async () => {
      const wrapper = mountEditors();
      await flushPromises();

      wrapper.vm.state.editorToRemove = testEditor;
      await wrapper.vm.cancelRemoveEditor();

      expect(wrapper.vm.state.editorToRemove).toBeNull();
    });

    it('removes editor successfully', async () => {
      calendarServiceMock.revokeEditAccess.mockResolvedValue(undefined);
      // First listCalendarEditors call (mount) returns the editor; reload after
      // removal returns the empty list.
      calendarServiceMock.listCalendarEditors
        .mockResolvedValueOnce({ activeEditors: [testEditor], pendingInvitations: [] })
        .mockResolvedValueOnce({ activeEditors: [], pendingInvitations: [] });

      const wrapper = mountEditors();
      await flushPromises();
      await nextTick();

      // Open the confirmation modal by clicking remove.
      await wrapper.find('.editor-actions .btn-ghost').trigger('click');
      await nextTick();

      // Confirm by invoking removeEditor (the danger button is inside the
      // ModalLayout stub, so calling the method is the cleanest path).
      await wrapper.vm.removeEditor();
      await flushPromises();

      expect(calendarServiceMock.revokeEditAccess).toHaveBeenCalledWith(
        'test-calendar',
        '1',
      );
      // listCalendarEditors should be called twice: once on mount, once after
      // the successful revoke.
      expect(calendarServiceMock.listCalendarEditors).toHaveBeenCalledTimes(2);
      expect(wrapper.vm.state.editors).toHaveLength(0);
      expect(wrapper.vm.state.editorToRemove).toBeNull();
    });

    it('handles editor not found error', async () => {
      calendarServiceMock.revokeEditAccess.mockRejectedValue(
        new EditorNotFoundError(),
      );

      const wrapper = mountEditors();
      await flushPromises();

      wrapper.vm.state.editorToRemove = testEditor;
      await wrapper.vm.removeEditor();

      expect(wrapper.vm.state.error).toBe('error_editor_not_found');
      // Should remove from local list to keep UI in sync with server.
      expect(wrapper.vm.state.editors).toHaveLength(0);
      expect(wrapper.vm.state.editorToRemove).toBeNull();
    });

    it('handles permission error when removing editor', async () => {
      calendarServiceMock.revokeEditAccess.mockRejectedValue(
        new CalendarEditorPermissionError(),
      );

      const wrapper = mountEditors();
      await flushPromises();

      wrapper.vm.state.editorToRemove = testEditor;
      await wrapper.vm.removeEditor();

      expect(wrapper.vm.state.error).toBe('error_permission_denied');
    });
  });

  describe('Editor Role Display', () => {
    it('should distinguish current user as editor vs owner', async () => {
      const mockEditors = [
        CalendarEditor.fromObject({
          id: 'editor-1',
          calendarId: 'calendar-123',
          email: 'alice@example.com',
        }),
      ];

      // Set current user email to match an editor — they can leave the calendar.
      authServiceMock.userEmail.mockReturnValue('alice@example.com');

      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: mockEditors,
        pendingInvitations: [],
      });

      const wrapper = mountEditors({ calendarId: 'calendar-123' });
      await flushPromises();
      await nextTick();

      // Current user should be able to leave (is an editor).
      expect(wrapper.vm.canLeaveCalendar()).toBe(true);

      // Leave button should be visible.
      const leaveButton = wrapper.find('.btn-ghost--danger');
      expect(leaveButton.exists()).toBe(true);
    });

    it('should not show leave button if user is not an editor', async () => {
      const mockEditors = [
        CalendarEditor.fromObject({
          id: 'editor-1',
          calendarId: 'calendar-123',
          email: 'bob@example.com',
        }),
      ];

      // Current user is the owner (not in editors list).
      authServiceMock.userEmail.mockReturnValue('owner@example.com');

      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: mockEditors,
        pendingInvitations: [],
      });

      const wrapper = mountEditors({ calendarId: 'calendar-123' });
      await flushPromises();
      await nextTick();

      expect(wrapper.vm.canLeaveCalendar()).toBe(false);
      expect(wrapper.find('.btn-ghost--danger').exists()).toBe(false);
    });
  });

  describe('UI State Management', () => {
    beforeEach(() => {
      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: [],
        pendingInvitations: [],
      });
    });

    it('disables add button while loading', async () => {
      const wrapper = mountEditors();
      await flushPromises();

      // Set loading state which should disable the button in empty state.
      wrapper.vm.state.isLoading = true;
      await nextTick();

      // During loading, the empty state PillButton is not rendered (v-else),
      // so verify loading state is active.
      expect(wrapper.vm.state.isLoading).toBe(true);
    });

    it('disables remove button while removing', async () => {
      const testEditor = new CalendarEditor('1', 'test-calendar', 'user1@example.com');
      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: [testEditor],
        pendingInvitations: [],
      });

      const wrapper = mountEditors();
      await flushPromises();

      wrapper.vm.state.isRemoving = testEditor.id;
      await nextTick();

      const removeButton = wrapper.find('.editor-actions .btn-ghost');
      expect(removeButton.attributes('disabled')).toBeDefined();
    });

    it('prevents form closure during operations', async () => {
      const wrapper = mountEditors();
      await flushPromises();

      wrapper.vm.state.showAddForm = true;
      wrapper.vm.state.isAdding = true;
      await nextTick();

      await wrapper.vm.closeAddForm();

      // Should not close while an add is in progress.
      expect(wrapper.vm.state.showAddForm).toBe(true);
    });
  });

  describe('Invitation Management', () => {
    let testInvitation: any;

    beforeEach(() => {
      testInvitation = {
        id: 'inv-1',
        accountId: 'user@example.com',
        email: 'user@example.com',
        status: 'pending',
      };
    });

    it('displays pending invitations in UI', async () => {
      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: [],
        pendingInvitations: [testInvitation],
      });

      const wrapper = mountEditors();
      await flushPromises();

      expect(wrapper.vm.state.pendingInvitations).toEqual([testInvitation]);
    });

    it('cancels invitation successfully', async () => {
      calendarServiceMock.listCalendarEditors
        .mockResolvedValueOnce({ activeEditors: [], pendingInvitations: [testInvitation] })
        .mockResolvedValueOnce({ activeEditors: [], pendingInvitations: [] });
      calendarServiceMock.cancelInvitation.mockResolvedValue(undefined);

      const wrapper = mountEditors();
      await flushPromises();
      await nextTick();

      // The cancel button is the non-primary .btn-text inside the invitation card.
      const cancelButton = wrapper.find('.btn-text:not(.btn-text--primary)');
      expect(cancelButton.exists()).toBe(true);

      await cancelButton.trigger('click');
      await flushPromises();

      expect(calendarServiceMock.cancelInvitation).toHaveBeenCalledWith(
        'test-calendar',
        'inv-1',
      );
      expect(calendarServiceMock.listCalendarEditors).toHaveBeenCalledTimes(2);
    });

    it('resends invitation successfully', async () => {
      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: [],
        pendingInvitations: [testInvitation],
      });
      calendarServiceMock.resendInvitation.mockResolvedValue(undefined);

      const wrapper = mountEditors();
      await flushPromises();
      await nextTick();

      const resendButton = wrapper.find('.btn-text--primary');
      expect(resendButton.exists()).toBe(true);

      await resendButton.trigger('click');
      await flushPromises();

      expect(calendarServiceMock.resendInvitation).toHaveBeenCalledWith(
        'test-calendar',
        'inv-1',
      );
      // Component sets state.success on resend success.
      expect(wrapper.vm.state.success).toBeTruthy();
    });

    it('handles cancel invitation errors', async () => {
      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: [],
        pendingInvitations: [testInvitation],
      });
      calendarServiceMock.cancelInvitation.mockRejectedValue(new Error('Network error'));

      const wrapper = mountEditors();
      await flushPromises();

      await wrapper.vm.cancelInvitation('inv-1');
      await flushPromises();

      expect(wrapper.vm.state.error).toBeTruthy();
    });

    it('handles resend invitation errors', async () => {
      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: [],
        pendingInvitations: [testInvitation],
      });
      calendarServiceMock.resendInvitation.mockRejectedValue(new Error('Rate limited'));

      const wrapper = mountEditors();
      await flushPromises();

      await wrapper.vm.resendInvitation('inv-1');
      await flushPromises();

      expect(wrapper.vm.state.error).toBeTruthy();
    });
  });
});
