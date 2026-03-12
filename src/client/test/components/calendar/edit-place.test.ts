import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import { mountComponent } from '@/client/test/lib/vue';
import EditPlaceView from '@/client/components/logged_in/calendar/edit-place.vue';
import { EventLocation, EventLocationContent } from '@/common/model/location';
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

vi.mock('@/client/service/location', () => ({
  default: vi.fn().mockImplementation(() => ({
    getLocationById: mockGetLocationById,
    createLocation: mockCreateLocation,
    updateLocation: mockUpdateLocation,
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

  const wrapper = mountComponent(EditPlaceView, router, {
    props: routeName === 'place_edit' ? { placeId: params.placeId } : {},
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
});
