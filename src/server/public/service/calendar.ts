import { Calendar } from '@/common/model/calendar';
import { EventCategory } from '@/common/model/event_category';
import CalendarEventInstance from '@/common/model/event_instance';
import CalendarInterface from '@/server/calendar/interface';
import { EventInstanceEntity } from '@/server/calendar/entity/event_instance';
import { EventEntity, EventContentEntity } from '@/server/calendar/entity/event';
import { EventCategoryAssignmentEntity } from '@/server/calendar/entity/event_category_assignment';
import { EventCategoryEntity, EventCategoryContentEntity } from '@/server/calendar/entity/event_category';
import { LocationEntity } from '@/server/calendar/entity/location';
import { MediaEntity } from '@/server/media/entity/media';
import { Op, literal } from 'sequelize';
import { DateTime } from 'luxon';

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
        console.error(`Error getting category content for category ${category.id}:`, error);
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
   * List event instances with combined filters (search, categories, date range)
   *
   * @param calendar - The calendar to filter events for
   * @param options - Filter options
   * @returns Filtered event instances
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

    // Build the query for event instances
    const queryOptions: any = {
      include: [
        {
          model: EventEntity,
          as: 'event',
          where: { calendar_id: calendar.id },
          include: [
            LocationEntity,
            MediaEntity,
            {
              model: EventCategoryAssignmentEntity,
              as: 'categoryAssignments',
              include: [{
                model: EventCategoryEntity,
                as: 'category',
                include: [EventCategoryContentEntity],
              }],
            },
          ],
        },
      ],
    };

    // Handle search parameter - search in event title/description
    if (options.search && options.search.trim()) {
      const searchTerm = options.search.trim().toLowerCase().replace(/'/g, "''");

      // Add content to the event include with search filter
      const eventInclude = queryOptions.include[0];
      eventInclude.include.push({
        model: EventContentEntity,
        as: 'content',
        where: literal(`(LOWER(\`event->content\`.\`name\`) LIKE '%${searchTerm}%' OR LOWER(\`event->content\`.\`description\`) LIKE '%${searchTerm}%')`),
        required: true, // INNER JOIN to only include events with matching content
      });
    }
    else {
      // Always include content, but without search filter
      const eventInclude = queryOptions.include[0];
      eventInclude.include.push(EventContentEntity);
    }

    // Handle category filter - map category names to IDs
    if (options.categories && options.categories.length > 0) {
      // Map category names to IDs (similar to listEventInstancesWithCategoryFilter)
      const categories = await this.calendarInterface.getCategories(calendar.id);
      const categoryMap = new Map<string, string>();

      // Default to English language for category name matching
      const language = 'en';

      for (const category of categories) {
        try {
          const content = category.content(language) || category.content(category.getLanguages()[0]);
          if (content?.name) {
            categoryMap.set(content.name, category.id);
          }
        }
        catch (error) {
          console.error(`Error getting category content for category ${category.id}:`, error);
        }
      }

      // Map provided category names to IDs
      const categoryIds = options.categories
        .map(name => categoryMap.get(name))
        .filter(id => id !== undefined) as string[];

      // If none of the provided category names matched, throw an error
      if (categoryIds.length === 0) {
        throw new Error('Invalid category IDs provided');
      }

      // Find the category assignment include in the event include
      const eventInclude = queryOptions.include[0];
      const categoryAssignmentInclude = eventInclude.include.find(
        (inc: any) => inc.model === EventCategoryAssignmentEntity || inc === EventCategoryAssignmentEntity,
      );

      if (categoryAssignmentInclude && typeof categoryAssignmentInclude === 'object') {
        // Add the filter to the existing category assignment include
        categoryAssignmentInclude.where = {
          category_id: {
            [Op.in]: categoryIds,
          },
        };
        categoryAssignmentInclude.required = true; // INNER JOIN to only include events with matching categories
      }
    }

    // Handle date range filter
    const instanceWhere: any = {};

    if (options.startDate || options.endDate) {
      if (options.startDate && options.endDate) {
        // Both start and end date provided - filter by range
        const startDateTime = DateTime.fromISO(options.startDate).startOf('day');
        const endDateTime = DateTime.fromISO(options.endDate).endOf('day');

        instanceWhere.start_time = {
          [Op.gte]: startDateTime.toJSDate(),
          [Op.lte]: endDateTime.toJSDate(),
        };
      }
      else if (options.startDate) {
        // Only start date provided - events on or after this date
        const startDateTime = DateTime.fromISO(options.startDate).startOf('day');
        instanceWhere.start_time = {
          [Op.gte]: startDateTime.toJSDate(),
        };
      }
      else if (options.endDate) {
        // Only end date provided - events on or before this date
        const endDateTime = DateTime.fromISO(options.endDate).endOf('day');
        instanceWhere.start_time = {
          [Op.lte]: endDateTime.toJSDate(),
        };
      }
    }

    if (Object.keys(instanceWhere).length > 0) {
      queryOptions.where = instanceWhere;
    }

    // Execute the query
    const instances = await EventInstanceEntity.findAll(queryOptions);

    // Convert entities to models
    const mappedInstances = instances.map(instanceEntity => {
      const instance = instanceEntity.toModel();
      const event = instanceEntity.event;

      // Add event content
      if (event.content) {
        for (const c of event.content) {
          instance.event.addContent(c.toModel());
        }
      }

      // Add location
      if (event.location) {
        instance.event.location = event.location.toModel();
      }

      // Add media
      if (event.media) {
        instance.event.media = event.media.toModel();
      }

      // Add categories
      const categoryAssignments = event.getDataValue('categoryAssignments') as EventCategoryAssignmentEntity[] | undefined;
      if (categoryAssignments) {
        instance.event.categories = categoryAssignments.map(assignment => assignment.category.toModel());
      }

      return instance;
    });

    return mappedInstances;
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
          console.error(`Error fetching categories for event ${eventId}:`, error);
          // Set empty array if category fetch fails
          for (const instance of eventInstances) {
            (instance.event as any).categories = [];
          }
        }
      }),
    );
  }
}
