import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import EditorsTab from '../editors.vue';
import CalendarService from '@/client/service/calendar';
import AuthenticationService from '@/client/service/authn';
import { CalendarEditor } from '@/common/model/calendar_editor';
import {
  CalendarEditorPermissionError,
  EditorAlreadyExistsError,
  EditorNotFoundError,
} from '@/common/exceptions/editor';
import { AccountInviteAlreadyExistsError } from '@/common/exceptions';

// Stub for PillButton component
const PillButtonStub = {
  template: '<button :class="[\'pill-button\', `pill-button--${variant}`]" @click="$emit(\'click\', $event)"><slot /></button>',
  props: ['variant', 'type', 'disabled', 'size'],
  emits: ['click'],
};

// Stub for lucide icons
const IconStub = { template: '<span />' };

// Mock i18next-vue
vi.mock('i18next-vue', () => ({
  useTranslation: () => ({
    t: (key: string, params?: any) => {
      // Return translation keys with params for testing
      if (params) {
        return `${key}:${JSON.stringify(params)}`;
      }
      return key;
    },
  }),
}));

// Mock services
vi.mock('@/client/service/calendar');
vi.mock('@/client/service/authn');

describe('EditorsTab Component', () => {
  let calendarServiceMock: any;
  let authServiceMock: any;

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();

    // Setup CalendarService mock
    calendarServiceMock = {
      listCalendarEditors: vi.fn(),
      grantEditAccess: vi.fn(),
      revokeEditAccess: vi.fn(),
      cancelInvitation: vi.fn(),
      resendInvitation: vi.fn(),
    };
    vi.mocked(CalendarService).mockImplementation(() => calendarServiceMock);

    // Setup AuthenticationService mock
    authServiceMock = {
      userEmail: vi.fn(),
    };
    vi.mocked(AuthenticationService).mockImplementation(() => authServiceMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('3.1.1 - Editor list displays current editors with roles', () => {
    it('should display list of active editors when loaded', async () => {
      // Arrange
      const mockEditors = [
        CalendarEditor.fromObject({
          id: 'editor-1',
          calendarId: 'calendar-123',
          email: 'alice@example.com',
        }),
        CalendarEditor.fromObject({
          id: 'editor-2',
          calendarId: 'calendar-123',
          email: 'bob@example.com',
        }),
      ];

      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: mockEditors,
        pendingInvitations: [],
      });

      // Act
      const wrapper = mount(EditorsTab, {
        props: {
          calendarId: 'calendar-123',
        },
        global: {
          stubs: {
            ModalLayout: true,
            EmptyLayout: true,
            LoadingMessage: true,
            PillButton: PillButtonStub,
            Plus: IconStub,
            Mail: IconStub,
            Crown: IconStub,
            Globe: IconStub,
            ArrowUp: IconStub,
            Trash2: IconStub,
            X: IconStub,
          },
        },
      });

      await flushPromises();
      await nextTick();

      // Assert
      expect(calendarServiceMock.listCalendarEditors).toHaveBeenCalledWith('calendar-123');

      // Should display both editors
      const editorItems = wrapper.findAll('.editor-card');
      expect(editorItems).toHaveLength(2);

      // Check editor emails are displayed
      expect(wrapper.html()).toContain('alice@example.com');
      expect(wrapper.html()).toContain('bob@example.com');
    });

    it('should display pending invitations separately from active editors', async () => {
      // Arrange
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

      // Act
      const wrapper = mount(EditorsTab, {
        props: {
          calendarId: 'calendar-123',
        },
        global: {
          stubs: {
            ModalLayout: true,
            EmptyLayout: true,
            LoadingMessage: true,
            PillButton: PillButtonStub,
            Plus: IconStub,
            Mail: IconStub,
            Crown: IconStub,
            Globe: IconStub,
            ArrowUp: IconStub,
            Trash2: IconStub,
            X: IconStub,
          },
        },
      });

      await flushPromises();
      await nextTick();

      // Assert
      // Should have sections for active editors and pending invitations
      const sections = wrapper.findAll('.editors-section');
      expect(sections.length).toBeGreaterThanOrEqual(2);

      // Check both emails are present
      expect(wrapper.html()).toContain('alice@example.com');
      expect(wrapper.html()).toContain('charlie@example.com');
    });
  });

  describe('3.1.2 - Add editor button opens search/invite dialog', () => {
    it('should open add editor modal when clicking add button', async () => {
      // Arrange
      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: [],
        pendingInvitations: [],
      });

      const wrapper = mount(EditorsTab, {
        props: {
          calendarId: 'calendar-123',
        },
        global: {
          stubs: {
            ModalLayout: {
              template: '<div class="modal-stub"><slot /></div>',
            },
            EmptyLayout: {
              template: '<div class="empty-stub"><slot /></div>',
            },
            LoadingMessage: true,
            PillButton: PillButtonStub,
            Plus: IconStub,
            Mail: IconStub,
            Crown: IconStub,
            Globe: IconStub,
            ArrowUp: IconStub,
            Trash2: IconStub,
            X: IconStub,
          },
        },
      });

      await flushPromises();
      await nextTick();

      // Act
      const addButton = wrapper.find('.pill-button--primary');
      expect(addButton.exists()).toBe(true);

      await addButton.trigger('click');
      await nextTick();

      // Assert
      // Modal should be visible
      expect(wrapper.vm.state.showAddForm).toBe(true);
      expect(wrapper.find('.add-editor-form').exists()).toBe(true);

      // Should have input field for email/username
      const input = wrapper.find('#email');
      expect(input.exists()).toBe(true);
    });

    it('should focus email input when modal opens', async () => {
      // Arrange
      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: [],
        pendingInvitations: [],
      });

      const wrapper = mount(EditorsTab, {
        props: {
          calendarId: 'calendar-123',
        },
        attachTo: document.body,
        global: {
          stubs: {
            ModalLayout: {
              template: '<div class="modal-stub"><slot /></div>',
            },
            EmptyLayout: {
              template: '<div class="empty-stub"><slot /></div>',
            },
            LoadingMessage: true,
            PillButton: PillButtonStub,
            Plus: IconStub,
            Mail: IconStub,
            Crown: IconStub,
            Globe: IconStub,
            ArrowUp: IconStub,
            Trash2: IconStub,
            X: IconStub,
          },
        },
      });

      await flushPromises();
      await nextTick();

      // Act
      await wrapper.find('.pill-button--primary').trigger('click');
      await nextTick();

      // Assert
      const input = wrapper.find('#email').element as HTMLInputElement;
      expect(document.activeElement).toBe(input);

      wrapper.unmount();
    });
  });

  describe('3.1.3 - Remove editor button triggers confirmation', () => {
    it('should show confirmation modal when clicking remove button', async () => {
      // Arrange
      const mockEditors = [
        CalendarEditor.fromObject({
          id: 'editor-1',
          calendarId: 'calendar-123',
          email: 'bob@example.com',
        }),
      ];

      authServiceMock.userEmail.mockReturnValue('alice@example.com');

      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: mockEditors,
        pendingInvitations: [],
      });

      const wrapper = mount(EditorsTab, {
        props: {
          calendarId: 'calendar-123',
        },
        global: {
          stubs: {
            ModalLayout: {
              template: '<div class="modal-stub"><slot /></div>',
            },
            EmptyLayout: true,
            LoadingMessage: true,
            PillButton: PillButtonStub,
            Plus: IconStub,
            Mail: IconStub,
            Crown: IconStub,
            Globe: IconStub,
            ArrowUp: IconStub,
            Trash2: IconStub,
            X: IconStub,
          },
        },
      });

      await flushPromises();
      await nextTick();

      // Act
      const removeButton = wrapper.find('.btn-ghost');
      expect(removeButton.exists()).toBe(true);

      await removeButton.trigger('click');
      await nextTick();

      // Assert
      // Confirmation modal should be shown
      expect(wrapper.vm.state.editorToRemove).not.toBeNull();
      expect(wrapper.vm.state.editorToRemove.id).toBe('editor-1');
      expect(wrapper.find('.confirmation-modal').exists()).toBe(true);
    });

    it('should remove editor when confirmation is accepted', async () => {
      // Arrange
      const mockEditors = [
        CalendarEditor.fromObject({
          id: 'editor-1',
          calendarId: 'calendar-123',
          email: 'bob@example.com',
        }),
      ];

      authServiceMock.userEmail.mockReturnValue('alice@example.com');

      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: mockEditors,
        pendingInvitations: [],
      });
      calendarServiceMock.revokeEditAccess.mockResolvedValue(undefined);

      const wrapper = mount(EditorsTab, {
        props: {
          calendarId: 'calendar-123',
        },
        global: {
          stubs: {
            ModalLayout: {
              template: '<div class="modal-stub"><slot /></div>',
            },
            EmptyLayout: true,
            LoadingMessage: true,
            PillButton: PillButtonStub,
            Plus: IconStub,
            Mail: IconStub,
            Crown: IconStub,
            Globe: IconStub,
            ArrowUp: IconStub,
            Trash2: IconStub,
            X: IconStub,
          },
        },
      });

      await flushPromises();
      await nextTick();

      // Open confirmation
      await wrapper.find('.btn-ghost').trigger('click');
      await nextTick();

      // Act
      // Call the removeEditor method directly
      await wrapper.vm.removeEditor();
      await flushPromises();

      // Assert
      expect(calendarServiceMock.revokeEditAccess).toHaveBeenCalledWith(
        'calendar-123',
        'editor-1',
      );

      // Should reload editors after removal
      expect(calendarServiceMock.listCalendarEditors).toHaveBeenCalledTimes(2);
    });
  });

  describe('3.1.4 - Editor role display (owner vs editor)', () => {
    it('should distinguish current user as editor vs owner', async () => {
      // Arrange
      const mockEditors = [
        CalendarEditor.fromObject({
          id: 'editor-1',
          calendarId: 'calendar-123',
          email: 'alice@example.com',
        }),
      ];

      // Set current user email to match an editor
      authServiceMock.userEmail.mockReturnValue('alice@example.com');

      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: mockEditors,
        pendingInvitations: [],
      });

      const wrapper = mount(EditorsTab, {
        props: {
          calendarId: 'calendar-123',
        },
        global: {
          stubs: {
            ModalLayout: true,
            EmptyLayout: true,
            LoadingMessage: true,
            PillButton: PillButtonStub,
            Plus: IconStub,
            Mail: IconStub,
            Crown: IconStub,
            Globe: IconStub,
            ArrowUp: IconStub,
            Trash2: IconStub,
            X: IconStub,
          },
        },
      });

      await flushPromises();
      await nextTick();

      // Assert
      // Current user should be able to leave calendar (is an editor)
      expect(wrapper.vm.canLeaveCalendar()).toBe(true);

      // Leave button should be visible
      const leaveButton = wrapper.find('.btn-ghost--danger');
      expect(leaveButton.exists()).toBe(true);
    });

    it('should not show leave button if user is not an editor', async () => {
      // Arrange
      const mockEditors = [
        CalendarEditor.fromObject({
          id: 'editor-1',
          calendarId: 'calendar-123',
          email: 'bob@example.com',
        }),
      ];

      // Current user is owner (not in editors list)
      authServiceMock.userEmail.mockReturnValue('owner@example.com');

      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: mockEditors,
        pendingInvitations: [],
      });

      const wrapper = mount(EditorsTab, {
        props: {
          calendarId: 'calendar-123',
        },
        global: {
          stubs: {
            ModalLayout: true,
            EmptyLayout: true,
            LoadingMessage: true,
            PillButton: PillButtonStub,
            Plus: IconStub,
            Mail: IconStub,
            Crown: IconStub,
            Globe: IconStub,
            ArrowUp: IconStub,
            Trash2: IconStub,
            X: IconStub,
          },
        },
      });

      await flushPromises();
      await nextTick();

      // Assert
      expect(wrapper.vm.canLeaveCalendar()).toBe(false);
      expect(wrapper.find('.btn-ghost--danger').exists()).toBe(false);
    });
  });

  describe('Grant edit access functionality', () => {
    it('should successfully grant edit access to a new editor', async () => {
      // Arrange
      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: [],
        pendingInvitations: [],
      });

      const newEditor = CalendarEditor.fromObject({
        id: 'editor-new',
        calendarId: 'calendar-123',
        email: 'newuser@example.com',
      });

      calendarServiceMock.grantEditAccess.mockResolvedValue(newEditor);

      const wrapper = mount(EditorsTab, {
        props: {
          calendarId: 'calendar-123',
        },
        global: {
          stubs: {
            ModalLayout: {
              template: '<div class="modal-stub"><slot /></div>',
            },
            EmptyLayout: {
              template: '<div class="empty-stub"><slot /></div>',
            },
            LoadingMessage: true,
            PillButton: PillButtonStub,
            Plus: IconStub,
            Mail: IconStub,
            Crown: IconStub,
            Globe: IconStub,
            ArrowUp: IconStub,
            Trash2: IconStub,
            X: IconStub,
          },
        },
      });

      await flushPromises();
      await nextTick();

      // Open add form
      await wrapper.find('.pill-button--primary').trigger('click');
      await nextTick();

      // Act
      // Fill in email
      const input = wrapper.find('#email');
      await input.setValue('newuser@example.com');
      await nextTick();

      // Submit form
      const addButton = wrapper.find('.add-editor-form .pill-button--primary');
      await addButton.trigger('click');
      await flushPromises();

      // Assert
      expect(calendarServiceMock.grantEditAccess).toHaveBeenCalledWith(
        'calendar-123',
        'newuser@example.com',
      );

      // Should close form and reload editors
      expect(wrapper.vm.state.showAddForm).toBe(false);
      expect(calendarServiceMock.listCalendarEditors).toHaveBeenCalledTimes(2);
    });

    it('should show error if editor already exists', async () => {
      // Arrange
      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: [],
        pendingInvitations: [],
      });

      calendarServiceMock.grantEditAccess.mockRejectedValue(
        new EditorAlreadyExistsError(),
      );

      const wrapper = mount(EditorsTab, {
        props: {
          calendarId: 'calendar-123',
        },
        global: {
          stubs: {
            ModalLayout: {
              template: '<div class="modal-stub"><slot /></div>',
            },
            EmptyLayout: {
              template: '<div class="empty-stub"><slot /></div>',
            },
            LoadingMessage: true,
            PillButton: PillButtonStub,
            Plus: IconStub,
            Mail: IconStub,
            Crown: IconStub,
            Globe: IconStub,
            ArrowUp: IconStub,
            Trash2: IconStub,
            X: IconStub,
          },
        },
      });

      await flushPromises();
      await nextTick();

      // Open add form
      await wrapper.find('.pill-button--primary').trigger('click');
      await nextTick();

      // Act
      await wrapper.find('#email').setValue('existing@example.com');
      await nextTick();

      const addButton = wrapper.find('.add-editor-form .pill-button--primary');
      await addButton.trigger('click');
      await flushPromises();

      // Assert
      expect(wrapper.vm.state.addError).toBe('error_editor_already_exists');
      expect(wrapper.vm.state.showAddForm).toBe(true); // Form should stay open
    });

    it('should show error if invitation already exists', async () => {
      // Arrange
      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: [],
        pendingInvitations: [],
      });

      calendarServiceMock.grantEditAccess.mockRejectedValue(
        new AccountInviteAlreadyExistsError(),
      );

      const wrapper = mount(EditorsTab, {
        props: {
          calendarId: 'calendar-123',
        },
        global: {
          stubs: {
            ModalLayout: {
              template: '<div class="modal-stub"><slot /></div>',
            },
            EmptyLayout: {
              template: '<div class="empty-stub"><slot /></div>',
            },
            LoadingMessage: true,
            PillButton: PillButtonStub,
            Plus: IconStub,
            Mail: IconStub,
            Crown: IconStub,
            Globe: IconStub,
            ArrowUp: IconStub,
            Trash2: IconStub,
            X: IconStub,
          },
        },
      });

      await flushPromises();
      await nextTick();

      // Open add form
      await wrapper.find('.pill-button--primary').trigger('click');
      await nextTick();

      // Act
      await wrapper.find('#email').setValue('invited@example.com');
      await nextTick();

      const addButton = wrapper.find('.add-editor-form .pill-button--primary');
      await addButton.trigger('click');
      await flushPromises();

      // Assert
      expect(wrapper.vm.state.addError).toBe('error_invite_already_exists');
      expect(wrapper.vm.state.showAddForm).toBe(true);
    });
  });

  describe('Invitation management', () => {
    it('should cancel a pending invitation', async () => {
      // Arrange
      const mockInvitations = [
        {
          id: 'invite-1',
          email: 'pending@example.com',
        },
      ];

      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: [],
        pendingInvitations: mockInvitations,
      });
      calendarServiceMock.cancelInvitation.mockResolvedValue(undefined);

      const wrapper = mount(EditorsTab, {
        props: {
          calendarId: 'calendar-123',
        },
        global: {
          stubs: {
            ModalLayout: true,
            EmptyLayout: true,
            LoadingMessage: true,
            PillButton: PillButtonStub,
            Plus: IconStub,
            Mail: IconStub,
            Crown: IconStub,
            Globe: IconStub,
            ArrowUp: IconStub,
            Trash2: IconStub,
            X: IconStub,
          },
        },
      });

      await flushPromises();
      await nextTick();

      // Act
      const cancelButton = wrapper.find('.btn-text:not(.btn-text--primary)');
      expect(cancelButton.exists()).toBe(true);

      await cancelButton.trigger('click');
      await flushPromises();

      // Assert
      expect(calendarServiceMock.cancelInvitation).toHaveBeenCalledWith(
        'calendar-123',
        'invite-1',
      );

      // Should reload editors after cancellation
      expect(calendarServiceMock.listCalendarEditors).toHaveBeenCalledTimes(2);
    });

    it('should resend a pending invitation', async () => {
      // Arrange
      const mockInvitations = [
        {
          id: 'invite-1',
          email: 'pending@example.com',
        },
      ];

      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: [],
        pendingInvitations: mockInvitations,
      });
      calendarServiceMock.resendInvitation.mockResolvedValue(undefined);

      const wrapper = mount(EditorsTab, {
        props: {
          calendarId: 'calendar-123',
        },
        global: {
          stubs: {
            ModalLayout: true,
            EmptyLayout: true,
            LoadingMessage: true,
            PillButton: PillButtonStub,
            Plus: IconStub,
            Mail: IconStub,
            Crown: IconStub,
            Globe: IconStub,
            ArrowUp: IconStub,
            Trash2: IconStub,
            X: IconStub,
          },
        },
      });

      await flushPromises();
      await nextTick();

      // Act
      const resendButton = wrapper.find('.btn-text--primary');
      expect(resendButton.exists()).toBe(true);

      await resendButton.trigger('click');
      await flushPromises();

      // Assert
      expect(calendarServiceMock.resendInvitation).toHaveBeenCalledWith(
        'calendar-123',
        'invite-1',
      );

      // Should show success message
      expect(wrapper.vm.state.success).toBeTruthy();
    });
  });

  describe('Error handling', () => {
    it('should display error when loading editors fails', async () => {
      // Arrange
      calendarServiceMock.listCalendarEditors.mockRejectedValue(
        new CalendarEditorPermissionError(),
      );

      // Act
      const wrapper = mount(EditorsTab, {
        props: {
          calendarId: 'calendar-123',
        },
        global: {
          stubs: {
            ModalLayout: true,
            EmptyLayout: true,
            LoadingMessage: true,
            PillButton: PillButtonStub,
            Plus: IconStub,
            Mail: IconStub,
            Crown: IconStub,
            Globe: IconStub,
            ArrowUp: IconStub,
            Trash2: IconStub,
            X: IconStub,
          },
        },
      });

      await flushPromises();
      await nextTick();

      // Assert
      expect(wrapper.vm.state.error).toBe('error_permission_denied');
      expect(wrapper.find('.alert--error').exists()).toBe(true);
    });

    it('should handle editor not found error during removal', async () => {
      // Arrange
      const mockEditors = [
        CalendarEditor.fromObject({
          id: 'editor-1',
          calendarId: 'calendar-123',
          email: 'bob@example.com',
        }),
      ];

      authServiceMock.userEmail.mockReturnValue('alice@example.com');

      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: mockEditors,
        pendingInvitations: [],
      });
      calendarServiceMock.revokeEditAccess.mockRejectedValue(
        new EditorNotFoundError(),
      );

      const wrapper = mount(EditorsTab, {
        props: {
          calendarId: 'calendar-123',
        },
        global: {
          stubs: {
            ModalLayout: {
              template: '<div class="modal-stub"><slot /></div>',
            },
            EmptyLayout: true,
            LoadingMessage: true,
            PillButton: PillButtonStub,
            Plus: IconStub,
            Mail: IconStub,
            Crown: IconStub,
            Globe: IconStub,
            ArrowUp: IconStub,
            Trash2: IconStub,
            X: IconStub,
          },
        },
      });

      await flushPromises();
      await nextTick();

      // Open confirmation
      await wrapper.find('.btn-ghost').trigger('click');
      await nextTick();

      // Act
      // Call the removeEditor method directly
      await wrapper.vm.removeEditor();
      await flushPromises();

      // Assert
      expect(wrapper.vm.state.error).toBe('error_editor_not_found');

      // Should remove editor from local list despite error
      expect(wrapper.vm.state.editors).toHaveLength(0);
    });
  });
});
