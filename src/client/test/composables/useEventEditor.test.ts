import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import { createPinia, setActivePinia } from 'pinia';
import { useEventEditor } from '@/client/composables/useEventEditor';
import { CalendarEvent } from '@/common/model/events';
import { Calendar } from '@/common/model/calendar';
import { EventCategory } from '@/common/model/event_category';
import CalendarService from '@/client/service/calendar';
import EventService from '@/client/service/event';
import CategoryService from '@/client/service/category';
import ModelService from '@/client/service/models';

// Create mock instances
const mockRoute = {
  params: {},
  query: {},
};

const mockRouter = {
  push: vi.fn(),
};

const mockCalendarStore = {
  getLastInteractedCalendar: null,
  setSelectedCalendar: vi.fn(),
};

const mockStripEventForDuplication = vi.fn((event) => {
  const stripped = new CalendarEvent('', event.calendarId);
  stripped.content('en').name = event.content('en').name;
  if (event.categories) {
    stripped.categories = event.categories;
  }
  if (event.mediaId) {
    stripped.mediaId = event.mediaId;
  }
  return stripped;
});

// Mock modules
vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
  useRouter: () => mockRouter,
}));

vi.mock('@/client/stores/calendarStore', () => ({
  useCalendarStore: () => mockCalendarStore,
}));

vi.mock('@/client/composables/useEventDuplication', () => ({
  useEventDuplication: () => ({
    stripEventForDuplication: mockStripEventForDuplication,
  }),
}));

describe('useEventEditor', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Set up Pinia for services that use stores
    setActivePinia(createPinia());

    // Reset mocks
    mockRoute.params = {};
    mockRoute.query = {};
    mockRouter.push.mockClear();
    mockCalendarStore.getLastInteractedCalendar = null;
    mockCalendarStore.setSelectedCalendar.mockClear();
    mockStripEventForDuplication.mockClear();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Initialization and Default State', () => {
    it('should initialize with correct default state', () => {
      const { state } = useEventEditor();

      expect(state.isLoading).toBe(true);
      expect(state.err).toBe('');
      expect(state.event).toBeNull();
      expect(state.calendar).toBeNull();
      expect(state.availableCalendars).toEqual([]);
      expect(state.mode).toBe('create');
      expect(state.isDuplicationMode).toBe(false);
    });

    it('should initialize selectedCategories as empty array', () => {
      const { selectedCategories } = useEventEditor();

      expect(selectedCategories.value).toEqual([]);
    });

    it('should initialize mediaId as null', () => {
      const { mediaId } = useEventEditor();

      expect(mediaId.value).toBeNull();
    });
  });

  describe('Mode Determination', () => {
    it('should determine edit mode from route params', async () => {
      mockRoute.params.eventId = 'event-123';

      const calendar = new Calendar('cal-1', 'test-calendar');
      const event = new CalendarEvent('event-123', 'cal-1');
      event.content('en').name = 'Test Event';

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar]);
      sandbox.stub(ModelService, 'getModel').resolves(event.toObject());
      sandbox.stub(CategoryService.prototype, 'getEventCategories').resolves([]);

      const { state, initializeEvent } = useEventEditor();

      await initializeEvent('event-123');

      expect(state.mode).toBe('edit');
      expect(state.isDuplicationMode).toBe(false);
    });

    it('should determine duplicate mode from query params', async () => {
      mockRoute.query.from = 'source-event-123';

      const calendar = new Calendar('cal-1', 'test-calendar');
      const sourceEvent = new CalendarEvent('source-event-123', 'cal-1');
      sourceEvent.content('en').name = 'Source Event';

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar]);
      sandbox.stub(ModelService, 'getModel').resolves(sourceEvent.toObject());

      const { state, initializeEvent } = useEventEditor();

      await initializeEvent();

      expect(state.mode).toBe('duplicate');
      expect(state.isDuplicationMode).toBe(true);
    });

    it('should default to create mode when no params', async () => {
      const calendar = new Calendar('cal-1', 'test-calendar');

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar]);

      const { state, initializeEvent } = useEventEditor();

      await initializeEvent();

      expect(state.mode).toBe('create');
      expect(state.isDuplicationMode).toBe(false);
    });

    it('should prioritize eventId over from query param', async () => {
      mockRoute.params.eventId = 'event-123';
      mockRoute.query.from = 'source-event-456';

      const calendar = new Calendar('cal-1', 'test-calendar');
      const event = new CalendarEvent('event-123', 'cal-1');
      event.content('en').name = 'Test Event';

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar]);
      sandbox.stub(ModelService, 'getModel').resolves(event.toObject());
      sandbox.stub(CategoryService.prototype, 'getEventCategories').resolves([]);

      const { state, initializeEvent } = useEventEditor();

      await initializeEvent('event-123');

      expect(state.mode).toBe('edit');
    });
  });

  describe('Event Initialization - Create Mode', () => {
    it('should initialize new event with single calendar', async () => {
      const calendar = new Calendar('cal-1', 'test-calendar');

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar]);

      const { state, initializeEvent } = useEventEditor();

      await initializeEvent();

      expect(state.event).not.toBeNull();
      expect(state.event?.calendarId).toBe('cal-1');
      expect(state.event?.id).toBe('');
      expect(state.event?.location).toBeDefined();
      expect(state.event?.schedules).toHaveLength(1);
    });

    it('should use preselected calendar from store', async () => {
      const calendar1 = new Calendar('cal-1', 'calendar-1');
      const calendar2 = new Calendar('cal-2', 'calendar-2');
      mockCalendarStore.getLastInteractedCalendar = calendar2;

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar1, calendar2]);

      const { state, initializeEvent } = useEventEditor();

      await initializeEvent();

      expect(state.event?.calendarId).toBe('cal-2');
    });

    it('should use first calendar when multiple available and no preselection', async () => {
      const calendar1 = new Calendar('cal-1', 'calendar-1');
      const calendar2 = new Calendar('cal-2', 'calendar-2');

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar1, calendar2]);

      const { state, initializeEvent } = useEventEditor();

      await initializeEvent();

      expect(state.event?.calendarId).toBe('cal-1');
    });

    it('should pre-populate default language content', async () => {
      const calendar = new Calendar('cal-1', 'test-calendar');

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar]);

      const { state, initializeEvent } = useEventEditor('fr');

      await initializeEvent();

      expect(state.event?.content('fr')).toBeDefined();
    });

    it('should redirect to calendars when no calendars available', async () => {
      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([]);

      const { initializeEvent } = useEventEditor();

      await initializeEvent();

      expect(mockRouter.push).toHaveBeenCalledWith({ name: 'calendars' });
    });
  });

  describe('Event Initialization - Edit Mode', () => {
    it('should load existing event in edit mode', async () => {
      mockRoute.params.eventId = 'event-123';

      const calendar = new Calendar('cal-1', 'test-calendar');
      const event = new CalendarEvent('event-123', 'cal-1');
      event.content('en').name = 'Test Event';

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar]);
      sandbox.stub(ModelService, 'getModel').resolves(event.toObject());
      sandbox.stub(CategoryService.prototype, 'getEventCategories').resolves([]);

      const { state, initializeEvent } = useEventEditor();

      await initializeEvent('event-123');

      expect(state.event).not.toBeNull();
      expect(state.event?.id).toBe('event-123');
      expect(state.event?.content('en').name).toBe('Test Event');
    });

    it('should load event categories in edit mode', async () => {
      mockRoute.params.eventId = 'event-123';

      const calendar = new Calendar('cal-1', 'test-calendar');
      const event = new CalendarEvent('event-123', 'cal-1');
      const category1 = new EventCategory('cat-1', 'cal-1');
      const category2 = new EventCategory('cat-2', 'cal-1');

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar]);
      sandbox.stub(ModelService, 'getModel').resolves(event.toObject());
      sandbox.stub(CategoryService.prototype, 'getEventCategories').resolves([category1, category2]);

      const { selectedCategories, initializeEvent } = useEventEditor();

      await initializeEvent('event-123');

      expect(selectedCategories.value).toEqual(['cat-1', 'cat-2']);
    });

    it('should handle category loading errors gracefully', async () => {
      mockRoute.params.eventId = 'event-123';

      const calendar = new Calendar('cal-1', 'test-calendar');
      const event = new CalendarEvent('event-123', 'cal-1');

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar]);
      sandbox.stub(ModelService, 'getModel').resolves(event.toObject());
      sandbox.stub(CategoryService.prototype, 'getEventCategories').rejects(new Error('Category API error'));

      const { selectedCategories, initializeEvent } = useEventEditor();

      await initializeEvent('event-123');

      expect(selectedCategories.value).toEqual([]);
      // Should not throw error
    });

    it('should redirect to calendars when event not found', async () => {
      mockRoute.params.eventId = 'nonexistent';

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([new Calendar('cal-1', 'test')]);
      sandbox.stub(ModelService, 'getModel').resolves(null);

      const { state, initializeEvent } = useEventEditor();

      await initializeEvent('nonexistent');

      expect(state.err).toBe('Event not found');
      expect(mockRouter.push).toHaveBeenCalledWith({ name: 'calendars' });
    });
  });

  describe('Event Initialization - Duplicate Mode', () => {
    it('should duplicate event and strip IDs', async () => {
      mockRoute.query.from = 'source-event-123';

      const calendar = new Calendar('cal-1', 'test-calendar');
      const sourceEvent = new CalendarEvent('source-event-123', 'cal-1');
      sourceEvent.content('en').name = 'Source Event';

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar]);
      sandbox.stub(ModelService, 'getModel').resolves(sourceEvent.toObject());

      const { state, initializeEvent } = useEventEditor();

      await initializeEvent();

      expect(mockStripEventForDuplication).toHaveBeenCalled();
      expect(state.event?.id).toBe('');
      expect(state.event?.content('en').name).toBe('Source Event');
    });

    it('should preserve categories in duplicate mode', async () => {
      mockRoute.query.from = 'source-event-123';

      const calendar = new Calendar('cal-1', 'test-calendar');
      const sourceEvent = new CalendarEvent('source-event-123', 'cal-1');
      sourceEvent.categories = [
        new EventCategory('cat-1', 'cal-1'),
        new EventCategory('cat-2', 'cal-1'),
      ];

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar]);
      sandbox.stub(ModelService, 'getModel').resolves(sourceEvent.toObject());

      const { selectedCategories, initializeEvent } = useEventEditor();

      await initializeEvent();

      expect(selectedCategories.value).toEqual(['cat-1', 'cat-2']);
    });

    it('should preserve media reference in duplicate mode', async () => {
      mockRoute.query.from = 'source-event-123';

      const calendar = new Calendar('cal-1', 'test-calendar');
      const sourceEvent = new CalendarEvent('source-event-123', 'cal-1');
      sourceEvent.mediaId = 'media-123';

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar]);
      sandbox.stub(ModelService, 'getModel').resolves(sourceEvent.toObject());

      const { mediaId, initializeEvent } = useEventEditor();

      await initializeEvent();

      expect(mediaId.value).toBe('media-123');
    });

    it('should redirect when source event not found', async () => {
      mockRoute.query.from = 'nonexistent';

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([new Calendar('cal-1', 'test')]);
      sandbox.stub(ModelService, 'getModel').resolves(null);

      const { initializeEvent } = useEventEditor();

      await initializeEvent();

      expect(mockRouter.push).toHaveBeenCalledWith({ name: 'calendars' });
    });
  });

  describe('Event Loading from API', () => {
    it('should load event successfully', async () => {
      const event = new CalendarEvent('event-123', 'cal-1');
      event.content('en').name = 'Test Event';

      const getModelStub = sandbox.stub(ModelService, 'getModel').resolves(event.toObject());
      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([new Calendar('cal-1', 'test')]);
      sandbox.stub(CategoryService.prototype, 'getEventCategories').resolves([]);

      const { initializeEvent } = useEventEditor();

      await initializeEvent('event-123');

      sinon.assert.calledWith(getModelStub, '/api/v1/events/event-123');
    });

    it('should handle 401 unauthorized error', async () => {
      const error = {
        response: {
          status: 401,
        },
      };

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([new Calendar('cal-1', 'test')]);
      sandbox.stub(ModelService, 'getModel').rejects(error);

      const { initializeEvent } = useEventEditor();

      await initializeEvent('event-123');

      expect(mockRouter.push).toHaveBeenCalledWith({ name: 'login' });
    });

    it('should handle 403 forbidden error', async () => {
      const error = {
        response: {
          status: 403,
        },
      };

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([new Calendar('cal-1', 'test')]);
      sandbox.stub(ModelService, 'getModel').rejects(error);

      const { initializeEvent } = useEventEditor();

      await initializeEvent('event-123');

      expect(mockRouter.push).toHaveBeenCalledWith({ name: 'calendars' });
    });

    it('should handle generic API error', async () => {
      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([new Calendar('cal-1', 'test')]);
      sandbox.stub(ModelService, 'getModel').rejects(new Error('Network error'));

      const { state, initializeEvent } = useEventEditor();

      await initializeEvent('event-123');

      expect(state.err).toBe('Failed to load event');
    });
  });

  describe('Save Event', () => {
    it('should save event successfully', async () => {
      const calendar = new Calendar('cal-1', 'test-calendar');

      const savedEvent = new CalendarEvent('event-123', 'cal-1');
      savedEvent.content('en').name = 'New Event';

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar]);
      const saveEventStub = sandbox.stub(EventService.prototype, 'saveEvent').resolves(savedEvent);

      const { initializeEvent, saveEvent } = useEventEditor();

      await initializeEvent();

      const mockT = vi.fn((key) => key);
      await saveEvent(mockT);

      sinon.assert.called(saveEventStub);
      expect(mockCalendarStore.setSelectedCalendar).toHaveBeenCalledWith('cal-1');
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: 'calendar',
        params: { calendar: 'test-calendar' },
      });
    });

    it('should save event with categories', async () => {
      const calendar = new Calendar('cal-1', 'test-calendar');
      const savedEvent = new CalendarEvent('event-123', 'cal-1');

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar]);
      sandbox.stub(EventService.prototype, 'saveEvent').resolves(savedEvent);
      const assignCategoriesStub = sandbox.stub(CategoryService.prototype, 'assignCategoriesToEvent').resolves();

      const { selectedCategories, initializeEvent, saveEvent } = useEventEditor();

      await initializeEvent();

      selectedCategories.value = ['cat-1', 'cat-2'];

      const mockT = vi.fn((key) => key);
      await saveEvent(mockT);

      sinon.assert.calledWith(assignCategoriesStub, 'event-123', ['cat-1', 'cat-2']);
    });

    it('should handle category save errors gracefully', async () => {
      const calendar = new Calendar('cal-1', 'test-calendar');
      const savedEvent = new CalendarEvent('event-123', 'cal-1');

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar]);
      sandbox.stub(EventService.prototype, 'saveEvent').resolves(savedEvent);
      sandbox.stub(CategoryService.prototype, 'assignCategoriesToEvent').rejects(new Error('Category error'));

      const { selectedCategories, initializeEvent, saveEvent } = useEventEditor();

      await initializeEvent();

      selectedCategories.value = ['cat-1'];

      const mockT = vi.fn((key) => key);
      await saveEvent(mockT);

      // Should still redirect even if categories fail
      expect(mockRouter.push).toHaveBeenCalled();
    });

    it('should save event with media', async () => {
      const calendar = new Calendar('cal-1', 'test-calendar');
      const savedEvent = new CalendarEvent('event-123', 'cal-1');

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar]);
      const saveStub = sandbox.stub(EventService.prototype, 'saveEvent').resolves(savedEvent);

      const { mediaId, initializeEvent, saveEvent } = useEventEditor();

      await initializeEvent();

      mediaId.value = 'media-123';

      const mockT = vi.fn((key) => key);
      await saveEvent(mockT);

      const savedModel = saveStub.firstCall.args[0];
      expect(savedModel.mediaId).toBe('media-123');
    });

    it('should return error when event is null', async () => {
      const { state, saveEvent } = useEventEditor();

      const mockT = vi.fn((key) => key);
      await saveEvent(mockT);

      expect(mockT).toHaveBeenCalledWith('error_no_event');
      expect(state.err).toBe('error_no_event');
    });

    it('should return error when no calendar selected', async () => {
      const { state, saveEvent } = useEventEditor();

      // Initialize with no calendars
      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([]);

      // Force create an event
      state.event = new CalendarEvent();
      state.event.calendarId = '';

      const mockT = vi.fn((key) => key);
      await saveEvent(mockT);

      expect(mockT).toHaveBeenCalledWith('error_no_calendar');
      expect(state.err).toBe('error_no_calendar');
    });

    it('should handle save API error', async () => {
      const calendar = new Calendar('cal-1', 'test-calendar');

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar]);
      sandbox.stub(EventService.prototype, 'saveEvent').rejects(new Error('Save failed'));

      const { state, initializeEvent, saveEvent } = useEventEditor();

      await initializeEvent();

      const mockT = vi.fn((key) => key);
      await saveEvent(mockT);

      expect(mockT).toHaveBeenCalledWith('error_saving_event');
      expect(state.err).toBe('error_saving_event');
    });

    it('should call onDirtyReset callback after successful save', async () => {
      const calendar = new Calendar('cal-1', 'test-calendar');
      const savedEvent = new CalendarEvent('event-123', 'cal-1');

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar]);
      sandbox.stub(EventService.prototype, 'saveEvent').resolves(savedEvent);

      const { initializeEvent, saveEvent } = useEventEditor();

      await initializeEvent();

      const mockT = vi.fn((key) => key);
      const mockOnDirtyReset = vi.fn();
      await saveEvent(mockT, mockOnDirtyReset);

      expect(mockOnDirtyReset).toHaveBeenCalled();
    });

    it('should redirect to calendars if calendar not found after save', async () => {
      const calendar1 = new Calendar('cal-1', 'test-calendar');
      const savedEvent = new CalendarEvent('event-123', 'cal-2'); // Different calendar

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar1]);
      sandbox.stub(EventService.prototype, 'saveEvent').resolves(savedEvent);

      const { state, initializeEvent, saveEvent } = useEventEditor();

      await initializeEvent();

      // Force the event to have a different calendar ID that doesn't exist
      state.event!.calendarId = 'cal-2';

      const mockT = vi.fn((key) => key);
      await saveEvent(mockT);

      expect(mockRouter.push).toHaveBeenCalledWith({ name: 'calendars' });
    });

    it('should set locationId if location is selected', async () => {
      const calendar = new Calendar('cal-1', 'test-calendar');
      const savedEvent = new CalendarEvent('event-123', 'cal-1');

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar]);
      const saveStub = sandbox.stub(EventService.prototype, 'saveEvent').resolves(savedEvent);

      const { state, initializeEvent, saveEvent } = useEventEditor();

      await initializeEvent();

      state.event!.locationId = 'location-123';

      const mockT = vi.fn((key) => key);
      await saveEvent(mockT);

      const savedModel = saveStub.firstCall.args[0];
      expect(savedModel.locationId).toBe('location-123');
    });
  });

  describe('Page Title', () => {
    it('should return edit_event for edit mode', async () => {
      mockRoute.params.eventId = 'event-123';

      const calendar = new Calendar('cal-1', 'test-calendar');
      const event = new CalendarEvent('event-123', 'cal-1');

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar]);
      sandbox.stub(ModelService, 'getModel').resolves(event.toObject());
      sandbox.stub(CategoryService.prototype, 'getEventCategories').resolves([]);

      const { pageTitle, initializeEvent } = useEventEditor();

      await initializeEvent('event-123');

      expect(pageTitle.value).toBe('edit_event');
    });

    it('should return duplicate_event for duplicate mode', async () => {
      mockRoute.query.from = 'source-event-123';

      const calendar = new Calendar('cal-1', 'test-calendar');
      const sourceEvent = new CalendarEvent('source-event-123', 'cal-1');

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar]);
      sandbox.stub(ModelService, 'getModel').resolves(sourceEvent.toObject());

      const { pageTitle, initializeEvent } = useEventEditor();

      await initializeEvent();

      expect(pageTitle.value).toBe('duplicate_event');
    });

    it('should return create_event for create mode', async () => {
      const calendar = new Calendar('cal-1', 'test-calendar');

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar]);

      const { pageTitle, initializeEvent } = useEventEditor();

      await initializeEvent();

      expect(pageTitle.value).toBe('create_event');
    });
  });

  describe('Language Management', () => {
    it('should call onLanguagesUpdate with event languages', async () => {
      const calendar = new Calendar('cal-1', 'test-calendar');

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar]);

      const mockOnLanguagesUpdate = vi.fn();
      const { initializeEvent } = useEventEditor('en');

      await initializeEvent(null, mockOnLanguagesUpdate);

      expect(mockOnLanguagesUpdate).toHaveBeenCalled();
      const languages = mockOnLanguagesUpdate.mock.calls[0][0];
      expect(languages).toContain('en');
    });

    it('should call onLocationsFetch with calendar ID', async () => {
      const calendar = new Calendar('cal-1', 'test-calendar');

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar]);

      const mockOnLocationsFetch = vi.fn().mockResolvedValue(undefined);
      const { initializeEvent } = useEventEditor();

      await initializeEvent(null, undefined, mockOnLocationsFetch);

      expect(mockOnLocationsFetch).toHaveBeenCalledWith('cal-1');
    });
  });

  describe('State Management', () => {
    it('should set isLoading to false after initialization', async () => {
      const calendar = new Calendar('cal-1', 'test-calendar');

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar]);

      const { state, initializeEvent } = useEventEditor();

      expect(state.isLoading).toBe(true);

      await initializeEvent();

      expect(state.isLoading).toBe(false);
    });

    it('should set isLoading to false even on error', async () => {
      sandbox.stub(CalendarService.prototype, 'loadCalendars').rejects(new Error('API error'));

      const { state, initializeEvent } = useEventEditor();

      await initializeEvent();

      expect(state.isLoading).toBe(false);
    });

    it('should set error on calendar loading failure', async () => {
      sandbox.stub(CalendarService.prototype, 'loadCalendars').rejects(new Error('API error'));

      const { state, initializeEvent } = useEventEditor();

      await initializeEvent();

      expect(state.err).toBe('error_loading_calendars');
    });

    it('should update available calendars', async () => {
      const calendar1 = new Calendar('cal-1', 'calendar-1');
      const calendar2 = new Calendar('cal-2', 'calendar-2');

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar1, calendar2]);

      const { state, initializeEvent } = useEventEditor();

      await initializeEvent();

      expect(state.availableCalendars).toHaveLength(2);
      expect(state.availableCalendars[0].id).toBe('cal-1');
      expect(state.availableCalendars[1].id).toBe('cal-2');
    });

    it('should set current calendar based on event', async () => {
      const calendar1 = new Calendar('cal-1', 'calendar-1');
      const calendar2 = new Calendar('cal-2', 'calendar-2');

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar1, calendar2]);

      const { state, initializeEvent } = useEventEditor();

      mockCalendarStore.getLastInteractedCalendar = calendar2;

      await initializeEvent();

      expect(state.calendar?.id).toBe('cal-2');
    });

    it('should clear previous validation errors on save', async () => {
      const calendar = new Calendar('cal-1', 'test-calendar');
      const savedEvent = new CalendarEvent('event-123', 'cal-1');

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar]);
      sandbox.stub(EventService.prototype, 'saveEvent').resolves(savedEvent);

      const { state, initializeEvent, saveEvent } = useEventEditor();

      await initializeEvent();

      state.err = 'Previous error';

      const mockT = vi.fn((key) => key);
      await saveEvent(mockT);

      // Error should be cleared before save attempt
      expect(state.err).toBe('');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty categories array', async () => {
      mockRoute.params.eventId = 'event-123';

      const calendar = new Calendar('cal-1', 'test-calendar');
      const event = new CalendarEvent('event-123', 'cal-1');

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar]);
      sandbox.stub(ModelService, 'getModel').resolves(event.toObject());
      sandbox.stub(CategoryService.prototype, 'getEventCategories').resolves([]);

      const { selectedCategories, initializeEvent } = useEventEditor();

      await initializeEvent('event-123');

      expect(selectedCategories.value).toEqual([]);
    });

    it('should handle missing event content gracefully', async () => {
      const calendar = new Calendar('cal-1', 'test-calendar');

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar]);

      const { state, initializeEvent } = useEventEditor('de');

      await initializeEvent();

      expect(state.event).not.toBeNull();
      expect(state.event?.content('de')).toBeDefined();
    });

    it('should handle null calendar in event', async () => {
      const calendar1 = new Calendar('cal-1', 'calendar-1');
      const calendar2 = new Calendar('cal-2', 'calendar-2');

      sandbox.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar1, calendar2]);

      const { state, initializeEvent } = useEventEditor();

      await initializeEvent();

      // Force nonexistent calendarId
      state.event!.calendarId = 'nonexistent-id';

      // Re-initialization in create mode will create a new event with first available calendar
      // So we expect the calendar to be set, not null
      const mockOnLanguagesUpdate = vi.fn();
      await initializeEvent(null, mockOnLanguagesUpdate);

      // After re-initialization, a new event is created with the first available calendar
      expect(state.calendar?.id).toBe('cal-1');
    });
  });
});
