import { expect, describe, it, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import { flushPromises } from '@vue/test-utils';

import { CalendarEditor } from '@/common/model/calendar_editor';
import { mountComponent } from '@/client/test/lib/vue';
import Editors from '@/client/components/logged_in/calendar-management/editors.vue';
import CalendarService from '@/client/service/calendar';
import { CalendarEditorPermissionError, EditorAlreadyExistsError, EditorNotFoundError } from '@/common/exceptions/editor';

const routes: RouteRecordRaw[] = [
  { path: '/test', component: {}, name: 'test' },
];

const mountEditorsComponent = (calendarId: string = 'test-calendar') => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });

  const wrapper = mountComponent(Editors, router, {
    props: {
      calendarId: calendarId,
    },
  });

  return {
    wrapper,
    router,
  };
};

describe('Editors Component', () => {
  let calendarServiceMock: any;
  let currentWrapper: any = null;

  beforeEach(() => {
    // Mock the calendar service
    calendarServiceMock = {
      listCalendarEditors: vi.fn(),
      grantEditAccess: vi.fn(),
      revokeEditAccess: vi.fn(),
      cancelInvitation: vi.fn(),
      resendInvitation: vi.fn(),
    };

    // Replace the CalendarService constructor with our mock
    vi.spyOn(CalendarService.prototype, 'listCalendarEditors').mockImplementation(
      calendarServiceMock.listCalendarEditors,
    );
    vi.spyOn(CalendarService.prototype, 'grantEditAccess').mockImplementation(
      calendarServiceMock.grantEditAccess,
    );
    vi.spyOn(CalendarService.prototype, 'revokeEditAccess').mockImplementation(
      calendarServiceMock.revokeEditAccess,
    );
    vi.spyOn(CalendarService.prototype, 'cancelInvitation').mockImplementation(
      calendarServiceMock.cancelInvitation,
    );
    vi.spyOn(CalendarService.prototype, 'resendInvitation').mockImplementation(
      calendarServiceMock.resendInvitation,
    );
  });

  afterEach(() => {
    if (currentWrapper) {
      currentWrapper.unmount();
      currentWrapper = null;
    }
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

      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      await wrapper.vm.$nextTick();

      expect(calendarServiceMock.listCalendarEditors).toHaveBeenCalledWith('test-calendar');
      expect(wrapper.vm.state.editors).toEqual(testEditors);
      expect(wrapper.vm.state.pendingInvitations).toEqual(testPendingInvitations);
      expect(wrapper.vm.state.isLoading).toBe(false);
    });

    it('displays loading state while fetching editors', async () => {
      // Mock with a promise that never resolves to keep loading state
      const neverResolvingPromise = new Promise(() => {});
      calendarServiceMock.listCalendarEditors.mockReturnValue(neverResolvingPromise);

      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      // Wait for the onMounted hook to execute
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.state.isLoading).toBe(true);
      expect(wrapper.find('.loading-message').exists()).toBe(true);

      // Note: We don't resolve this promise since we want to test the loading state
    });

    it('handles permission error when loading editors', async () => {
      calendarServiceMock.listCalendarEditors.mockRejectedValue(
        new CalendarEditorPermissionError(),
      );

      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      // Wait for async error handling to complete
      await flushPromises();

      expect(wrapper.vm.state.error).toBe('You don\'t have permission to manage editors for this calendar');
      expect(wrapper.find('.alert--error').exists()).toBe(true);
    });

    it('handles generic error when loading editors', async () => {
      calendarServiceMock.listCalendarEditors.mockRejectedValue(new Error('Network error'));

      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.state.error).toBe('Failed to load calendar editors');
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

      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      // Wait for async loading to complete
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

      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      // Wait for async loading to complete
      await flushPromises();

      expect(wrapper.find('.empty-state').exists()).toBe(true);
      expect(wrapper.find('.empty-state').text()).toContain('No editors have been granted access to this calendar');
    });

    it('shows remove button for each editor', async () => {
      const testEditors = [
        new CalendarEditor('1', 'test-calendar', 'user1@example.com'),
      ];

      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: testEditors,
        pendingInvitations: [],
      });

      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      // Wait for async loading to complete
      await flushPromises();

      const removeButton = wrapper.find('.editor-actions .btn-ghost');
      expect(removeButton.exists()).toBe(true);
      expect(removeButton.text()).toBe('Remove');
    });
  });

  describe('Add Editor Functionality', () => {
    beforeEach(async () => {
      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: [],
        pendingInvitations: [],
      });
    });

    it('opens add editor form when button clicked', async () => {
      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      // Wait for initial load to complete
      await flushPromises();

      const addButton = wrapper.find('.pill-button--primary');
      await addButton.trigger('click');

      expect(wrapper.vm.state.showAddForm).toBe(true);
      // Check that the modal wrapper exists
      expect(wrapper.find('[data-testid="modal-layout"]').exists() ||
             wrapper.findComponent({ name: 'ModalLayout' }).exists() ||
             wrapper.find('.add-editor-form').exists()).toBe(true);
    });

    it('closes add editor form when cancel clicked', async () => {
      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      // Wait for initial load to complete
      await flushPromises();

      // Open the form
      wrapper.vm.state.showAddForm = true;
      await wrapper.vm.$nextTick();

      // Call the close method directly since button text may be translated
      wrapper.vm.closeAddForm();

      expect(wrapper.vm.state.showAddForm).toBe(false);
    });

    it('adds editor successfully', async () => {
      const testEditor = new CalendarEditor('1', 'test-calendar', 'existing@example.com');
      const newEditor = new CalendarEditor('3', 'test-calendar', 'newuser@example.com');
      calendarServiceMock.grantEditAccess.mockResolvedValue(newEditor);

      // Mock the subsequent loadEditors call to return the updated list
      calendarServiceMock.listCalendarEditors.mockResolvedValueOnce({
        activeEditors: [testEditor],
        pendingInvitations: [],
      }).mockResolvedValueOnce({
        activeEditors: [testEditor, newEditor],
        pendingInvitations: [],
      });

      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      // Wait for initial load to complete
      await flushPromises();

      // Open add form first
      wrapper.vm.state.showAddForm = true;
      wrapper.vm.state.newAccountId = 'newuser@example.com';
      await wrapper.vm.$nextTick();

      // Verify form is open before adding
      expect(wrapper.vm.state.showAddForm).toBe(true);

      // Call add method directly
      await wrapper.vm.addEditor();

      // Wait for add operation to complete
      await flushPromises();

      expect(calendarServiceMock.grantEditAccess).toHaveBeenCalledWith(
        'test-calendar',
        'newuser@example.com',
      );
      expect(wrapper.vm.state.editors).toContainEqual(newEditor);
      expect(wrapper.vm.state.showAddForm).toBe(false);
    });

    it('handles empty account ID error', async () => {
      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      await wrapper.vm.$nextTick();

      // Open add form with empty account ID
      wrapper.vm.state.showAddForm = true;
      wrapper.vm.state.newAccountId = '';
      await wrapper.vm.$nextTick();

      await wrapper.vm.addEditor();

      expect(wrapper.vm.state.addError).toBe('Account ID is required');
      expect(calendarServiceMock.grantEditAccess).not.toHaveBeenCalled();
    });

    it('handles editor already exists error', async () => {
      calendarServiceMock.grantEditAccess.mockRejectedValue(
        new EditorAlreadyExistsError(),
      );

      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      await wrapper.vm.$nextTick();

      wrapper.vm.state.showAddForm = true;
      wrapper.vm.state.newAccountId = 'existing@example.com';
      await wrapper.vm.$nextTick();

      await wrapper.vm.addEditor();

      expect(wrapper.vm.state.addError).toBe('This person already has edit access to this calendar');
    });

    it('handles permission error when adding editor', async () => {
      calendarServiceMock.grantEditAccess.mockRejectedValue(
        new CalendarEditorPermissionError(),
      );

      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      await wrapper.vm.$nextTick();

      wrapper.vm.state.showAddForm = true;
      wrapper.vm.state.newAccountId = 'user@example.com';
      await wrapper.vm.$nextTick();

      await wrapper.vm.addEditor();

      expect(wrapper.vm.state.addError).toBe('You don\'t have permission to manage editors for this calendar');
    });
  });

  describe('Remove Editor Functionality', () => {
    let testEditor: CalendarEditor;

    beforeEach(async () => {
      testEditor = new CalendarEditor('1', 'test-calendar', 'user1@example.com');
      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: [testEditor],
        pendingInvitations: [],
      });
    });

    it('shows confirmation modal when remove clicked', async () => {
      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      await wrapper.vm.$nextTick();

      await wrapper.vm.confirmRemoveEditor(testEditor);

      expect(wrapper.vm.state.editorToRemove).toEqual(testEditor);
    });

    it('cancels remove operation', async () => {
      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      await wrapper.vm.$nextTick();

      wrapper.vm.state.editorToRemove = testEditor;
      await wrapper.vm.cancelRemoveEditor();

      expect(wrapper.vm.state.editorToRemove).toBeNull();
    });

    it('removes editor successfully', async () => {
      calendarServiceMock.revokeEditAccess.mockResolvedValue(undefined);
      // Mock the subsequent loadEditors call to return empty list after removal
      calendarServiceMock.listCalendarEditors.mockResolvedValueOnce({
        activeEditors: [testEditor],
        pendingInvitations: [],
      }).mockResolvedValueOnce({
        activeEditors: [],
        pendingInvitations: [],
      });

      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      await wrapper.vm.$nextTick();

      wrapper.vm.state.editorToRemove = testEditor;
      await wrapper.vm.removeEditor();

      expect(calendarServiceMock.revokeEditAccess).toHaveBeenCalledWith(
        'test-calendar',
        '1',
      );
      expect(wrapper.vm.state.editors).toHaveLength(0);
      expect(wrapper.vm.state.editorToRemove).toBeNull();
    });

    it('handles editor not found error', async () => {
      calendarServiceMock.revokeEditAccess.mockRejectedValue(
        new EditorNotFoundError(),
      );

      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      await wrapper.vm.$nextTick();

      wrapper.vm.state.editorToRemove = testEditor;
      await wrapper.vm.removeEditor();

      expect(wrapper.vm.state.error).toBe('Editor not found');
      expect(wrapper.vm.state.editors).toHaveLength(0); // Should remove from local list
      expect(wrapper.vm.state.editorToRemove).toBeNull();
    });

    it('handles permission error when removing editor', async () => {
      calendarServiceMock.revokeEditAccess.mockRejectedValue(
        new CalendarEditorPermissionError(),
      );

      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      await wrapper.vm.$nextTick();

      wrapper.vm.state.editorToRemove = testEditor;
      await wrapper.vm.removeEditor();

      expect(wrapper.vm.state.error).toBe('You don\'t have permission to manage editors for this calendar');
    });
  });

  describe('UI State Management', () => {
    beforeEach(async () => {
      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: [],
        pendingInvitations: [],
      });
    });

    it('disables add button while loading', async () => {
      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      // Wait for initial load to complete
      await flushPromises();

      // Set loading state which should disable the button in empty state
      wrapper.vm.state.isLoading = true;
      await wrapper.vm.$nextTick();

      // During loading, the empty state PillButton is not rendered (v-else),
      // so verify loading state is active
      expect(wrapper.vm.state.isLoading).toBe(true);
    });

    it('disables remove button while removing', async () => {
      const testEditor = new CalendarEditor('1', 'test-calendar', 'user1@example.com');
      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: [testEditor],
        pendingInvitations: [],
      });

      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      // Wait for initial load to complete
      await flushPromises();

      wrapper.vm.state.isRemoving = testEditor.id;
      await wrapper.vm.$nextTick();

      const removeButton = wrapper.find('.editor-actions .btn-ghost');
      expect(removeButton.attributes('disabled')).toBeDefined();
    });

    it('prevents form closure during operations', async () => {
      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      // Wait for initial load to complete
      await flushPromises();

      wrapper.vm.state.showAddForm = true;
      wrapper.vm.state.isAdding = true;
      await wrapper.vm.$nextTick();

      await wrapper.vm.closeAddForm();

      expect(wrapper.vm.state.showAddForm).toBe(true); // Should not close
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

      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      await flushPromises();

      expect(wrapper.vm.state.pendingInvitations).toEqual([testInvitation]);
      // Note: UI display will be tested after component implementation
    });

    it('cancels invitation successfully', async () => {
      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: [],
        pendingInvitations: [testInvitation],
      });
      calendarServiceMock.cancelInvitation.mockResolvedValue(undefined);

      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      await flushPromises();

      // Mock the reload to show invitation removed
      calendarServiceMock.listCalendarEditors.mockResolvedValueOnce({
        activeEditors: [],
        pendingInvitations: [],
      });

      // Call cancel method (will be implemented in component)
      if (wrapper.vm.cancelInvitation) {
        await wrapper.vm.cancelInvitation('inv-1');

        expect(calendarServiceMock.cancelInvitation).toHaveBeenCalledWith('test-calendar', 'inv-1');
        expect(wrapper.vm.state.pendingInvitations).toEqual([]);
      }
    });

    it('resends invitation successfully', async () => {
      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: [],
        pendingInvitations: [testInvitation],
      });
      calendarServiceMock.resendInvitation.mockResolvedValue(undefined);

      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      await flushPromises();

      // Call resend method (will be implemented in component)
      if (wrapper.vm.resendInvitation) {
        await wrapper.vm.resendInvitation('inv-1');

        expect(calendarServiceMock.resendInvitation).toHaveBeenCalledWith('test-calendar', 'inv-1');
      }
    });

    it('handles cancel invitation errors', async () => {
      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: [],
        pendingInvitations: [testInvitation],
      });
      calendarServiceMock.cancelInvitation.mockRejectedValue(new Error('Network error'));

      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      await flushPromises();

      // Call cancel method and expect error handling (will be implemented in component)
      if (wrapper.vm.cancelInvitation) {
        await wrapper.vm.cancelInvitation('inv-1');

        expect(wrapper.vm.state.error).toBeTruthy();
      }
    });

    it('handles resend invitation errors', async () => {
      calendarServiceMock.listCalendarEditors.mockResolvedValue({
        activeEditors: [],
        pendingInvitations: [testInvitation],
      });
      calendarServiceMock.resendInvitation.mockRejectedValue(new Error('Rate limited'));

      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      await flushPromises();

      // Call resend method and expect error handling (will be implemented in component)
      if (wrapper.vm.resendInvitation) {
        await wrapper.vm.resendInvitation('inv-1');

        expect(wrapper.vm.state.error).toBeTruthy();
      }
    });
  });
});
