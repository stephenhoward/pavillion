import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createRouter, createWebHistory, Router } from 'vue-router';
import { createPinia, setActivePinia, Pinia } from 'pinia';
import { nextTick } from 'vue';
import EditEventView from '@/client/components/logged_in/calendar/edit_event.vue';
import SingleEventCancelControl from '@/client/components/logged_in/calendar/SingleEventCancelControl.vue';
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

type EventKind = 'single' | 'recurring' | 'multiple';

const createEventModelObject = (
  id: string,
  opts: { kind: EventKind } = { kind: 'single' },
) => {
  // Build a raw object in the shape `ModelService.getModel` returns to
  // `CalendarEvent.fromObject`. We skip going through the live model to keep
  // the test simple and avoid calling toObject() on plain contents.
  //
  // Gating reasons over POSITIVE (non-exclusion) schedules:
  //   single   -> one positive schedule, no frequency  -> SingleEventCancelControl
  //   recurring -> one positive schedule with frequency -> EventCancellationsPanel
  //   multiple  -> 2+ positive one-off schedules        -> EventCancellationsPanel
  let schedules: Array<Record<string, unknown>>;
  switch (opts.kind) {
    case 'recurring':
      schedules = [{ id: 'sched-1', start: '2030-01-01T12:00:00.000Z', frequency: 'weekly' }];
      break;
    case 'multiple':
      schedules = [
        { id: 'sched-1', start: '2030-01-01T12:00:00.000Z' },
        { id: 'sched-2', start: '2030-02-01T12:00:00.000Z' },
      ];
      break;
    default:
      schedules = [{ id: 'sched-1', start: '2030-01-01T12:00:00.000Z' }];
  }

  return {
    id,
    calendarId: 'calendar-123',
    content: {
      en: { language: 'en', name: `${opts.kind} Event` },
    },
    schedules,
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
        SingleEventCancelControl: true,
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

  it('renders neither cancel control in create mode (unsaved event has no id)', async () => {
    // Create mode: route /event with no eventId and no model fetch. The
    // event service's initEvent builds a brand-new event with one default
    // non-recurring schedule but no id, so neither the single-occurrence
    // control nor the multi-occurrence trigger should render.
    const wrapper = await mountEditEventView('/event');

    expect(wrapper.findComponent(SingleEventCancelControl).exists()).toBe(false);
    expect(wrapper.find('[data-testid="cancellations-trigger"]').exists()).toBe(false);
  });

  it('renders SingleEventCancelControl (not the panel trigger) for a single non-recurring event', async () => {
    const testId = '00000000-0000-0000-0000-000000000001';
    mockGetModel.mockResolvedValueOnce(createEventModelObject(testId, { kind: 'single' }));

    const wrapper = await mountEditEventView(`/event/${testId}`, { eventId: testId });

    // One positive schedule with no frequency -> single-occurrence branch.
    expect(wrapper.findComponent(SingleEventCancelControl).exists()).toBe(true);
    // The multi-occurrence cancellations-panel trigger must NOT render.
    expect(wrapper.find('[data-testid="cancellations-trigger"]').exists()).toBe(false);
  });

  it('renders the panel trigger (not SingleEventCancelControl) for an event with multiple one-off occurrences', async () => {
    const testId = '00000000-0000-0000-0000-000000000004';
    mockGetModel.mockResolvedValueOnce(createEventModelObject(testId, { kind: 'multiple' }));

    const wrapper = await mountEditEventView(`/event/${testId}`, { eventId: testId });

    // 2+ positive schedules -> multi-occurrence branch.
    expect(wrapper.find('[data-testid="cancellations-trigger"]').exists()).toBe(true);
    expect(wrapper.findComponent(SingleEventCancelControl).exists()).toBe(false);
  });

  it('shows the trigger (not SingleEventCancelControl) when the event has a recurring schedule', async () => {
    const testId = '00000000-0000-0000-0000-000000000002';
    mockGetModel.mockResolvedValueOnce(createEventModelObject(testId, { kind: 'recurring' }));

    const wrapper = await mountEditEventView(`/event/${testId}`, { eventId: testId });
    const trigger = wrapper.find('[data-testid="cancellations-trigger"]');
    expect(trigger.exists()).toBe(true);
    expect(wrapper.findComponent(SingleEventCancelControl).exists()).toBe(false);
  });

  it('renders the EventCancellationsPanel when the trigger is clicked', async () => {
    const testId = '00000000-0000-0000-0000-000000000003';
    mockGetModel.mockResolvedValueOnce(createEventModelObject(testId, { kind: 'recurring' }));

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
