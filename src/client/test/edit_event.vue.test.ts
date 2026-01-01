import { expect, describe, it, afterEach, beforeEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import { createPinia, setActivePinia, Pinia } from 'pinia';
import sinon from 'sinon';
import { nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';
import axios from 'axios';

import { CalendarEvent } from '@/common/model/events';
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

    // The button text should say "Create" not "Update" (either translation key or translated text)
    const submitButton = wrapper.find('button[type="submit"]');
    expect(submitButton.exists()).toBe(true);
    expect(submitButton.text().toLowerCase()).toMatch(/create/i);
  });
});
