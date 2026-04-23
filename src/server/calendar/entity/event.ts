import { Model, Table, Column, PrimaryKey, BelongsTo, DataType, ForeignKey, HasMany, Index } from 'sequelize-typescript';
import { DateTime } from 'luxon';

import { CalendarEvent, CalendarEventContent, CalendarEventSchedule, UrlPrompt, language } from '@/common/model/events';
import db from '@/server/common/entity/db';
import { LocationEntity } from '@/server/calendar/entity/location';
import { MediaEntity } from '@/server/media/entity/media';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { EventSeriesEntity } from '@/server/calendar/entity/event_series';
import { ImportSourceEntity } from '@/server/calendar/entity/import_source';

@Table({ tableName: 'event' })
class EventEntity extends Model {
  @PrimaryKey
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    allowNull: false,
  })
  declare id: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  declare event_source_url: string;

  @ForeignKey(() => EventEntity)
  @Column({ type: DataType.UUID })
  declare parent_event_id: string;

  /**
   * FK to CalendarEntity for events owned by a local calendar.
   * Null for remote-origin events (events copied from federation).
   * AP origin information is tracked separately in EventObjectEntity.
   */
  @ForeignKey(() => CalendarEntity)
  @Index('idx_event_calendar_id')
  @Column({ type: DataType.UUID, allowNull: true })
  declare calendar_id: string | null;

  @BelongsTo(() => CalendarEntity, 'calendar_id')
  declare calendar: CalendarEntity;

  @ForeignKey(() => LocationEntity)
  @Column({ type: DataType.UUID })
  declare location_id: string;

  @ForeignKey(() => MediaEntity)
  @Column({ type: DataType.UUID })
  declare media_id: string;

  @Column({ type: DataType.FLOAT, allowNull: false, defaultValue: 0.5 })
  declare media_focal_point_x: number;

  @Column({ type: DataType.FLOAT, allowNull: false, defaultValue: 0.5 })
  declare media_focal_point_y: number;

  @Column({ type: DataType.FLOAT, allowNull: false, defaultValue: 1.0 })
  declare media_zoom: number;

  @ForeignKey(() => EventSeriesEntity)
  @Column({ type: DataType.UUID, allowNull: true })
  declare series_id: string | null;

  @Column({ type: DataType.STRING(2048), allowNull: true })
  declare external_url: string | null;

  @Column({ type: DataType.STRING(32), allowNull: true })
  declare url_prompt: string | null;

  /**
   * ICS-import origin columns.
   *
   * Populated when this event was created by importing a subscribed ICS
   * feed. `import_source_id` links back to the parent ImportSourceEntity;
   * the remaining fields capture the metadata needed for deduplication and
   * incremental sync on subsequent import runs.
   *
   * Divergence note (pv-1qcp epic DESIGN): ActivityPub-origin events track
   * their remote origin in a sibling EventObjectEntity (see lines 31-35
   * above re: calendar_id being null for remote AP events). ICS-origin
   * events are owned by a local calendar (calendar_id is non-null) and
   * carry their upstream provenance inline here. The two origins are
   * independent: an event cannot be both AP-origin and ICS-origin, and
   * neither set of columns is serialized into the public/federation-facing
   * CalendarEvent.toObject() projection (privacy: origin provenance must
   * not leak into the public API or AP output).
   *
   * @see migration 0027_add_event_import_origin_columns.ts
   */
  @ForeignKey(() => ImportSourceEntity)
  @Column({ type: DataType.UUID, allowNull: true })
  declare import_source_id: string | null;

  @Column({ type: DataType.STRING(512), allowNull: true })
  declare external_uid: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  declare external_recurrence_id: string | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare source_last_modified: Date | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare source_last_seen_at: Date | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare locally_edited: boolean;

  @Column({ type: DataType.JSON, allowNull: true })
  declare x_props: Record<string, unknown> | null;

  @BelongsTo(() => ImportSourceEntity, 'import_source_id')
  declare importSource: ImportSourceEntity | null;

  @BelongsTo(() => EventEntity)
  declare parentEvent: EventEntity;

  @HasMany(() => EventContentEntity)
  declare content: EventContentEntity[];

  @HasMany(() => EventScheduleEntity)
  declare schedules: EventScheduleEntity[];

  @BelongsTo(() => LocationEntity)
  declare location: LocationEntity;

  @BelongsTo(() => MediaEntity)
  declare media: MediaEntity;

  @BelongsTo(() => EventSeriesEntity)
  declare series: EventSeriesEntity;

  /**
   * Association with EventCategoryAssignmentEntity defined programmatically
   * after model registration to avoid circular dependency.
   */
  declare categoryAssignments: any[];

  toModel(): CalendarEvent {
    let model = new CalendarEvent(this.id, this.calendar_id, this.event_source_url);
    model.locationId = this.location_id || null;
    model.mediaFocalPointX = this.media_focal_point_x;
    model.mediaFocalPointY = this.media_focal_point_y;
    model.mediaZoom = this.media_zoom;
    model.externalUrl = this.external_url;
    model.urlPrompt = this.url_prompt as UrlPrompt | null;
    // ICS-origin metadata (server-side read-only; NOT serialized publicly).
    // Populated for events that were created by importing an ICS feed so
    // the service layer can make origin-aware decisions (skip on
    // locally_edited, re-run dedup, etc.). See CalendarEvent docstring.
    model.importSourceId = this.import_source_id ?? null;
    model.externalUid = this.external_uid ?? null;
    model.externalRecurrenceId = this.external_recurrence_id ?? null;
    model.sourceLastModified = this.source_last_modified ?? null;
    model.sourceLastSeenAt = this.source_last_seen_at ?? null;
    model.locallyEdited = this.locally_edited ?? false;
    model.xProps = this.x_props ?? null;
    if (this.location) {
      model.location = this.location.toModel();
    }
    if (this.media) {
      model.media = this.media.toModel();
    }
    if (this.content && this.content.length > 0) {
      for (let content of this.content) {
        model.addContent(content.toModel());
      }
    }
    if (this.series) {
      model.series = this.series.toModel();
    }
    return model;
  };

  /**
   * Creates an EventEntity from a CalendarEvent model.
   */
  static fromModel(event: CalendarEvent): EventEntity {
    return EventEntity.build({
      id: event.id,
      event_source_url: event.eventSourceUrl,
      calendar_id: event.calendarId,
      media_id: event.media?.id,
      media_focal_point_x: event.mediaFocalPointX,
      media_focal_point_y: event.mediaFocalPointY,
      media_zoom: event.mediaZoom,
      series_id: event.series?.id ?? null,
      external_url: event.externalUrl,
      url_prompt: event.urlPrompt,
      // ICS-origin columns. These are on the domain model but not on the
      // public toObject() projection; they round-trip through the server
      // boundary only.
      import_source_id: event.importSourceId,
      external_uid: event.externalUid,
      external_recurrence_id: event.externalRecurrenceId,
      source_last_modified: event.sourceLastModified,
      source_last_seen_at: event.sourceLastSeenAt,
      locally_edited: event.locallyEdited,
      x_props: event.xProps,
    });
  }
};

@Table({ tableName: 'event_content' })
class EventContentEntity extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID })
  declare id: string;

  @ForeignKey(() => EventEntity)
  @Index('idx_event_content_event_id')
  @Column({ type: DataType.UUID })
  declare event_id: string;

  @Column({ type: DataType.STRING })
  declare language: string;

  @Index('idx_event_content_name')
  @Column({ type: DataType.STRING })
  declare name: string;

  @Column({ type: DataType.TEXT })
  declare description: string;

  @Column({ type: DataType.TEXT })
  declare accessibility_info: string;

  @BelongsTo(() => EventEntity)
  declare event: EventEntity;

  toModel(): CalendarEventContent {
    let content = new CalendarEventContent( this.language as language );
    content.name = this.name;
    content.description = this.description;
    content.accessibilityInfo = this.accessibility_info ?? '';

    return content;
  }

  static fromModel(content: CalendarEventContent): EventContentEntity {
    return EventContentEntity.build({
      language: content.language as string,
      name: content.name,
      description: content.description,
      accessibility_info: content.accessibilityInfo,
    });
  }
};

@Table({ tableName: 'event_schedule' })
class EventScheduleEntity extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID })
  declare id: string;

  @ForeignKey(() => EventEntity)
  @Column({ type: DataType.UUID })
  declare event_id: string;

  @Column({ type: DataType.STRING })
  declare timezone: string;

  @Column({ type: DataType.DATE })
  declare start_date: Date;

  @Column({ type: DataType.DATE })
  declare end_date: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  declare event_end_time: Date | null;

  @Column({ type: DataType.STRING })
  declare frequency: string;

  @Column({ type: DataType.INTEGER })
  declare interval: number;

  @Column({ type: DataType.INTEGER })
  declare count: number;

  @Column({ type: DataType.STRING })
  declare by_day: string;

  @Column({ type: DataType.BOOLEAN })
  declare is_exclusion: boolean;

  /**
   * Distinguishes EXDATE-style silent exclusion (true) from
   * RECURRENCE-ID cancellation override (false).
   *
   * Only meaningful when is_exclusion = true:
   *   - true  → occurrence is silently omitted from public-facing output (EXDATE).
   *   - false → occurrence is emitted publicly but marked as cancelled
   *             (iCalendar RECURRENCE-ID with STATUS:CANCELLED semantics).
   */
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  declare hide_from_public: boolean;

  @BelongsTo(() => EventEntity)
  declare event: EventEntity;

  toModel(): CalendarEventSchedule {
    const zone = this.timezone || 'UTC';
    // Sequelize SQLite stores naive datetime strings and reads them back as UTC
    // (appending "+00:00"). The UTC digit values represent the intended local time,
    // so we reinterpret them as the event's timezone using UTC field accessors.
    const toLocalDT = (d: Date | null | undefined): DateTime | null => {
      if (!d) return null;
      return DateTime.fromObject(
        {
          year: d.getUTCFullYear(),
          month: d.getUTCMonth() + 1,
          day: d.getUTCDate(),
          hour: d.getUTCHours(),
          minute: d.getUTCMinutes(),
          second: d.getUTCSeconds(),
          millisecond: d.getUTCMilliseconds(),
        },
        { zone },
      );
    };
    const schedule = new CalendarEventSchedule(
      this.id,
      toLocalDT(this.start_date) ?? undefined,
      toLocalDT(this.end_date) ?? undefined,
    );
    schedule.eventEndTime = toLocalDT(this.event_end_time);
    schedule.frequency = this.frequency
      ? CalendarEventSchedule.parseFrequency(this.frequency)
      : null;
    schedule.interval = this.interval;
    schedule.count = this.count;
    schedule.byDay = this.by_day ? this.by_day.split(',') : [];
    schedule.isExclusion = this.is_exclusion;
    schedule.hideFromPublic = this.hide_from_public;
    return schedule;
  }

  /**
   * Converts a Luxon DateTime to a JS Date for database storage,
   * preserving local-time digit values as UTC digits.
   * Sequelize SQLite appends "+00:00" to naive strings, treating stored values as UTC.
   * By converting with keepLocalTime: true, toModel() can reverse this correctly.
   */
  static toStorageDate(dt: DateTime | null | undefined): Date | undefined {
    if (!dt) return undefined;
    return dt.setZone('UTC', { keepLocalTime: true }).toJSDate();
  }

  static fromModel(schedule: CalendarEventSchedule): EventScheduleEntity {
    const tz = schedule.startDate?.zoneName ?? 'UTC';
    return EventScheduleEntity.build({
      id: schedule.id,
      timezone: tz,
      start_date: EventScheduleEntity.toStorageDate(schedule.startDate),
      end_date: EventScheduleEntity.toStorageDate(schedule.endDate),
      event_end_time: EventScheduleEntity.toStorageDate(schedule.eventEndTime),
      frequency: schedule.frequency as string,
      interval: schedule.interval,
      count: schedule.count,
      by_day: schedule.byDay ? schedule.byDay.join(',') : '',
      is_exclusion: schedule.isExclusion,
      hide_from_public: schedule.hideFromPublic,
    });
  }
};

/**
 * Import EventCategoryAssignmentEntity after all class definitions.
 * This import happens after the EventEntity class is fully defined,
 * but event_category_assignment.ts doesn't import EventEntity,
 * so there's no circular dependency at module load time.
 */
import { EventCategoryAssignmentEntity } from './event_category_assignment';
import { EventCategoryEntity } from './event_category';

/**
 * Register all entities with Sequelize.
 *
 * CIRCULAR DEPENDENCY RESOLUTION:
 * Both EventEntity and EventCategoryAssignmentEntity are registered together
 * to ensure both classes exist before associations are defined.
 */
db.addModels([EventEntity, EventContentEntity, EventScheduleEntity, EventCategoryAssignmentEntity]);

/**
 * Define associations programmatically after model registration.
 *
 * This approach breaks the circular dependency by:
 * 1. EventEntity class is defined without importing EventCategoryAssignmentEntity
 * 2. EventCategoryAssignmentEntity class is defined without importing EventEntity
 * 3. Both entities are registered with Sequelize
 * 4. Associations are established using direct class references (no decorators)
 *
 * This is cleaner than an async IIFE because it executes synchronously during
 * module initialization, ensuring associations are ready before any code uses them.
 */
EventEntity.hasMany(EventCategoryAssignmentEntity, {
  foreignKey: 'event_id',
  as: 'categoryAssignments',
});

EventCategoryAssignmentEntity.belongsTo(EventEntity, {
  foreignKey: 'event_id',
  as: 'event',
});

EventCategoryAssignmentEntity.belongsTo(EventCategoryEntity, {
  foreignKey: 'category_id',
  as: 'category',
});

/**
 * Define Calendar <-> Event associations.
 *
 * The calendar association is already defined via @BelongsTo decorator.
 * This programmatic definition adds the hasMany side for eager loading.
 */
CalendarEntity.hasMany(EventEntity, {
  foreignKey: 'calendar_id',
  as: 'events',
});

export {
  EventEntity,
  EventContentEntity,
  EventScheduleEntity,
};
