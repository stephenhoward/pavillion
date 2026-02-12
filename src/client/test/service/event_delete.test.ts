import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import EventService from '@/client/service/event';
import ModelService from '@/client/service/models';
import { CalendarEvent } from '@/common/model/events';
import { useEventStore } from '@/client/stores/eventStore';

// Mock ModelService
vi.mock('@/client/service/models', () => ({
  default: {
    deleteModel: vi.fn(),
  },
}));

describe('EventService - Delete Functionality', () => {
  let eventService: EventService;
  let mockEventStore: ReturnType<typeof useEventStore>;
  let mockDeleteModel: any;

  beforeEach(() => {
    // Setup Pinia for testing
    setActivePinia(createPinia());

    // Get the event store
    mockEventStore = useEventStore();

    // Spy on store methods
    vi.spyOn(mockEventStore, 'removeEvent');

    // Get the mocked ModelService method
    mockDeleteModel = vi.mocked(ModelService.deleteModel);

    // Create service instance
    eventService = new EventService(mockEventStore);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('deleteEvent', () => {
    it('should successfully delete an event and remove it from store', async () => {
      const testEvent = new CalendarEvent('event-123', 'calendar-123');
      mockEventStore.addEvent('calendar-123', testEvent);

      // Setup mock to resolve successfully
      mockDeleteModel.mockResolvedValue(undefined);

      await eventService.deleteEvent(testEvent);

      // Verify API call was made with correct parameters
      expect(mockDeleteModel).toHaveBeenCalledWith(testEvent, '/api/v1/events');
      expect(mockDeleteModel).toHaveBeenCalledTimes(1);

      // Verify event was removed from store
      expect(mockEventStore.removeEvent).toHaveBeenCalledWith('calendar-123', testEvent);
      expect(mockEventStore.removeEvent).toHaveBeenCalledTimes(1);
      expect(mockEventStore.events['calendar-123']).not.toContain(testEvent);
    });

    it('should handle API errors gracefully', async () => {
      const testEvent = new CalendarEvent('event-123', 'calendar-123');
      const apiError = new Error('API Error: Event not found');
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockEventStore.addEvent('calendar-123', testEvent);

      // Setup mock to reject
      mockDeleteModel.mockRejectedValue(apiError);

      // Expect the error to be thrown
      await expect(eventService.deleteEvent(testEvent)).rejects.toThrow('API Error: Event not found');

      // Verify API call was attempted
      expect(mockDeleteModel).toHaveBeenCalledWith(testEvent, '/api/v1/events');

      // Verify store method was NOT called due to error
      expect(mockEventStore.removeEvent).not.toHaveBeenCalled();
      expect(mockEventStore.events['calendar-123'].some((event: CalendarEvent) => event.id === testEvent.id)).toBe(true);

      // Verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error deleting event:', apiError);
    });

    it('should work with different event instances', async () => {
      const events = [
        new CalendarEvent('event-1', 'calendar-1'),
        new CalendarEvent('event-2', 'calendar-2'),
        new CalendarEvent('event-3', 'calendar-3'),
      ];

      // Add events to store
      events.forEach(event => {
        mockEventStore.addEvent(event.calendarId!, event);
      });

      mockDeleteModel.mockResolvedValue(undefined);

      // Delete each event
      for (const event of events) {
        await eventService.deleteEvent(event);
      }

      // Verify each deletion was called correctly
      expect(mockDeleteModel).toHaveBeenCalledTimes(3);
      expect(mockEventStore.removeEvent).toHaveBeenCalledTimes(3);

      // Verify each specific call
      events.forEach((event, index) => {
        expect(mockDeleteModel).toHaveBeenNthCalledWith(index + 1, event, '/api/v1/events');
        expect(mockEventStore.removeEvent).toHaveBeenNthCalledWith(index + 1, event.calendarId, event);
      });
    });

    it('should handle concurrent deletions correctly', async () => {
      const events = [
        new CalendarEvent('event-a', 'calendar-a'),
        new CalendarEvent('event-b', 'calendar-b'),
        new CalendarEvent('event-c', 'calendar-c'),
      ];

      // Add events to store
      events.forEach(event => {
        mockEventStore.addEvent(event.calendarId!, event);
      });

      mockDeleteModel.mockResolvedValue(undefined);

      // Delete all events concurrently
      const deletionPromises = events.map(event => eventService.deleteEvent(event));
      await Promise.all(deletionPromises);

      // Verify all deletions were called
      expect(mockDeleteModel).toHaveBeenCalledTimes(3);
      expect(mockEventStore.removeEvent).toHaveBeenCalledTimes(3);

      // Verify each event was processed
      events.forEach(event => {
        expect(mockDeleteModel).toHaveBeenCalledWith(event, '/api/v1/events');
        expect(mockEventStore.removeEvent).toHaveBeenCalledWith(event.calendarId, event);
      });
    });

    it('should handle partial failures in concurrent deletions', async () => {
      const events = [
        new CalendarEvent('event-success', 'calendar-success'),
        new CalendarEvent('event-fail', 'calendar-fail'),
        new CalendarEvent('event-success2', 'calendar-success2'),
      ];

      // Add events to store
      events.forEach(event => {
        mockEventStore.addEvent(event.calendarId!, event);
      });

      // Setup mixed success/failure responses
      mockDeleteModel
        .mockResolvedValueOnce(undefined) // First call succeeds
        .mockRejectedValueOnce(new Error('API Error')) // Second call fails
        .mockResolvedValueOnce(undefined); // Third call succeeds

      const deletionPromises = events.map(event =>
        eventService.deleteEvent(event).catch(error => ({ error, event })),
      );

      const results = await Promise.all(deletionPromises);

      // Verify API was called for all events
      expect(mockDeleteModel).toHaveBeenCalledTimes(3);

      // Verify store updates only for successful deletions
      expect(mockEventStore.removeEvent).toHaveBeenCalledTimes(2);
      expect(mockEventStore.removeEvent).toHaveBeenCalledWith(events[0].calendarId, events[0]);
      expect(mockEventStore.removeEvent).toHaveBeenCalledWith(events[2].calendarId, events[2]);

      // Check results contain the expected error
      const failedResult = results.find(result => result && 'error' in result);
      expect(failedResult).toBeDefined();
      expect(failedResult?.error.message).toBe('API Error');
    });
  });
});
