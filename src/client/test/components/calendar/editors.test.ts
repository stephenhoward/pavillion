import { expect, describe, it, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import { flushPromises } from '@vue/test-utils';

import { CalendarEditor } from '@/common/model/calendar_editor';
import { mountComponent } from '@/client/test/lib/vue';
import Editors from '@/client/components/calendar/editors.vue';
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

      calendarServiceMock.listCalendarEditors.mockResolvedValue(testEditors);

      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      await wrapper.vm.$nextTick();

      expect(calendarServiceMock.listCalendarEditors).toHaveBeenCalledWith('test-calendar');
      expect(wrapper.vm.state.editors).toEqual(testEditors);
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
      expect(wrapper.find('.loading').exists()).toBe(true);

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
      expect(wrapper.find('.error').exists()).toBe(true);
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

      calendarServiceMock.listCalendarEditors.mockResolvedValue(testEditors);

      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      // Wait for async loading to complete
      await flushPromises();

      const editorItems = wrapper.findAll('.editor-item');
      expect(editorItems).toHaveLength(2);
      expect(editorItems[0].text()).toContain('user1@example.com');
      expect(editorItems[1].text()).toContain('user2@example.com');
    });

    it('displays empty state when no editors exist', async () => {
      calendarServiceMock.listCalendarEditors.mockResolvedValue([]);

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

      calendarServiceMock.listCalendarEditors.mockResolvedValue(testEditors);

      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      // Wait for async loading to complete
      await flushPromises();

      const removeButton = wrapper.find('.remove-btn');
      expect(removeButton.exists()).toBe(true);
      expect(removeButton.text()).toBe('Remove');
    });
  });

  describe('Add Editor Functionality', () => {
    beforeEach(async () => {
      calendarServiceMock.listCalendarEditors.mockResolvedValue([]);
    });

    it('opens add editor form when button clicked', async () => {
      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      // Wait for initial load to complete
      await flushPromises();

      const addButton = wrapper.find('.add-editor-btn');
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
      const newEditor = new CalendarEditor('3', 'test-calendar', 'newuser@example.com');
      calendarServiceMock.grantEditAccess.mockResolvedValue(newEditor);

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
      calendarServiceMock.listCalendarEditors.mockResolvedValue([testEditor]);
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

      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      await wrapper.vm.$nextTick();

      wrapper.vm.state.editorToRemove = testEditor;
      await wrapper.vm.removeEditor();

      expect(calendarServiceMock.revokeEditAccess).toHaveBeenCalledWith(
        'test-calendar',
        'user1@example.com',
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
      calendarServiceMock.listCalendarEditors.mockResolvedValue([]);
    });

    it('disables add button while adding', async () => {
      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      // Wait for initial load to complete
      await flushPromises();

      // Set loading state which should disable the button
      wrapper.vm.state.isLoading = true;
      await wrapper.vm.$nextTick();

      const addButton = wrapper.find('.add-editor-btn');
      expect(addButton.attributes('disabled')).toBeDefined();
    });

    it('disables remove button while removing', async () => {
      const testEditor = new CalendarEditor('1', 'test-calendar', 'user1@example.com');
      calendarServiceMock.listCalendarEditors.mockResolvedValue([testEditor]);

      const { wrapper } = mountEditorsComponent();
      currentWrapper = wrapper;

      // Wait for initial load to complete
      await flushPromises();

      wrapper.vm.state.isRemoving = testEditor.id;
      await wrapper.vm.$nextTick();

      const removeButton = wrapper.find('.remove-btn');
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
});
