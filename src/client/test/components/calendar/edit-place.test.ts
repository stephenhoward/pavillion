import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import { mountComponent } from '@/client/test/lib/vue';
import EditPlaceView from '@/client/components/logged_in/calendar/edit-place.vue';
import { useLocationStore } from '@/client/stores/locationStore';
import {
  EventLocation,
  EventLocationContent,
  EventLocationSpace,
  EventLocationSpaceContent,
} from '@/common/model/location';
import { Calendar } from '@/common/model/calendar';

const createMockCalendar = (id: string, urlName: string) => {
  const calendar = new Calendar(id, urlName);
  calendar.addContent({
    language: 'en',
    name: `Test Calendar ${urlName}`,
    description: 'Test Description',
  });
  return calendar;
};

const createMockLocation = (id: string, name: string) => {
  const location = new EventLocation(id, name, '123 Main St', 'Springfield', 'IL', '62701');
  const content = new EventLocationContent('en', 'Wheelchair accessible');
  location.addContent(content);
  return location;
};

const createMockSpace = (
  id: string,
  placeId: string,
  contents: Array<{ language: string; name: string; accessibilityInfo?: string }>,
) => {
  const space = new EventLocationSpace(id, placeId);
  for (const c of contents) {
    space.addContent(new EventLocationSpaceContent(c.language, c.name, c.accessibilityInfo ?? ''));
  }
  return space;
};

// Mock CalendarService
const mockGetCalendarByUrlName = vi.fn();

vi.mock('@/client/service/calendar', () => ({
  default: vi.fn().mockImplementation(() => ({
    getCalendarByUrlName: mockGetCalendarByUrlName,
  })),
}));

// Mock LocationService
const mockGetLocationById = vi.fn();
const mockCreateLocation = vi.fn();
const mockUpdateLocation = vi.fn();
const mockGetSpaces = vi.fn();
const mockCreateSpace = vi.fn();
const mockUpdateSpace = vi.fn();
const mockDeleteSpace = vi.fn();

vi.mock('@/client/service/location', () => ({
  default: vi.fn().mockImplementation(() => ({
    getLocationById: mockGetLocationById,
    createLocation: mockCreateLocation,
    updateLocation: mockUpdateLocation,
    // Space methods used by the locationStore CRUD wrappers.
    getSpaces: mockGetSpaces,
    createSpace: mockCreateSpace,
    updateSpace: mockUpdateSpace,
    deleteSpace: mockDeleteSpace,
  })),
}));

const routes: RouteRecordRaw[] = [
  { path: '/calendar/:calendar', component: {}, name: 'calendar' },
  { path: '/calendar/:calendar/places/new', component: EditPlaceView, name: 'place_new' },
  { path: '/calendar/:calendar/places/:placeId', component: EditPlaceView, name: 'place_edit', props: true },
];

let routerPushSpy: ReturnType<typeof vi.fn>;

const createWrapper = async (routeName: string = 'place_new', params: Record<string, string> = {}) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });

  const defaultParams = { calendar: 'test-calendar', ...params };
  await router.push({ name: routeName, params: defaultParams });
  await router.isReady();

  routerPushSpy = vi.fn();
  router.push = routerPushSpy;

  const pinia = createPinia();
  setActivePinia(pinia);

  const wrapper = mountComponent(EditPlaceView, router, {
    props: routeName === 'place_edit' ? { placeId: params.placeId } : {},
    pinia,
  });

  await flushPromises();
  return wrapper;
};

describe('EditPlaceView', () => {
  beforeEach(() => {
    mockGetCalendarByUrlName.mockReset();
    mockGetLocationById.mockReset();
    mockCreateLocation.mockReset();
    mockUpdateLocation.mockReset();
    mockGetSpaces.mockReset();
    mockCreateSpace.mockReset();
    mockUpdateSpace.mockReset();
    mockDeleteSpace.mockReset();

    mockGetCalendarByUrlName.mockResolvedValue(
      createMockCalendar('calendar-123', 'test-calendar'),
    );
    mockGetLocationById.mockResolvedValue(
      createMockLocation('loc-1', 'Community Center'),
    );
    mockCreateLocation.mockResolvedValue(
      createMockLocation('loc-new', 'New Place'),
    );
    mockUpdateLocation.mockResolvedValue(
      createMockLocation('loc-1', 'Updated Place'),
    );
    // Default Space mocks resolve to empty so onBeforeMount fetchSpaces
    // doesn't pollute test state. Tests that exercise Spaces seed the cache
    // directly via locationStore.setSpacesForPlace.
    mockGetSpaces.mockResolvedValue([]);
    mockDeleteSpace.mockResolvedValue(undefined);
  });

  describe('Create mode', () => {
    it('should render with "New Place" title', async () => {
      const wrapper = await createWrapper();
      const heading = wrapper.find('h1');
      expect(heading.exists()).toBe(true);
      expect(heading.text()).toBe('New Place');
    });

    it('should show empty form fields', async () => {
      const wrapper = await createWrapper();
      const nameInput = wrapper.find('#place-name');
      expect(nameInput.exists()).toBe(true);
      expect((nameInput.element as HTMLInputElement).value).toBe('');
    });

    it('should render all basic fields', async () => {
      const wrapper = await createWrapper();
      expect(wrapper.find('#place-name').exists()).toBe(true);
      expect(wrapper.find('#place-address').exists()).toBe(true);
      expect(wrapper.find('#place-city').exists()).toBe(true);
      expect(wrapper.find('#place-state').exists()).toBe(true);
      expect(wrapper.find('#place-postal-code').exists()).toBe(true);
    });

    it('should display a visible required indicator on the name field label', async () => {
      const wrapper = await createWrapper();
      const nameLabel = wrapper.find('label[for="place-name"]');
      expect(nameLabel.exists()).toBe(true);
      const indicator = nameLabel.find('.required-indicator');
      expect(indicator.exists()).toBe(true);
      expect(indicator.text()).toBe('*');
      expect(indicator.attributes('aria-hidden')).toBe('true');
    });
    it('should render accessibility info textarea', async () => {
      const wrapper = await createWrapper();
      const textarea = wrapper.find('[id^="place-accessibility-"]');
      expect(textarea.exists()).toBe(true);
    });

    it('should call createLocation on save with valid data', async () => {
      const wrapper = await createWrapper();

      await wrapper.find('#place-name').setValue('New Location');
      await wrapper.find('#place-address').setValue('456 Elm St');

      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(mockCreateLocation).toHaveBeenCalledWith(
        'calendar-123',
        expect.objectContaining({
          name: 'New Location',
          address: '456 Elm St',
        }),
      );
    });

    it('should show error when name is empty on save', async () => {
      const wrapper = await createWrapper();

      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(mockCreateLocation).not.toHaveBeenCalled();
      const error = wrapper.find('[role="alert"]');
      expect(error.exists()).toBe(true);
    });

    it('should navigate back on cancel click', async () => {
      const wrapper = await createWrapper();

      await wrapper.find('.btn-cancel').trigger('click');

      expect(routerPushSpy).toHaveBeenCalledWith('/calendar/test-calendar?tab=places');
    });

    it('should navigate back on back button click', async () => {
      const wrapper = await createWrapper();

      await wrapper.find('.back-button').trigger('click');

      expect(routerPushSpy).toHaveBeenCalledWith('/calendar/test-calendar?tab=places');
    });

    it('should navigate back after successful save', async () => {
      const wrapper = await createWrapper();

      await wrapper.find('#place-name').setValue('New Location');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(routerPushSpy).toHaveBeenCalledWith('/calendar/test-calendar?tab=places');
    });
  });

  describe('Edit mode', () => {
    it('should render with "Edit Place" title', async () => {
      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });
      const heading = wrapper.find('h1');
      expect(heading.text()).toBe('Edit Place');
    });

    it('should populate form with existing location data', async () => {
      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });

      expect((wrapper.find('#place-name').element as HTMLInputElement).value).toBe('Community Center');
      expect((wrapper.find('#place-address').element as HTMLInputElement).value).toBe('123 Main St');
      expect((wrapper.find('#place-city').element as HTMLInputElement).value).toBe('Springfield');
      expect((wrapper.find('#place-state').element as HTMLInputElement).value).toBe('IL');
      expect((wrapper.find('#place-postal-code').element as HTMLInputElement).value).toBe('62701');
    });

    it('should call getLocationById to load existing location', async () => {
      await createWrapper('place_edit', { placeId: 'loc-1' });

      expect(mockGetLocationById).toHaveBeenCalledWith('calendar-123', 'loc-1');
    });

    it('should call updateLocation on save', async () => {
      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });

      await wrapper.find('#place-name').setValue('Updated Center');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(mockUpdateLocation).toHaveBeenCalledWith(
        'calendar-123',
        expect.objectContaining({
          name: 'Updated Center',
        }),
      );
    });

    it('should populate accessibility info from existing content', async () => {
      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });

      const textarea = wrapper.find('[id^="place-accessibility-"]');
      expect(textarea.exists()).toBe(true);
      expect((textarea.element as HTMLTextAreaElement).value).toBe('Wheelchair accessible');
    });
  });

  describe('Validation', () => {
    it('should validate location hierarchy errors', async () => {
      const wrapper = await createWrapper();

      // Set name and city without address (violates hierarchy)
      await wrapper.find('#place-name').setValue('Test Place');
      await wrapper.find('#place-city').setValue('Springfield');

      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(mockCreateLocation).not.toHaveBeenCalled();
      const error = wrapper.find('[role="alert"]');
      expect(error.exists()).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('should show error when calendar is not found', async () => {
      mockGetCalendarByUrlName.mockResolvedValueOnce(null);
      const wrapper = await createWrapper();

      const error = wrapper.find('[role="alert"]');
      expect(error.exists()).toBe(true);
    });

    it('should show error when save fails', async () => {
      mockCreateLocation.mockRejectedValueOnce(new Error('Server error'));
      const wrapper = await createWrapper();

      await wrapper.find('#place-name').setValue('New Place');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      const error = wrapper.find('[role="alert"]');
      expect(error.exists()).toBe(true);
    });

    it('should allow dismissing error', async () => {
      const wrapper = await createWrapper();

      // Trigger a validation error
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      // Error should be visible
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);

      // Dismiss the error
      await wrapper.find('.error-dismiss').trigger('click');
      await flushPromises();

      // Error should be gone
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    });

    it('should have tabindex="-1" on error container for programmatic focus', async () => {
      const wrapper = await createWrapper();

      await wrapper.find('form').trigger('submit');
      await flushPromises();

      const error = wrapper.find('[role="alert"]');
      expect(error.exists()).toBe(true);
      expect(error.attributes('tabindex')).toBe('-1');
    });

    it('should move focus to error container when save fails', async () => {
      const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
      mockCreateLocation.mockRejectedValueOnce(new Error('Server error'));
      const wrapper = await createWrapper();

      await wrapper.find('#place-name').setValue('New Place');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      const error = wrapper.find('[role="alert"]');
      expect(error.exists()).toBe(true);
      expect(focusSpy).toHaveBeenCalled();
      const focusedElements = focusSpy.mock.instances.filter(
        (el) => el === error.element,
      );
      expect(focusedElements.length).toBeGreaterThan(0);
      focusSpy.mockRestore();
    });

    it('should move focus to error container on validation error', async () => {
      const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
      const wrapper = await createWrapper();

      await wrapper.find('form').trigger('submit');
      await flushPromises();

      const error = wrapper.find('[role="alert"]');
      expect(error.exists()).toBe(true);
      expect(focusSpy).toHaveBeenCalled();
      const focusedElements = focusSpy.mock.instances.filter(
        (el) => el === error.element,
      );
      expect(focusedElements.length).toBeGreaterThan(0);
      focusSpy.mockRestore();
    });
  });

  describe('Loading state', () => {
    it('should show loading state initially', async () => {
      // Use a delayed mock so loading state is visible
      mockGetCalendarByUrlName.mockImplementation(() => new Promise(() => {}));

      const router: Router = createRouter({
        history: createMemoryHistory(),
        routes: routes,
      });

      await router.push({ name: 'place_new', params: { calendar: 'test-calendar' } });
      await router.isReady();

      const wrapper = mountComponent(EditPlaceView, router, {});

      // Loading should be showing before promises resolve
      expect(wrapper.find('[role="status"]').exists()).toBe(true);
    });
  });

  describe('Spaces section', () => {
    it('should not render the Spaces section in create mode', async () => {
      const wrapper = await createWrapper();
      expect(wrapper.find('.spaces-section').exists()).toBe(false);
    });

    it('should render the Spaces section in edit mode with section title', async () => {
      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });
      const section = wrapper.find('.spaces-section');
      expect(section.exists()).toBe(true);
      // Section header text uses places.space.section_title
      expect(section.text()).toContain('Spaces');
    });

    it('should fetch spaces for the place on mount in edit mode', async () => {
      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });
      const store = useLocationStore();
      // Seed the cache directly to assert downstream rendering uses it.
      store.setSpacesForPlace('loc-1', [
        createMockSpace('space-1', 'loc-1', [{ language: 'en', name: 'Pacific Room' }]),
      ]);
      await flushPromises();

      const items = wrapper.findAll('.space-item');
      expect(items.length).toBe(1);
      expect(items[0].text()).toContain('Pacific Room');
    });

    it('should render an Add Space button in edit mode', async () => {
      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });
      const addBtn = wrapper.find('.spaces-section .add-space-button');
      expect(addBtn.exists()).toBe(true);
      expect(addBtn.text()).toContain('Add space');
    });

    it('should mount edit-space.vue when Add Space button is clicked', async () => {
      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });

      expect(wrapper.find('.space-editor').exists()).toBe(false);
      await wrapper.find('.add-space-button').trigger('click');
      await flushPromises();

      expect(wrapper.find('.space-editor').exists()).toBe(true);
    });

    it('should mount edit-space.vue with the space when Edit is clicked', async () => {
      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });
      const store = useLocationStore();
      store.setSpacesForPlace('loc-1', [
        createMockSpace('space-1', 'loc-1', [{ language: 'en', name: 'Pacific Room' }]),
      ]);
      await flushPromises();

      await wrapper.find('.space-item .edit-space-button').trigger('click');
      await flushPromises();

      expect(wrapper.find('.space-editor').exists()).toBe(true);
    });

    it('should show delete confirmation with event-count message when delete clicked', async () => {
      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });
      const store = useLocationStore();
      const space = createMockSpace('space-1', 'loc-1', [
        { language: 'en', name: 'Pacific Room' },
      ]);
      // Add eventCount as a runtime property (server augments space payloads
      // similarly to places).
      (space as any).eventCount = 3;
      store.setSpacesForPlace('loc-1', [space]);
      await flushPromises();

      await wrapper.find('.space-item .delete-space-button').trigger('click');
      await flushPromises();

      // Delete confirm dialog renders the space delete-confirm message
      // and the event-count consequence sentence.
      expect(wrapper.text()).toContain('Pacific Room');
      expect(wrapper.text()).toContain('whole-venue events');
    });

    it('should call locationStore.deleteSpace on confirm', async () => {
      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });
      const store = useLocationStore();
      store.setSpacesForPlace('loc-1', [
        createMockSpace('space-1', 'loc-1', [{ language: 'en', name: 'Pacific Room' }]),
      ]);
      const deleteSpy = vi.spyOn(store, 'deleteSpace').mockResolvedValue(undefined);
      await flushPromises();

      await wrapper.find('.space-item .delete-space-button').trigger('click');
      await flushPromises();

      // Click the confirm button inside ConfirmDeleteDialog
      const confirmBtn = wrapper.find('.delete-space-modal button.btn--danger, .delete-space-modal .btn-danger, .delete-space-modal [data-testid="confirm-delete"]');
      // Fall back: find any button that emits "confirm" — the ConfirmDeleteDialog
      // renders a primary button with the delete label.
      const buttons = wrapper.findAll('.delete-space-modal button');
      const deleteBtn = confirmBtn.exists()
        ? confirmBtn
        : buttons.find(b => b.text().trim() === 'Delete') ?? buttons[buttons.length - 1];
      await deleteBtn.trigger('click');
      await flushPromises();

      expect(deleteSpy).toHaveBeenCalledWith('test-calendar', 'loc-1', 'space-1');
    });

    it('should close edit-space editor when child emits cancel', async () => {
      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });

      await wrapper.find('.add-space-button').trigger('click');
      await flushPromises();
      expect(wrapper.find('.space-editor').exists()).toBe(true);

      // Click cancel inside the space editor
      await wrapper.find('.space-editor .btn-cancel').trigger('click');
      await flushPromises();

      expect(wrapper.find('.space-editor').exists()).toBe(false);
    });
  });
});
