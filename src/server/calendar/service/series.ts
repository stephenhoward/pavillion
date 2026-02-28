import { v4 as uuidv4 } from 'uuid';
import { QueryTypes } from 'sequelize';

import { Account } from '@/common/model/account';
import { EventSeries } from '@/common/model/event_series';
import { EventSeriesContent } from '@/common/model/event_series_content';
import { CalendarEvent } from '@/common/model/events';
import { EventSeriesEntity, EventSeriesContentEntity } from '@/server/calendar/entity/event_series';
import { EventEntity, EventContentEntity, EventScheduleEntity } from '@/server/calendar/entity/event';
import { MediaEntity } from '@/server/media/entity/media';
import { CalendarNotFoundError, EventNotFoundError, InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';
import {
  SeriesNotFoundError,
  SeriesUrlNameAlreadyExistsError,
  InvalidSeriesUrlNameError,
  SeriesEventCalendarMismatchError,
} from '@/common/exceptions/series';
import CalendarService from './calendar';
import db from '@/server/common/entity/db';

/**
 * Service for managing event series within calendars.
 * Handles CRUD operations for series with multi-language content support.
 */
class SeriesService {
  constructor(private calendarService?: CalendarService) {
    // calendarService is optional for backward compatibility but recommended for proper dependency injection
  }

  /**
   * Validate a series URL name against the allowed pattern.
   * Same regex as Calendar.isValidUrlName: /^[a-z0-9][a-z0-9_]{2,23}$/i
   *
   * @param urlName - The URL name to validate
   * @returns true if valid, false otherwise
   */
  isValidUrlName(urlName: string): boolean {
    return /^[a-z0-9][a-z0-9_]{2,23}$/i.test(urlName);
  }

  /**
   * Create a new event series for a calendar.
   *
   * @param account - The account performing the creation
   * @param calendarId - The calendar to create the series in
   * @param seriesData - Series data including urlName, mediaId, and content
   * @returns The created EventSeries
   * @throws CalendarNotFoundError if calendar doesn't exist
   * @throws InsufficientCalendarPermissionsError if user lacks editor permission
   * @throws InvalidSeriesUrlNameError if urlName format is invalid
   * @throws SeriesUrlNameAlreadyExistsError if urlName is already taken in this calendar
   */
  async createSeries(account: Account, calendarId: string, seriesData: Record<string, any>): Promise<EventSeries> {
    // Get calendar and verify ownership/editor permissions
    const calendar = await this.getCalendar(calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    const canModify = await this.userCanModifyCalendar(account, calendar);
    if (!canModify) {
      throw new InsufficientCalendarPermissionsError();
    }

    // Validate urlName format
    const urlName = seriesData.urlName as string;
    if (!urlName || !this.isValidUrlName(urlName)) {
      throw new InvalidSeriesUrlNameError();
    }

    // Check for duplicate urlName within this calendar
    const existing = await EventSeriesEntity.findOne({
      where: { calendar_id: calendarId, url_name: urlName },
    });
    if (existing) {
      throw new SeriesUrlNameAlreadyExistsError();
    }

    // Validate mediaId ownership if provided
    if (seriesData.mediaId) {
      const media = await MediaEntity.findOne({
        where: { id: seriesData.mediaId, calendar_id: calendarId },
      });
      if (!media) {
        throw new Error('Media not found or does not belong to this calendar');
      }
    }

    // Create the series entity
    const seriesEntity = EventSeriesEntity.build({
      id: uuidv4(),
      calendar_id: calendarId,
      url_name: urlName,
      media_id: seriesData.mediaId ?? null,
    });
    await seriesEntity.save();

    const series = seriesEntity.toModel();

    // Create content for each provided language
    if (seriesData.content) {
      for (const [language, content] of Object.entries(seriesData.content)) {
        if (!content) continue;
        const c = content as Record<string, any>;
        if (!c.name) continue;
        series.addContent(await this.createSeriesContent(series.id, language, c));
      }
    }

    return series;
  }

  /**
   * Get a specific series by ID with optional calendar scope enforcement.
   *
   * @param seriesId - The ID of the series to retrieve
   * @param calendarId - Optional calendar ID to verify series belongs to calendar
   * @returns The EventSeries
   * @throws SeriesNotFoundError if series doesn't exist or belongs to a different calendar
   */
  async getSeries(seriesId: string, calendarId?: string): Promise<EventSeries> {
    const seriesEntity = await EventSeriesEntity.findByPk(seriesId, {
      include: [EventSeriesContentEntity],
    });

    if (!seriesEntity) {
      throw new SeriesNotFoundError();
    }

    // Verify series belongs to the specified calendar if calendarId is provided
    if (calendarId && seriesEntity.calendar_id !== calendarId) {
      throw new SeriesNotFoundError();
    }

    return seriesEntity.toModel();
  }

  /**
   * Get a series by its URL name within a calendar.
   *
   * @param calendarId - The calendar to search within
   * @param urlName - The URL name of the series
   * @returns The EventSeries
   * @throws SeriesNotFoundError if series doesn't exist in this calendar
   */
  async getSeriesByUrlName(calendarId: string, urlName: string): Promise<EventSeries> {
    const seriesEntity = await EventSeriesEntity.findOne({
      where: { calendar_id: calendarId, url_name: urlName },
      include: [EventSeriesContentEntity],
    });

    if (!seriesEntity) {
      throw new SeriesNotFoundError();
    }

    return seriesEntity.toModel();
  }

  /**
   * Get all series for a calendar.
   *
   * @param calendarId - The calendar to retrieve series for
   * @returns Array of EventSeries
   */
  async getSeriesForCalendar(calendarId: string): Promise<EventSeries[]> {
    const entities = await EventSeriesEntity.findAll({
      where: { calendar_id: calendarId },
      include: [EventSeriesContentEntity],
      order: [['created_at', 'ASC']],
    });

    return entities.map(entity => entity.toModel());
  }

  /**
   * Update a series with new data.
   * Note: urlName is immutable after creation and cannot be changed.
   *
   * @param account - The account performing the update
   * @param seriesId - The ID of the series to update
   * @param seriesData - The data to update (urlName changes are rejected)
   * @param calendarId - Optional calendar ID to verify series belongs to calendar
   * @returns The updated EventSeries
   * @throws SeriesNotFoundError if series doesn't exist or belongs to a different calendar
   * @throws CalendarNotFoundError if calendar doesn't exist
   * @throws InsufficientCalendarPermissionsError if user lacks editor permission
   * @throws Error if urlName change is attempted
   */
  async updateSeries(account: Account, seriesId: string, seriesData: Record<string, any>, calendarId?: string): Promise<EventSeries> {
    // Get series to verify it exists
    const series = await this.getSeries(seriesId);

    // Verify series belongs to the specified calendar if calendarId is provided
    if (calendarId && series.calendarId !== calendarId) {
      throw new SeriesNotFoundError();
    }

    // Reject urlName changes — urlName is immutable after creation
    if (seriesData.urlName !== undefined && seriesData.urlName !== series.urlName) {
      throw new Error('Series urlName is immutable and cannot be changed after creation');
    }

    // Get calendar and verify ownership/editor permissions
    const calendar = await this.getCalendar(series.calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    const canModify = await this.userCanModifyCalendar(account, calendar);
    if (!canModify) {
      throw new InsufficientCalendarPermissionsError();
    }

    // Validate mediaId ownership if provided
    if (seriesData.mediaId !== undefined) {
      if (seriesData.mediaId !== null) {
        const media = await MediaEntity.findOne({
          where: { id: seriesData.mediaId, calendar_id: series.calendarId },
        });
        if (!media) {
          throw new Error('Media not found or does not belong to this calendar');
        }
      }

      // Update media_id on the entity
      await EventSeriesEntity.update(
        { media_id: seriesData.mediaId },
        { where: { id: seriesId } },
      );
    }

    // Handle content updates
    if (seriesData.content) {
      for (const [language, content] of Object.entries(seriesData.content)) {
        const contentEntity = await EventSeriesContentEntity.findOne({
          where: { series_id: seriesId, language },
        });

        if (contentEntity) {
          if (!content) {
            await contentEntity.destroy();
            continue;
          }

          const c = content as Record<string, any>;

          if (!c.name || Object.keys(c).length === 0) {
            await contentEntity.destroy();
            continue;
          }

          // Update existing content
          contentEntity.name = c.name;
          if (c.description !== undefined) {
            contentEntity.description = c.description;
          }
          await contentEntity.save();
        }
        else {
          if (!content) {
            continue;
          }

          const c = content as Record<string, any>;

          if (c.name && Object.keys(c).length > 0) {
            await this.createSeriesContent(seriesId, language, c);
          }
        }
      }
    }

    // Return updated series
    return this.getSeries(seriesId, calendarId);
  }

  /**
   * Delete a series and clear series_id from associated events.
   *
   * @param account - The account performing the deletion
   * @param seriesId - The ID of the series to delete
   * @param calendarId - Optional calendar ID to verify series belongs to calendar
   * @throws SeriesNotFoundError if series doesn't exist or belongs to a different calendar
   * @throws CalendarNotFoundError if calendar doesn't exist
   * @throws InsufficientCalendarPermissionsError if user lacks editor permission
   */
  async deleteSeries(account: Account, seriesId: string, calendarId?: string): Promise<void> {
    // Get series to verify it exists and verify calendar match
    const series = await this.getSeries(seriesId, calendarId);

    // Get calendar and verify ownership/editor permissions
    const calendar = await this.getCalendar(series.calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    const canModify = await this.userCanModifyCalendar(account, calendar);
    if (!canModify) {
      throw new InsufficientCalendarPermissionsError();
    }

    const transaction = await db.transaction();

    try {
      // Clear series_id from all associated events
      await EventEntity.update(
        { series_id: null },
        { where: { series_id: seriesId }, transaction },
      );

      // Delete all content translations
      await EventSeriesContentEntity.destroy({
        where: { series_id: seriesId },
        transaction,
      });

      // Delete the series itself
      await EventSeriesEntity.destroy({
        where: { id: seriesId },
        transaction,
      });

      await transaction.commit();
    }
    catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Assign an event to a series.
   * Both the event and the series must belong to the same calendar.
   * Remote events (events without a calendar_id) cannot be assigned.
   *
   * @param account - The account performing the assignment
   * @param eventId - The ID of the event to assign
   * @param seriesId - The ID of the series to assign the event to
   * @throws EventNotFoundError if the event doesn't exist
   * @throws SeriesNotFoundError if the series doesn't exist
   * @throws Error if the event is a remote event (no calendar_id)
   * @throws SeriesEventCalendarMismatchError if event and series belong to different calendars
   * @throws CalendarNotFoundError if the calendar doesn't exist
   * @throws InsufficientCalendarPermissionsError if user lacks editor permission
   */
  async setSeriesForEvent(account: Account, eventId: string, seriesId: string): Promise<void> {
    // Get the event to verify it exists
    const event = await EventEntity.findByPk(eventId);
    if (!event) {
      throw new EventNotFoundError();
    }

    // Reject remote events (events without a calendar_id)
    if (!event.calendar_id) {
      throw new Error('Cannot assign series to remote events');
    }

    // Get the series to verify it exists
    const series = await this.getSeries(seriesId);

    // Verify event and series belong to the same calendar
    if (event.calendar_id !== series.calendarId) {
      throw new SeriesEventCalendarMismatchError();
    }

    // Get calendar and verify permissions
    const calendar = await this.getCalendar(event.calendar_id);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    const canModify = await this.userCanModifyCalendar(account, calendar);
    if (!canModify) {
      throw new InsufficientCalendarPermissionsError();
    }

    // Set series_id on the event
    await EventEntity.update(
      { series_id: seriesId },
      { where: { id: eventId } },
    );
  }

  /**
   * Clear the series assignment from an event (set series_id to null).
   *
   * @param account - The account performing the operation
   * @param eventId - The ID of the event to clear
   * @throws EventNotFoundError if the event doesn't exist
   * @throws Error if the event is a remote event (no calendar_id)
   * @throws CalendarNotFoundError if the calendar doesn't exist
   * @throws InsufficientCalendarPermissionsError if user lacks editor permission
   */
  async clearSeriesForEvent(account: Account, eventId: string): Promise<void> {
    // Get the event to verify it exists
    const event = await EventEntity.findByPk(eventId);
    if (!event) {
      throw new EventNotFoundError();
    }

    // Reject remote events (events without a calendar_id)
    if (!event.calendar_id) {
      throw new Error('Cannot modify series assignment on remote events');
    }

    // Get calendar and verify permissions
    const calendar = await this.getCalendar(event.calendar_id);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    const canModify = await this.userCanModifyCalendar(account, calendar);
    if (!canModify) {
      throw new InsufficientCalendarPermissionsError();
    }

    // Clear the series_id on the event
    await EventEntity.update(
      { series_id: null },
      { where: { id: eventId } },
    );
  }

  /**
   * Get the series assigned to an event, if any.
   *
   * @param eventId - The ID of the event
   * @returns The EventSeries if assigned, or null
   * @throws EventNotFoundError if the event doesn't exist
   */
  async getEventSeries(eventId: string): Promise<EventSeries | null> {
    const event = await EventEntity.findByPk(eventId, {
      include: [EventSeriesEntity],
    });

    if (!event) {
      throw new EventNotFoundError();
    }

    if (!event.series_id || !event.series) {
      return null;
    }

    return event.series.toModel();
  }

  /**
   * Get event counts per series for a calendar.
   *
   * @param calendarId - The calendar ID to get stats for
   * @returns Map of series ID to event count
   */
  async getSeriesStats(calendarId: string): Promise<Map<string, number>> {
    // Get all series IDs for this calendar
    const seriesList = await EventSeriesEntity.findAll({
      where: { calendar_id: calendarId },
      attributes: ['id'],
    });

    const seriesIds = seriesList.map(s => s.id);

    if (seriesIds.length === 0) {
      return new Map();
    }

    // Query event counts grouped by series_id
    const results = await db.query<{ series_id: string; event_count: string }>(
      `SELECT series_id, COUNT(id) as event_count
       FROM event
       WHERE series_id IN (:seriesIds)
       GROUP BY series_id`,
      {
        replacements: { seriesIds },
        type: QueryTypes.SELECT,
      },
    );

    // Build map with all series initialized to 0
    const statsMap = new Map<string, number>();
    for (const seriesId of seriesIds) {
      statsMap.set(seriesId, 0);
    }

    // Update with actual counts
    for (const result of results) {
      statsMap.set(result.series_id, parseInt(result.event_count, 10));
    }

    return statsMap;
  }

  /**
   * Get all events belonging to a series.
   *
   * @param seriesId - The ID of the series
   * @param calendarId - Optional calendar ID to verify the series belongs to it
   * @returns Array of CalendarEvent with full eager loading
   * @throws SeriesNotFoundError if the series doesn't exist or belongs to a different calendar
   */
  async getSeriesEvents(seriesId: string, calendarId?: string): Promise<CalendarEvent[]> {
    // Verify the series exists (and optionally check calendar scope)
    await this.getSeries(seriesId, calendarId);

    const eventEntities = await EventEntity.findAll({
      where: { series_id: seriesId },
      include: [EventContentEntity, EventScheduleEntity],
    });

    return eventEntities.map(entity => entity.toModel());
  }

  /**
   * Create series content for a specific language.
   */
  private async createSeriesContent(seriesId: string, language: string, content: Record<string, any>): Promise<EventSeriesContent> {
    const contentEntity = EventSeriesContentEntity.build({
      id: uuidv4(),
      series_id: seriesId,
      language,
      name: content.name,
      description: content.description ?? null,
    });
    await contentEntity.save();

    return contentEntity.toModel();
  }

  /**
   * Get a calendar by ID — internal helper method.
   */
  private async getCalendar(id: string): Promise<import('@/common/model/calendar').Calendar | null> {
    if (this.calendarService) {
      return await this.calendarService.getCalendar(id);
    }

    // Fallback to direct entity access if no service injected
    const { CalendarEntity } = await import('@/server/calendar/entity/calendar');
    const calendarEntity = await CalendarEntity.findByPk(id);
    return calendarEntity ? calendarEntity.toModel() : null;
  }

  /**
   * Check if a user can modify a calendar — internal helper method.
   * Uses CalendarMemberEntity for unified membership lookup.
   */
  private async userCanModifyCalendar(account: Account, calendar: import('@/common/model/calendar').Calendar): Promise<boolean> {
    if (this.calendarService) {
      return await this.calendarService.userCanModifyCalendar(account, calendar);
    }

    // Fallback to direct implementation if no service injected
    if (account.hasRole('admin')) {
      return true;
    }

    const { CalendarMemberEntity } = await import('@/server/calendar/entity/calendar_member');

    const membership = await CalendarMemberEntity.findOne({
      where: {
        calendar_id: calendar.id,
        account_id: account.id,
      },
    });

    return membership !== null;
  }
}

export default SeriesService;
