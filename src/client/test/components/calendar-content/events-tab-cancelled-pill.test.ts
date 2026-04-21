import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';
import { nextTick } from 'vue';
import { setActivePinia, createPinia, Pinia } from 'pinia';

import { mountComponent } from '@/client/test/lib/vue';
import EventsTab from '@/client/components/logged_in/calendar-content/events-tab.vue';
import { useEventStore } from '@/client/stores/eventStore';
import { CalendarEvent, CalendarEventSchedule } from '@/common/model/events';
import { Calendar } from '@/common/model/calendar';

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
};

vi.mock('@/client/composables/useToast', () => ({
  useToast: () => mockToast,
}));

vi.mock('@/client/service/calendar', () => ({
  default: vi.fn().mockImplementation(() => ({
    loadCalendars: vi.fn().mockResolvedValue([]),
    replaceEventCategories: vi.fn(),
  })),
}));

vi.mock('@/client/service/event', () => ({
  default: vi.fn().mockImplementation(() => ({
    deleteEvent: vi.fn(),
    unshareReposted: vi.fn(),
  })),
}));

vi.mock('@/client/stores/categoryStore', () => ({
  useCategoryStore: () => ({
    categories: {},
  }),
}));

vi.mock('@/client/stores/calendarStore', () => ({
  useCalendarStore: () => ({
    selectedCalendar: null,
    setSelectedCalendar: vi.fn(),
    calendars: [],
  }),
}));

const routes: RouteRecordRaw[] = [
  {
    path: '/calendar/:calendar/events',
    component: {},
    name: 'calendar-events',
  },
  {
    path: '/event/new',
    component: {},
    name: 'event_new',
  },
  {
    path: '/event/:eventId',
    component: {},
    name: 'event_edit',
  },
];

type ScheduleSpec = { isExclusion: boolean; hideFromPublic: boolean };

/**
 * Builds a CalendarEvent with optional schedules. The cancelled pill is now
 * derived from the event's schedules (a schedule is a shown cancellation when
 * `isExclusion === true && hideFromPublic === false`), so tests exercise the
 * real computation rather than injecting a synthetic `isCancelled` field.
 */
const createEvent = (
  id: string,
  name: string,
  opts: { schedules?: ScheduleSpec[] } = {},
) => {
  const event = new CalendarEvent();
  event.id = id;
  event.calendarId = 'calendar-123';
  event.addContent({
    language: 'en',
    name,
    description: 'Test description',
  } as any);

  if (opts.schedules) {
    event.schedules = opts.schedules.map((spec, idx) => {
      const schedule = new CalendarEventSchedule(`${id}-schedule-${idx}`);
      schedule.isExclusion = spec.isExclusion;
      schedule.hideFromPublic = spec.hideFromPublic;
      return schedule;
    });
  }

  return event;
};

const createCalendar = () => {
  const calendar = new Calendar('calendar-123', 'test-calendar');
  calendar.addContent({
    language: 'en',
    name: 'Test Calendar',
    description: '',
  } as any);
  return calendar;
};

let activePinia: Pinia;

const mountEventsTab = async (events: CalendarEvent[]) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });
  router.push({ name: 'calendar-events', params: { calendar: 'test-calendar' } });
  await router.isReady();

  // Seed events into the pinia instance that we will pass into mountComponent
  // so that the store lookup inside the component sees the same data.
  const store = useEventStore(activePinia);
  store.setEventsForCalendar('calendar-123', events);

  const wrapper = mountComponent(EventsTab, router, {
    pinia: activePinia,
    props: {
      calendar: createCalendar(),
      isLoading: false,
    },
    stubs: {
      SearchFilter: true,
      BulkOperationsMenu: true,
      CategorySelectionDialog: true,
      ReportEvent: true,
      RepostCategoriesModal: true,
      ModalLayout: true,
      EventImage: true,
    },
  });

  await nextTick();
  return wrapper;
};

describe('EventsTab - Cancelled Pill', () => {
  beforeEach(() => {
    activePinia = createPinia();
    setActivePinia(activePinia);
    mockToast.success.mockClear();
    mockToast.error.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not render the cancelled pill when events have no schedules', async () => {
    const events = [
      createEvent('event-1', 'Active Event'),
      createEvent('event-2', 'Another Active Event'),
    ];

    const wrapper = await mountEventsTab(events);

    const pills = wrapper.findAll('[data-testid="event-cancelled-pill"]');
    expect(pills).toHaveLength(0);
  });

  it('does not render the cancelled pill for events with no exclusion schedules', async () => {
    const events = [
      createEvent('event-1', 'Recurring Event', {
        schedules: [{ isExclusion: false, hideFromPublic: false }],
      }),
    ];

    const wrapper = await mountEventsTab(events);

    const pills = wrapper.findAll('[data-testid="event-cancelled-pill"]');
    expect(pills).toHaveLength(0);
  });

  it('renders the cancelled pill when an event has a shown cancellation (isExclusion && !hideFromPublic)', async () => {
    const events = [
      createEvent('event-1', 'Active Event'),
      createEvent('event-2', 'Cancelled Event', {
        schedules: [{ isExclusion: true, hideFromPublic: false }],
      }),
      createEvent('event-3', 'Another Active Event'),
    ];

    const wrapper = await mountEventsTab(events);

    const pills = wrapper.findAll('[data-testid="event-cancelled-pill"]');
    expect(pills).toHaveLength(1);

    // Pill should be associated with the cancelled event's row
    const cancelledTitle = wrapper.find('#event-title-event-2');
    expect(cancelledTitle.exists()).toBe(true);
    expect(pills[0].text()).toMatch(/cancelled/i);
  });

  it('does not render the cancelled pill when the only exclusions are hidden (EXDATE-style)', async () => {
    const events = [
      createEvent('event-1', 'Event With Hidden Exclusion', {
        schedules: [{ isExclusion: true, hideFromPublic: true }],
      }),
    ];

    const wrapper = await mountEventsTab(events);

    const pills = wrapper.findAll('[data-testid="event-cancelled-pill"]');
    expect(pills).toHaveLength(0);
  });

  it('renders a pill for each event with a shown cancellation when multiple are cancelled', async () => {
    const events = [
      createEvent('event-1', 'Cancelled A', {
        schedules: [{ isExclusion: true, hideFromPublic: false }],
      }),
      createEvent('event-2', 'Active'),
      createEvent('event-3', 'Cancelled B', {
        schedules: [
          { isExclusion: false, hideFromPublic: false },
          { isExclusion: true, hideFromPublic: false },
        ],
      }),
    ];

    const wrapper = await mountEventsTab(events);

    const pills = wrapper.findAll('[data-testid="event-cancelled-pill"]');
    expect(pills).toHaveLength(2);
  });
});
