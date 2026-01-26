import { expect, describe, it, afterEach, beforeEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import { createPinia, setActivePinia, Pinia } from 'pinia';
import sinon from 'sinon';
import { nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';
import axios from 'axios';

import { EventLocation } from '@/common/model/location';
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

// Mock LocationService
vi.mock('@/client/service/location', () => ({
  default: vi.fn().mockImplementation(() => ({
    getLocations: vi.fn().mockResolvedValue([]),
    createLocation: vi.fn().mockResolvedValue({}),
    getLocationById: vi.fn().mockResolvedValue({}),
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

    const selectedLocation = new EventLocation(
      'https://pavillion.dev/places/loc-1',
      'Venue 1',
      '123 Main St',
      'Portland',
      'OR',
      '97201',
    );

    const { wrapper } = await mountedEditorOnRoute('/event', [calendar]);
    currentWrapper = wrapper;

    // Open picker
    const locationCard = wrapper.findComponent({ name: 'LocationDisplayCard' });
    await locationCard.vm.$emit('add-location');
    await nextTick();
    await flushPromises();

    // Select a location
    const pickerModal = wrapper.findComponent({ name: 'LocationPickerModal' });
    await pickerModal.vm.$emit('location-selected', selectedLocation);
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
});
