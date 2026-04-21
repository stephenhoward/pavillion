import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createRouter, createWebHistory, Router } from 'vue-router';
import { createPinia, setActivePinia, Pinia } from 'pinia';
import { nextTick } from 'vue';
import EditEventView from '@/client/components/logged_in/calendar/edit_event.vue';
import { CalendarEvent } from '@/common/model/events';
import { Calendar } from '@/common/model/calendar';
import { EventLocation } from '@/common/model/location';
import { mountComponent } from '@/client/test/lib/vue';

// Mock factories -----------------------------------------------------

const createMockCalendar = (id: string, urlName: string) => {
  const calendar = new Calendar(id, urlName);
  calendar.addContent({
    language: 'en',
    name: `Test Calendar ${urlName}`,
    description: 'Test Description',
  });
  return calendar;
};

const createEventModelObject = (
  id: string,
  opts: { recurring: boolean } = { recurring: false },
) => {
  // Build a raw object in the shape `ModelService.getModel` returns to
  // `CalendarEvent.fromObject`. We skip going through the live model to keep
  // the test simple and avoid calling toObject() on plain contents.
  return {
    id,
    calendarId: 'calendar-123',
    content: {
      en: { language: 'en', name: opts.recurring ? 'Recurring Event' : 'One-off Event' },
    },
    schedules: opts.recurring
      ? [{ id: 'sched-1', frequency: 'weekly' }]
      : [{ id: 'sched-1' }],
    location: {},
    categories: [],
  };
};

// Mocks --------------------------------------------------------------

vi.mock('@/client/service/calendar', () => ({
  default: vi.fn().mockImplementation(() => ({
    loadCalendars: vi.fn().mockResolvedValue([
      createMockCalendar('calendar-123', 'test-calendar'),
    ]),
    getCalendarByUrlName: vi.fn(),
  })),
}));

vi.mock('@/client/service/event', () => ({
  default: vi.fn().mockImplementation(() => ({
    initEvent: vi.fn((calendar) => {
      const event = new CalendarEvent();
      event.calendarId = calendar.id;
      event.location = new EventLocation();
      event.addSchedule();
      return event;
    }),
    saveEvent: vi.fn(),
  })),
}));

vi.mock('@/client/service/category', () => ({
  default: vi.fn().mockImplementation(() => ({
    getEventCategories: vi.fn().mockResolvedValue([]),
    assignCategoriesToEvent: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/client/service/location', () => ({
  default: vi.fn().mockImplementation(() => ({
    getLocations: vi.fn().mockResolvedValue([]),
    createLocation: vi.fn().mockResolvedValue({}),
  })),
}));

// ModelService.getModel is what useEventEditor calls to hydrate the event in
// edit mode. We vary its return value per test to produce recurring vs
// non-recurring events.
const mockGetModel = vi.fn();
vi.mock('@/client/service/models', () => ({
  default: {
    getModel: (...args: any[]) => mockGetModel(...args),
  },
}));

vi.mock('i18next-vue', () => ({
  default: { install: () => {} },
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

vi.mock('i18next', () => ({
  default: {},
}));

vi.mock('@/client/service/locale', () => ({
  initI18Next: () => {},
}));

vi.mock('iso-639-1-dir', () => ({
  default: {
    getName: (code: string) => code === 'en' ? 'English' : code,
    getDir: () => 'ltr',
    getAllCodes: () => ['en', 'es', 'fr'],
  },
}));

vi.mock('@/client/composables/useEventDuplication', () => ({
  useEventDuplication: () => ({
    stripEventForDuplication: vi.fn((event) => {
      const cloned = event.clone();
      cloned.id = '';
      return cloned;
    }),
  }),
}));

vi.mock('@/client/stores/calendarStore', () => ({
  useCalendarStore: () => ({
    selectedCalendar: null,
    setSelectedCalendar: vi.fn(),
    calendars: [],
    addCalendar: vi.fn(),
  }),
}));

// Tests --------------------------------------------------------------

describe('EditEventView - Cancellations Panel Trigger', () => {
  let router: Router;
  let pinia: Pinia;

  const createTestRouter = () => {
    return createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/event', name: 'event_new', component: EditEventView },
        { path: '/event/:eventId', name: 'event_edit', component: EditEventView, props: true },
        { path: '/calendar', name: 'calendars', component: { template: '<div />' } },
        { path: '/auth/login', name: 'login', component: { template: '<div />' } },
      ],
    });
  };

  const mountEditEventView = async (routePath: string, props = {}) => {
    router = createTestRouter();
    await router.push(routePath);
    await router.isReady();

    const wrapper = mountComponent(EditEventView, router, {
      pinia,
      props,
      stubs: {
        EventRecurrenceView: true,
        languagePicker: true,
        ImageUpload: true,
        CategorySelector: true,
        SeriesSelector: true,
        LocationDisplayCard: true,
        LocationPickerModal: true,
        CreateLocationForm: true,
        EventCancellationsPanel: true,
      },
    });

    await flushPromises();
    await nextTick();
    await nextTick();

    return wrapper;
  };

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('hides the trigger when the event has no recurring schedule (create mode)', async () => {
    const wrapper = await mountEditEventView('/event');

    const trigger = wrapper.find('[data-testid="cancellations-trigger"]');
    expect(trigger.exists()).toBe(false);
  });

  it('hides the trigger when the event schedule has no frequency set', async () => {
    const testId = '00000000-0000-0000-0000-000000000001';
    mockGetModel.mockResolvedValueOnce(createEventModelObject(testId, { recurring: false }));

    const wrapper = await mountEditEventView(`/event/${testId}`, { eventId: testId });
    const trigger = wrapper.find('[data-testid="cancellations-trigger"]');
    expect(trigger.exists()).toBe(false);
  });

  it('shows the trigger when the event has a recurring schedule', async () => {
    const testId = '00000000-0000-0000-0000-000000000002';
    mockGetModel.mockResolvedValueOnce(createEventModelObject(testId, { recurring: true }));

    const wrapper = await mountEditEventView(`/event/${testId}`, { eventId: testId });
    const trigger = wrapper.find('[data-testid="cancellations-trigger"]');
    expect(trigger.exists()).toBe(true);
  });

  it('renders the EventCancellationsPanel when the trigger is clicked', async () => {
    const testId = '00000000-0000-0000-0000-000000000003';
    mockGetModel.mockResolvedValueOnce(createEventModelObject(testId, { recurring: true }));

    const wrapper = await mountEditEventView(`/event/${testId}`, { eventId: testId });
    const trigger = wrapper.find('[data-testid="cancellations-trigger"]');
    expect(trigger.exists()).toBe(true);

    // Panel initially collapsed
    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(wrapper.find('#event-cancellations-panel').exists()).toBe(false);

    await trigger.trigger('click');
    await nextTick();

    expect(trigger.attributes('aria-expanded')).toBe('true');
    expect(wrapper.find('#event-cancellations-panel').exists()).toBe(true);
  });
});
