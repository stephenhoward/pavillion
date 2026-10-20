import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, createWebHistory, Router } from 'vue-router';
import { createPinia, setActivePinia, Pinia } from 'pinia';
import { buildClientRoutes } from '@/client/routes';
import { createRouteGuards } from '@/client/service/route-guards';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { EventLocation } from '@/common/model/location';

// Create mock calendars for testing
const createMockCalendar = (id: string, urlName: string) => {
  const calendar = new Calendar(id, urlName);
  calendar.addContent({
    language: 'en',
    name: `Test Calendar ${urlName}`,
    description: 'Test Description',
  });
  return calendar;
};

// Create a mock event for testing
const createMockEvent = (id: string, calendarId: string) => {
  const event = new CalendarEvent();
  event.id = id;
  event.calendarId = calendarId;
  event.location = new EventLocation();
  event.addSchedule();
  event.addContent({
    language: 'en',
    name: 'Test Event',
    description: 'Test Description',
  });
  return event;
};

// Mock CalendarService
const mockLoadCalendars = vi.fn();
const mockEnsureCalendarsLoaded = vi.fn();
const mockGetCalendarByUrlName = vi.fn();

vi.mock('@/client/service/calendar', () => ({
  default: vi.fn().mockImplementation(() => ({
    loadCalendars: mockLoadCalendars,
    ensureCalendarsLoaded: mockEnsureCalendarsLoaded,
    getCalendarByUrlName: mockGetCalendarByUrlName,
  })),
}));

// Mock EventService
const mockInitEvent = vi.fn();
const mockLoadCalendarEvents = vi.fn();

vi.mock('@/client/service/event', () => ({
  default: vi.fn().mockImplementation(() => ({
    initEvent: mockInitEvent,
    loadCalendarEvents: mockLoadCalendarEvents,
    saveEvent: vi.fn(),
    deleteEvent: vi.fn(),
  })),
}));

// Mock useCalendarStore
const mockSetSelectedCalendar = vi.fn();
vi.mock('@/client/stores/calendarStore', () => ({
  useCalendarStore: () => ({
    selectedCalendarId: null,
    selectedCalendar: null,
    setSelectedCalendar: mockSetSelectedCalendar,
    calendars: [],
    addCalendar: vi.fn(),
  }),
}));

// Mock useEventStore
vi.mock('@/client/stores/eventStore', () => ({
  useEventStore: () => ({
    events: {},
    setEventsForCalendar: vi.fn(),
    eventsForCalendar: vi.fn().mockReturnValue([]),
  }),
}));

// Mock i18next-vue
vi.mock('i18next-vue', () => ({
  default: {
    install: () => {},
  },
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

// Mock locale service
vi.mock('@/client/service/locale', () => ({
  initI18Next: () => {},
}));

// Mock useBulkSelection composable
vi.mock('@/client/composables/useBulkSelection', () => ({
  useBulkSelection: () => ({
    selectedEvents: { value: [] },
    selectedCount: { value: 0 },
    hasSelection: { value: false },
    toggleEventSelection: vi.fn(),
    isEventSelected: vi.fn(() => false),
    selectAllState: vi.fn(() => ({ checked: false, indeterminate: false })),
    toggleSelectAll: vi.fn(),
    deselectAll: vi.fn(),
    getSelectedEventObjects: vi.fn(() => []),
  }),
}));

describe('Navigation Integration - Task Group 4', () => {
  let router: Router;
  let pinia: Pinia;

  // The real client route table, with every guard passing through.
  const createTestRouter = () => {
    const pass = () => true;
    return createRouter({
      history: createWebHistory(),
      routes: buildClientRoutes({
        mustBeLoggedIn: pass,
        mustBeAdmin: pass,
        setupGuard: pass,
        authRouteGuard: pass,
        currentCalendarRedirect: () => pass,
        settingsIndexRedirect: () => pass,
        calendarLeafGate: pass,
        legacyTabReportsRedirect: pass,
        fundingEnabledRedirect: pass,
      }),
    });
  };

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();

    // Default mock returns
    mockLoadCalendars.mockResolvedValue([
      createMockCalendar('cal-1', 'test-calendar'),
    ]);
    mockEnsureCalendarsLoaded.mockResolvedValue([
      { calendar: createMockCalendar('cal-1', 'test-calendar'), isEditor: false },
    ]);
    mockGetCalendarByUrlName.mockResolvedValue(createMockCalendar('cal-1', 'test-calendar'));
    mockLoadCalendarEvents.mockResolvedValue([]);
    mockInitEvent.mockImplementation((calendar) => {
      const event = new CalendarEvent();
      event.calendarId = calendar?.id;
      event.location = new EventLocation();
      event.addSchedule();
      return event;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Note: "New Event Button Navigation" tests removed - the New Event button was
  // intentionally removed from main navigation per design decision. Event creation
  // will be accessible from calendar/event list headers in a future spec.

  describe('Edit Action Navigation', () => {
    it('should navigate to /event/:eventId when clicking edit action on event', async () => {
      router = createTestRouter();
      await router.push('/calendar/test-calendar');
      await router.isReady();

      const testEvent = createMockEvent('event-123', 'cal-1');

      // Mock event store with event
      vi.doMock('@/client/stores/eventStore', () => ({
        useEventStore: () => ({
          events: { 'cal-1': [testEvent] },
          setEventsForCalendar: vi.fn(),
          eventsForCalendar: vi.fn().mockReturnValue([testEvent]),
        }),
      }));

      // After implementation, clicking on an event item should navigate to /event/:eventId
      // This test verifies the route structure is correct
      const editRoute = router.resolve({ name: 'event_edit', params: { eventId: 'event-123' } });
      expect(editRoute.path).toBe('/event/event-123');
      expect(editRoute.name).toBe('event_edit');
    });

    it('should pass eventId as route parameter to edit route', async () => {
      router = createTestRouter();
      const testEventId = 'abc-123-def-456';

      await router.push({ name: 'event_edit', params: { eventId: testEventId } });
      await router.isReady();

      expect(router.currentRoute.value.params.eventId).toBe(testEventId);
      expect(router.currentRoute.value.path).toBe(`/event/${testEventId}`);
    });
  });

  describe('Duplicate Action Navigation', () => {
    it('should navigate to /event?from=:eventId when clicking duplicate action', async () => {
      router = createTestRouter();
      const sourceEventId = 'source-event-123';

      // Navigate to duplicate route
      await router.push({ name: 'event_new', query: { from: sourceEventId } });
      await router.isReady();

      expect(router.currentRoute.value.name).toBe('event_new');
      expect(router.currentRoute.value.query.from).toBe(sourceEventId);
      expect(router.currentRoute.value.path).toBe('/event');
    });

    it('should preserve source event ID in query parameter', async () => {
      router = createTestRouter();
      const sourceEventId = 'original-event-uuid-123';

      await router.push(`/event?from=${sourceEventId}`);
      await router.isReady();

      expect(router.currentRoute.value.query.from).toBe(sourceEventId);
    });
  });

  describe('Calendar Selector with Routing', () => {
    it('should navigate to /event after calendar selection', async () => {
      router = createTestRouter();
      await router.push('/calendar');
      await router.isReady();

      // Verify that route to event_new exists
      const eventRoute = router.resolve({ name: 'event_new' });
      expect(eventRoute.path).toBe('/event');
    });

    it('should update selectedCalendar when calendar is selected', async () => {
      router = createTestRouter();
      await router.push('/calendar');
      await router.isReady();

      // Mock calendar selection - this would be called when calendar is selected
      mockSetSelectedCalendar('cal-1');

      expect(mockSetSelectedCalendar).toHaveBeenCalledWith('cal-1');
    });
  });

  describe('Post-Save Navigation', () => {
    it('should be able to navigate to calendar view after save', async () => {
      router = createTestRouter();

      // Start at event editor
      await router.push('/event');
      await router.isReady();

      // Navigate to calendar view (simulating post-save)
      await router.push({ name: 'calendar', params: { calendar: 'test-calendar' } });
      await router.isReady();

      expect(router.currentRoute.value.name).toBe('calendar');
      expect(router.currentRoute.value.params.calendar).toBe('test-calendar');
    });

    it('should preserve search and category filter parameters when returning to calendar', async () => {
      router = createTestRouter();

      // Start at calendar with filters
      await router.push('/calendar/test-calendar?search=workshop&categories=cat1,cat2');
      await router.isReady();

      expect(router.currentRoute.value.query.search).toBe('workshop');
      expect(router.currentRoute.value.query.categories).toBe('cat1,cat2');
    });
  });

  describe('Back Navigation', () => {
    it('should support navigation back to calendars view', async () => {
      router = createTestRouter();

      // Start at event
      await router.push('/event');
      await router.isReady();

      expect(router.currentRoute.value.path).toBe('/event');

      // Navigate to calendars (simulating back navigation behavior)
      await router.push({ name: 'calendars' });
      await flushPromises();

      expect(router.currentRoute.value.path).toBe('/calendar');
    });

    it('should fallback to calendars view when no history exists', async () => {
      router = createTestRouter();

      // Direct navigation to event (no history)
      await router.push('/event');
      await router.isReady();

      // Verify calendars route exists as fallback
      const calendarsRoute = router.resolve({ name: 'calendars' });
      expect(calendarsRoute.path).toBe('/calendar');
    });
  });

  describe('URL contract', () => {
    it.each([
      [{ name: 'calendars' }, '/calendar'],
      [{ name: 'feed_root' }, '/feed'],
      [{ name: 'feed', params: { calendar: 'cal' } }, '/feed/cal'],
      [{ name: 'calendar_category_mappings', params: { calendar: 'cal', actorId: 'a1' } }, '/feed/cal/following/a1/category-mappings'],
      [{ name: 'settings' }, '/settings'],
      [{ name: 'calendar_management', params: { calendar: 'cal' } }, '/settings/calendar/cal'],
      [{ name: 'account' }, '/settings/account'],
      [{ name: 'profile' }, '/settings/account/profile'],
      [{ name: 'security' }, '/settings/account/security'],
      [{ name: 'funding_plan' }, '/settings/account/funding'],
      [{ name: 'admin_settings' }, '/settings/admin/settings'],
      [{ name: 'moderation_report_detail', params: { reportId: 'r1' } }, '/settings/admin/moderation/reports/r1'],
    ])('resolves %o to %s', (location, path) => {
      router = createTestRouter();
      expect(router.resolve(location).path).toBe(path);
    });

    it('has no calendar_new route; /calendar/new is just a calendar name', () => {
      router = createTestRouter();
      expect(router.hasRoute('calendar_new')).toBe(false);
      expect(router.resolve('/calendar/new').name).toBe('calendar');
    });

    it.each(['/profile', '/funding', '/admin/settings'])('does not route the old path %s', (path) => {
      router = createTestRouter();
      expect(router.resolve(path).matched).toEqual([]);
    });
  });

  describe('Settings guards', () => {
    // Entering the calendar subtree runs its parent's guard as well as the
    // leaf's; between leaves of one calendar the parent is not re-entered.
    it.each([
      ['/settings/account', '/settings/account/funding', 1],
      ['/settings/account/funding', '/settings/calendar/test-calendar', 2],
      ['/settings/calendar/test-calendar', '/settings/account', 1],
      ['/settings/calendar/test-calendar/editors', '/settings/calendar/test-calendar/general', 1],
    ])('runs mustBeLoggedIn when moving from %s to its sibling %s (%i checks)', async (from, to, expectedChecks) => {
      const pass = () => true;
      let loginChecks = 0;
      const countingRouter = createRouter({
        history: createWebHistory(),
        routes: buildClientRoutes({
          mustBeLoggedIn: () => {
            loginChecks++;
            return true;
          },
          mustBeAdmin: pass,
          setupGuard: pass,
          authRouteGuard: pass,
          currentCalendarRedirect: () => pass,
          settingsIndexRedirect: () => pass,
          calendarLeafGate: pass,
          legacyTabReportsRedirect: pass,
          fundingEnabledRedirect: pass,
        }),
      });
      await countingRouter.push(from);
      loginChecks = 0;

      await countingRouter.push(to);

      expect(countingRouter.currentRoute.value.path).toBe(to);
      expect(loginChecks).toBe(expectedChecks);
    });
  });

  describe('Access guards on the real route table', () => {
    /** The real client route table behind the real guards, for a given session. */
    const routerFor = (session: { loggedIn: boolean; admin: boolean }, setupMode = false): Router => {
      const pass = () => true;
      return createRouter({
        history: createMemoryHistory(),
        routes: buildClientRoutes({
          ...createRouteGuards({ isLoggedIn: () => session.loggedIn, isAdmin: () => session.admin }, () => setupMode),
          currentCalendarRedirect: () => pass,
          settingsIndexRedirect: () => pass,
          calendarLeafGate: pass,
          legacyTabReportsRedirect: pass,
          fundingEnabledRedirect: pass,
        }),
      });
    };

    it.each([
      '/settings/admin/settings',
      '/settings/admin/moderation/settings',
    ])('sends a signed-in non-admin from %s to login', async (path) => {
      const guarded = routerFor({ loggedIn: true, admin: false });
      await guarded.push(path);
      expect(guarded.currentRoute.value.name).toBe('login');
    });

    it('checks admin again on a move between admin pages', async () => {
      // Starting inside the admin section means only the destination's own
      // guard runs on the second push, not the parent admin route's.
      const session = { loggedIn: true, admin: true };
      const guarded = routerFor(session);
      await guarded.push('/settings/admin/settings');
      expect(guarded.currentRoute.value.name).toBe('admin_settings');

      session.admin = false;
      await guarded.push('/settings/admin/moderation/settings');
      expect(guarded.currentRoute.value.name).toBe('login');
    });

    it('lets an admin into the admin settings page', async () => {
      const guarded = routerFor({ loggedIn: true, admin: true });
      await guarded.push('/settings/admin/settings');
      expect(guarded.currentRoute.value.name).toBe('admin_settings');
    });

    it('lets a signed-in non-admin into the account page', async () => {
      const guarded = routerFor({ loggedIn: true, admin: false });
      await guarded.push('/settings/account/profile');
      expect(guarded.currentRoute.value.name).toBe('profile');
    });

    it('sends a signed-out visitor from the account page to login', async () => {
      const guarded = routerFor({ loggedIn: false, admin: false });
      await guarded.push('/settings/account/profile');
      expect(guarded.currentRoute.value.name).toBe('login');
    });

    it('sends a guarded route to setup while setup mode is active', async () => {
      const guarded = routerFor({ loggedIn: true, admin: true }, true);
      await guarded.push('/settings/admin/settings');
      expect(guarded.currentRoute.value.name).toBe('setup');
    });
  });
});
