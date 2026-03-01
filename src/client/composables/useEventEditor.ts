import { ref, reactive, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CalendarEvent } from '@/common/model/events';
import { EventLocation } from '@/common/model/location';
import type { Calendar } from '@/common/model/calendar';
import CalendarService from '@/client/service/calendar';
import EventService from '@/client/service/event';
import CategoryService from '@/client/service/category';
import SeriesService from '@/client/service/series';
import ModelService from '@/client/service/models';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { useEventDuplication } from '@/client/composables/useEventDuplication';
import { useToast } from '@/client/composables/useToast';

/**
 * Editor mode type
 */
export type EditorMode = 'create' | 'edit' | 'duplicate';

/**
 * Event editor state interface
 */
export interface EventEditorState {
  isLoading: boolean;
  err: string;
  errDetail: string;
  event: CalendarEvent | null;
  calendar: Calendar | null;
  availableCalendars: Calendar[];
  mode: EditorMode;
  isDuplicationMode: boolean;
}

/**
 * Checks whether an EventLocation has any meaningful data.
 * A location is considered empty if it has no id and no name.
 *
 * @param location - The location to check
 * @returns true if the location is empty
 */
function isEmptyLocation(location: EventLocation): boolean {
  return !location.id && !location.name;
}

/**
 * Composable for event editor core functionality
 *
 * Handles mode determination, event initialization, loading, and saving.
 * Extracted from edit_event.vue for better maintainability and testability.
 *
 * @param defaultLanguage - The default language code for event content
 * @returns Event editor state and methods
 */
export function useEventEditor(defaultLanguage: string = 'en') {
  const route = useRoute();
  const router = useRouter();
  const calendarStore = useCalendarStore();
  const { stripEventForDuplication } = useEventDuplication();
  const toast = useToast();

  // Services
  const calendarService = new CalendarService();
  const eventService = new EventService();
  const categoryService = new CategoryService();
  const seriesService = new SeriesService();

  // State
  const state = reactive<EventEditorState>({
    isLoading: true,
    err: '',
    errDetail: '',
    event: null,
    calendar: null,
    availableCalendars: [],
    mode: 'create',
    isDuplicationMode: false,
  });

  const selectedCategories = ref<string[]>([]);
  const selectedSeriesId = ref<string | null>(null);
  const mediaId = ref<string | null>(null);

  /**
   * Determine the editor mode based on route parameters
   * - Edit mode: /event/:eventId
   * - Duplicate mode: /event?from=:eventId
   * - Create mode: /event (default)
   *
   * @param eventIdProp - Optional event ID from component props
   * @returns The determined editor mode
   */
  const determineMode = (eventIdProp?: string | null): EditorMode => {
    const eventIdParam = eventIdProp || route.params.eventId;
    const fromParam = route.query.from;

    if (eventIdParam) {
      return 'edit';
    }
    if (fromParam) {
      return 'duplicate';
    }
    return 'create';
  };

  /**
   * Initialize a new event for create mode
   *
   * @param calendar - The calendar to associate the event with
   * @returns A new CalendarEvent instance
   */
  const initializeNewEvent = (calendar?: Calendar): CalendarEvent => {
    const event = new CalendarEvent();
    event.location = new EventLocation();
    event.addSchedule();
    if (calendar) {
      event.calendarId = calendar.id;
    }
    // Pre-populate default language content to avoid triggering dirty state when template renders
    event.content(defaultLanguage);
    return event;
  };

  /**
   * Load an event from the API for edit or duplicate mode
   * Uses ModelService which includes JWT authentication via axios interceptor
   *
   * @param eventId - The ID of the event to load
   * @returns The loaded CalendarEvent or null if loading failed
   */
  const loadEvent = async (eventId: string): Promise<CalendarEvent | null> => {
    try {
      const eventData = await ModelService.getModel(`/api/v1/events/${eventId}`);

      if (!eventData) {
        // Event not found
        state.err = 'Event not found';
        router.push({ name: 'calendars' });
        return null;
      }

      return CalendarEvent.fromObject(eventData);
    }
    catch (error: any) {
      console.error('Error loading event:', error);

      // Check for axios error with response status
      if (error.response) {
        if (error.response.status === 401) {
          // Not authenticated
          router.push({ name: 'login' });
          return null;
        }
        if (error.response.status === 403) {
          // No permission
          router.push({ name: 'calendars' });
          return null;
        }
      }

      state.err = 'Failed to load event';
      return null;
    }
  };

  /**
   * Initialize the event editor based on mode and route parameters
   *
   * @param eventIdProp - Optional event ID from component props
   * @param onLanguagesUpdate - Callback to update languages list
   * @param onLocationsFetch - Callback to fetch locations for a calendar
   * @returns Promise that resolves when initialization is complete
   */
  const initializeEvent = async (
    eventIdProp?: string | null,
    onLanguagesUpdate?: (languages: string[]) => void,
    onLocationsFetch?: (calendarId: string) => Promise<void>,
  ): Promise<void> => {
    try {
      state.isLoading = true;

      // Determine mode from route
      state.mode = determineMode(eventIdProp);
      state.isDuplicationMode = state.mode === 'duplicate';

      // Load available calendars
      state.availableCalendars = await calendarService.loadCalendars();

      if (state.availableCalendars.length === 0) {
        // No calendars, redirect to calendar creation
        router.push({ name: 'calendars' });
        return;
      }

      // Handle different modes
      if (state.mode === 'edit') {
        // Edit mode: Load existing event
        const eventId = (eventIdProp || route.params.eventId) as string;
        const loadedEvent = await loadEvent(eventId);

        if (!loadedEvent) {
          return; // Redirect handled in loadEvent
        }

        state.event = loadedEvent;
        // Ensure default language content exists
        state.event.content(defaultLanguage);

        // Load categories for existing event
        try {
          const eventCategories = await categoryService.getEventCategories(loadedEvent.id);
          selectedCategories.value = eventCategories.map(cat => cat.id);
        }
        catch (error) {
          console.error('Error loading event categories:', error);
        }

        // Initialize series from the loaded event
        selectedSeriesId.value = loadedEvent.series?.id || null;
      }
      else if (state.mode === 'duplicate') {
        // Duplicate mode: Load source event and strip IDs
        const sourceEventId = route.query.from as string;
        const sourceEvent = await loadEvent(sourceEventId);

        if (!sourceEvent) {
          return; // Redirect handled in loadEvent
        }

        // Strip the event for duplication
        state.event = stripEventForDuplication(sourceEvent);
        // Ensure default language content exists
        state.event.content(defaultLanguage);

        // Load categories from the source event via the API, mirroring the edit mode approach.
        // This is more reliable than relying on sourceEvent.categories, which may be empty
        // if the API response did not include category data in the serialised event object.
        try {
          const eventCategories = await categoryService.getEventCategories(sourceEventId);
          selectedCategories.value = eventCategories.map(cat => cat.id);
        }
        catch (error) {
          console.error('Error loading source event categories:', error);
          // Fall back to categories already present on the loaded event model
          if (sourceEvent.categories && sourceEvent.categories.length > 0) {
            selectedCategories.value = sourceEvent.categories.map(cat => cat.id);
          }
        }

        // Preserve media reference
        if (sourceEvent.mediaId) {
          mediaId.value = sourceEvent.mediaId;
        }
        // Series is not copied on duplication — new event starts without a series
      }
      else {
        // Create mode: Initialize new event
        // Check for pre-selected calendar from store
        const preSelectedCalendar = calendarStore.getLastInteractedCalendar;

        if (preSelectedCalendar) {
          state.event = initializeNewEvent(preSelectedCalendar);
        }
        else if (state.availableCalendars.length === 1) {
          state.event = initializeNewEvent(state.availableCalendars[0]);
        }
        else {
          // Multiple calendars, use first one as default
          state.event = initializeNewEvent(state.availableCalendars[0]);
        }
      }

      // Update languages from event
      if (state.event) {
        const eventLanguages = state.event.getLanguages();
        eventLanguages.unshift(defaultLanguage);
        const uniqueLanguages = [...new Set(eventLanguages)];

        if (onLanguagesUpdate) {
          onLanguagesUpdate(uniqueLanguages);
        }

        // Set current calendar
        state.calendar = state.availableCalendars.find(c => c.id === state.event!.calendarId) || null;

        // Fetch locations for the calendar
        if (onLocationsFetch && state.event.calendarId) {
          await onLocationsFetch(state.event.calendarId);
        }
      }
    }
    catch (error) {
      console.error('Error initializing event editor:', error);
      state.err = 'error_loading_calendars';
    }
    finally {
      state.isLoading = false;
    }
  };

  /**
   * Save the event (create or update)
   *
   * @param t - Translation function for error messages
   * @param onDirtyReset - Callback to reset dirty state after successful save
   * @returns Promise that resolves when save is complete
   */
  const saveEvent = async (
    t: (key: string) => string,
    onDirtyReset?: () => void,
  ): Promise<void> => {
    const model = state.event;

    if (!model) {
      state.err = t('error_no_event');
      state.errDetail = '';
      return;
    }

    // Clear previous validation errors
    state.err = '';
    state.errDetail = '';

    // Ensure we have a calendarId
    if (!model.calendarId && state.availableCalendars.length > 0) {
      model.calendarId = state.availableCalendars[0].id;
    }

    if (!model.calendarId) {
      state.err = t('error_no_calendar');
      state.errDetail = '';
      return;
    }

    // Validate that at least one schedule has a date and start time
    const hasValidSchedule = model.schedules && model.schedules.some(
      (schedule: any) => schedule.startDate,
    );
    if (!hasValidSchedule) {
      state.err = t('error_date_required');
      state.errDetail = '';
      return;
    }

    try {
      if (mediaId.value) {
        model.mediaId = mediaId.value;
      }

      // Set locationId if a location has been selected
      // (The location object is only for display purposes in the UI)
      if (state.event.locationId) {
        model.locationId = state.event.locationId;
      }

      // Nullify empty location objects to prevent sending empty data to the server.
      // The form initializes events with an empty EventLocation for UI binding,
      // but the server rejects empty location objects with a 500 error.
      if (model.location && isEmptyLocation(model.location)) {
        model.location = null;
      }

      // Save the event
      const savedEvent = await eventService.saveEvent(model);

      // Save category assignments if any categories are selected
      if (selectedCategories.value.length > 0) {
        try {
          await categoryService.assignCategoriesToEvent(savedEvent.id, selectedCategories.value);
        }
        catch (categoryError) {
          console.error('Error saving event categories:', categoryError);
          // Don't fail the entire save for category errors
        }
      }

      // Save series assignment: assign or clear based on selection
      try {
        const previousSeriesId = model.series?.id || null;
        if (selectedSeriesId.value) {
          // Assign (or reassign) series to the event
          await seriesService.assignSeries(savedEvent.id, selectedSeriesId.value);
        }
        else if (previousSeriesId) {
          // Clear the existing series assignment
          await seriesService.clearSeries(savedEvent.id, previousSeriesId);
        }
      }
      catch (seriesError) {
        console.error('Error saving event series:', seriesError);
        // Don't fail the entire save for series errors
      }

      // Update selected calendar
      calendarStore.setSelectedCalendar(model.calendarId);

      // Reset dirty state after successful save to allow navigation
      if (onDirtyReset) {
        onDirtyReset();
      }

      // Show success toast before navigating away
      toast.success(t('event_saved_success'));

      // Navigate to the calendar view for this event's calendar
      const calendar = state.availableCalendars.find(c => c.id === model.calendarId);
      if (calendar) {
        router.push({
          name: 'calendar',
          params: { calendar: calendar.urlName },
        });
      }
      else {
        router.push({ name: 'calendars' });
      }
    }
    catch (error: any) {
      console.error('Error saving event:', error);
      state.err = t('error_saving_event');
      // Extract actionable detail from the server response if available
      const serverMessage = error?.response?.data?.error
        || error?.response?.data?.message
        || error?.message
        || '';
      state.errDetail = typeof serverMessage === 'string' ? serverMessage : '';
    }
  };

  /**
   * Computed page title based on mode
   */
  const pageTitle = computed(() => {
    if (state.mode === 'edit') {
      return 'edit_event';
    }
    else if (state.mode === 'duplicate') {
      return 'duplicate_event';
    }
    else {
      return 'create_event';
    }
  });

  return {
    state,
    selectedCategories,
    selectedSeriesId,
    mediaId,
    initializeEvent,
    saveEvent,
    pageTitle,
  };
}
