import { CalendarEvent } from '@/common/model/events';

/**
 * Composable for event duplication functionality
 */
export function useEventDuplication() {

  /**
   * Strips auto-generated and ID fields from an event for duplication
   * @param sourceEvent The original event to duplicate
   * @returns A new event with IDs and auto-generated fields removed but related data preserved
   */
  const stripEventForDuplication = (sourceEvent: CalendarEvent): CalendarEvent => {
    // Clone the event to avoid modifying the original
    const duplicatedEvent = sourceEvent.clone();

    // Remove the event ID to create a new event
    duplicatedEvent.id = '';

    // Strip schedule IDs to create new schedules but preserve schedule data
    duplicatedEvent.schedules.forEach(schedule => {
      schedule.id = '';
    });

    // Remove event source URL as this is a new event
    duplicatedEvent.eventSourceUrl = '';

    // Keep media reference - user likely wants same media for duplicated event
    // Note: media and mediaId are preserved

    // Keep categories - user likely wants same categories for duplicated event
    // Note: categories array is preserved

    return duplicatedEvent;
  };

  return {
    stripEventForDuplication,
  };
}
