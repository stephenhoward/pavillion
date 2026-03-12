import { Calendar } from '@/common/model/calendar';
import { EventCategory } from '@/common/model/event_category';
import CalendarEventInstance from '@/common/model/event_instance';
import CalendarInterface from '@/server/calendar/interface';
import { DateTime } from 'luxon';
import { logError } from '@/server/common/helper/error-logger';

/**
 * Service for public calendar operations
 *
 * This service contains business logic for public calendar functionality
 * and acts as an abstraction layer over the calendar domain interface.
 */
export default class PublicCalendarService {
  constructor(
    private calendarInterface: CalendarInterface,
  ) {}

  async listCategoriesForCalendar(calendar: Calendar): Promise<Array<{category: EventCategory, eventCount: number}>> {
    const categories = await this.calendarInterface.getCategories(calendar.id);

    // Get event count for each category
    const categoriesWithCounts = await Promise.all(
      categories.map(async (category) => {
        const eventIds = await this.calendarInterface.getCategoryEvents(category.id);
        return {
          category,
          eventCount: eventIds.length,
        };
      }),
    );

    return categoriesWithCounts;
  }

  async listEventInstances(calendar: Calendar): Promise<CalendarEventInstance[]> {
    const instances = await this.calendarInterface.listEventInstancesForCalendar(calendar);

    // Populate category information for each event
    await this.populateEventCategories(instances);

    return instances;
  }

  async listEventInstancesWithCategoryFilter(calendar: Calendar, categoryNames: string[], language: string = 'en'): Promise<CalendarEventInstance[]> {
    // Validate category names
    for (const categoryName of categoryNames) {
      if (!categoryName.trim() || categoryName.length > 100) {
        throw new Error('Invalid category names provided');
      }
    }

    // Get categories and map by name in the specified language to get their IDs for internal filtering
    const categories = await this.calendarInterface.getCategories(calendar.id);
    const categoryMap = new Map<string, string>();

    for (const category of categories) {
      try {
        // Try to get content in the requested language, fallback to first available language
        const content = category.content(language) || category.content(category.getLanguages()[0]);
        if (content?.name) {
          categoryMap.set(content.name, category.id);
        }
      }
      catch (error) {
        logError(error, `[Public] Error getting category content for category ${category.id}`);
      }
    }

    const categoryIds = categoryNames.map(name => categoryMap.get(name)).filter(id => id !== undefined) as string[];

    // If none of the provided category names matched any existing categories, throw an error
    if (categoryIds.length === 0) {
      throw new Error('Invalid category names provided');
    }

    // Get all event IDs that belong to the specified categories
    const eventIdSets = await Promise.all(
      categoryIds.map(categoryId => this.calendarInterface.getCategoryEvents(categoryId)),
    );

    // Get union of all event IDs (events that belong to any of the specified categories)
    const allEventIds = [...new Set(eventIdSets.flat())];

    // Get all instances for the calendar and filter by event IDs
    const allInstances = await this.calendarInterface.listEventInstancesForCalendar(calendar);
    const filteredInstances = allInstances.filter(instance => allEventIds.includes(instance.event.id));

    // Populate category information for each event
    await this.populateEventCategories(filteredInstances);

    return filteredInstances;
  }

  /**
   * List event instances with combined filters (search, categories, date range).
   * Delegates query building to the calendar domain's EventInstanceService.
   *
   * @param calendar - The calendar to filter events for
   * @param options - Filter options
   * @returns Filtered event instances, each augmented with isRecurring
   */
  async listEventInstancesWithFilters(calendar: Calendar, options: {
    search?: string;
    categories?: string[];
    startDate?: string;
    endDate?: string;
  }): Promise<CalendarEventInstance[]> {
    // Validate date formats if provided
    if (options.startDate && !this.isValidISODate(options.startDate)) {
      throw new Error('Invalid date format');
    }
    if (options.endDate && !this.isValidISODate(options.endDate)) {
      throw new Error('Invalid date format');
    }

    return this.calendarInterface.listEventInstancesWithFilters(calendar, options);
  }

  /**
   * Get a single event instance with full schedule and location content data.
   * Used by the public detail page.
   *
   * @param instanceId - The UUID of the event instance
   * @returns The event instance augmented with schedule detail and recurrence text,
   *          or null if not found
   */
  async getEventInstanceById(instanceId: string): Promise<CalendarEventInstance | null> {
    return this.calendarInterface.getEventInstanceWithDetails(instanceId);
  }

  /**
   * Validate ISO date format (YYYY-MM-DD)
   */
  private isValidISODate(dateString: string): boolean {
    const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!isoDatePattern.test(dateString)) {
      return false;
    }

    // Check if it's a valid date using Luxon
    const date = DateTime.fromISO(dateString);
    return date.isValid;
  }

  /**
   * Populate category information for events in instances
   */
  private async populateEventCategories(instances: CalendarEventInstance[]): Promise<void> {
    // Group instances by event ID to avoid duplicate category lookups
    const eventMap = new Map<string, CalendarEventInstance[]>();

    for (const instance of instances) {
      const eventId = instance.event.id;
      if (!eventMap.has(eventId)) {
        eventMap.set(eventId, []);
      }
      eventMap.get(eventId)!.push(instance);
    }

    // Fetch categories for each unique event
    await Promise.all(
      Array.from(eventMap.entries()).map(async ([eventId, eventInstances]) => {
        try {
          const categories = await this.calendarInterface.getEventCategories(eventId);

          // Add categories to the event object for serialization
          for (const instance of eventInstances) {
            // Add categories property to the event for frontend consumption
            (instance.event as any).categories = categories;
          }
        }
        catch (error) {
          logError(error, `[Public] Error fetching categories for event ${eventId}`);
          // Set empty array if category fetch fails
          for (const instance of eventInstances) {
            (instance.event as any).categories = [];
          }
        }
      }),
    );
  }
}
