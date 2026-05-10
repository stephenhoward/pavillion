import { expect, describe, it, afterEach, beforeEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import { createPinia, setActivePinia, Pinia } from 'pinia';
import sinon from 'sinon';
import { nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';
import axios from 'axios';

import { EventLocation, EventLocationSpace, EventLocationSpaceContent } from '@/common/model/location';
import { Calendar } from '@/common/model/calendar';
import { mountComponent } from '@/client/test/lib/vue';
import EditEvent from '@/client/components/logged_in/calendar/edit_event.vue';
import CalendarService from '@/client/service/calendar';

// Mock useCalendarStore
vi.mock('@/client/stores/calendarStore', () => ({
  useCalendarStore: () => ({

    selectedCalendar: null,
    setSelectedCalendar: vi.fn(),
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

// Module-level LocationService mocks so individual tests can configure
// per-call return values via the exported handles (e.g. seed a freshly-
// created Place with inline spaces[] for the post-create flow).
const locationServiceMocks = {
  getLocations: vi.fn().mockResolvedValue([]),
  createLocation: vi.fn().mockResolvedValue({}),
  getLocationById: vi.fn().mockResolvedValue({}),
  updateLocation: vi.fn().mockResolvedValue({}),
};

// Mock LocationService
vi.mock('@/client/service/location', () => ({
  default: vi.fn().mockImplementation(() => locationServiceMocks),
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

const routes: RouteRecordRaw[] = [
  { path: '/login', component: {}, name: 'login', props: true },
  { path: '/logout', component: {}, name: 'logout' },
  { path: '/calendar', component: {}, name: 'calendars' },
  { path: '/calendar/:calendar', component: {}, name: 'calendar' },
  { path: '/event', component: EditEvent, name: 'event_new' },
  { path: '/event/:eventId', component: EditEvent, name: 'event_edit', props: true },
];

const mountedEditorOnRoute = async (routePath: string, calendars: Calendar[] = [], props = {}) => {
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
    props,
    stubs: {
      EventRecurrenceView: true,
      languagePicker: true,
      ImageUpload: true,
      CategorySelector: true,
    },
  });

  // Wait for async initialization
  await flushPromises();
  await nextTick();
  await nextTick();

  return {
    wrapper,
    router,
  };
};

describe('Editor Behavior - Route-Based', () => {
  let currentWrapper: any = null;
  let pinia: Pinia;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    // Restore any sinon stubs before each test
    sinon.restore();
    sandbox = sinon.createSandbox();
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    sandbox.restore();
    // Properly unmount Vue component and wait for cleanup
    if (currentWrapper) {
      currentWrapper.unmount();
      currentWrapper = null;
      await nextTick();
    }
  });

  it('create mode - no calendars redirects to calendar creation', async () => {
    // With no calendars, the component should redirect
    const { wrapper, router } = await mountedEditorOnRoute('/event', []);
    currentWrapper = wrapper;

    // After initialization with no calendars, should redirect to calendars
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('calendars');
  });

  it('create mode - with calendar initializes form', async () => {
    const calendar = new Calendar('testId', 'testName');
    calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

    const { wrapper } = await mountedEditorOnRoute('/event', [calendar]);
    currentWrapper = wrapper;

    // The form should be rendered
    const form = wrapper.find('form');
    expect(form.exists()).toBe(true);

    // Should have event editor page layout
    const pageContainer = wrapper.find('.event-editor-page');
    expect(pageContainer.exists()).toBe(true);
  });

  it('create mode displays correct title', async () => {
    const calendar = new Calendar('testId', 'testName');
    calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

    const { wrapper } = await mountedEditorOnRoute('/event', [calendar]);
    currentWrapper = wrapper;

    // Should show create title in page header (either translation key or translated text)
    const header = wrapper.find('.page-header h1');
    expect(header.exists()).toBe(true);
    expect(header.text().toLowerCase()).toMatch(/create/i);
  });

  it('duplication mode - from query parameter shows duplicate title', async () => {
    const calendar = new Calendar('testCalendarId', 'testName');
    calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

    // Mock axios.get for loading source event
    sandbox.stub(axios, 'get').resolves({
      data: {
        id: 'originalId',
        calendarId: 'testCalendarId',
        schedules: [],
        content: { en: { language: 'en', name: 'Original Event', description: 'Test' } },
        location: {},
        categories: [],
      },
    });

    const { wrapper } = await mountedEditorOnRoute('/event?from=originalId', [calendar]);
    currentWrapper = wrapper;

    // Should show duplicate title (either translation key or translated text)
    const header = wrapper.find('.page-header h1');
    expect(header.text().toLowerCase()).toMatch(/duplicate/i);
  });

  it('duplication mode - submit button shows create not update', async () => {
    const calendar = new Calendar('testCalendarId', 'testName');
    calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

    // Mock axios.get for loading source event
    sandbox.stub(axios, 'get').resolves({
      data: {
        id: 'originalId',
        calendarId: 'testCalendarId',
        schedules: [],
        content: { en: { language: 'en', name: 'Original Event', description: 'Test' } },
        location: {},
        categories: [],
      },
    });

    const { wrapper } = await mountedEditorOnRoute('/event?from=originalId', [calendar]);
    currentWrapper = wrapper;

    // The button text should say "Save Changes" (current implementation)
    const submitButton = wrapper.find('button[type="submit"]');
    expect(submitButton.exists()).toBe(true);
    expect(submitButton.text().toLowerCase()).toMatch(/save changes/i);
  });
});

describe('Location Integration', () => {
  let currentWrapper: any = null;
  let pinia: Pinia;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sinon.restore();
    sandbox = sinon.createSandbox();
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
    // Reset module-level LocationService mocks to baseline defaults; tests
    // that need different return values can override via mockResolvedValueOnce.
    locationServiceMocks.getLocations.mockResolvedValue([]);
    locationServiceMocks.createLocation.mockResolvedValue({});
    locationServiceMocks.getLocationById.mockResolvedValue({});
    locationServiceMocks.updateLocation.mockResolvedValue({});
  });

  afterEach(async () => {
    sandbox.restore();
    if (currentWrapper) {
      currentWrapper.unmount();
      currentWrapper = null;
      await nextTick();
    }
  });

  // Task 11.1: Write tests for location display in event editor
  it('should display LocationDisplayCard in the editor', async () => {
    const calendar = new Calendar('testId', 'testName');
    calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

    const { wrapper } = await mountedEditorOnRoute('/event', [calendar]);
    currentWrapper = wrapper;

    // Should have LocationDisplayCard component
    const locationCard = wrapper.findComponent({ name: 'LocationDisplayCard' });
    expect(locationCard.exists()).toBe(true);
  });

  it('should display location when event has locationId', async () => {
    const calendar = new Calendar('testCalendarId', 'testName');
    calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

    const mockLocation = new EventLocation(
      'https://pavillion.dev/places/loc-123',
      'Test Venue',
      '123 Main St',
      'Portland',
      'OR',
      '97201',
    );

    // Mock event with location
    sandbox.stub(axios, 'get').resolves({
      data: {
        id: 'event-123',
        calendarId: 'testCalendarId',
        locationId: 'https://pavillion.dev/places/loc-123',
        schedules: [],
        content: { en: { language: 'en', name: 'Test Event', description: 'Test' } },
        location: mockLocation.toObject(),
        categories: [],
      },
    });

    const { wrapper } = await mountedEditorOnRoute('/event/event-123', [calendar]);
    currentWrapper = wrapper;

    await flushPromises();

    // LocationDisplayCard should receive the location prop
    const locationCard = wrapper.findComponent({ name: 'LocationDisplayCard' });
    expect(locationCard.exists()).toBe(true);
    expect(locationCard.props('location')).toBeDefined();
  });

  // Task 11.2: Write tests for location picker modal opening
  it('should open location picker modal when Change button clicked', async () => {
    const calendar = new Calendar('testId', 'testName');
    calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

    const { wrapper } = await mountedEditorOnRoute('/event', [calendar]);
    currentWrapper = wrapper;

    // Initially, picker modal should not be in DOM
    expect(wrapper.findComponent({ name: 'LocationPickerModal' }).exists()).toBe(false);

    // Find and click the location card to trigger picker
    const locationCard = wrapper.findComponent({ name: 'LocationDisplayCard' });
    await locationCard.vm.$emit('add-location');
    await nextTick();
    await flushPromises();

    // Picker modal should now be in DOM
    const pickerModal = wrapper.findComponent({ name: 'LocationPickerModal' });
    expect(pickerModal.exists()).toBe(true);
  });

  it('should fetch locations when opening picker', async () => {
    const calendar = new Calendar('testId', 'testName');
    calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

    const { wrapper } = await mountedEditorOnRoute('/event', [calendar]);
    currentWrapper = wrapper;

    // Trigger location picker
    const locationCard = wrapper.findComponent({ name: 'LocationDisplayCard' });
    await locationCard.vm.$emit('add-location');
    await nextTick();
    await flushPromises();

    // Picker should appear
    const pickerModal = wrapper.findComponent({ name: 'LocationPickerModal' });
    expect(pickerModal.exists()).toBe(true);

    // Picker should have locations prop (empty array from mock)
    expect(pickerModal.props('locations')).toBeDefined();
  });

  // Task 11.3: Write tests for location selection flow
  it('should update event location when location selected from picker', async () => {
    const calendar = new Calendar('testId', 'testName');
    calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

    const { wrapper } = await mountedEditorOnRoute('/event', [calendar]);
    currentWrapper = wrapper;

    // Open picker
    const locationCard = wrapper.findComponent({ name: 'LocationDisplayCard' });
    await locationCard.vm.$emit('add-location');
    await nextTick();
    await flushPromises();

    // Select a location — picker emits {placeId, spaceId|null}
    const pickerModal = wrapper.findComponent({ name: 'LocationPickerModal' });
    await pickerModal.vm.$emit('location-selected', {
      placeId: 'https://pavillion.dev/places/loc-1',
      spaceId: null,
    });
    await nextTick();

    // Picker should close
    await flushPromises();
    expect(wrapper.findComponent({ name: 'LocationPickerModal' }).exists()).toBe(false);

    // Event should have the locationId
    expect(wrapper.vm.state.event.locationId).toBe('https://pavillion.dev/places/loc-1');
  });

  it('should remove location when remove-location emitted', async () => {
    const calendar = new Calendar('testCalendarId', 'testName');
    calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

    const mockLocation = new EventLocation(
      'https://pavillion.dev/places/loc-123',
      'Test Venue',
      '123 Main St',
      'Portland',
      'OR',
      '97201',
    );

    // Mock event with location
    sandbox.stub(axios, 'get').resolves({
      data: {
        id: 'event-123',
        calendarId: 'testCalendarId',
        locationId: 'https://pavillion.dev/places/loc-123',
        schedules: [],
        content: { en: { language: 'en', name: 'Test Event', description: 'Test' } },
        location: mockLocation.toObject(),
        categories: [],
      },
    });

    const { wrapper } = await mountedEditorOnRoute('/event/event-123', [calendar]);
    currentWrapper = wrapper;
    await flushPromises();

    // Event should initially have location
    expect(wrapper.vm.state.event.locationId).toBe('https://pavillion.dev/places/loc-123');

    // Open picker and remove location
    const locationCard = wrapper.findComponent({ name: 'LocationDisplayCard' });
    await locationCard.vm.$emit('change-location');
    await nextTick();
    await flushPromises();

    const pickerModal = wrapper.findComponent({ name: 'LocationPickerModal' });
    await pickerModal.vm.$emit('remove-location');
    await nextTick();

    // Location should be cleared
    expect(wrapper.vm.state.event.locationId).toBeNull();
  });

  // Task 11.4: Write tests for create location flow
  it('should show create location form when create-new emitted from picker', async () => {
    const calendar = new Calendar('testId', 'testName');
    calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

    const { wrapper } = await mountedEditorOnRoute('/event', [calendar]);
    currentWrapper = wrapper;

    // Open picker
    const locationCard = wrapper.findComponent({ name: 'LocationDisplayCard' });
    await locationCard.vm.$emit('add-location');
    await nextTick();
    await flushPromises();

    // Click create new
    const pickerModal = wrapper.findComponent({ name: 'LocationPickerModal' });
    await pickerModal.vm.$emit('create-new');
    await nextTick();
    await flushPromises();

    // Picker should close, create form should open
    expect(wrapper.findComponent({ name: 'LocationPickerModal' }).exists()).toBe(false);
    expect(wrapper.findComponent({ name: 'CreateLocationForm' }).exists()).toBe(true);
  });

  it('should create location and select it when form submitted', async () => {
    const calendar = new Calendar('testId', 'testName');
    calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

    const { wrapper } = await mountedEditorOnRoute('/event', [calendar]);
    currentWrapper = wrapper;

    // Open create form (via picker)
    const locationCard = wrapper.findComponent({ name: 'LocationDisplayCard' });
    await locationCard.vm.$emit('add-location');
    await nextTick();
    await flushPromises();

    const pickerModal = wrapper.findComponent({ name: 'LocationPickerModal' });
    await pickerModal.vm.$emit('create-new');
    await nextTick();
    await flushPromises();

    // Submit create form
    const createForm = wrapper.findComponent({ name: 'CreateLocationForm' });
    const locationData = {
      name: 'New Venue',
      address: '789 Elm St',
      city: 'Portland',
      state: 'OR',
      postalCode: '97203',
    };

    await createForm.vm.$emit('create-location', locationData);
    await nextTick();
    await flushPromises();

    // Create form should close (location service mock returns empty object, so no locationId set)
    expect(wrapper.findComponent({ name: 'CreateLocationForm' }).exists()).toBe(false);
  });

  it('should return to picker when back-to-search clicked from create form', async () => {
    const calendar = new Calendar('testId', 'testName');
    calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

    const { wrapper} = await mountedEditorOnRoute('/event', [calendar]);
    currentWrapper = wrapper;

    // Open create form
    const locationCard = wrapper.findComponent({ name: 'LocationDisplayCard' });
    await locationCard.vm.$emit('add-location');
    await nextTick();
    await flushPromises();

    const pickerModal = wrapper.findComponent({ name: 'LocationPickerModal' });
    await pickerModal.vm.$emit('create-new');
    await nextTick();
    await flushPromises();

    // Click back to search
    const createForm = wrapper.findComponent({ name: 'CreateLocationForm' });
    await createForm.vm.$emit('back-to-search');
    await nextTick();
    await flushPromises();

    // Should return to picker
    expect(wrapper.findComponent({ name: 'CreateLocationForm' }).exists()).toBe(false);
    expect(wrapper.findComponent({ name: 'LocationPickerModal' }).exists()).toBe(true);
  });

  // pv-24jz.3: Post-create flow — when a place is created WITH inline spaces,
  // the picker re-opens seeded with the new place's name so the user can pick
  // a room. With ZERO spaces, the picker stays closed (legacy behavior).
  describe('Post-create flow — picker re-opens with spaces', () => {
    /**
     * Build a freshly-saved Place with one staged Space, mimicking the
     * server response from POST /api/v1/calendars/:id/locations when the
     * user staged a single room during creation.
     */
    const buildPlaceWithSpace = (placeId: string, placeName: string, spaceName: string) => {
      const place = new EventLocation(placeId, placeName, '500 Center Way', 'Portland', 'OR', '97203');
      const space = new EventLocationSpace(`${placeId}-space-1`, placeId);
      space.addContent(new EventLocationSpaceContent('en', spaceName, ''));
      place.spaces = [space];
      return place;
    };

    it('passes initialSearch from useLocationManagement to LocationPickerModal as a prop', async () => {
      const calendar = new Calendar('testId', 'testName');
      calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

      const { wrapper } = await mountedEditorOnRoute('/event', [calendar]);
      currentWrapper = wrapper;

      // Open the picker and confirm the prop is wired and defaults to empty.
      const locationCard = wrapper.findComponent({ name: 'LocationDisplayCard' });
      await locationCard.vm.$emit('add-location');
      await nextTick();
      await flushPromises();

      const pickerModal = wrapper.findComponent({ name: 'LocationPickerModal' });
      expect(pickerModal.exists()).toBe(true);
      // Empty by default — verifies the prop is bound, not just present.
      expect(pickerModal.props('initialSearch')).toBe('');
    });

    it('creating a place with one staged space re-opens the picker seeded with the new name', async () => {
      const calendar = new Calendar('testCalendarId', 'testName');
      calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

      const newPlace = buildPlaceWithSpace('new-place-1', 'Convention Center', 'Pacific Room');
      locationServiceMocks.createLocation.mockResolvedValueOnce(newPlace);

      const { wrapper } = await mountedEditorOnRoute('/event', [calendar]);
      currentWrapper = wrapper;

      // Open create form via picker.
      const locationCard = wrapper.findComponent({ name: 'LocationDisplayCard' });
      await locationCard.vm.$emit('add-location');
      await nextTick();
      await flushPromises();

      const pickerModal = wrapper.findComponent({ name: 'LocationPickerModal' });
      await pickerModal.vm.$emit('create-new');
      await nextTick();
      await flushPromises();

      // Submit create form — composable resolves a Place with inline spaces.
      const createForm = wrapper.findComponent({ name: 'CreateLocationForm' });
      await createForm.vm.$emit('create-location', {
        name: 'Convention Center',
        spaces: [{ content: { en: { name: 'Pacific Room' } } }],
      });
      await nextTick();
      await flushPromises();

      // Create form closes; picker re-opens seeded with the new place name.
      expect(wrapper.findComponent({ name: 'CreateLocationForm' }).exists()).toBe(false);
      const reopenedPicker = wrapper.findComponent({ name: 'LocationPickerModal' });
      expect(reopenedPicker.exists()).toBe(true);
      expect(reopenedPicker.props('initialSearch')).toBe('Convention Center');

      // Whole-venue is pre-selected (the picker reads selected-location-id
      // and selected-space-id; spaceId === null means whole venue).
      expect(reopenedPicker.props('selectedLocationId')).toBe('new-place-1');
      expect(reopenedPicker.props('selectedSpaceId')).toBeNull();

      // The new Place ships with its inline space[] — picker can render it.
      const places = reopenedPicker.props('locations') as EventLocation[];
      const reopenedPlace = places.find(p => p.id === 'new-place-1');
      expect(reopenedPlace).toBeDefined();
      // Cross-bead-integration carry-over: assert exactly ONE entry for the
      // new place, not two (guards against duplicate-push regressions across
      // the store + composable array reference).
      expect(places.filter(p => p.id === 'new-place-1')).toHaveLength(1);
      expect(reopenedPlace?.spaces.map(s => s.id)).toEqual(['new-place-1-space-1']);
    });

    it('creating a place with zero spaces does NOT re-open the picker and shows the new place on the event', async () => {
      const calendar = new Calendar('testCalendarId', 'testName');
      calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

      const zeroSpacePlace = new EventLocation(
        'no-space-place', 'Solo Venue', '1 First St', 'Portland', 'OR', '97201',
      );
      // Belt-and-suspenders: model defaults spaces to [].
      expect(zeroSpacePlace.spaces).toHaveLength(0);
      locationServiceMocks.createLocation.mockResolvedValueOnce(zeroSpacePlace);

      const { wrapper } = await mountedEditorOnRoute('/event', [calendar]);
      currentWrapper = wrapper;

      // Open create form via picker.
      const locationCard = wrapper.findComponent({ name: 'LocationDisplayCard' });
      await locationCard.vm.$emit('add-location');
      await nextTick();
      await flushPromises();

      const pickerModal = wrapper.findComponent({ name: 'LocationPickerModal' });
      await pickerModal.vm.$emit('create-new');
      await nextTick();
      await flushPromises();

      const createForm = wrapper.findComponent({ name: 'CreateLocationForm' });
      await createForm.vm.$emit('create-location', { name: 'Solo Venue' });
      await nextTick();
      await flushPromises();

      // Create form closes; picker stays closed (legacy zero-space behavior).
      expect(wrapper.findComponent({ name: 'CreateLocationForm' }).exists()).toBe(false);
      expect(wrapper.findComponent({ name: 'LocationPickerModal' }).exists()).toBe(false);

      // The event reflects the freshly created Place with whole-venue selection.
      expect(wrapper.vm.state.event.locationId).toBe('no-space-place');
      expect(wrapper.vm.state.event.space).toBeNull();
    });

    it('closing the re-opened picker without clicking an entry leaves the event with the new place + whole-venue', async () => {
      const calendar = new Calendar('testCalendarId', 'testName');
      calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

      const newPlace = buildPlaceWithSpace('orphan-place', 'Orphan Venue', 'Side Room');
      locationServiceMocks.createLocation.mockResolvedValueOnce(newPlace);

      const { wrapper } = await mountedEditorOnRoute('/event', [calendar]);
      currentWrapper = wrapper;

      // Open picker -> create form -> submit.
      const locationCard = wrapper.findComponent({ name: 'LocationDisplayCard' });
      await locationCard.vm.$emit('add-location');
      await nextTick();
      await flushPromises();

      let pickerModal = wrapper.findComponent({ name: 'LocationPickerModal' });
      await pickerModal.vm.$emit('create-new');
      await nextTick();
      await flushPromises();

      const createForm = wrapper.findComponent({ name: 'CreateLocationForm' });
      await createForm.vm.$emit('create-location', { name: 'Orphan Venue' });
      await nextTick();
      await flushPromises();

      // Picker re-opened — close it without clicking any entry.
      pickerModal = wrapper.findComponent({ name: 'LocationPickerModal' });
      expect(pickerModal.exists()).toBe(true);
      await pickerModal.vm.$emit('close');
      await nextTick();
      await flushPromises();

      // Picker is closed.
      expect(wrapper.findComponent({ name: 'LocationPickerModal' }).exists()).toBe(false);

      // Event still references the just-created Place with whole-venue (no
      // orphaned no-location state from the implicit-close path).
      expect(wrapper.vm.state.event.locationId).toBe('orphan-place');
      expect(wrapper.vm.state.event.space).toBeNull();
    });

    it('clicking a space in the re-opened picker assigns that space to the event', async () => {
      const calendar = new Calendar('testCalendarId', 'testName');
      calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

      const newPlace = buildPlaceWithSpace('multi-place', 'Multi Venue', 'Main Hall');
      locationServiceMocks.createLocation.mockResolvedValueOnce(newPlace);

      const { wrapper } = await mountedEditorOnRoute('/event', [calendar]);
      currentWrapper = wrapper;

      // Open picker -> create form -> submit -> picker re-opens.
      const locationCard = wrapper.findComponent({ name: 'LocationDisplayCard' });
      await locationCard.vm.$emit('add-location');
      await nextTick();
      await flushPromises();

      let pickerModal = wrapper.findComponent({ name: 'LocationPickerModal' });
      await pickerModal.vm.$emit('create-new');
      await nextTick();
      await flushPromises();

      const createForm = wrapper.findComponent({ name: 'CreateLocationForm' });
      await createForm.vm.$emit('create-location', { name: 'Multi Venue' });
      await nextTick();
      await flushPromises();

      // Pick the space from the re-opened picker.
      pickerModal = wrapper.findComponent({ name: 'LocationPickerModal' });
      expect(pickerModal.exists()).toBe(true);
      await pickerModal.vm.$emit('location-selected', {
        placeId: 'multi-place',
        spaceId: 'multi-place-space-1',
      });
      await nextTick();
      await flushPromises();

      // Picker closes; event has the chosen space attached.
      expect(wrapper.findComponent({ name: 'LocationPickerModal' }).exists()).toBe(false);
      expect(wrapper.vm.state.event.locationId).toBe('multi-place');
      expect(wrapper.vm.state.event.space?.id).toBe('multi-place-space-1');
    });

    it('re-opening the picker via "Add Location" after a create-and-pick sequence has empty initial search', async () => {
      const calendar = new Calendar('testCalendarId', 'testName');
      calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

      const newPlace = buildPlaceWithSpace('reset-place', 'Reset Venue', 'Reset Room');
      locationServiceMocks.createLocation.mockResolvedValueOnce(newPlace);

      const { wrapper } = await mountedEditorOnRoute('/event', [calendar]);
      currentWrapper = wrapper;

      // Sequence: Add Location -> create-new -> create-location ->
      // picker re-opens (seeded) -> select the space -> picker closes.
      const locationCard = wrapper.findComponent({ name: 'LocationDisplayCard' });
      await locationCard.vm.$emit('add-location');
      await nextTick();
      await flushPromises();

      let pickerModal = wrapper.findComponent({ name: 'LocationPickerModal' });
      await pickerModal.vm.$emit('create-new');
      await nextTick();
      await flushPromises();

      const createForm = wrapper.findComponent({ name: 'CreateLocationForm' });
      await createForm.vm.$emit('create-location', { name: 'Reset Venue' });
      await nextTick();
      await flushPromises();

      pickerModal = wrapper.findComponent({ name: 'LocationPickerModal' });
      // Confirm the seeded state before we reset by selecting an entry.
      expect(pickerModal.props('initialSearch')).toBe('Reset Venue');
      await pickerModal.vm.$emit('location-selected', {
        placeId: 'reset-place',
        spaceId: 'reset-place-space-1',
      });
      await nextTick();
      await flushPromises();

      // Now re-open the picker via the regular "Change Location" path.
      // (The card emits change-location once a location is set; the editor
      // wires both add-location and change-location into the same handler.)
      await locationCard.vm.$emit('change-location');
      await nextTick();
      await flushPromises();

      const freshPicker = wrapper.findComponent({ name: 'LocationPickerModal' });
      expect(freshPicker.exists()).toBe(true);
      // initialSearch must be empty on the fresh open — no stale seed.
      expect(freshPicker.props('initialSearch')).toBe('');
    });
  });

  // pv-s6s3.8: Add-space sheet flow from the picker — clicking the per-Place
  // add-space action opens AddSpaceSheet over the picker, saving a new Space
  // calls LocationService.updateLocation with the merged spaces[] and then
  // re-opens the picker seeded with the place name.
  describe('Add-space flow from picker', () => {
    /**
     * Seed an EventLocation with one existing Space so the picker has a
     * well-formed parent row that exposes the per-Place add-space action.
     */
    const buildExistingPlace = (
      placeId: string,
      placeName: string,
      spaceId: string,
      spaceName: string,
    ) => {
      const place = new EventLocation(placeId, placeName, '200 Main St', 'Portland', 'OR', '97201');
      const space = new EventLocationSpace(spaceId, placeId);
      space.addContent(new EventLocationSpaceContent('en', spaceName, ''));
      place.spaces = [space];
      return place;
    };

    it('add-space happy path: picker -> sheet -> save -> picker re-opens with new space sub-row', async () => {
      const calendar = new Calendar('testCalendarId', 'testName');
      calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

      const existingPlace = buildExistingPlace('place-1', 'Civic Hall', 'space-existing', 'Foyer');
      locationServiceMocks.getLocations.mockResolvedValue([existingPlace]);

      // Synthetic updateLocation response: a copy of the place with the
      // newly-staged Space appended (server-issued id, clientId echoed).
      locationServiceMocks.updateLocation.mockImplementationOnce(
        async (_calendarId: string, snapshot: EventLocation) => {
          const updated = new EventLocation(
            snapshot.id, snapshot.name, snapshot.address, snapshot.city,
            snapshot.state, snapshot.postalCode, snapshot.country,
          );
          updated.spaces = (snapshot.spaces ?? []).map((s, i) => {
            const persisted = new EventLocationSpace(s.id || `server-space-${i}`, updated.id);
            if (s.clientId) persisted.clientId = s.clientId;
            // Carry the staged content forward so the picker can render the
            // new sub-row by name.
            for (const lang of s.getLanguages()) {
              const c = s.content(lang);
              persisted.addContent(
                new EventLocationSpaceContent(lang, c.name, c.accessibilityInfo ?? ''),
              );
            }
            return persisted;
          });
          return updated;
        },
      );

      const { wrapper } = await mountedEditorOnRoute('/event', [calendar]);
      currentWrapper = wrapper;

      // Open the picker.
      const locationCard = wrapper.findComponent({ name: 'LocationDisplayCard' });
      await locationCard.vm.$emit('add-location');
      await nextTick();
      await flushPromises();

      const pickerModal = wrapper.findComponent({ name: 'LocationPickerModal' });
      expect(pickerModal.exists()).toBe(true);

      // Click the per-Place add-space action.
      await pickerModal.vm.$emit('add-space', { placeId: 'place-1' });
      await nextTick();
      await flushPromises();

      // Sheet visible, picker hidden.
      const addSpaceSheet = wrapper.findComponent({ name: 'AddSpaceSheet' });
      expect(addSpaceSheet.exists()).toBe(true);
      expect(wrapper.findComponent({ name: 'LocationPickerModal' }).exists()).toBe(false);

      // Sheet received the resolved Place + calendarId.
      expect(addSpaceSheet.props('place').id).toBe('place-1');
      expect(addSpaceSheet.props('calendarId')).toBe('testCalendarId');

      // Stage a new Space via the real SpacesEditor's update:spaces emit
      // (skipping the inline EditSpace UI keeps this test focused on the
      // sheet wiring rather than the per-row form).
      const spacesEditor = wrapper.findComponent({ name: 'SpacesEditor' });
      expect(spacesEditor.exists()).toBe(true);
      const stagedSpace = new EventLocationSpace(undefined, 'place-1');
      stagedSpace.clientId = 'client-staged-1';
      stagedSpace.addContent(new EventLocationSpaceContent('en', 'Atrium', ''));
      const currentBuffer = spacesEditor.props('spaces') as EventLocationSpace[];
      await spacesEditor.vm.$emit('update:spaces', [...currentBuffer, stagedSpace]);
      await nextTick();
      await flushPromises();

      // Click Save — find the primary PillButton in the sheet's footer.
      const sheetButtons = addSpaceSheet.findAllComponents({ name: 'PillButton' });
      const saveButton = sheetButtons.find(b => b.props('variant') === 'primary');
      expect(saveButton).toBeDefined();
      await saveButton!.trigger('click');
      await nextTick();
      await flushPromises();

      // updateLocation called once with the merged spaces[].
      expect(locationServiceMocks.updateLocation).toHaveBeenCalledTimes(1);
      const [calledCalendarId, calledSnapshot] = locationServiceMocks.updateLocation.mock.calls[0];
      expect(calledCalendarId).toBe('testCalendarId');
      expect(calledSnapshot).toBeInstanceOf(EventLocation);
      expect(calledSnapshot.id).toBe('place-1');
      expect(calledSnapshot.name).toBe('Civic Hall');
      // The merged buffer carries both the existing Space and the staged one.
      expect(calledSnapshot.spaces).toHaveLength(2);
      expect(calledSnapshot.spaces.map((s: EventLocationSpace) => s.clientId ?? null))
        .toContain('client-staged-1');

      // Sheet closes; picker re-opens seeded with the place name.
      expect(wrapper.findComponent({ name: 'AddSpaceSheet' }).exists()).toBe(false);
      const reopenedPicker = wrapper.findComponent({ name: 'LocationPickerModal' });
      expect(reopenedPicker.exists()).toBe(true);
      expect(reopenedPicker.props('initialSearch')).toBe('Civic Hall');

      // The new Space appears as a sub-row under the place — the picker's
      // `locations` prop carries the updated Place with both spaces.
      const places = reopenedPicker.props('locations') as EventLocation[];
      const updatedRow = places.find(p => p.id === 'place-1');
      expect(updatedRow).toBeDefined();
      expect(updatedRow?.spaces).toHaveLength(2);
      expect(updatedRow?.spaces.some(s => (s.content('en')?.name ?? '') === 'Atrium')).toBe(true);
    });

    it('add-space cancel path: clicking Cancel in the sheet returns to the picker without a service call', async () => {
      const calendar = new Calendar('testCalendarId', 'testName');
      calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

      const existingPlace = buildExistingPlace('place-2', 'Library Annex', 'space-foyer', 'Lobby');
      locationServiceMocks.getLocations.mockResolvedValue([existingPlace]);

      const { wrapper } = await mountedEditorOnRoute('/event', [calendar]);
      currentWrapper = wrapper;

      // Open picker -> click add-space.
      const locationCard = wrapper.findComponent({ name: 'LocationDisplayCard' });
      await locationCard.vm.$emit('add-location');
      await nextTick();
      await flushPromises();

      const pickerModal = wrapper.findComponent({ name: 'LocationPickerModal' });
      await pickerModal.vm.$emit('add-space', { placeId: 'place-2' });
      await nextTick();
      await flushPromises();

      const addSpaceSheet = wrapper.findComponent({ name: 'AddSpaceSheet' });
      expect(addSpaceSheet.exists()).toBe(true);

      // Click Cancel — find the ghost PillButton in the sheet's footer.
      const sheetButtons = addSpaceSheet.findAllComponents({ name: 'PillButton' });
      const cancelButton = sheetButtons.find(b => b.props('variant') === 'ghost');
      expect(cancelButton).toBeDefined();
      await cancelButton!.trigger('click');
      await nextTick();
      await flushPromises();

      // Sheet closed; picker re-opened with no search seed.
      expect(wrapper.findComponent({ name: 'AddSpaceSheet' }).exists()).toBe(false);
      const reopenedPicker = wrapper.findComponent({ name: 'LocationPickerModal' });
      expect(reopenedPicker.exists()).toBe(true);
      expect(reopenedPicker.props('initialSearch')).toBe('');

      // No service call was made.
      expect(locationServiceMocks.updateLocation).not.toHaveBeenCalled();
    });
  });
});

describe('Language Management Wiring', () => {
  let currentWrapper: any = null;
  let pinia: Pinia;
  let sandbox: sinon.SinonSandbox;
  let originalConfirm: typeof window.confirm;

  beforeEach(() => {
    sinon.restore();
    sandbox = sinon.createSandbox();
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
    // Auto-accept the confirm dialog so handleRemoveLanguage proceeds.
    // happy-dom's window.confirm property descriptor varies across full-suite
    // runs (sometimes accessor, sometimes data, sometimes absent), so direct
    // assignment with afterEach restore is more robust than sinon stubbing.
    originalConfirm = window.confirm;
    window.confirm = (() => true) as typeof window.confirm;
  });

  afterEach(async () => {
    window.confirm = originalConfirm;
    sandbox.restore();
    if (currentWrapper) {
      currentWrapper.unmount();
      currentWrapper = null;
      await nextTick();
    }
  });

  it('drives event.dropContent when LanguageTabSelector emits remove-language', async () => {
    const calendar = new Calendar('testId', 'testName');
    calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

    const { wrapper } = await mountedEditorOnRoute('/event', [calendar]);
    currentWrapper = wrapper;

    // Spy on the live event instance — onLanguageRemoved hook reads
    // editorState.event from closure, so the spy must be installed
    // after the event has been created by initializeEvent.
    const dropContentSpy = sandbox.spy(wrapper.vm.state.event, 'dropContent');

    const tabSelector = wrapper.findComponent({ name: 'LanguageTabSelector' });
    expect(tabSelector.exists()).toBe(true);

    // Open the language picker via the tab selector's add-language emit,
    // then have the picker stub emit `select('fr')` — this is the same
    // path the real UI takes and is what wires `handleAddLanguage` via
    // the composable.
    await tabSelector.vm.$emit('add-language');
    await nextTick();
    await flushPromises();

    const picker = wrapper.findComponent({ name: 'languagePicker' });
    expect(picker.exists()).toBe(true);
    await picker.vm.$emit('select', 'fr');
    await nextTick();

    // Now trigger the remove-language emit; the composable's
    // onLanguageRemoved hook should call event.dropContent('fr').
    await tabSelector.vm.$emit('remove-language', 'fr');
    await nextTick();

    expect(dropContentSpy.calledWith('fr')).toBe(true);
  });
});

describe('External Link Section', () => {
  let currentWrapper: any = null;
  let pinia: Pinia;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sinon.restore();
    sandbox = sinon.createSandbox();
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    sandbox.restore();
    if (currentWrapper) {
      currentWrapper.unmount();
      currentWrapper = null;
      await nextTick();
    }
  });

  it('renders external URL input and prompt dropdown', async () => {
    const calendar = new Calendar('testId', 'testName');
    calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

    const { wrapper } = await mountedEditorOnRoute('/event', [calendar]);
    currentWrapper = wrapper;

    const urlInput = wrapper.find('input[name="externalUrl"]');
    expect(urlInput.exists()).toBe(true);
    expect(urlInput.attributes('type')).toBe('url');

    const promptSelect = wrapper.find('select[name="urlPrompt"]');
    expect(promptSelect.exists()).toBe(true);

    // Three non-null options: more_info (default first), tickets, rsvp
    const options = promptSelect.findAll('option');
    expect(options.length).toBe(3);
    expect(options[0].attributes('value')).toBe('more_info');
  });

  it('binds URL input to event.externalUrl', async () => {
    const calendar = new Calendar('testId', 'testName');
    calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

    const { wrapper } = await mountedEditorOnRoute('/event', [calendar]);
    currentWrapper = wrapper;

    const urlInput = wrapper.find('input[name="externalUrl"]');
    await urlInput.setValue('https://example.com/tickets');
    await nextTick();

    expect(wrapper.vm.state.event.externalUrl).toBe('https://example.com/tickets');
  });

  it('binds prompt dropdown to event.urlPrompt', async () => {
    const calendar = new Calendar('testId', 'testName');
    calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

    const { wrapper } = await mountedEditorOnRoute('/event', [calendar]);
    currentWrapper = wrapper;

    // Backing state starts null (no prompt persisted until URL is set)
    expect(wrapper.vm.state.event.urlPrompt).toBeNull();

    const promptSelect = wrapper.find('select[name="urlPrompt"]');
    await promptSelect.setValue('tickets');
    await nextTick();

    expect(wrapper.vm.state.event.urlPrompt).toBe('tickets');
  });

  it('surfaces server field error for externalUrl on the URL input', async () => {
    const calendar = new Calendar('testId', 'testName');
    calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

    const { wrapper } = await mountedEditorOnRoute('/event', [calendar]);
    currentWrapper = wrapper;

    // Directly populate fieldErrors (exposed via defineExpose)
    wrapper.vm.fieldErrors.externalUrl = 'Please enter a valid http or https URL.';
    await nextTick();

    const urlInput = wrapper.find('input[name="externalUrl"]');
    expect(urlInput.attributes('aria-invalid')).toBe('true');

    const errorMsg = wrapper.find('#event-externalUrl-error');
    expect(errorMsg.exists()).toBe(true);
    expect(errorMsg.text()).toContain('Please enter a valid http or https URL.');
  });

  it('surfaces server field error for urlPrompt on the dropdown', async () => {
    const calendar = new Calendar('testId', 'testName');
    calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

    const { wrapper } = await mountedEditorOnRoute('/event', [calendar]);
    currentWrapper = wrapper;

    wrapper.vm.fieldErrors.urlPrompt = 'URL and button label must both be set or both be empty.';
    await nextTick();

    const promptSelect = wrapper.find('select[name="urlPrompt"]');
    expect(promptSelect.attributes('aria-invalid')).toBe('true');

    const errorMsg = wrapper.find('#event-urlPrompt-error');
    expect(errorMsg.exists()).toBe(true);
  });
});
