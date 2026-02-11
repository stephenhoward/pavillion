import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import { createPinia, setActivePinia, Pinia } from 'pinia';
import { nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';
import sinon from 'sinon';

import { Calendar } from '@/common/model/calendar';
import { mountComponent } from '@/client/test/lib/vue';
import EditEvent from '@/client/components/logged_in/calendar/edit_event.vue';
import CalendarService from '@/client/service/calendar';

// Mock useCalendarStore
vi.mock('@/client/stores/calendarStore', () => ({
  useCalendarStore: () => ({

    getLastInteractedCalendar: null,
    setLastInteractedCalendar: vi.fn(),
    calendars: [],
    addCalendar: vi.fn(),
  }),
}));

// Mock CategoryService
vi.mock('@/client/service/category', () => ({
  default: vi.fn().mockImplementation(() => ({
    getEventCategories: vi.fn().mockResolvedValue([]),
    assignCategoriesToEvent: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock useEventDuplication composable
vi.mock('@/client/composables/useEventDuplication', () => ({
  useEventDuplication: () => ({
    stripEventForDuplication: vi.fn((event) => {
      const cloned = event.clone();
      cloned.id = '';
      return cloned;
    }),
  }),
}));

// Mock EventService
vi.mock('@/client/service/event', () => ({
  default: vi.fn().mockImplementation(() => ({
    saveEvent: vi.fn().mockResolvedValue({ id: 'saved-event-id', calendarId: 'testCalendarId' }),
  })),
}));

// Stub component for other routes
const StubComponent = { template: '<div>Stub</div>' };

// Helper to wait for snapshot initialization
const waitForSnapshotReady = async (vm: any, timeout = 2000) => {
  const startTime = Date.now();
  while (!vm.snapshotReady && (Date.now() - startTime < timeout)) {
    await new Promise(resolve => setTimeout(resolve, 50));
    await nextTick();
  }
  if (!vm.snapshotReady) {
    throw new Error('Snapshot did not become ready within timeout');
  }
};

const routes: RouteRecordRaw[] = [
  { path: '/login', component: StubComponent, name: 'login', props: true },
  { path: '/logout', component: StubComponent, name: 'logout' },
  { path: '/calendar', component: StubComponent, name: 'calendars' },
  { path: '/calendar/:calendar', component: StubComponent, name: 'calendar' },
  { path: '/event', component: EditEvent, name: 'event_new' },
  { path: '/event/:eventId', component: EditEvent, name: 'event_edit', props: true },
];

const mountEditorOnRoute = async (routePath: string, calendars: Calendar[] = []) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });

  // Navigate to the specified route first
  await router.push(routePath);
  await router.isReady();

  // Stub loadCalendars
  sinon.stub(CalendarService.prototype, 'loadCalendars').resolves(calendars);

  const pinia = createPinia();
  setActivePinia(pinia);

  const wrapper = mountComponent(EditEvent, router, {
    pinia,
    provide: {
      site_config: {
        settings: () => ({}),
      },
    },
    stubs: {
      EventRecurrenceView: true,
      languagePicker: true,
      ImageUpload: true,
      CategorySelector: true,
      ModalLayout: true,
    },
  });

  // Wait for async initialization
  await flushPromises();
  await nextTick();
  await nextTick();
  await nextTick(); // Extra wait for snapshot initialization in onBeforeMount
  await nextTick();
  await nextTick();

  return {
    wrapper,
    router,
    pinia,
  };
};

describe('Unsaved Changes Detection', () => {
  let currentWrapper: any = null;
  let pinia: Pinia;

  beforeEach(() => {
    sinon.restore();
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    sinon.restore();
    if (currentWrapper) {
      currentWrapper.unmount();
      currentWrapper = null;
      await nextTick();
    }
  });

  describe('isDirty flag detection', () => {
    it('isDirty should be false on initial load', async () => {
      const calendar = new Calendar('testCalendarId', 'testName');
      calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

      const { wrapper } = await mountEditorOnRoute('/event', [calendar]);
      currentWrapper = wrapper;

      // The component should expose isDirty
      const vm = wrapper.vm as any;
      expect(vm.isDirty).toBe(false);
    });

    it('isDirty should become true when event name changes via vm', async () => {
      const calendar = new Calendar('testCalendarId', 'testName');
      calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

      const { wrapper } = await mountEditorOnRoute('/event', [calendar]);
      currentWrapper = wrapper;

      const vm = wrapper.vm as any;

      // Wait for snapshot to be ready
      await waitForSnapshotReady(vm);

      expect(vm.isDirty).toBe(false);

      // Directly modify the event content through the vm
      if (vm.state.event) {
        vm.state.event.content('en').name = 'Changed Event Name';
      }

      // Manually trigger dirty state check (watchers don't fire in test environment for direct mutations)
      vm.checkDirtyState();

      expect(vm.isDirty).toBe(true);
    });

    it('isDirty should become true when location field changes', async () => {
      const calendar = new Calendar('testCalendarId', 'testName');
      calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

      const { wrapper } = await mountEditorOnRoute('/event', [calendar]);
      currentWrapper = wrapper;

      const vm = wrapper.vm as any;

      // Wait for snapshot to be ready
      await waitForSnapshotReady(vm);

      expect(vm.isDirty).toBe(false);

      // Directly modify the location through the vm
      if (vm.state.event && vm.state.event.location) {
        vm.state.event.location.name = 'New Location Name';
      }

      // Manually trigger dirty state check (watchers don't fire in test environment for direct mutations)
      vm.checkDirtyState();

      expect(vm.isDirty).toBe(true);
    });
  });

  describe('Confirmation dialog behavior', () => {
    it('showUnsavedChangesDialog should be false initially', async () => {
      const calendar = new Calendar('testCalendarId', 'testName');
      calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

      const { wrapper } = await mountEditorOnRoute('/event', [calendar]);
      currentWrapper = wrapper;

      const vm = wrapper.vm as any;
      expect(vm.showUnsavedChangesDialog).toBe(false);
    });

    it('should set showUnsavedChangesDialog to true when isDirty and trying to leave', async () => {
      const calendar = new Calendar('testCalendarId', 'testName');
      calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

      const { wrapper} = await mountEditorOnRoute('/event', [calendar]);
      currentWrapper = wrapper;

      const vm = wrapper.vm as any;

      // Wait for snapshot to be ready
      await waitForSnapshotReady(vm);

      // Make a change to set dirty state
      if (vm.state.event) {
        vm.state.event.content('en').name = 'Changed Event Name';
      }

      // Manually trigger dirty state check (watchers don't fire in test environment for direct mutations)
      vm.checkDirtyState();

      expect(vm.isDirty).toBe(true);

      // Click the back button - should show dialog instead of navigating
      const backButton = wrapper.find('.back-button');
      await backButton.trigger('click');
      await nextTick();

      expect(vm.showUnsavedChangesDialog).toBe(true);
    });

    it('confirmLeave should close dialog and reset isDirty', async () => {
      const calendar = new Calendar('testCalendarId', 'testName');
      calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

      const { wrapper } = await mountEditorOnRoute('/event', [calendar]);
      currentWrapper = wrapper;

      const vm = wrapper.vm as any;

      // Wait for snapshot to be ready
      await waitForSnapshotReady(vm);

      // Make a change
      if (vm.state.event) {
        vm.state.event.content('en').name = 'Changed Event Name';
      }

      // Manually trigger dirty state check (watchers don't fire in test environment for direct mutations)
      vm.checkDirtyState();

      // Open dialog
      vm.showUnsavedChangesDialog = true;
      expect(vm.isDirty).toBe(true);

      // Confirm leave - this should reset isDirty
      vm.confirmLeave();

      // Check immediately after confirmLeave(), before watchers can re-run
      expect(vm.showUnsavedChangesDialog).toBe(false);
      expect(vm.isDirty).toBe(false);

      // In real usage, navigation would occur here and component would unmount
      // Unmount to simulate post-navigation state
      wrapper.unmount();
      currentWrapper = null;
    });

    it('cancelLeave should close dialog but keep isDirty true', async () => {
      const calendar = new Calendar('testCalendarId', 'testName');
      calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

      const { wrapper } = await mountEditorOnRoute('/event', [calendar]);
      currentWrapper = wrapper;

      const vm = wrapper.vm as any;

      // Wait for snapshot to be ready
      await waitForSnapshotReady(vm);

      // Make a change
      if (vm.state.event) {
        vm.state.event.content('en').name = 'Changed Event Name';
      }

      // Manually trigger dirty state check (watchers don't fire in test environment for direct mutations)
      vm.checkDirtyState();

      // Open dialog
      vm.showUnsavedChangesDialog = true;
      expect(vm.isDirty).toBe(true);

      // Cancel leave
      vm.cancelLeave();
      await nextTick();

      expect(vm.showUnsavedChangesDialog).toBe(false);
      expect(vm.isDirty).toBe(true);
    });
  });

  describe('Navigation without unsaved changes', () => {
    it('should not show dialog when navigating without changes', async () => {
      const calendar = new Calendar('testCalendarId', 'testName');
      calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

      const { wrapper } = await mountEditorOnRoute('/event', [calendar]);
      currentWrapper = wrapper;

      const vm = wrapper.vm as any;
      expect(vm.isDirty).toBe(false);

      // Click the back button - should not show dialog
      const backButton = wrapper.find('.back-button');
      await backButton.trigger('click');
      await nextTick();

      // No dialog should be shown because isDirty is false
      expect(vm.showUnsavedChangesDialog).toBe(false);
    });
  });
});
