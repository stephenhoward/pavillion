import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';
import { nextTick } from 'vue';
import { setActivePinia, createPinia, Pinia } from 'pinia';
import { DateTime, Settings } from 'luxon';

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
  default: vi.fn().mockImplementation(function () {
    return {
      loadCalendars: vi.fn().mockResolvedValue([]),
      replaceEventCategories: vi.fn(),
    };
  }),
}));

vi.mock('@/client/service/event', () => ({
  default: vi.fn().mockImplementation(function () {
    return {
      deleteEvent: vi.fn(),
      unshareReposted: vi.fn(),
    };
  }),
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
 * Builds a CalendarEvent with optional schedules and an optional synthetic
 * `isCancelled` flag. The cancelled pill is gated on `event.isCancelled`
 * (a field that represents whole-event cancellation). Per-occurrence
 * exclusions (isExclusion schedules) must NOT trigger the pill — cancelling
 * individual occurrences of a recurring event leaves the event itself active.
 */
const createEvent = (
  id: string,
  name: string,
  opts: { isCancelled?: boolean; schedules?: ScheduleSpec[]; repostStatus?: 'none' | 'manual' | 'auto' } = {},
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

  // `isCancelled` is not a declared field on CalendarEvent; it is read
  // defensively by the template so that when the server eventually populates
  // a whole-event cancellation flag the pill will appear. Attach via `as any`
  // to match that runtime shape.
  (event as any).isCancelled = opts.isCancelled ?? false;
  event.repostStatus = opts.repostStatus ?? 'none';

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

describe('EventsTab - report control', () => {
  beforeEach(() => {
    activePinia = createPinia();
    setActivePinia(activePinia);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offers the report control on reposts only, not on the calendar\'s own events', async () => {
    const wrapper = await mountEventsTab([
      createEvent('event-own', 'Own Event'),
      createEvent('event-repost', 'Reposted Event', { repostStatus: 'manual' }),
    ]);

    const buttons = wrapper.findAll('.report-btn');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].element.closest('li')?.querySelector('#event-title-event-repost')).not.toBeNull();
  });

  it('offers the report control on auto reposts', async () => {
    const wrapper = await mountEventsTab([
      createEvent('event-auto', 'Auto Repost', { repostStatus: 'auto' }),
    ]);

    expect(wrapper.findAll('.report-btn')).toHaveLength(1);
  });
});
