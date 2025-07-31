import { Calendar } from '@/common/model/calendar';
import { EventCategory } from '@/common/model/event_category';
import CalendarEventInstance from '@/common/model/event_instance';
import CalendarInterface from '@/server/calendar/interface';

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

  async listEventInstancesWithCategoryFilter(calendar: Calendar, categoryIds: string[]): Promise<CalendarEventInstance[]> {
    // Validate category IDs
    for (const categoryId of categoryIds) {
      if (!categoryId.match(/^[a-zA-Z0-9-_]+$/)) {
        throw new Error('Invalid category IDs provided');
      }
    }

    // Get all event IDs that belong to the specified categories
    const eventIdSets = await Promise.all(
      categoryIds.map(categoryId => this.calendarInterface.getCategoryEvents(categoryId)),
    );

    // Get union of all event IDs (events that belong to any of the specified categories)
    const allEventIds = [...new Set(eventIdSets.flat())];

    // Get all instances for the calendar and filter by event IDs
    const allInstances = await this.calendarInterface.listEventInstancesForCalendar(calendar);

    return allInstances.filter(instance => allEventIds.includes(instance.event.id));
  }
}
