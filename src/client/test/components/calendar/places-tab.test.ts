import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import { nextTick } from 'vue';
import { mountComponent } from '@/client/test/lib/vue';
import PlacesTab from '@/client/components/logged_in/calendar/places-tab.vue';
import LocationService from '@/client/service/location';
import { EventLocation } from '@/common/model/location';

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
};

vi.mock('@/client/composables/useToast', () => ({
  useToast: () => mockToast,
}));

const routes: RouteRecordRaw[] = [
  { path: '/calendar/:calendar', component: {}, name: 'calendar' },
  { path: '/calendar/:calendar/places/new', component: {}, name: 'place_new' },
  { path: '/calendar/:calendar/places/:placeId', component: {}, name: 'place_edit' },
];

let routerPushSpy: ReturnType<typeof vi.fn>;

const createWrapper = (props = {}) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });

  router.push({
    name: 'calendar',
    params: { calendar: 'test-calendar' },
  });

  routerPushSpy = vi.fn();
  router.push = routerPushSpy;

  return mountComponent(PlacesTab, router, {
    props: {
      calendarId: 'calendar-123',
      calendarUrlName: 'test-calendar',
      ...props,
    },
  });
};

/**
 * Helper to create a test location with optional event count
 */
function createTestLocation(id: string, name: string, eventCount: number = 0): EventLocation & { eventCount: number } {
  const location = new EventLocation(id, name, '123 Main St', 'Springfield', 'IL', '62701', 'US');
  return Object.assign(location, { eventCount });
}

describe('Places Tab Component', () => {
  let wrapper: any;

  beforeEach(() => {
    vi.spyOn(LocationService.prototype, 'getLocations').mockResolvedValue([]);
    mockToast.success.mockClear();
    mockToast.error.mockClear();
    mockToast.warning.mockClear();
    mockToast.info.mockClear();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.restoreAllMocks();
  });

  describe('Empty state', () => {
    it('renders empty state when no locations exist', async () => {
      vi.spyOn(LocationService.prototype, 'getLocations').mockResolvedValue([]);

      wrapper = createWrapper();
      await nextTick();
      await nextTick();

      expect(wrapper.text()).toContain('No places');
    });

    it('shows add button in empty state', async () => {
      vi.spyOn(LocationService.prototype, 'getLocations').mockResolvedValue([]);

      wrapper = createWrapper();
      await nextTick();
      await nextTick();

      const addButton = wrapper.findAll('button').find(
        (b: any) => b.text().includes('Add Place'),
      );
      expect(addButton).toBeTruthy();
    });
  });

  describe('Location list', () => {
    it('renders location cards when locations exist', async () => {
      const locations = [
        createTestLocation('loc-1', 'Community Center', 5),
        createTestLocation('loc-2', 'City Hall', 2),
      ];
      vi.spyOn(LocationService.prototype, 'getLocations').mockResolvedValue(locations);

      wrapper = createWrapper();
      await nextTick();
      await nextTick();

      expect(wrapper.text()).toContain('Community Center');
      expect(wrapper.text()).toContain('City Hall');
    });

    it('displays location address information', async () => {
      const locations = [
        createTestLocation('loc-1', 'Community Center', 0),
      ];
      vi.spyOn(LocationService.prototype, 'getLocations').mockResolvedValue(locations);

      wrapper = createWrapper();
      await nextTick();
      await nextTick();

      expect(wrapper.text()).toContain('123 Main St');
      expect(wrapper.text()).toContain('Springfield');
    });

    it('shows header with title and add button when locations exist', async () => {
      const locations = [createTestLocation('loc-1', 'Community Center')];
      vi.spyOn(LocationService.prototype, 'getLocations').mockResolvedValue(locations);

      wrapper = createWrapper();
      await nextTick();
      await nextTick();

      expect(wrapper.text()).toContain('Places');
      const addButton = wrapper.findAll('button').find(
        (b: any) => b.text().includes('Add Place'),
      );
      expect(addButton).toBeTruthy();
    });

    it('hides decorative MapPin icon from accessibility tree', async () => {
      const locations = [createTestLocation('loc-1', 'Community Center')];
      vi.spyOn(LocationService.prototype, 'getLocations').mockResolvedValue(locations);

      wrapper = createWrapper();
      await nextTick();
      await nextTick();

      const placeIcon = wrapper.find('.place-icon svg');
      expect(placeIcon.exists()).toBe(true);
      expect(placeIcon.attributes('aria-hidden')).toBe('true');
    });
  });

  describe('Navigation', () => {
    it('navigates to create route when add button is clicked', async () => {
      vi.spyOn(LocationService.prototype, 'getLocations').mockResolvedValue([]);

      wrapper = createWrapper();
      await nextTick();
      await nextTick();

      const addButton = wrapper.findAll('button').find(
        (b: any) => b.text().includes('Add Place'),
      );
      await addButton.trigger('click');
      await nextTick();

      expect(routerPushSpy).toHaveBeenCalledWith({
        name: 'place_new',
        params: { calendar: 'test-calendar' },
      });
    });

    it('navigates to edit route when edit button is clicked', async () => {
      const locations = [createTestLocation('loc-1', 'Community Center')];
      vi.spyOn(LocationService.prototype, 'getLocations').mockResolvedValue(locations);

      wrapper = createWrapper();
      await nextTick();
      await nextTick();

      const editButton = wrapper.findAll('button').find(
        (b: any) => b.attributes('aria-label')?.includes('Edit'),
      );
      expect(editButton).toBeTruthy();
      await editButton.trigger('click');
      await nextTick();

      expect(routerPushSpy).toHaveBeenCalledWith({
        name: 'place_edit',
        params: {
          calendar: 'test-calendar',
          placeId: 'loc-1',
        },
      });
    });
  });

  describe('Delete', () => {
    it('shows delete confirmation dialog when delete button is clicked', async () => {
      const locations = [createTestLocation('loc-1', 'Community Center', 3)];
      vi.spyOn(LocationService.prototype, 'getLocations').mockResolvedValue(locations);

      wrapper = createWrapper();
      await nextTick();
      await nextTick();

      const deleteButton = wrapper.findAll('button').find(
        (b: any) => b.attributes('aria-label')?.includes('Delete'),
      );
      expect(deleteButton).toBeTruthy();
      await deleteButton.trigger('click');
      await nextTick();

      expect(wrapper.text()).toContain('Community Center');
      expect(wrapper.text()).toContain('3');
    });

    it('calls deleteLocation and refreshes list on confirm', async () => {
      const locations = [createTestLocation('loc-1', 'Community Center')];
      vi.spyOn(LocationService.prototype, 'getLocations').mockResolvedValue(locations);
      const deleteSpy = vi.spyOn(LocationService.prototype, 'deleteLocation').mockResolvedValue();

      wrapper = createWrapper();
      await nextTick();
      await nextTick();

      // Open delete dialog
      const deleteButton = wrapper.findAll('button').find(
        (b: any) => b.attributes('aria-label')?.includes('Delete'),
      );
      await deleteButton.trigger('click');
      await nextTick();

      // Confirm delete
      const confirmButton = wrapper.findAll('button').find(
        (b: any) => b.text().includes('Delete') && !b.attributes('aria-label'),
      );
      expect(confirmButton).toBeTruthy();
      await confirmButton.trigger('click');
      await nextTick();
      await nextTick();

      expect(deleteSpy).toHaveBeenCalledWith('calendar-123', 'loc-1');
    });

    it('closes delete dialog on cancel', async () => {
      const locations = [createTestLocation('loc-1', 'Community Center')];
      vi.spyOn(LocationService.prototype, 'getLocations').mockResolvedValue(locations);

      wrapper = createWrapper();
      await nextTick();
      await nextTick();

      // Open delete dialog
      const deleteButton = wrapper.findAll('button').find(
        (b: any) => b.attributes('aria-label')?.includes('Delete'),
      );
      await deleteButton.trigger('click');
      await nextTick();

      // Cancel
      const cancelButton = wrapper.findAll('button').find(
        (b: any) => b.text().includes('Cancel'),
      );
      await cancelButton.trigger('click');
      await nextTick();

      // Dialog should be closed - delete confirmation text should not be present
      expect(wrapper.text()).not.toContain('Are you sure');
    });

    it('shows toast on successful delete', async () => {
      const locations = [createTestLocation('loc-1', 'Community Center')];
      vi.spyOn(LocationService.prototype, 'getLocations').mockResolvedValue(locations);
      vi.spyOn(LocationService.prototype, 'deleteLocation').mockResolvedValue();

      wrapper = createWrapper();
      await nextTick();
      await nextTick();

      // Open delete dialog
      const deleteButton = wrapper.findAll('button').find(
        (b: any) => b.attributes('aria-label')?.includes('Delete'),
      );
      await deleteButton.trigger('click');
      await nextTick();

      // Confirm delete
      const confirmButton = wrapper.findAll('button').find(
        (b: any) => b.text().includes('Delete') && !b.attributes('aria-label'),
      );
      await confirmButton.trigger('click');
      await nextTick();
      await nextTick();

      expect(mockToast.success).toHaveBeenCalled();
    });

    it('shows toast on delete error', async () => {
      const locations = [createTestLocation('loc-1', 'Community Center')];
      vi.spyOn(LocationService.prototype, 'getLocations').mockResolvedValue(locations);
      vi.spyOn(LocationService.prototype, 'deleteLocation').mockRejectedValue(new Error('Server error'));

      wrapper = createWrapper();
      await nextTick();
      await nextTick();

      // Open delete dialog
      const deleteButton = wrapper.findAll('button').find(
        (b: any) => b.attributes('aria-label')?.includes('Delete'),
      );
      await deleteButton.trigger('click');
      await nextTick();

      // Confirm delete
      const confirmButton = wrapper.findAll('button').find(
        (b: any) => b.text().includes('Delete') && !b.attributes('aria-label'),
      );
      await confirmButton.trigger('click');
      await nextTick();
      await nextTick();

      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('shows error message when loading fails', async () => {
      vi.spyOn(LocationService.prototype, 'getLocations').mockRejectedValue(new Error('Network error'));

      wrapper = createWrapper();
      await nextTick();
      await nextTick();

      const errorAlert = wrapper.find('.alert--error');
      expect(errorAlert.exists()).toBe(true);
    });
  });

  describe('Loading state', () => {
    it('shows loading message while fetching locations', async () => {
      let resolvePromise: (value: any) => void;
      const loadPromise = new Promise(resolve => { resolvePromise = resolve; });
      vi.spyOn(LocationService.prototype, 'getLocations').mockReturnValue(loadPromise as Promise<EventLocation[]>);

      wrapper = createWrapper();
      await nextTick();

      expect(wrapper.find('[aria-busy="true"]').exists()).toBe(true);

      resolvePromise!([]);
      await nextTick();
      await nextTick();

      expect(wrapper.find('[aria-busy="true"]').exists()).toBe(false);
    });
  });
});
